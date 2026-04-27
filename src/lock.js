/**
 * lock.js — soft lock screen.
 *
 * "Soft" because the browser tab is the security boundary, not us —
 * a determined user with devtools can dismiss the overlay. This is a
 * UX feature: blur the desktop, show a clock + identity, click to
 * unlock. Idle auto-lock kicks in after 5 minutes by default.
 *
 * For real privacy you'd combine this with: page-visibility logout,
 * passkey re-auth, or a signed-out state. Out of scope for v1.
 */

import { getAuth } from "./auth.js";

const IDLE_MS = 5 * 60 * 1000;
let overlay = null;
let idleTimer = null;

export function lock() {
  if (overlay) return;
  overlay = document.createElement("div");
  overlay.className = "lock-overlay";
  draw();
  document.body.appendChild(overlay);
  // Esc and click anywhere unlock.
  overlay.addEventListener("click", unlock);
  document.addEventListener("keydown", onKey);
}

export function unlock() {
  if (!overlay) return;
  overlay.classList.add("lock-fading");
  setTimeout(() => {
    overlay?.remove();
    overlay = null;
  }, 250);
  document.removeEventListener("keydown", onKey);
  resetIdleTimer();
}

export function isLocked() { return !!overlay; }

function onKey(e) {
  if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    unlock();
  }
}

function draw() {
  const auth = getAuth();
  const time = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const date = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  overlay.innerHTML = `
    <div class="lock-clock">${time}</div>
    <div class="lock-date">${escape(date)}</div>
    ${auth.loggedIn ? `<div class="lock-user">${escape(shortName(auth))}</div>` : ""}
    <div class="lock-hint">click anywhere or press Esc to unlock</div>
  `;
  // Tick the clock every 15s while locked.
  setTimeout(() => { if (overlay) draw(); }, 15000);
}

function shortName(a) {
  if (!a.id) return "";
  try { return new URL(a.id).hostname; }
  catch { return a.id; }
}

function escape(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

// ---- Idle auto-lock ----

function resetIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (!overlay) lock(); }, IDLE_MS);
}

["mousemove", "keydown", "click", "wheel", "touchstart"].forEach(ev =>
  window.addEventListener(ev, () => { if (!overlay) resetIdleTimer(); }, { passive: true })
);
resetIdleTimer();
