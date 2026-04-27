/**
 * auth.js — xlogin wrapper.
 *
 * Listens for xlogin/xlogout DOM events, exposes a small reactive
 * auth object, and provides an authFetch that falls back to anonymous
 * fetch when signed out.
 *
 * Lifted from solid-apps/hub. xlogin is a one-tag auth library
 * supporting Solid OIDC (DPoP) and Nostr (NIP-98); it's loaded via
 * <script src="https://unpkg.com/xlogin"> in index.html.
 */

const listeners = new Set();
const auth = {
  type: null,        // "solid" | "nostr" | null
  id: null,          // WebID URL (solid) or pubkey (nostr)
  loggedIn: false,
};

function fire() {
  for (const fn of listeners) { try { fn(auth); } catch (e) { console.error(e); } }
}

function update(detail) {
  auth.type = detail?.type || null;
  auth.id = detail?.id || null;
  auth.loggedIn = !!auth.id;
  fire();
}

document.addEventListener("xlogin", (e) => update(e.detail));
document.addEventListener("xlogout", () => update(null));

// xlogin restores sessions asynchronously — poll briefly until ready.
let polls = 0;
const poll = setInterval(() => {
  polls++;
  if (window.xlogin?.id && !auth.loggedIn) update({ type: window.xlogin.type, id: window.xlogin.id });
  if (polls > 20) clearInterval(poll); // 10s ceiling
}, 500);

export function onAuth(fn) {
  listeners.add(fn);
  fn(auth);
  return () => listeners.delete(fn);
}

export function getAuth() { return { ...auth }; }

/**
 * authFetch: DPoP / NIP-98 authenticated when signed in, plain fetch
 * otherwise. Apps shouldn't import this directly — they get it through
 * ctx.fetch from the launcher.
 */
export function authFetch(url, init) {
  const f = (window.xlogin && window.xlogin.authFetch) || fetch;
  return f(url, init);
}

export function login()  { window.xlogin?.login?.(); }
export function logout() { window.xlogin?.logout?.(); }
