/**
 * session.js — persist & restore open windows across reloads.
 *
 * Saves each window's app/pane + geometry (x/y/w/h, maximized, minimized,
 * desk) to localStorage on every window change (debounced), and re-opens
 * them on boot once auth has settled. App windows re-launch their module;
 * pane windows (opened from Files) re-fetch their resource and re-dispatch.
 *
 * Shared engine — chrome/win98/ubuntu all get session restore. Per-device
 * (localStorage), same as desktop icon positions; pod-sync is a later option.
 */

import { onWindowsChange, serializeWindows } from "./windows.js";
import { launchApp } from "./launcher.js";
import { openPaneFor } from "./panes.js";
import { authFetch, getAuth, onAuth } from "./auth.js";
import { subscribe } from "./notifications.js";
import { schedulePush, pullFromPod } from "./sync.js";

const KEY = "chrome-session";
let restored = false;
let kicked = false;
let saveTimer = null;

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(serializeWindows())); } catch { /* ignore quota */ }
    const a = getAuth();
    if (a?.loggedIn && a.type === "solid") schedulePush(a.id);   // mirror session to the pod
  }, 400);
}

function ctx() {
  return { get auth() { return getAuth(); }, fetch: authFetch, subscribe };
}

async function restoreOne(s) {
  const geom = { x: s.x, y: s.y, w: s.w, h: s.h, maximized: s.maximized, minimized: s.minimized, desk: s.desk };
  if (s.kind === "pane" && s.resource) {
    let doc = null;
    try {
      const r = await authFetch(s.resource, { headers: { Accept: "application/ld+json" } });
      if (r.ok) doc = await r.json().catch(() => null);
    } catch { /* offline / no access — pane handles a null doc */ }
    await openPaneFor({ url: s.resource, doc, types: s.types || [] }, ctx(), geom);
  } else {
    await launchApp(s.url, geom);
  }
}

export async function restoreSession() {
  if (restored) return;
  restored = true;
  let list = [];
  try { list = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { list = []; }
  for (const s of list) {
    try { await restoreOne(s); } catch { /* skip a window that won't restore */ }
  }
}

// Persist on every open/close/move/resize/min/max/focus.
onWindowsChange(save);

// Restore once, after auth has had a chance to settle. When signed in to a pod,
// pull the canonical session first (so restore reflects other devices), then
// restore. Fall back to a timer (localStorage-only) if no auth event arrives.
onAuth(async (a) => {
  if (kicked) return;
  kicked = true;
  if (a?.loggedIn && a.type === "solid") {
    try { await pullFromPod(a.id); } catch { /* fall back to local session */ }
    schedulePush(a.id);
  }
  restoreSession();
});
setTimeout(() => { if (!kicked) { kicked = true; restoreSession(); } }, 1500);
