/**
 * Cookie that keeps the desktop sidebar state across page loads. The
 * dashboard layout reads it on the server, so the first paint has the
 * right width.
 */
export const SIDEBAR_COOKIE = "crocode-sidebar";
export const SIDEBAR_COLLAPSED = "collapsed";
