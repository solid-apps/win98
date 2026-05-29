/**
 * desktop.js — icons on the desktop surface.
 *
 * Renders the installed (pod-synced) apps + builtins as icons on the
 * wallpaper. Single click/tap launches (reusing the launcher's launch
 * path); drag to arrange. Icon *positions* persist in localStorage,
 * per app URL. The *set* of icons already follows you across devices
 * via the pod-backed installed-apps list (installed.js).
 *
 * Renders into #desktop, a pointer-transparent layer sized by each
 * skin's CSS to the free desktop area (below the bar, clear of the
 * dock/shelf). No-ops if that element is absent.
 */

import { list as listInstalled, onChange as onInstalledChange } from "./installed.js";
import { listApps } from "./registry.js";
import { listBuiltins } from "./builtins/index.js";
import { launchApp } from "./launcher.js";

const POS_KEY = "chrome-desktop-icons";
const CELL = 96;   // icon cell for auto-layout
const PAD  = 16;

let metaByUrl = new Map();
let positions = loadPositions();

function loadPositions() {
  try { return new Map(Object.entries(JSON.parse(localStorage.getItem(POS_KEY) || "{}"))); }
  catch { return new Map(); }
}
function savePositions() {
  try { localStorage.setItem(POS_KEY, JSON.stringify(Object.fromEntries(positions))); } catch {}
}

function items() {
  const builtins = listBuiltins().map(b => ({ url: b.url, name: b.name, icon: b.icon }));
  const bset = new Set(builtins.map(b => b.url));
  const installed = listInstalled()
    .filter(u => !bset.has(u))
    .map(u => {
      const m = metaByUrl.get(u) || {};
      return { url: u, name: m.name || u.split("/").filter(Boolean).pop(), icon: m.icon || "📦" };
    });
  return [...builtins, ...installed];
}

function autoPos(i, H) {
  const perCol = Math.max(1, Math.floor((H - PAD * 2) / CELL));
  const col = Math.floor(i / perCol), row = i % perCol;
  return { x: PAD + col * CELL, y: PAD + row * CELL };
}

function render() {
  const layer = document.getElementById("desktop");
  if (!layer) return;
  const H = layer.clientHeight || window.innerHeight;
  const list = items();
  layer.innerHTML = "";
  list.forEach((it, i) => {
    const pos = positions.get(it.url) || autoPos(i, H);
    const el = document.createElement("button");
    el.className = "desk-icon";
    el.style.left = pos.x + "px";
    el.style.top = pos.y + "px";
    el.dataset.url = it.url;
    el.title = it.name;
    el.innerHTML = `<span class="desk-icon-glyph">${escape(it.icon)}</span><span class="desk-icon-label">${escape(it.name)}</span>`;
    wireIcon(el, it.url);
    layer.appendChild(el);
  });
}

// Pointer-driven: a small move threshold separates a drag (reposition +
// save) from a tap (launch), so it feels right on both mouse and touch.
function wireIcon(el, url) {
  let down = null, dragged = false;
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    down = { x: e.clientX, y: e.clientY, ox: parseInt(el.style.left) || 0, oy: parseInt(el.style.top) || 0 };
    dragged = false;
    try { el.setPointerCapture(e.pointerId); } catch {}
  });
  el.addEventListener("pointermove", (e) => {
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (!dragged && Math.abs(dx) + Math.abs(dy) < 5) return;
    dragged = true;
    el.style.left = Math.max(0, down.ox + dx) + "px";
    el.style.top  = Math.max(0, down.oy + dy) + "px";
  });
  el.addEventListener("pointerup", (e) => {
    if (!down) return;
    try { el.releasePointerCapture(e.pointerId); } catch {}
    if (dragged) {
      positions.set(url, { x: parseInt(el.style.left) || 0, y: parseInt(el.style.top) || 0 });
      savePositions();
    } else {
      launchApp(url);
    }
    down = null;
  });
}

function escape(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

// Boot: builtins + cached installed render immediately; enrich names/icons
// from the registry; re-render when the installed list changes (e.g. after
// a pod sync or pinning an app from the launcher).
render();
listApps().then(list => { metaByUrl = new Map(list.map(a => [a.url, a])); render(); }).catch(() => {});
onInstalledChange(render);
