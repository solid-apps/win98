/**
 * sync.js — cross-device sync of desktop layout + window session.
 *
 * Persists the desktop icon positions (localStorage "chrome-desktop-icons")
 * AND the open-window session (localStorage "chrome-session") to ONE pod doc
 * — `hub/prefs/desktop.jsonld`, registered in the TypeIndex under
 * `urn:solid:DesktopLayout`. Same pattern as wallpaper / installed-apps:
 * localStorage is the boot cache; the pod is canonical when signed in, so the
 * arrangement + open windows follow you across devices.
 *
 * The two values are stored as opaque JSON strings (app-internal state);
 * both desktop.js and session.js write through here so one push carries both.
 */

import {
  fetchTypeIndex, getJsonLd, putJsonLd, ensureContainer,
  addTypeRegistration, discoverStorage, findSubject,
} from "./pod.js";

const LAYOUT_CLASS = "urn:solid:DesktopLayout";
const DOC_PATH     = "hub/prefs/desktop.jsonld";
const ICONS_KEY    = "chrome-desktop-icons";
const SESSION_KEY  = "chrome-session";

const lsGet = (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
const lsSet = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch {} };
const valueOf = (v) => (typeof v === "string" ? v : (v && v["@value"]) || null);

let pushTimer = null;

/** Debounced push — call on any layout/session change while signed in. */
export function schedulePush(webid) {
  if (!webid) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushToPod(webid).catch(() => {}); }, 1500);
}

export async function pushToPod(webid) {
  if (!webid) return;
  const storage = await discoverStorage(webid);
  if (!storage) return;
  await ensureContainer(`${storage}hub/`).catch(() => {});
  await ensureContainer(`${storage}hub/prefs/`).catch(() => {});
  const dataUrl = storage + DOC_PATH;
  const doc = {
    "@context": { "urn": "urn:solid:" },
    "@id": "#this",
    "@type": "urn:solid:DesktopLayout",
    "urn:icons":   lsGet(ICONS_KEY)   || "{}",
    "urn:session": lsGet(SESSION_KEY) || "[]",
  };
  await putJsonLd(dataUrl, doc);
  const ti = await fetchTypeIndex(webid).catch(() => null);
  const has = ti?.registrations.some(r => r.forClass === LAYOUT_CLASS && r.instance);
  if (ti && !has) {
    await addTypeRegistration(ti.typeIndexUrl, { forClass: LAYOUT_CLASS, instance: dataUrl + "#this" });
  }
}

/** Pull the pod doc into localStorage. Returns { changed, iconsChanged, sessionChanged }. */
export async function pullFromPod(webid) {
  if (!webid) return { changed: false };
  try {
    const ti = await fetchTypeIndex(webid).catch(() => null);
    if (!ti) return { changed: false };
    const reg = ti.registrations.find(r => r.forClass === LAYOUT_CLASS && r.instance);
    if (!reg) return { changed: false };
    const doc = await getJsonLd(reg.instance.replace(/#.*$/, ""));
    if (!doc) return { changed: false };
    const subj = findSubject(doc, reg.instance.includes("#") ? reg.instance.split("#")[1] : null);
    const icons   = valueOf(subj["urn:solid:icons"]   ?? subj["urn:icons"]   ?? subj["icons"]);
    const session = valueOf(subj["urn:solid:session"] ?? subj["urn:session"] ?? subj["session"]);
    let iconsChanged = false, sessionChanged = false;
    if (icons   != null && icons   !== lsGet(ICONS_KEY))   { lsSet(ICONS_KEY, icons);     iconsChanged = true; }
    if (session != null && session !== lsGet(SESSION_KEY)) { lsSet(SESSION_KEY, session); sessionChanged = true; }
    return { changed: iconsChanged || sessionChanged, iconsChanged, sessionChanged };
  } catch { return { changed: false }; }
}
