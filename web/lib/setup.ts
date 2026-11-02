import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * First-run GitHub App setup through the manifest flow:
 * https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest
 *
 * Kept free of `server-only` so tests can import it.
 */

/** Credentials stored in `${CROCODE_CONFIG_DIR}/github-app.json`. */
export type StoredConfig = {
  id: number;
  slug: string;
  owner: string;
  client_id: string;
  client_secret: string;
  webhook_secret: string;
  pem: string;
  auth_secret: string;
  url: string;
};

export const APP_DESCRIPTION = `Self-hosted AI code review for pull requests.

CroCode reviews each new pull request with Claude Code and Codex in a read-only sandbox. It posts inline comments with suggested fixes on the changed lines.

- Reads code and pull requests. It never pushes commits.
- The review agent gets no GitHub token.
- Runs on your own infrastructure.`;

/** Returns the origin of an HTTP(S) URL with no credentials, path, query, or fragment. */
export function parseOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    return null;
  return url.origin;
}

/** GitHub organization logins: letters, digits, and single hyphens. */
export function validOwner(value: string) {
  return /^[a-zA-Z0-9](?:-?[a-zA-Z0-9]){0,38}$/.test(value);
}

/**
 * GitHub App names are unique across GitHub, so each install gets a random
 * suffix, for example `CroCode Bot 3f9a1c`. The owner can still edit it.
 */
export function defaultAppName() {
  return `CroCode Bot ${randomBytes(3).toString("hex")}`;
}

export function buildManifest(origin: string, name: string) {
  return {
    name,
    url: "https://github.com/kacigaya/crocode",
    description: APP_DESCRIPTION,
    hook_attributes: { url: `${origin}/webhooks/github`, active: true },
    redirect_url: `${origin}/setup/callback`,
    callback_urls: [`${origin}/api/auth/callback/github`],
    setup_url: `${origin}/installations`,
    public: false,
    default_permissions: {
      contents: "read",
      pull_requests: "write",
      metadata: "read",
      members: "read",
    },
    default_events: ["pull_request"],
  };
}

/** GitHub page that receives the manifest form. */
export function manifestTarget(webUrl: string, owner: string, state: string) {
  const path = owner
    ? `/organizations/${owner}/settings/apps/new`
    : "/settings/apps/new";
  return `${webUrl}${path}?state=${encodeURIComponent(state)}`;
}

/** Settings page where the owner uploads the logo. */
export function appSettingsUrl(webUrl: string, config: StoredConfig) {
  return config.owner
    ? `${webUrl}/organizations/${config.owner}/settings/apps/${config.slug}`
    : `${webUrl}/settings/apps/${config.slug}`;
}

/**
 * The manifest `state` binds GitHub's redirect to the setup token without a
 * cookie: a nonce, the chosen URL and owner, and an HMAC keyed by the token.
 */
export function signState(token: string, origin: string, owner: string) {
  const body = Buffer.from(
    JSON.stringify({ n: randomBytes(12).toString("hex"), origin, owner }),
  ).toString("base64url");
  return `${body}.${mac(token, body)}`;
}

export function verifyState(
  token: string,
  state: string,
): { origin: string; owner: string } | null {
  const [body, sig, extra] = state.split(".");
  if (!body || !sig || extra !== undefined || !safeEqual(sig, mac(token, body)))
    return null;
  try {
    const { origin, owner } = JSON.parse(
      Buffer.from(body, "base64url").toString(),
    ) as Record<string, unknown>;
    if (
      typeof origin !== "string" ||
      parseOrigin(origin) !== origin ||
      typeof owner !== "string" ||
      (owner !== "" && !validOwner(owner))
    )
      return null;
    return { origin, owner };
  } catch {
    return null;
  }
}

export function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function mac(token: string, body: string) {
  return createHmac("sha256", token).update(body).digest("base64url");
}

/** Validates GitHub's manifest conversion response and adds dashboard values. */
export function toStoredConfig(
  app: unknown,
  origin: string,
  owner: string,
): StoredConfig {
  const value = (app ?? {}) as Record<string, unknown>;
  const text = (key: string) => {
    const field = value[key];
    if (typeof field !== "string" || !field)
      throw new Error(`GitHub response is missing ${key}`);
    return field;
  };
  if (typeof value.id !== "number" || !Number.isSafeInteger(value.id))
    throw new Error("GitHub response is missing id");
  const slug = text("slug");
  if (!/^[a-zA-Z0-9-]+$/.test(slug))
    throw new Error("GitHub returned an invalid slug");
  const webhookSecret = text("webhook_secret");
  if (webhookSecret.length < 16)
    throw new Error("GitHub returned a short webhook secret");
  return {
    id: value.id,
    slug,
    owner,
    client_id: text("client_id"),
    client_secret: text("client_secret"),
    webhook_secret: webhookSecret,
    pem: text("pem"),
    auth_secret: randomBytes(32).toString("base64url"),
    url: origin,
  };
}
