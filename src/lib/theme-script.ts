export const PREFERENCES_STORAGE_KEY = "maeosan:preferences";

/**
 * Runs before first paint so a dark-theme user never sees a light flash.
 * Kept tiny and dependency-free; it mirrors resolveTheme() in preferences.ts.
 */
export const THEME_SCRIPT = `(function(){var d=document.documentElement;try{var p=JSON.parse(localStorage.getItem(${JSON.stringify(
  PREFERENCES_STORAGE_KEY,
)})||"{}");var t=p.theme||"light";var k=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);d.dataset.theme=k?"dark":"light"}catch(e){d.dataset.theme="light"}})();`;
