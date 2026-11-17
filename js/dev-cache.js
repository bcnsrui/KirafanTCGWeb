/** Localhost only: drop Service Workers / stale Cache Storage that hide CSS/JS updates. */

function isLocalDevHost() {
  try {
    const h = location.hostname;
    return h === "127.0.0.1" || h === "localhost" || h === "[::1]";
  } catch {
    return false;
  }
}

/**
 * Unregister SWs and delete kirafan caches once per tab session on local dev.
 * Production / Railway is untouched.
 */
export async function clearLocalDevCaches() {
  if (!isLocalDevHost()) return;
  try {
    if (sessionStorage.getItem("kirafan-dev-cache-cleared") === "2") return;
    sessionStorage.setItem("kirafan-dev-cache-cleared", "2");
  } catch { /* continue anyway */ }

  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch { /* ignore */ }

  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith("kirafan")).map((k) => caches.delete(k)),
      );
    }
  } catch { /* ignore */ }
}
