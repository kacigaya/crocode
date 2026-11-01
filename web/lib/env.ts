import "server-only";

export function getEnv() {
  function required(name: string) {
    const value = process.env[name];
    if (!value?.trim())
      throw new Error(`Missing environment variable: ${name}`);
    return value;
  }
  function url(name: string, originOnly = false) {
    const value = required(name);
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error(`${name} must be an absolute HTTP(S) URL`);
    }
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      (originOnly && parsed.pathname !== "/")
    ) {
      throw new Error(
        `${name} must be an HTTP(S) URL without credentials, query, or fragment${originOnly ? ", with no path" : ""}`,
      );
    }
    return parsed.toString().replace(/\/$/, "");
  }
  const sessionSecret = required("SESSION_SECRET");
  if (sessionSecret.length < 32)
    throw new Error("SESSION_SECRET must contain at least 32 characters");
  const appSlug = required("GITHUB_APP_SLUG");
  if (!/^[a-zA-Z0-9-]+$/.test(appSlug))
    throw new Error("GITHUB_APP_SLUG must be a GitHub App slug");
  return {
    clientId: required("GITHUB_CLIENT_ID"),
    clientSecret: required("GITHUB_CLIENT_SECRET"),
    appSlug,
    sessionSecret,
    apiUrl: url("CROCODE_API_URL"),
    publicUrl: url("PUBLIC_URL", true),
  };
}
