/**
 * notifications.js — solid-0.1 WebSocket subscription helper.
 *
 * Solid pods that support real-time notifications expose a WebSocket
 * endpoint via the `Updates-Via` header on every resource response.
 * Clients connect once, send `sub <uri>` per resource of interest, and
 * receive `pub <uri>` whenever that resource is written.
 *
 * Usage:
 *   const off = await subscribe(url, () => reload());
 *   ...
 *   off(); // unsubscribe + clean up
 *
 * One WebSocket per origin, multiplexed across subscriptions. If the
 * server doesn't support notifications (no Updates-Via header), the
 * call rejects — callers should treat that as "best-effort, no error."
 */

const connections = new Map(); // wsUrl -> { ws, callbacks: Map<resourceUrl, Set<cb>> }
const probeCache = new Map();   // resourceUrl -> Updates-Via URL (or null)

async function probeUpdatesVia(resourceUrl) {
  if (probeCache.has(resourceUrl)) return probeCache.get(resourceUrl);
  let updatesVia = null;
  try {
    const r = await fetch(resourceUrl, { method: "HEAD", cache: "no-store" });
    updatesVia = r.headers.get("Updates-Via");
  } catch { /* network or CORS — no notifications */ }
  probeCache.set(resourceUrl, updatesVia);
  return updatesVia;
}

async function ensureConnection(wsUrl) {
  let entry = connections.get(wsUrl);
  if (entry?.ws?.readyState === WebSocket.OPEN) return entry;
  if (entry?.ws?.readyState === WebSocket.CONNECTING) {
    await new Promise(res => entry.ws.addEventListener("open", res, { once: true }));
    return entry;
  }

  entry = { ws: new WebSocket(wsUrl), callbacks: new Map() };
  connections.set(wsUrl, entry);

  entry.ws.addEventListener("message", (e) => {
    const data = String(e.data || "").trim();
    const sp = data.indexOf(" ");
    if (sp < 0) return;
    const verb = data.slice(0, sp);
    const uri = data.slice(sp + 1);
    if (verb !== "pub") return;
    const cbs = entry.callbacks.get(uri);
    if (cbs) for (const cb of cbs) {
      try { cb(uri); } catch (err) { console.warn("notification callback threw", err); }
    }
  });
  entry.ws.addEventListener("close", () => {
    // Drop the entry so future subscribe() calls reconnect.
    connections.delete(wsUrl);
  });

  await new Promise((res, rej) => {
    entry.ws.addEventListener("open",  res, { once: true });
    entry.ws.addEventListener("error", rej, { once: true });
  });
  return entry;
}

/**
 * Subscribe to change notifications on a resource. Returns an
 * unsubscribe function. If the server doesn't support notifications,
 * subscribe() resolves to a no-op so callers can treat real-time as
 * best-effort:
 *
 *   const off = await subscribe(url, refresh).catch(() => () => {});
 */
export async function subscribe(resourceUrl, callback) {
  const wsUrl = await probeUpdatesVia(resourceUrl);
  if (!wsUrl) return () => {}; // best-effort: silent no-op when unsupported
  const entry = await ensureConnection(wsUrl);
  if (!entry.callbacks.has(resourceUrl)) {
    entry.callbacks.set(resourceUrl, new Set());
    entry.ws.send(`sub ${resourceUrl}`);
  }
  entry.callbacks.get(resourceUrl).add(callback);

  return () => {
    const cbs = entry.callbacks.get(resourceUrl);
    if (!cbs) return;
    cbs.delete(callback);
    if (!cbs.size) {
      entry.callbacks.delete(resourceUrl);
      try { entry.ws.send(`unsub ${resourceUrl}`); } catch { /* ws may be closing */ }
    }
  };
}
