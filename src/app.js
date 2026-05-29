/**
 * app.js — chrome (the desktop) main entry.
 *
 * Day-2 ships the window manager. The launcher button (and ⌘Space)
 * spawns demo windows so the WM is exercise-able. Real launcher,
 * registry-installed apps, auth, and real-time come in coming days.
 */

import { startClock } from "./tray.js";
import {
  openWindow, listWindows, onWindowsChange,
  focusWindow, minimizeWindow, restoreWindow,
  getCurrentDesk, getDesks, switchDesk, addDesk, removeDesk, nextDesk, prevDesk,
} from "./windows.js";
import { openLauncher, closeLauncher, isOpen as launcherIsOpen } from "./launcher.js";
import { onAuth, getAuth, authFetch, login, logout } from "./auth.js";
import { subscribe } from "./notifications.js";
import { list as listInstalled, onChange as onInstalledChange, syncFromPod as syncInstalledFromPod } from "./installed.js";
import { listApps as listRegistryApps, loadApp } from "./registry.js";
import { listBuiltins } from "./builtins/index.js";
import * as wallpaper from "./wallpaper.js";
import { toggleQuickSettings } from "./quick-settings.js";
import "./lock.js"; // import for side-effect: idle auto-lock listener
import "./desktop.js"; // import for side-effect: renders app icons on the desktop surface
import "./session.js"; // import for side-effect: saves + restores open windows across reloads

// ---- Theme (system pref → localStorage). ----
function resolveTheme() {
  const saved = localStorage.getItem("chrome-theme");
  if (saved === "light" || saved === "dark") return saved;
  return matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
}
function setTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem("chrome-theme", t);
}
setTheme(resolveTheme());

// Apply any cached wallpaper before first paint.
wallpaper.apply();

// ---- Shelf — pinned apps (always visible, click to launch) +
//      running windows (one pill per open window). The two are
//      separated by a thin divider so the user can tell them apart.
const shelfRunning = document.getElementById("shelf-running");
let registryAppsByUrl = new Map(); // url → registry entry, used for icon/name
const launchingByUrl = new Set();   // for the spinner state

(async function preloadRegistry() {
  try {
    const entries = await listRegistryApps();
    registryAppsByUrl = new Map(entries.map(e => [e.url, e]));
    drawShelf();
  } catch { /* keep empty map; pinned apps just show URLs */ }
})();

function drawShelf() {
  const wins = listWindows();
  const installed = listInstalled();
  const builtins = listBuiltins();
  // Pinned apps that already have a window open are deduped from the
  // pinned area — the running pill represents them.
  const runningUrls = new Set(wins.map(w => w.app?.url).filter(Boolean));
  const builtinNotRunning = builtins.filter(b => !runningUrls.has(b.url));
  const pinnedNotRunning = installed.filter(u => !runningUrls.has(u));

  if (!installed.length && !wins.length && !builtins.length) {
    shelfRunning.innerHTML = `<span class="shelf-empty">no apps pinned · ⌘Space to launch · star apps to pin</span>`;
    return;
  }

  const builtinHTML = builtinNotRunning.map(b => {
    const launching = launchingByUrl.has(b.url);
    return `
      <button class="shelf-app builtin ${launching ? "launching" : ""}" data-launch-url="${escape(b.url)}" title="${escape(b.name)}">
        <span class="shelf-app-icon">${escape(b.icon)}</span>
        <span class="shelf-app-name">${escape(b.name)}</span>
      </button>
    `;
  }).join("");

  const pinnedHTML = pinnedNotRunning.map(url => {
    const meta = registryAppsByUrl.get(url) || {};
    const launching = launchingByUrl.has(url);
    return `
      <button class="shelf-app pinned ${launching ? "launching" : ""}" data-launch-url="${escape(url)}" title="${escape(meta.name || url)}">
        <span class="shelf-app-icon">${escape(meta.icon || "▢")}</span>
        <span class="shelf-app-name">${escape(meta.name || url.split("/").pop())}</span>
      </button>
    `;
  }).join("");

  const runningHTML = wins.map(w => `
    <button class="shelf-app ${w.active ? "active" : ""} ${w.minimized ? "minimized" : ""}" data-wid="${w.id}" title="${escape(w.title)}">
      <span class="shelf-app-icon">${escape(w.icon || "▢")}</span>
      <span class="shelf-app-name">${escape(w.title)}</span>
    </button>
  `).join("");

  const sepBeforePinned = (builtinHTML && pinnedHTML) ? `<span class="shelf-sep"></span>` : "";
  const sepBeforeRunning = ((builtinHTML || pinnedHTML) && runningHTML) ? `<span class="shelf-sep"></span>` : "";
  shelfRunning.innerHTML = builtinHTML + sepBeforePinned + pinnedHTML + sepBeforeRunning + runningHTML;

  for (const btn of shelfRunning.querySelectorAll("[data-wid]")) {
    btn.addEventListener("click", () => {
      const id = +btn.dataset.wid;
      const w = listWindows().find(x => x.id === id);
      if (!w) return;
      if (w.minimized) restoreWindow(id);
      else if (!w.active) focusWindow(id);
      else minimizeWindow(id);
    });
  }
  for (const btn of shelfRunning.querySelectorAll("[data-launch-url]")) {
    btn.addEventListener("click", () => launchPinned(btn.dataset.launchUrl));
  }
}

async function launchPinned(url) {
  if (launchingByUrl.has(url)) return;
  launchingByUrl.add(url); drawShelf();
  try {
    const app = await loadApp(url);
    const builtinMeta = listBuiltins().find(b => b.url === url);
    const meta = builtinMeta || registryAppsByUrl.get(url) || {};
    openWindow({
      title: app.meta?.name || meta.name || url,
      icon:  app.meta?.icon || meta.icon || "📦",
      width:  app.meta?.width  || 720,
      height: app.meta?.height || 480,
      app:   { url, meta: app.meta },
      render(content, win) {
        const ctx = makeAppCtx(win);
        try { Promise.resolve(app.render(content, ctx)).catch(e => {
          content.innerHTML = `<div style="padding:18px;color:var(--danger);font:13px var(--mono)">App error: ${escape(e.message)}</div>`;
        }); } catch (e) {
          content.innerHTML = `<div style="padding:18px;color:var(--danger);font:13px var(--mono)">App error: ${escape(e.message)}</div>`;
        }
      },
    });
  } catch (e) {
    alert("Couldn't launch: " + e.message);
  } finally {
    launchingByUrl.delete(url); drawShelf();
  }
}

// Build the same ctx the launcher does. Keep them in sync — apps
// expect identical contracts whether launched from the shelf or the
// launcher overlay.
function makeAppCtx(win) {
  return {
    get auth() { return getAuth(); },
    fetch: authFetch,
    subscribe,
    openWindow,
    closeWindow: () => win.close(),
    setTitle: (t) => win.setTitle(t),
  };
}

function drawDesks() {
  const el = document.getElementById("tray-desks");
  if (!el) return;
  const desks = getDesks();
  const cur = getCurrentDesk();
  el.innerHTML = desks.map(id => `
    <button class="tray-desk ${id === cur ? "active" : ""}" data-desk="${id}" title="Desk ${id}"></button>
  `).join("") + `<button class="tray-desk-add" id="tray-desk-add" title="New desk">+</button>`;
  for (const b of el.querySelectorAll("[data-desk]")) {
    b.addEventListener("click", () => switchDesk(+b.dataset.desk));
    b.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (getDesks().length > 1 && confirm(`Remove desk ${b.dataset.desk}?`)) {
        removeDesk(+b.dataset.desk);
      }
    });
  }
  el.querySelector("#tray-desk-add").addEventListener("click", () => addDesk());
}

onWindowsChange(() => { drawShelf(); drawDesks(); });
onInstalledChange(drawShelf);
drawShelf();
drawDesks();

// ---- Tray buttons ----
document.getElementById("tray-launcher").addEventListener("click", () => {
  launcherIsOpen() ? closeLauncher() : openLauncher();
});
document.getElementById("tray-quick").addEventListener("click", (e) => {
  e.stopPropagation();
  toggleQuickSettings();
});
// Auth pill — clicking signs in (when logged out) or shows a small
// menu (when logged in). For day 4 the menu is just "Sign out".
const authPill = document.getElementById("tray-auth");
authPill.addEventListener("click", () => {
  const a = authStateRef.current;
  if (!a.loggedIn) login();
  else if (confirm(`Sign out ${shortName(a)}?`)) logout();
});

const authStateRef = { current: { loggedIn: false } };
let lastSyncedFor = null;
onAuth((a) => {
  authStateRef.current = a;
  authPill.textContent = a.loggedIn ? shortName(a) : "Sign in";
  authPill.classList.toggle("tray-auth-on", a.loggedIn);
  authPill.title = a.loggedIn
    ? `${a.id} (${a.type}) — click to sign out`
    : "Sign in with WebID or Nostr key";

  // Pull the user's installed-apps list from their pod once per
  // sign-in. If it differs from the localStorage cache, prompt to
  // reload so the shelf reflects the canonical pod state. Solid
  // sessions only — Nostr-only sessions don't have a TypeIndex.
  if (a.loggedIn && a.type === "solid" && a.id !== lastSyncedFor) {
    lastSyncedFor = a.id;
    syncInstalledFromPod(a.id).then((r) => {
      if (r.changed) {
        if (confirm(
          "Your pod has a different installed-apps list than this browser.\n\n" +
          `Pod: ${r.items.length} app${r.items.length === 1 ? "" : "s"}\n` +
          "Reload to apply?"
        )) location.reload();
      }
    }).catch(() => { /* best-effort */ });
    // Silently pull the wallpaper from pod and apply if it changed.
    wallpaper.syncFromPod(a.id).catch(() => {});
  }
});

function shortName(a) {
  if (!a.id) return "you";
  try { return new URL(a.id).hostname.replace(/^www\./, ""); }
  catch { return a.id.length > 14 ? a.id.slice(0, 6) + "…" + a.id.slice(-4) : a.id; }
}
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.code === "Space") {
    e.preventDefault();
    launcherIsOpen() ? closeLauncher() : openLauncher();
  }
  // Cmd+] / Cmd+[ — switch desks. Cmd+] at the last desk creates a new one.
  // Don't intercept when the user is typing in an input or contenteditable.
  if ((e.metaKey || e.ctrlKey) && (e.key === "]" || e.key === "[")) {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) return;
    e.preventDefault();
    e.key === "]" ? nextDesk() : prevDesk();
  }
});

// ---- Live clock ----
startClock(document.getElementById("tray-clock"));

function escape(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
