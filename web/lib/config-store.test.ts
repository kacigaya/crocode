import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "crocode-config-"));
process.env.CROCODE_CONFIG_DIR = dir;
// Bun loads a local .env; a configured client would disable setup.
delete process.env.GITHUB_CLIENT_ID;
const store = await import("./config-store");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const config = (id: number) => ({
  id,
  slug: "crocode",
  owner: "",
  client_id: "Iv1.x",
  client_secret: "secret",
  webhook_secret: "0123456789abcdef",
  pem: "pem",
  auth_secret: "auth",
  url: "https://cc.example.com",
});

test("setup token is stable until the app is stored once", () => {
  expect(store.setupAvailable()).toBe(true);
  const token = store.setupToken();
  expect(store.setupToken()).toBe(token);
  store.writeStoredConfig(config(1));
  expect(() => store.writeStoredConfig(config(2))).toThrow();
  expect(store.readStoredConfig()?.id).toBe(1);
  expect(store.setupAvailable()).toBe(false);
  expect(readdirSync(dir)).toEqual([store.CONFIG_FILE]);
  expect(statSync(join(dir, store.CONFIG_FILE)).mode & 0o777).toBe(0o640);
  expect(JSON.parse(readFileSync(join(dir, store.CONFIG_FILE), "utf8")).id).toBe(1);
});
