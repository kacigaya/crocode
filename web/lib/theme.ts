export const THEME_KEY = "crocode-theme";
export const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Runs in <head> before first paint. A saved choice wins; otherwise the
 * OS setting applies. Without JavaScript the page stays light.
 */
export const themeScript = `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});document.documentElement.classList.toggle("dark",t?t==="dark":matchMedia(${JSON.stringify(DARK_QUERY)}).matches)}catch(e){}`;
