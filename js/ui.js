let toastTimer = 0;

/** A short notice at the bottom of the screen (the page needs a #toast element). */
export function toast(text) {
  const box = document.getElementById("toast");
  box.textContent = text;
  box.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove("show"), 1800);
}
