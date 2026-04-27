/**
 * registry.js — loader for solid-apps/registry.
 *
 * Fetches the curated JSON-LD list of apps and panes once per session
 * (with cache: no-cache so newly-merged entries appear immediately),
 * and dynamically imports module URLs on demand.
 */

const REGISTRY_URL = "https://solid-apps.github.io/registry/index.json";

let entriesPromise = null;
const moduleCache = new Map(); // url → resolved module

export async function loadRegistry() {
  if (!entriesPromise) {
    entriesPromise = fetch(REGISTRY_URL, {
      cache: "no-cache",
      headers: { Accept: "application/ld+json" },
    }).then(async (r) => {
      if (!r.ok) throw new Error(`registry HTTP ${r.status}`);
      const doc = await r.json();
      const raw = doc["schema:itemListElement"] ?? doc["itemListElement"] ?? [];
      const arr = Array.isArray(raw) ? raw : [raw];
      return arr.map(e => ({
        type:        e["@type"] === "urn:Pane" ? "pane" : "app",
        url:         e["@id"],
        name:        e["schema:name"]        || "",
        description: e["schema:description"] || "",
        icon:        e["schema:icon"]        || "📦",
        author:      e["schema:author"]      || "",
        license:     e["schema:license"]     || "",
        forClass:    e["urn:forClass"]       || null,
      })).filter(x => x.url);
    }).catch(e => {
      // Reset so a later attempt can retry.
      entriesPromise = null;
      throw e;
    });
  }
  return entriesPromise;
}

export async function listApps() {
  return (await loadRegistry()).filter(e => e.type === "app");
}

export async function listPanes() {
  return (await loadRegistry()).filter(e => e.type === "pane");
}

/**
 * Import an app's ES module, normalising default-vs-named exports.
 * Returns the app object: { meta: { id, name, icon, … }, render(...) }.
 *
 * `chrome:` URLs resolve to chrome's built-in apps (no network).
 */
export async function loadApp(url) {
  if (moduleCache.has(url)) return moduleCache.get(url);
  let app;
  if (typeof url === "string" && url.startsWith("chrome:")) {
    const { getBuiltin } = await import("./builtins/index.js");
    const m = getBuiltin(url);
    if (!m) throw new Error("unknown chrome: URL " + url);
    app = m;
  } else {
    const mod = await import(url);
    app = (mod.default && typeof mod.default.render === "function")
      ? mod.default
      : (typeof mod.render === "function" ? mod : null);
    if (!app) throw new Error("module didn't expose a render() function");
  }
  moduleCache.set(url, app);
  return app;
}
