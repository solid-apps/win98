/**
 * windows.js — window manager.
 *
 * Public API:
 *   openWindow({ title, icon, app, render, width, height, x, y })
 *     → returns a handle: { id, close(), setTitle(s), focus(), getEl() }
 *
 *   onWindowsChange(cb)  // notified on open/close/focus/min/max/move/resize
 *   listWindows()        // current state, for the shelf to render running apps
 *
 * `render(content, win)` is called once when the window opens. `content`
 * is the inner DOM container for the app's UI; `win` is the same handle
 * as returned by openWindow. Apps treat `content` like the body slot
 * (set innerHTML, append children, etc.).
 *
 * Behaviour:
 *   - Title-bar drag to move; eight resize handles (4 edges + 4 corners)
 *   - Click anywhere → bring to front (z-order managed here)
 *   - Snap-to-edge during drag: top = maximize, left/right = half-screen
 *     tile. Snap is committed on release.
 *   - Minimum size 280×180; never smaller than the title bar.
 *   - Maximize: cover the workspace (viewport minus tray + shelf).
 *   - Minimize: hide the window node, keep state for restore.
 *   - Esc inside window closes the focused popover-style dialog if any
 *     (apps can opt in); otherwise no-op at the WM level.
 */

const TRAY_H = 0;    // win98: no top tray
const SHELF_H = 28;  // taskbar at the bottom (matches style.css .taskbar)
const MIN_W = 280;
const MIN_H = 180;
const SNAP_EDGE = 12;     // px from viewport edge to trigger snap preview
const SNAP_PREVIEW_FADE = 120; // ms

let nextId = 1;
let nextZ = 100;
let active = null;
const all = [];        // { id, el, content, title, icon, app, x, y, w, h, minimized, maximized, beforeMaximize, desk }
const subs = new Set();

// ---- Desks (virtual workspaces) ----
let desks = [1];
let currentDesk = 1;
let nextDeskId = 2;

export function getCurrentDesk() { return currentDesk; }
export function getDesks() { return desks.slice(); }

function applyDeskVisibility() {
  for (const w of all) {
    const onThisDesk = w.desk === currentDesk;
    w.el.style.display = (onThisDesk && !w.minimized) ? "" : "none";
  }
}

export function switchDesk(id) {
  if (!desks.includes(id) || id === currentDesk) return;
  currentDesk = id;
  applyDeskVisibility();
  // Refocus the topmost visible window on the new desk.
  const onDesk = all.filter(w => w.desk === id && !w.minimized);
  active = onDesk.length ? onDesk[onDesk.length - 1].id : null;
  if (active) focus(active);
  notify();
}

export function addDesk() {
  const id = nextDeskId++;
  desks.push(id);
  switchDesk(id);
  return id;
}

export function removeDesk(id) {
  if (desks.length <= 1) return;
  // Move any windows on the doomed desk to the previous desk.
  const i = desks.indexOf(id);
  if (i < 0) return;
  const next = desks[i - 1] ?? desks[i + 1];
  for (const w of all) if (w.desk === id) w.desk = next;
  desks.splice(i, 1);
  if (currentDesk === id) switchDesk(next);
  notify();
}

export function nextDesk() {
  const i = desks.indexOf(currentDesk);
  if (i === desks.length - 1) addDesk();
  else switchDesk(desks[i + 1]);
}
export function prevDesk() {
  const i = desks.indexOf(currentDesk);
  if (i > 0) switchDesk(desks[i - 1]);
}

let snapPreviewEl = null;
let pendingSnap = null; // {edge: "top"|"left"|"right", rect}

function workspaceRect() {
  return {
    x: 0,
    y: TRAY_H,
    w: window.innerWidth,
    h: window.innerHeight - TRAY_H - SHELF_H,
  };
}

export function listWindows() {
  // Returns only the windows on the current desk — what the shelf
  // and switcher should show. Use listAllWindows() if you need
  // global state.
  return all
    .filter(w => w.desk === currentDesk)
    .map(w => ({
      id: w.id, title: w.title, icon: w.icon, app: w.app, desk: w.desk,
      minimized: w.minimized, maximized: w.maximized,
      active: active === w.id,
    }));
}

export function listAllWindows() {
  return all.map(w => ({
    id: w.id, title: w.title, icon: w.icon, app: w.app, desk: w.desk,
    minimized: w.minimized, maximized: w.maximized,
    active: active === w.id,
  }));
}

export function onWindowsChange(cb) {
  subs.add(cb);
  return () => subs.delete(cb);
}
function notify() { for (const cb of subs) try { cb(listWindows()); } catch {} }

export function openWindow(opts = {}) {
  const id = nextId++;
  const wsRect = workspaceRect();
  const w = Math.max(MIN_W, Math.min(opts.width  || 720, wsRect.w - 80));
  const h = Math.max(MIN_H, Math.min(opts.height || 480, wsRect.h - 60));
  const cx = wsRect.x + (wsRect.w - w) / 2;
  const cy = wsRect.y + (wsRect.h - h) / 2;
  const x = clamp(opts.x ?? cx, wsRect.x, wsRect.x + wsRect.w - w);
  const y = clamp(opts.y ?? cy, wsRect.y, wsRect.y + wsRect.h - h);

  const el = document.createElement("div");
  el.className = "window";
  el.dataset.wid = String(id);
  el.style.cssText = `
    position: absolute; left: ${x}px; top: ${y}px;
    width: ${w}px; height: ${h}px;
    z-index: ${++nextZ};
  `;
  el.innerHTML = `
    <div class="win-titlebar" data-role="titlebar">
      <div class="win-title">
        ${opts.icon ? `<span class="win-icon">${escape(opts.icon)}</span>` : ""}
        <span class="win-title-text" data-role="title-text">${escape(opts.title || "Untitled")}</span>
      </div>
      <div class="win-actions">
        <button class="win-act win-min"   data-role="min"   title="Minimize">—</button>
        <button class="win-act win-max"   data-role="max"   title="Maximize">▢</button>
        <button class="win-act win-close" data-role="close" title="Close">×</button>
      </div>
    </div>
    <div class="win-content" data-role="content"></div>
    ${["n","s","e","w","ne","nw","se","sw"].map(d => `<div class="win-resize win-${d}" data-resize="${d}"></div>`).join("")}
  `;

  const win = {
    id, el,
    content: el.querySelector('[data-role="content"]'),
    title: opts.title || "Untitled",
    icon: opts.icon || null,
    app: opts.app || null,
    x, y, w, h,
    desk: opts.desk ?? currentDesk,
    minimized: false, maximized: false, beforeMaximize: null,
  };
  all.push(win);

  document.getElementById("windows").appendChild(el);
  wireWindow(win);
  focus(id);

  // Run the app's render. If it throws, surface inline rather than dying.
  try {
    const handle = makeHandle(win);
    Promise.resolve(opts.render?.(win.content, handle)).catch(e => {
      win.content.innerHTML = `<div class="win-error">App render error: ${escape(e?.message || String(e))}</div>`;
    });
  } catch (e) {
    win.content.innerHTML = `<div class="win-error">App render error: ${escape(e?.message || String(e))}</div>`;
  }

  notify();
  return makeHandle(win);
}

function makeHandle(win) {
  return {
    id: win.id,
    close: () => closeWindow(win.id),
    focus: () => focus(win.id),
    setTitle: (s) => {
      win.title = s ?? "";
      const el = win.el.querySelector('[data-role="title-text"]');
      if (el) el.textContent = win.title;
      notify();
    },
    minimize: () => minimize(win.id),
    maximize: () => maximize(win.id),
    restore:  () => restore(win.id),
    getEl: () => win.el,
    getContent: () => win.content,
  };
}

// Direct-by-id ops, for the shelf and other host code that operates on
// windows by their id (returned via listWindows()).
export const focusWindow    = focus;
export const minimizeWindow = minimize;
export const maximizeWindow = maximize;
export const restoreWindow  = restore;
export const closeWindowById = closeWindow;

function focus(id) {
  const w = all.find(x => x.id === id);
  if (!w) return;
  active = id;
  w.el.style.zIndex = String(++nextZ);
  for (const x of all) x.el.classList.toggle("win-active", x.id === id);
  notify();
}

function closeWindow(id) {
  const i = all.findIndex(x => x.id === id);
  if (i < 0) return;
  const w = all[i];
  w.el.remove();
  all.splice(i, 1);
  if (active === id) active = all[all.length - 1]?.id || null;
  if (active) focus(active);
  notify();
}

function minimize(id) {
  const w = all.find(x => x.id === id);
  if (!w) return;
  w.minimized = true;
  w.el.style.display = "none";
  if (active === id) {
    const next = all.filter(x => !x.minimized).pop();
    active = next?.id || null;
    if (active) focus(active);
  }
  notify();
}

function maximize(id) {
  const w = all.find(x => x.id === id);
  if (!w) return;
  if (w.maximized) return restore(id);
  w.beforeMaximize = { x: w.x, y: w.y, w: w.w, h: w.h };
  const r = workspaceRect();
  setBox(w, r.x, r.y, r.w, r.h);
  w.maximized = true;
  w.el.classList.add("win-maximized");
  focus(id);
}

function restore(id) {
  const w = all.find(x => x.id === id);
  if (!w) return;
  if (w.minimized) {
    w.minimized = false;
    w.el.style.display = "";
    focus(id);
    notify();
    return;
  }
  if (w.maximized && w.beforeMaximize) {
    setBox(w, w.beforeMaximize.x, w.beforeMaximize.y, w.beforeMaximize.w, w.beforeMaximize.h);
    w.maximized = false;
    w.el.classList.remove("win-maximized");
    focus(id);
  }
}

function setBox(w, x, y, ww, hh) {
  w.x = x; w.y = y; w.w = ww; w.h = hh;
  w.el.style.left = `${x}px`;
  w.el.style.top = `${y}px`;
  w.el.style.width = `${ww}px`;
  w.el.style.height = `${hh}px`;
}

// ---- Window-level interactions: focus, drag, resize, action buttons ----

function wireWindow(w) {
  // Focus on any pointerdown.
  w.el.addEventListener("pointerdown", () => focus(w.id), { capture: true });

  // Title-bar buttons.
  w.el.querySelector('[data-role="min"]').addEventListener("click", e => { e.stopPropagation(); minimize(w.id); });
  w.el.querySelector('[data-role="max"]').addEventListener("click", e => { e.stopPropagation(); maximize(w.id); });
  w.el.querySelector('[data-role="close"]').addEventListener("click", e => { e.stopPropagation(); closeWindow(w.id); });

  // Drag from title bar.
  const titlebar = w.el.querySelector('[data-role="titlebar"]');
  titlebar.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".win-actions")) return;
    if (e.button !== 0) return;
    e.preventDefault();
    if (w.maximized) {
      // Restore to a window of beforeMaximize size positioned under cursor.
      const before = w.beforeMaximize || { w: 720, h: 480 };
      const dx = e.clientX - before.w / 2;
      const dy = e.clientY - 16;
      restore(w.id);
      setBox(w, dx, dy, before.w, before.h);
    }
    const offsetX = e.clientX - w.x;
    const offsetY = e.clientY - w.y;
    titlebar.setPointerCapture(e.pointerId);

    const onMove = (ev) => {
      const r = workspaceRect();
      const x = clamp(ev.clientX - offsetX, r.x - w.w + 60, r.x + r.w - 60);
      const y = clamp(ev.clientY - offsetY, r.y, r.y + r.h - 32);
      setBox(w, x, y, w.w, w.h);

      // Snap detection
      let edge = null;
      if (ev.clientY <= TRAY_H + SNAP_EDGE) edge = "top";
      else if (ev.clientX <= SNAP_EDGE) edge = "left";
      else if (ev.clientX >= window.innerWidth - SNAP_EDGE) edge = "right";
      pendingSnap = edge ? { edge, rect: snapRect(edge) } : null;
      drawSnapPreview();
    };
    const onUp = (ev) => {
      titlebar.releasePointerCapture(ev.pointerId);
      titlebar.removeEventListener("pointermove", onMove);
      titlebar.removeEventListener("pointerup", onUp);
      titlebar.removeEventListener("pointercancel", onUp);
      if (pendingSnap) {
        const { edge, rect } = pendingSnap;
        if (edge === "top") {
          maximize(w.id);
        } else {
          w.beforeMaximize = { x: w.x, y: w.y, w: w.w, h: w.h };
          setBox(w, rect.x, rect.y, rect.w, rect.h);
          w.maximized = false; // half-tile is its own state, treat as windowed
        }
        pendingSnap = null;
        drawSnapPreview();
      }
    };
    titlebar.addEventListener("pointermove", onMove);
    titlebar.addEventListener("pointerup", onUp);
    titlebar.addEventListener("pointercancel", onUp);
  });

  // Double-click title bar → toggle maximize.
  titlebar.addEventListener("dblclick", (e) => {
    if (e.target.closest(".win-actions")) return;
    maximize(w.id);
  });

  // Eight resize handles.
  for (const h of w.el.querySelectorAll("[data-resize]")) {
    h.addEventListener("pointerdown", (e) => {
      if (w.maximized) return;
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const dir = h.dataset.resize;
      const start = { x: w.x, y: w.y, w: w.w, h: w.h, mx: e.clientX, my: e.clientY };
      h.setPointerCapture(e.pointerId);
      const onMove = (ev) => {
        let { x, y, w: ww, h: hh } = start;
        const dx = ev.clientX - start.mx;
        const dy = ev.clientY - start.my;
        if (dir.includes("e")) ww = Math.max(MIN_W, start.w + dx);
        if (dir.includes("s")) hh = Math.max(MIN_H, start.h + dy);
        if (dir.includes("w")) { ww = Math.max(MIN_W, start.w - dx); x = start.x + (start.w - ww); }
        if (dir.includes("n")) { hh = Math.max(MIN_H, start.h - dy); y = start.y + (start.h - hh); }
        setBox(w, x, y, ww, hh);
      };
      const onUp = (ev) => {
        h.releasePointerCapture(ev.pointerId);
        h.removeEventListener("pointermove", onMove);
        h.removeEventListener("pointerup", onUp);
        h.removeEventListener("pointercancel", onUp);
      };
      h.addEventListener("pointermove", onMove);
      h.addEventListener("pointerup", onUp);
      h.addEventListener("pointercancel", onUp);
    });
  }
}

// ---- Snap previews ----

function snapRect(edge) {
  const r = workspaceRect();
  if (edge === "top") return { x: r.x, y: r.y, w: r.w, h: r.h };
  if (edge === "left") return { x: r.x, y: r.y, w: Math.round(r.w / 2), h: r.h };
  if (edge === "right") return { x: r.x + Math.round(r.w / 2), y: r.y, w: r.w - Math.round(r.w / 2), h: r.h };
  return r;
}

function drawSnapPreview() {
  if (!snapPreviewEl) {
    snapPreviewEl = document.createElement("div");
    snapPreviewEl.className = "win-snap-preview";
    document.body.appendChild(snapPreviewEl);
  }
  if (!pendingSnap) {
    snapPreviewEl.style.opacity = "0";
    setTimeout(() => { if (!pendingSnap && snapPreviewEl) snapPreviewEl.style.display = "none"; }, SNAP_PREVIEW_FADE);
    return;
  }
  snapPreviewEl.style.display = "block";
  Object.assign(snapPreviewEl.style, {
    left:   pendingSnap.rect.x + "px",
    top:    pendingSnap.rect.y + "px",
    width:  pendingSnap.rect.w + "px",
    height: pendingSnap.rect.h + "px",
    opacity: "1",
  });
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function escape(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
