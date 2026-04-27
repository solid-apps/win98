/**
 * installed.js — the user's pinned/installed apps.
 *
 * Two persistence layers, identical to hub's apps.js model:
 *   - localStorage `chrome-installed`: boot cache, source of truth
 *     when signed out, fast first paint.
 *   - Pod: canonical when signed in. urn:solid:App TypeRegistration
 *     with solid:instance pointing at /hub/apps/list.jsonld (same path
 *     hub uses, so a single pod has ONE shelf — install Pad in hub →
 *     it appears on chrome's shelf).
 *
 * The pod sync is best-effort: every write to the pod also updates
 * localStorage so the next boot paints immediately even if the pod
 * is unreachable.
 */

import { getAppsList, saveAppsList } from "./pod.js";

const KEY = "chrome-installed";
const SEEDED_KEY = "chrome-installed-seeded";
const subs = new Set();

// Default pinned apps for first-time users. Curated trio that
// demonstrates the breadth of the platform without overwhelming the
// shelf: Pad (productivity), Clock (live data), Today (real-time +
// pod-stored). The user can unpin any of them; the seed runs exactly
// once per browser, so clearing the list and not re-seeding sticks.
const DEFAULT_URLS = [
  "https://solid-apps.github.io/hub/directory/pad.js",
  "https://solid-apps.github.io/hub/directory/clock.js",
  "https://solid-apps.github.io/hub/directory/motd.js",
];

(function seedDefaultsOnce() {
  if (localStorage.getItem(SEEDED_KEY)) return;
  if (localStorage.getItem(KEY)) {
    // User already has a list (e.g. set before this code shipped). Mark
    // as seeded so we don't trample it on next load.
    localStorage.setItem(SEEDED_KEY, "1");
    return;
  }
  localStorage.setItem(KEY, JSON.stringify(DEFAULT_URLS));
  localStorage.setItem(SEEDED_KEY, "1");
})();

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); }
  catch { return []; }
}
function write(urls) {
  localStorage.setItem(KEY, JSON.stringify(urls));
  for (const cb of subs) try { cb(urls); } catch {}
}

export function list() { return read(); }
export function isInstalled(url) { return read().includes(url); }

export function onChange(cb) {
  subs.add(cb);
  return () => subs.delete(cb);
}

export async function install(url, webid = null) {
  const urls = read();
  if (urls.includes(url)) return;
  urls.push(url);
  write(urls);
  if (webid) try { await saveAppsList(webid, urls); } catch (e) { console.warn("install: pod write failed", e); }
}

export async function uninstall(url, webid = null) {
  const urls = read().filter(u => u !== url);
  write(urls);
  if (webid) try { await saveAppsList(webid, urls); } catch (e) { console.warn("uninstall: pod write failed", e); }
}

/**
 * Pull the apps list from the pod and update local cache. Returns
 * { source, items, changed } so the caller can decide whether to
 * re-render (changed=true) or stay quiet.
 */
export async function syncFromPod(webid) {
  if (!webid) return { source: "local", items: read(), changed: false };
  let r;
  try { r = await getAppsList(webid); }
  catch { return { source: "none", items: read(), changed: false }; }
  if (!r) return { source: "none", items: read(), changed: false };
  const cur = read();
  const same = cur.length === r.items.length && cur.every((u, i) => u === r.items[i]);
  if (!same) write(r.items);
  return { source: "pod", items: r.items, changed: !same };
}

/** Push the local cache up to the pod (first migration). */
export async function syncToPod(webid) {
  if (!webid) throw new Error("Need a WebID to sync to pod");
  const urls = read();
  await saveAppsList(webid, urls);
  return urls;
}
