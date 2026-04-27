/**
 * quick-settings.js — popover hung off the tray-quick button.
 *
 * Holds settings that need to be one click away — theme, wallpaper,
 * lock. Bigger settings live in a future Settings app.
 */

import { getAuth } from "./auth.js";
import * as wallpaper from "./wallpaper.js";
import { lock } from "./lock.js";

let popover = null;

export function toggleQuickSettings() {
  if (popover) { close(); return; }
  open();
}

function open() {
  popover = document.createElement("div");
  popover.className = "quick-settings";
  draw();
  document.body.appendChild(popover);

  // Position under the tray-quick button.
  const anchor = document.getElementById("tray-quick").getBoundingClientRect();
  popover.style.right = (window.innerWidth - anchor.right) + "px";
  popover.style.top = (anchor.bottom + 6) + "px";

  setTimeout(() => document.addEventListener("click", onOutsideClick), 0);
}

function close() {
  if (!popover) return;
  popover.remove();
  popover = null;
  document.removeEventListener("click", onOutsideClick);
}

function onOutsideClick(e) {
  if (!popover) return;
  if (popover.contains(e.target)) return;
  if (e.target.closest("#tray-quick")) return;
  close();
}

function draw() {
  const theme = document.documentElement.getAttribute("data-theme") || "light";
  const wall = wallpaper.get();
  const auth = getAuth();
  popover.innerHTML = `
    <div class="qs-row">
      <div class="qs-label">Theme</div>
      <div class="qs-seg">
        <button data-theme="light" class="${theme === "light" ? "on" : ""}">Light</button>
        <button data-theme="dark"  class="${theme === "dark"  ? "on" : ""}">Dark</button>
      </div>
    </div>
    <div class="qs-row qs-stack">
      <div class="qs-label">Wallpaper</div>
      <div class="qs-input-row">
        <input id="qs-wallpaper" placeholder="https://example.org/photo.jpg" value="${escape(wall || "")}" />
        <button class="qs-btn" id="qs-wallpaper-apply">Apply</button>
        <button class="qs-btn qs-ghost" id="qs-wallpaper-clear">Clear</button>
      </div>
      <div class="qs-hint">Stored on your pod (when signed in) so the same wallpaper follows you across devices.</div>
    </div>
    <div class="qs-row">
      <button class="qs-btn qs-wide" id="qs-lock">🔒 Lock screen</button>
    </div>
    <div class="qs-row">
      <button class="qs-btn qs-wide qs-ghost" id="qs-reset" title="Re-pin the default starter apps to your shelf">Reset shelf to defaults</button>
    </div>
    ${auth.loggedIn ? `<div class="qs-foot">Signed in as <code>${escape(auth.id)}</code></div>` : ""}
  `;

  popover.querySelectorAll("[data-theme]").forEach(b => b.addEventListener("click", () => {
    const t = b.dataset.theme;
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem("chrome-theme", t);
    draw();
  }));

  popover.querySelector("#qs-wallpaper-apply").addEventListener("click", async () => {
    const url = popover.querySelector("#qs-wallpaper").value.trim();
    const auth = getAuth();
    await wallpaper.set(url, auth.type === "solid" ? auth.id : null);
    draw();
  });
  popover.querySelector("#qs-wallpaper-clear").addEventListener("click", async () => {
    const auth = getAuth();
    await wallpaper.set("", auth.type === "solid" ? auth.id : null);
    draw();
  });
  popover.querySelector("#qs-lock").addEventListener("click", () => {
    close();
    lock();
  });
  popover.querySelector("#qs-reset").addEventListener("click", () => {
    if (!confirm("Re-pin the default starter apps (Pad, Clock, Today) and clear any unpinning you've done? Reload required.")) return;
    localStorage.removeItem("chrome-installed");
    localStorage.removeItem("chrome-installed-seeded");
    location.reload();
  });
}

function escape(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
