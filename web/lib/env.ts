import "server-only";
import { readStoredConfig } from "./config";

export type Env = ReturnType<typeof getEnv>;

/** Values written by first-run setup, used when the variable is unset. */
const stored = {
  GITHUB_CLIENT_ID: "client_id",
  GITHUB_CLIENT_SECRET: "client_secret",
  GITHUB_APP_SLUG: "slug",
  BETTER_AUTH_SECRET: "auth_secret",
  BETTER_AUTH_URL: "url",
} as const;

export function getEnv() {
  const config = readStoredConfig();
  function required(name: string) {
    let value = process.env[name];
    if (!value?.trim() && config && name in stored)
      value = config[stored[name as keyof typeof stored]];
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
  const authSecret = required("BETTER_AUTH_SECRET");
  if (authSecret.length < 32)
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
  const appSlug = required("GITHUB_APP_SLUG");
  if (!/^[a-zA-Z0-9-]+$/.test(appSlug))
    throw new Error("GITHUB_APP_SLUG must be a GitHub App slug");
  return {
    clientId: required("GITHUB_CLIENT_ID"),
    clientSecret: required("GITHUB_CLIENT_SECRET"),
    appSlug,
    authSecret,
    apiUrl: url("CROCODE_API_URL"),
    authUrl: url("BETTER_AUTH_URL", true),
  };
}
