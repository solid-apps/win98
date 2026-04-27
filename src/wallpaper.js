/**
 * wallpaper.js — desktop background.
 *
 * Two persistence layers (same pattern as installed apps):
 *   - localStorage `chrome-wallpaper`: boot cache, instant first paint
 *   - Pod doc at /hub/prefs/wallpaper.jsonld, registered in TypeIndex
 *     with forClass urn:solid:Wallpaper. Same-named term keeps the
 *     setting portable across hub / chrome / future Solid hosts.
 *
 * Schema:
 *   { "@context": "https://schema.org/",
 *     "@id": "#this",
 *     "@type": "schema:ImageObject",
 *     "schema:contentUrl": "<image URL>" }
 *
 * If no URL is set, the gradient default in style.css is used.
 */

import {
  authFetch,
} from "./auth.js";
import {
  fetchTypeIndex, getJsonLd, putJsonLd, ensureContainer,
  addTypeRegistration, discoverStorage, findSubject,
} from "./pod.js";

const KEY = "chrome-wallpaper";
const WALL_CLASS = "urn:solid:Wallpaper";
const DOC_PATH = "hub/prefs/wallpaper.jsonld";

const subs = new Set();

function read() { return localStorage.getItem(KEY) || ""; }
function write(url) {
  if (url) localStorage.setItem(KEY, url);
  else localStorage.removeItem(KEY);
  apply();
  for (const cb of subs) try { cb(url); } catch {}
}

export function get() { return read(); }
export function onChange(cb) { subs.add(cb); return () => subs.delete(cb); }

export function apply() {
  const url = read();
  const el = document.getElementById("wallpaper");
  if (!el) return;
  if (url) {
    el.style.backgroundImage = `url("${cssEscape(url)}")`;
    el.style.backgroundSize = "cover";
    el.style.backgroundPosition = "center";
    el.classList.add("wallpaper-custom");
  } else {
    el.style.backgroundImage = "";
    el.style.backgroundSize = "";
    el.style.backgroundPosition = "";
    el.classList.remove("wallpaper-custom");
  }
}

export async function set(url, webid = null) {
  write(url || "");
  if (!webid) return;
  try { await saveToPod(webid, url); }
  catch (e) { console.warn("wallpaper: pod write failed", e); }
}

export async function syncFromPod(webid) {
  if (!webid) return { changed: false };
  try {
    const ti = await fetchTypeIndex(webid).catch(() => null);
    if (!ti) return { changed: false };
    const reg = ti.registrations.find(r => r.forClass === WALL_CLASS && r.instance);
    if (!reg) return { changed: false };
    const doc = await getJsonLd(reg.instance.replace(/#.*$/, ""));
    if (!doc) return { changed: false };
    const subj = findSubject(doc, reg.instance.includes("#") ? reg.instance.split("#")[1] : null);
    const url = idOf(
      subj["schema:contentUrl"]
      ?? subj["http://schema.org/contentUrl"]
      ?? subj["https://schema.org/contentUrl"]
      ?? subj["contentUrl"]
    );
    if (url && url !== read()) { write(url); return { changed: true, url }; }
    return { changed: false };
  } catch { return { changed: false }; }
}

async function saveToPod(webid, url) {
  const storage = await discoverStorage(webid);
  if (!storage) throw new Error("no storage on WebID");
  await ensureContainer(`${storage}hub/`).catch(() => {});
  await ensureContainer(`${storage}hub/prefs/`).catch(() => {});
  const dataUrl = storage + DOC_PATH;
  const doc = {
    "@context": "https://schema.org/",
    "@id": "#this",
    "@type": "schema:ImageObject",
    "schema:contentUrl": url || "",
  };
  await putJsonLd(dataUrl, doc);
  const ti = await fetchTypeIndex(webid).catch(() => null);
  const has = ti?.registrations.some(r => r.forClass === WALL_CLASS && r.instance);
  if (ti && !has) {
    await addTypeRegistration(ti.typeIndexUrl, {
      forClass: WALL_CLASS,
      instance: dataUrl + "#this",
    });
  }
}

function idOf(v) { return typeof v === "string" ? v : (v && v["@id"]) || null; }
function cssEscape(s) { return String(s).replace(/["\\]/g, "\\$&"); }
