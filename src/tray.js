/**
 * tray.js — top status tray helpers.
 *
 * Currently just the live clock. As we add notifications, quick
 * settings, and the auth pill in coming days, their wiring lives
 * here.
 */

export function startClock(el) {
  if (!el) return;
  const tick = () => {
    const d = new Date();
    el.textContent = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  };
  tick();
  setInterval(tick, 15_000); // 15s — clock display only changes every minute, but
                             // small drift from system time gets corrected fast enough.
}
