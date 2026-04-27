/**
 * pod.js — minimal Solid pod helpers used by chrome.
 *
 * Scope: the bits we need to read + write the user's installed-apps
 * list via TypeIndex. Hub's pod.js has a much wider surface (tracker
 * creation, calendar, photos, panes registrations etc.) — chrome
 * doesn't need any of that yet.
 */

import { authFetch } from "./auth.js";

const SOLID_TERMS = "http://www.w3.org/ns/solid/terms#";
const PIM_NS      = "http://www.w3.org/ns/pim/space#";
const RDF_TYPE    = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

export const APP_CLASS = "urn:solid:App";

// ---- Generic helpers ----

const idOf = (v) => typeof v === "string" ? v : (v && v["@id"]) || null;

export function findSubject(doc, fragment) {
  if (!doc) return {};
  const nodes = Array.isArray(doc?.["@graph"]) ? doc["@graph"] : [doc];
  if (fragment) {
    const m = nodes.find(n => typeof n["@id"] === "string" && n["@id"].endsWith("#" + fragment));
    if (m) return m;
  }
  return nodes[0] || {};
}

// ---- Read / write JSON-LD ----

export async function getJsonLd(url) {
  if (!url) return null;
  const r = await authFetch(url, {
    cache: "no-cache",
    headers: { Accept: "application/ld+json" },
  });
  if (!r.ok) return null;
  try { return await r.json(); }
  catch { return null; }
}

export async function putJsonLd(url, doc) {
  const r = await authFetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/ld+json" },
    body: JSON.stringify(doc),
  });
  if (!r.ok) throw new Error(`PUT ${url} → ${r.status}`);
  return r;
}

export async function ensureContainer(url) {
  const u = url.endsWith("/") ? url : url + "/";
  const head = await authFetch(u, { method: "HEAD" }).catch(() => null);
  if (head && head.ok) return;
  const r = await authFetch(u, {
    method: "PUT",
    headers: {
      "Content-Type": "text/turtle",
      "Link": '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
    },
    body: "",
  });
  if (!r.ok && r.status !== 409) throw new Error(`ensureContainer ${u} → ${r.status}`);
}

// ---- WebID + storage ----

export async function discoverStorage(webid) {
  if (!webid) return null;
  const profile = await getJsonLd(webid.replace(/#.*$/, ""));
  if (!profile) return null;
  const subj = findSubject(profile, webid.includes("#") ? webid.split("#")[1] : null);
  const raw = subj["pim:storage"] ?? subj[PIM_NS + "storage"] ?? subj["storage"];
  let storage = idOf(raw);
  if (!storage) {
    // Origin fallback — common for pods that don't declare pim:storage.
    try { storage = new URL(webid).origin + "/"; }
    catch { return null; }
  }
  if (!storage.endsWith("/")) storage += "/";
  // Resolve relative against the WebID URL if the pod reported a
  // path-only string.
  if (!/^https?:/.test(storage)) storage = new URL(storage, webid).href;
  return storage;
}

// ---- TypeIndex ----

export async function fetchTypeIndex(webid) {
  const profile = await getJsonLd(webid.replace(/#.*$/, ""));
  if (!profile) throw new Error("WebID document not found");
  const subj = findSubject(profile, webid.includes("#") ? webid.split("#")[1] : null);
  const tiRef = subj["solid:publicTypeIndex"]
             ?? subj[SOLID_TERMS + "publicTypeIndex"]
             ?? subj["publicTypeIndex"];
  const tiId = idOf(tiRef);
  if (!tiId) throw new Error("no solid:publicTypeIndex on WebID");
  const tiUrl = new URL(tiId, webid).href;
  const ti = await getJsonLd(tiUrl);
  if (!ti) throw new Error("TypeIndex returned no document");

  const nodes = [];
  const collect = (x) => {
    if (!x || typeof x !== "object") return;
    if (Array.isArray(x)) { x.forEach(collect); return; }
    if (x["solid:forClass"] || x[SOLID_TERMS + "forClass"]) nodes.push(x);
    for (const v of Object.values(x)) if (typeof v === "object") collect(v);
  };
  collect(ti);

  const registrations = nodes.map(n => ({
    forClass:          idOf(n["solid:forClass"]          ?? n[SOLID_TERMS + "forClass"]),
    instance:          idOf(n["solid:instance"]          ?? n[SOLID_TERMS + "instance"]),
    instanceContainer: idOf(n["solid:instanceContainer"] ?? n[SOLID_TERMS + "instanceContainer"]),
  })).filter(r => r.forClass && (r.instance || r.instanceContainer));

  registrations.forEach(r => {
    if (r.instance && !/^https?:/.test(r.instance)) r.instance = new URL(r.instance, tiUrl).href;
    if (r.instanceContainer && !/^https?:/.test(r.instanceContainer)) r.instanceContainer = new URL(r.instanceContainer, tiUrl).href;
  });
  return { typeIndexUrl: tiUrl, registrations };
}

export async function addTypeRegistration(typeIndexUrl, { forClass, instance, instanceContainer }) {
  const ti = await getJsonLd(typeIndexUrl) || { "@context": { "solid": SOLID_TERMS }, "@graph": [] };
  const reg = { "@type": "solid:TypeRegistration", "solid:forClass": { "@id": forClass } };
  if (instance) reg["solid:instance"] = { "@id": instance };
  if (instanceContainer) reg["solid:instanceContainer"] = { "@id": instanceContainer };
  if (Array.isArray(ti["@graph"])) ti["@graph"].push(reg);
  else ti["@graph"] = [ti, reg];
  await putJsonLd(typeIndexUrl, ti);
}

// ---- Apps list (urn:solid:App) — same shape as hub's pod doc, so a
//      pod has ONE set of installed apps regardless of which client
//      (hub, chrome, anything else) wrote it. The killer feature.

const APPS_DOC_PATH = "hub/apps/list.jsonld"; // shared with hub on purpose

export async function getAppsList(webid) {
  const ti = await fetchTypeIndex(webid).catch(() => null);
  if (!ti) return null;
  const reg = ti.registrations.find(r => r.forClass === APP_CLASS && r.instance);
  if (!reg) return null;
  const doc = await getJsonLd(reg.instance.replace(/#.*$/, ""));
  if (!doc) return { url: reg.instance, items: [] };
  const subj = findSubject(doc, reg.instance.includes("#") ? reg.instance.split("#")[1] : null);
  const elements = subj["schema:itemListElement"]
                ?? subj["http://schema.org/itemListElement"]
                ?? subj["https://schema.org/itemListElement"]
                ?? subj["itemListElement"]
                ?? [];
  const arr = Array.isArray(elements) ? elements : [elements];
  return { url: reg.instance, items: arr.map(e => idOf(e)).filter(Boolean) };
}

export async function saveAppsList(webid, urls) {
  const storage = await discoverStorage(webid);
  if (!storage) throw new Error("Couldn't find your pod root");
  await ensureContainer(`${storage}hub/`).catch(() => {});
  await ensureContainer(`${storage}hub/apps/`).catch(() => {});
  const dataUrl = storage + APPS_DOC_PATH;
  const doc = {
    "@context": { "schema": "https://schema.org/", "urn": "urn:solid:" },
    "@id": "#this",
    "@type": "schema:ItemList",
    "schema:name": "Installed apps",
    "schema:itemListElement": (urls || []).map(u => ({ "@id": u, "@type": "urn:App" })),
  };
  await putJsonLd(dataUrl, doc);

  const ti = await fetchTypeIndex(webid).catch(() => null);
  const has = ti?.registrations.some(r => r.forClass === APP_CLASS && r.instance);
  if (ti && !has) {
    await addTypeRegistration(ti.typeIndexUrl, {
      forClass: APP_CLASS,
      instance: dataUrl + "#this",
    });
  }
  return dataUrl + "#this";
}
