import { describe, expect, test } from "bun:test";
import {
  buildManifest,
  defaultAppName,
  manifestTarget,
  parseOrigin,
  signState,
  toStoredConfig,
  verifyState,
} from "./setup";

describe("parseOrigin", () => {
  test("accepts bare HTTP(S) origins", () => {
    expect(parseOrigin("https://crocode.example.com")).toBe(
      "https://crocode.example.com",
    );
    expect(parseOrigin(" https://crocode.example.com/ ")).toBe(
      "https://crocode.example.com",
    );
  });
  test("rejects paths, credentials, queries, and other schemes", () => {
    for (const value of [
      "https://example.com/app",
      "https://user:pass@example.com",
      "https://example.com?x=1",
      "javascript:alert(1)",
      "not a url",
    ])
      expect(parseOrigin(value)).toBeNull();
  });
});

describe("defaultAppName", () => {
  test("adds a random hex suffix within GitHub's name limit", () => {
    const name = defaultAppName();
    expect(name).toMatch(/^CroCode Bot [0-9a-f]{6}$/);
    expect(name.length).toBeLessThanOrEqual(34);
  });
});

describe("manifest", () => {
  test("points every URL at the chosen origin", () => {
    const manifest = buildManifest("https://cc.example.com", "CroCode");
    expect(manifest.hook_attributes.url).toBe(
      "https://cc.example.com/webhooks/github",
    );
    expect(manifest.redirect_url).toBe("https://cc.example.com/setup/callback");
    expect(manifest.callback_urls).toEqual([
      "https://cc.example.com/api/auth/callback/github",
    ]);
    expect(manifest.default_permissions).toEqual({
      contents: "read",
      pull_requests: "write",
      metadata: "read",
      members: "read",
    });
  });
  test("targets the personal or organization form", () => {
    expect(manifestTarget("https://github.com", "", "s")).toBe(
      "https://github.com/settings/apps/new?state=s",
    );
    expect(manifestTarget("https://github.com", "acme", "s")).toBe(
      "https://github.com/organizations/acme/settings/apps/new?state=s",
    );
  });
});

describe("state", () => {
  test("round-trips with the same token only", () => {
    const state = signState("token-a", "https://cc.example.com", "acme");
    expect(verifyState("token-a", state)).toEqual({
      origin: "https://cc.example.com",
      owner: "acme",
    });
    expect(verifyState("token-b", state)).toBeNull();
  });
  test("rejects tampered state", () => {
    const [, sig] = signState("t", "https://a.example.com", "").split(".");
    const forged = Buffer.from(
      JSON.stringify({ n: "x", origin: "https://evil.example.com", owner: "" }),
    ).toString("base64url");
    expect(verifyState("t", `${forged}.${sig}`)).toBeNull();
    expect(verifyState("t", "")).toBeNull();
    expect(verifyState("t", "a.b.c")).toBeNull();
  });
});

describe("toStoredConfig", () => {
  const app = {
    id: 7,
    slug: "crocode",
    client_id: "Iv1.x",
    client_secret: "secret",
    webhook_secret: "0123456789abcdef",
    pem: "-----BEGIN RSA PRIVATE KEY-----",
  };
  test("keeps the needed fields and adds an auth secret", () => {
    const config = toStoredConfig(
      { ...app, owner: { login: "x" } },
      "https://cc.example.com",
      "",
    );
    expect(config).toMatchObject({ ...app, url: "https://cc.example.com" });
    expect(config.auth_secret.length).toBeGreaterThanOrEqual(32);
    expect(Object.keys(config)).not.toContain("html_url");
  });
  test("rejects incomplete or unsafe responses", () => {
    expect(() => toStoredConfig({ ...app, pem: "" }, "https://a.b", "")).toThrow();
    expect(() => toStoredConfig({ ...app, slug: "../x" }, "https://a.b", "")).toThrow();
    expect(() =>
      toStoredConfig({ ...app, webhook_secret: "short" }, "https://a.b", ""),
    ).toThrow();
    expect(() => toStoredConfig(null, "https://a.b", "")).toThrow();
  });
});
