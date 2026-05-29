/**
 * panes.js — SLIP-48 pane dispatch.
 *
 * Walks `solid-apps/registry` for `urn:Pane` entries, indexes them by
 * forClass, and renders matching subjects in fresh chrome windows.
 * Same contract hub uses internally — registry panes are interchange-
 * able between hub and chrome.
 *
 * Public surface:
 *   findPaneFor(rdfTypes)  → registry entry or null
 *   openPaneFor({ url, doc, types }, ctx) → opens a chrome window
 *   getPanesIndex() → Promise<Map<forClass, entry>>
 */

import { loadRegistry, loadApp } from "./registry.js";
import { openWindow } from "./windows.js";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

// User's chosen default pane per class — shared with hub. On solid-apps.github.io
// every shell is same-origin, so hub's localStorage map is visible here directly;
// a default set in hub applies on the desktop too. (Cross-device sync of the pod's
// urn:solid:PaneDefaults registration is the natural follow-up.)
function classDefaults() {
  try { return JSON.parse(localStorage.getItem("hubpod-pane-defaults") || "{}"); }
  catch { return {}; }
}
const localName = (s) => String(s || "").split(/[#/:]/).pop();

let indexPromise = null;
function ensureIndex() {
  if (!indexPromise) {
    indexPromise = loadRegistry().then(entries => {
      const m = new Map();
      for (const e of entries) {
        if (e.type !== "pane" || !e.forClass) continue;
        // urn:forClass may be a single IRI or an array (one pane, many types).
        for (const c of (Array.isArray(e.forClass) ? e.forClass : [e.forClass])) m.set(c, e);
      }
      return m;
    }).catch(e => { indexPromise = null; throw e; });
  }
  return indexPromise;
}

export async function getPanesIndex() { return ensureIndex(); }

/** Given an array of rdf:type IRIs found on a subject, return the
 *  first registry pane whose forClass matches, or null.
 *
 *  Two-pass match:
 *    1. Exact full-IRI equality (handles docs that emit unprefixed IRIs)
 *    2. Local-name suffix on bare terms (handles compacted @type like
 *       "Tracker" pointing at wf:Tracker via the doc's @context — we
 *       can't expand the @context cheaply, so a local-name match is
 *       the practical fallback)
 */
export async function findPaneFor(types) {
  if (!Array.isArray(types) || !types.length) return null;
  const index = await ensureIndex();
  const byUrl = new Map([...index.values()].map(e => [e.url, e]));

  // 0. Honour the user's pinned default pane for any of these classes
  //    (shared with hub). Match the class exactly or by local name.
  const defaults = classDefaults();
  for (const t of types) {
    if (typeof t !== "string") continue;
    for (const cls of Object.keys(defaults)) {
      if (cls === t || localName(cls) === localName(t)) {
        const e = byUrl.get(defaults[cls]);
        if (e) return e;
      }
    }
  }

  // 1. Exact full-IRI match.
  for (const t of types) {
    if (typeof t === "string" && index.has(t)) return index.get(t);
  }
  // 2. Local-name match (handles compacted "schema:TextDocument" or the
  //    https/http variant vs a registry forClass written either way).
  for (const t of types) {
    if (typeof t !== "string") continue;
    const tln = localName(t);
    for (const [cls, entry] of index) {
      if (localName(cls) === tln) return entry;
    }
  }
  return null;
}

/** Open a pane in a new chrome window. `ctx` is the host context that
 *  the dispatching app already has (auth, fetch, subscribe). The pane
 *  receives a SLIP-48 4-arg call (+ ctx as 5th, hub-style extension). */
export async function openPaneFor({ url, doc, types, name, icon }, ctx) {
  const entry = await findPaneFor(types);
  if (!entry) return null;

  let pane;
  try { pane = await loadApp(entry.url); }
  catch (e) {
    openWindow({
      title: "Pane load error",
      icon: "⚠️",
      width: 480, height: 240,
      render(content) {
        content.innerHTML = `<div style="padding:18px;color:var(--danger);font:13px var(--mono);word-break:break-all">
          Couldn't load pane:<br>${escape(entry.url)}<br><br>${escape(e.message)}
        </div>`;
      },
    });
    // Return the entry, not null — caller treats null as "no pane
    // found, fall through to raw URL open." Here a pane WAS found,
    // it just failed to load; the user wants to stay in chrome and
    // see the error, not get a surprise browser tab.
    return entry;
  }

  openWindow({
    title: name || entry.name || url.split("/").pop(),
    icon:  icon || entry.icon || "🧩",
    width:  720, height: 520,
    app: { url: entry.url, meta: pane.meta },
    render(content, win) {
      const subject = { value: url, termType: "NamedNode" };
      const store = makeStore(types, url);
      // Bridge SLIP-48 CustomEvents → win actions where useful.
      content.addEventListener("pane:delete", () => win.close());
      const childCtx = { ...ctx, openWindow };
      try {
        Promise.resolve(pane.render?.(subject, store, content, doc, childCtx)).catch(e => {
          content.innerHTML = `<div style="padding:18px;color:var(--danger);font:13px var(--mono)">Pane render error: ${escape(e.message)}</div>`;
        });
      } catch (e) {
        content.innerHTML = `<div style="padding:18px;color:var(--danger);font:13px var(--mono)">Pane render error: ${escape(e.message)}</div>`;
      }
    },
  });
  return entry;
}

/** Synthetic rdflib-shaped store. Reflects the rdf:type triples we
 *  already know from the doc — enough for canHandle gates that walk
 *  store.statementsMatching(subject, undefined, undefined). */
function makeStore(types, url) {
  return {
    type: () => (types && types[0]) || null,
    get: () => null,
    statementsMatching(_s, predicate, _o) {
      if (!types || !types.length) return [];
      if (predicate === undefined || predicate?.value === RDF_TYPE) {
        return types.map(t => ({
          subject:   { value: url, termType: "NamedNode" },
          predicate: { value: RDF_TYPE, termType: "NamedNode" },
          object:    { value: t, termType: "NamedNode" },
        }));
      }
      return [];
    },
  };
}

function escape(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
