/* Shared cache key helpers (avoid circular imports between update.js and storage.js). */

export const CACHE_NAME = "kirafan-data-v5";

export function cacheKey(rel) {
  const path = rel.replace(/^\//, "");
  if (path.startsWith("data/") || path.startsWith("pics/") || path.startsWith("sound/")) {
    return new URL(path, location.href).href;
  }
  return new URL(`data/${path}`, location.href).href;
}
