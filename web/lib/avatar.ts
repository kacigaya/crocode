/**
 * GitHub serves every user and organization avatar by numeric account ID.
 * Must match images.remotePatterns in next.config.ts.
 */
export const AVATAR_PREFIX = "https://avatars.githubusercontent.com/u/";

/**
 * Avatar URL for a github.com account, or null on GitHub Enterprise, whose
 * avatars live on another host. Call it on the server, where GITHUB_WEB_URL
 * is readable.
 */
export function accountAvatar(accountId: number): string | null {
  const web = (process.env.GITHUB_WEB_URL?.trim() || "https://github.com").replace(/\/$/, "");
  if (web !== "https://github.com" || !Number.isSafeInteger(accountId) || accountId <= 0)
    return null;
  return `${AVATAR_PREFIX}${accountId}?v=4`;
}
