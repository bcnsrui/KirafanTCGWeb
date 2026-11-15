/** Where the app is running. Browsers cannot write real AppData — only origin storage. */

export function isTauri() {
  return typeof window !== "undefined"
    && !!(window.__TAURI__ || window.__TAURI_INTERNALS__);
}

export function invoke(cmd, args = {}) {
  const fn = window.__TAURI__?.core?.invoke;
  if (!fn) throw new Error("데스크톱 전용 기능입니다");
  return fn(cmd, args);
}
