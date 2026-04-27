/**
 * builtins/index.js — chrome's built-in apps.
 *
 * These are imported statically (not loaded from the registry) and are
 * always pinned to the shelf. They can't be unpinned. New built-ins
 * just get added to the array below.
 */

import * as files from "./files.js";

export const BUILTINS = [files];

// `chrome:` URL scheme so shelf/launcher can address them like any
// other app, but the loader resolves them locally.
export function builtinUrlFor(meta) { return `chrome:${meta.id}`; }

const byUrl = new Map(BUILTINS.map(m => [builtinUrlFor(m.meta), m]));

export function isBuiltinUrl(url) { return typeof url === "string" && url.startsWith("chrome:"); }
export function getBuiltin(url) { return byUrl.get(url) || null; }

export function listBuiltins() {
  return BUILTINS.map(m => ({
    url: builtinUrlFor(m.meta),
    name: m.meta.name,
    icon: m.meta.icon,
    description: m.meta.description || "",
    author: "chrome",
    builtin: true,
  }));
}
