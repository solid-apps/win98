/**
 * Files — built-in pod browser.
 *
 * Walks the user's pod via LDP container listings (JSON-LD), shows a
 * breadcrumb + a table view (Name / Type / Size / Modified). Click a
 * folder to navigate; click a file to open it in a new tab. Subscribes
 * via ctx.subscribe so changes from any client reflect live.
 *
 * Built-in: ships with chrome rather than the registry. Always pinned
 * to the shelf; can't be uninstalled.
 */

export const meta = {
  id:   "chrome/files",
  name: "Files",
  icon: "📁",
  width: 880, height: 560,
  builtin: true,
};

export async function render(content, ctx) {
  injectStyles();
  let storage = null;
  let currentDir = null;
  let unsubscribe = null;

  if (ctx.auth?.loggedIn && ctx.auth.type === "solid") {
    storage = await discoverStorage(ctx.auth.id, ctx.fetch);
  }
  if (!storage) {
    content.innerHTML = `<div class="files-empty">
      <div class="files-empty-title">Sign in to a Solid pod to browse your files</div>
      <div class="files-empty-body">Files reads LDP containers on the pod that your WebID points at.</div>
    </div>`;
    return;
  }

  currentDir = storage;

  content.innerHTML = `
    <div class="files-app">
      <div class="files-bc" data-role="bc"></div>
      <div class="files-body" data-role="body"><div class="files-loading">Loading…</div></div>
    </div>
  `;

  await load();

  async function load() {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }

    drawBreadcrumb();
    const body = content.querySelector('[data-role="body"]');
    body.innerHTML = `<div class="files-loading">Loading…</div>`;

    let doc;
    try {
      const r = await ctx.fetch(currentDir, { cache: "reload", headers: { Accept: "application/ld+json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      doc = await r.json();
    } catch (e) {
      body.innerHTML = `<div class="files-error">Couldn't list this container: ${escape(e.message)}<br><span style="font-family:var(--mono);font-size:11px">${escape(currentDir)}</span></div>`;
      return;
    }

    const items = parseContainer(doc, currentDir);
    drawList(body, items);

    try { unsubscribe = await ctx.subscribe(currentDir, () => load()); }
    catch { /* best-effort */ }
  }

  function drawBreadcrumb() {
    const bc = content.querySelector('[data-role="bc"]');
    let url;
    try { url = new URL(currentDir); }
    catch { bc.textContent = currentDir; return; }
    const origin = url.origin + "/";
    const parts = url.pathname.split("/").filter(Boolean);
    let acc = origin;
    bc.innerHTML = `
      <button class="files-crumb" data-path="${escape(origin)}">${escape(url.host)}</button>
    ` + parts.map(p => {
      acc += p + "/";
      return `<span class="files-sep">/</span><button class="files-crumb" data-path="${escape(acc)}">${escape(decodeURIComponent(p))}</button>`;
    }).join("");
    for (const b of bc.querySelectorAll("[data-path]")) {
      b.addEventListener("click", () => { currentDir = b.dataset.path; load(); });
    }
  }

  function drawList(body, items) {
    if (!items.length) {
      body.innerHTML = `<div class="files-empty"><div class="files-empty-title">Empty container</div></div>`;
      return;
    }
    const folders = items.filter(i => i.type === "container").length;
    const files = items.length - folders;
    body.innerHTML = `
      <div class="files-counts">${folders} folder${folders === 1 ? "" : "s"} · ${files} file${files === 1 ? "" : "s"}</div>
      <table class="files-table">
        <thead><tr><th>NAME</th><th>TYPE</th><th class="files-num">SIZE</th><th>MODIFIED</th></tr></thead>
        <tbody>${items.map(rowHTML).join("")}</tbody>
      </table>
    `;
    for (const tr of body.querySelectorAll("[data-url]")) {
      tr.addEventListener("click", () => {
        const url = tr.dataset.url;
        const type = tr.dataset.type;
        if (type === "container") { currentDir = url; load(); }
        else openResource(url, ctx);
      });
    }
  }
}

/** Try to render a resource via a registry pane (matched by rdf:type).
 *  Falls back to opening the raw URL in a new tab when no pane matches
 *  or fetching/parsing fails. */
async function openResource(url, ctx) {
  let doc, types = [];
  try {
    const r = await ctx.fetch(url, { cache: "reload", headers: { Accept: "application/ld+json" } });
    if (r.ok) {
      const body = (await r.text()).trim();
      if (body.startsWith("{") || body.startsWith("[")) {
        doc = JSON.parse(body);
        types = extractTypes(doc, url);
      }
    }
  } catch { /* fall through to raw open */ }

  if (types.length) {
    try {
      const { openPaneFor } = await import("../panes.js");
      const entry = await openPaneFor({ url, doc, types }, ctx);
      if (entry) return;
    } catch { /* fall through */ }
  }
  window.open(url, "_blank");
}

function extractTypes(doc, url) {
  if (!doc) return [];
  const nodes = Array.isArray(doc?.["@graph"]) ? doc["@graph"] : [doc];
  // Try exact full-URL match first; then fragment-prefixed (#frag);
  // then fall back to the first node that has any @type at all (covers
  // docs with fragment-only @ids like "#this" or "#work" that JSON.parse
  // didn't expand against the doc URL).
  let subj = nodes.find(n => n["@id"] === url) || null;
  if (!subj) {
    subj = nodes.find(n => typeof n["@id"] === "string" && /^#/.test(n["@id"])) || null;
  }
  if (!subj) subj = nodes.find(n => n["@type"]) || nodes[0];
  if (!subj) return [];

  // Aggregate types from this subject AND any other typed nodes — covers
  // multi-subject docs (a Tracker that also contains its issue Vtodos).
  // De-duped, primary subject's types first so they win the pane match.
  const out = [];
  const seen = new Set();
  const push = (v) => {
    if (typeof v !== "string" || seen.has(v)) return;
    seen.add(v); out.push(v);
  };
  const addFrom = (n) => {
    const t = n?.["@type"];
    if (!t) return;
    for (const v of Array.isArray(t) ? t : [t]) push(v);
  };
  addFrom(subj);
  for (const n of nodes) if (n !== subj) addFrom(n);
  return out;
}

function rowHTML(it) {
  const name = decodeURIComponent(it.url.replace(/\/$/, "").split("/").pop() || it.url);
  const ext = it.type === "container" ? "" : (name.split(".").pop() || "").toUpperCase();
  const icon = it.type === "container" ? "📁" : iconForExt(name);
  const typeLabel = it.type === "container" ? "Folder" : (ext || "—");
  return `<tr data-url="${escape(it.url)}" data-type="${it.type}">
    <td class="files-name"><span class="files-icon">${icon}</span>${escape(name)}</td>
    <td class="files-meta">${escape(typeLabel)}</td>
    <td class="files-meta files-num">${it.size != null ? fmtBytes(it.size) : "—"}</td>
    <td class="files-meta">${it.modified ? fmtDate(it.modified) : "—"}</td>
  </tr>`;
}

// ---- Helpers ----

async function discoverStorage(webid, fetcher) {
  if (!webid) return null;
  try {
    const r = await fetcher(webid.replace(/#.*$/, ""), { headers: { Accept: "application/ld+json" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const doc = await r.json();
    const subj = findSubject(doc, webid.includes("#") ? webid.split("#")[1] : null);
    let storage = idOf(subj["pim:storage"] ?? subj["http://www.w3.org/ns/pim/space#storage"] ?? subj["storage"]);
    if (!storage) storage = new URL(webid).origin + "/";
    if (!storage.endsWith("/")) storage += "/";
    if (!/^https?:/.test(storage)) storage = new URL(storage, webid).href;
    return storage;
  } catch { return null; }
}

function findSubject(doc, frag) {
  const nodes = Array.isArray(doc?.["@graph"]) ? doc["@graph"] : [doc];
  if (frag) {
    const m = nodes.find(n => typeof n["@id"] === "string" && n["@id"].endsWith("#" + frag));
    if (m) return m;
  }
  return nodes[0] || {};
}

function parseContainer(doc, baseUrl) {
  const nodes = Array.isArray(doc?.["@graph"]) ? doc["@graph"] : [doc];
  const container = nodes.find(n =>
    n["@id"] === baseUrl ||
    (typeof n["@id"] === "string" && resolveUrl(n["@id"], baseUrl) === baseUrl)
  ) || nodes[0];
  if (!container) return [];
  const raw = container["contains"] ?? container["ldp:contains"] ?? container["http://www.w3.org/ns/ldp#contains"] ?? [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map(c => {
    if (typeof c === "string") return { url: resolveUrl(c, baseUrl), type: c.endsWith("/") ? "container" : "resource" };
    const url = resolveUrl(c["@id"], baseUrl);
    const types = [].concat(c["@type"] || []);
    const isContainer = types.some(t => /(?:#|\/)(?:BasicContainer|Container)$/.test(t)) || url.endsWith("/");
    return {
      url,
      type: isContainer ? "container" : "resource",
      size: c["stat:size"] ?? c["http://www.w3.org/ns/posix/stat#size"],
      modified: c["dcterms:modified"] ?? c["http://purl.org/dc/terms/modified"] ?? c["dc:modified"],
    };
  }).filter(x => x.url && x.url !== baseUrl);
}

function iconForExt(name) {
  if (/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(name)) return "🖼";
  if (/\.(mp3|ogg|wav|flac)$/i.test(name)) return "🎵";
  if (/\.(jsonld|json|ttl|n3)$/i.test(name)) return "🔗";
  if (/\.(js|ts|css|html?)$/i.test(name)) return "📄";
  if (/\.(md|txt)$/i.test(name)) return "📝";
  if (/\.pdf$/i.test(name)) return "📕";
  return "📄";
}
function fmtBytes(n) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
  return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
}
function fmtDate(iso) {
  try { return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return String(iso); }
}
function idOf(v) { if (!v) return null; if (typeof v === "string") return v; if (typeof v === "object" && v["@id"]) return v["@id"]; return null; }
function resolveUrl(href, base) { try { return new URL(href, base).href; } catch { return href; } }
function escape(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

function injectStyles() {
  if (document.getElementById("files-app-css")) return;
  const s = document.createElement("style");
  s.id = "files-app-css";
  s.textContent = `
.files-app { display: flex; flex-direction: column; height: 100%; }
.files-bc { padding: 12px 18px; border-bottom: 1px solid var(--line); display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.files-crumb { background: transparent; border: none; color: var(--accent); font: 13px var(--mono); cursor: pointer; padding: 2px 6px; border-radius: 5px; }
.files-crumb:hover { background: var(--bg-elev-2); }
.files-sep { color: var(--text-faint); font: 13px var(--mono); }
.files-body { flex: 1; overflow: auto; padding: 14px 18px; }
.files-counts { font: 12px var(--mono); color: var(--text-faint); margin-bottom: 8px; }
.files-table { width: 100%; border-collapse: collapse; font: 14px var(--sans); }
.files-table th { text-align: left; padding: 8px 10px; font: 600 11px var(--mono); color: var(--text-faint); text-transform: uppercase; letter-spacing: .06em; border-bottom: 1px solid var(--line); }
.files-table td { padding: 9px 10px; border-bottom: 1px solid var(--line); }
.files-table tr { cursor: pointer; transition: background .1s; }
.files-table tr:hover td { background: var(--bg-elev-2); }
.files-name { color: var(--accent); display: flex; align-items: center; gap: 8px; }
.files-icon { font-size: 16px; }
.files-meta { color: var(--text-dim); font: 13px var(--mono); white-space: nowrap; }
.files-num { text-align: right; }
.files-loading { padding: 32px; text-align: center; color: var(--text-faint); }
.files-error { padding: 18px; color: var(--danger); font: 13px var(--mono); }
.files-empty { padding: 40px 24px; text-align: center; color: var(--text-faint); }
.files-empty-title { font: 16px var(--sans); color: var(--text); margin-bottom: 6px; }
.files-empty-body { font: 13px var(--sans); }
`;
  document.head.appendChild(s);
}
