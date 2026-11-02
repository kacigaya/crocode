import { randomBytes } from "node:crypto";
import {
  linkSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { StoredConfig } from "./setup";

/**
 * Kept free of `server-only` so `instrumentation.ts` can import it. App code
 * imports `./config`, which adds the guard.
 *
 * Optional shared config directory. The dashboard writes the GitHub App
 * credentials here during first-run setup; the API and worker read them.
 * Environment variables take precedence over this file.
 */
function configDir() {
  return process.env.CROCODE_CONFIG_DIR?.trim() || null;
}

export const CONFIG_FILE = "github-app.json";
const TOKEN_FILE = "setup-token";

export function readStoredConfig(): StoredConfig | null {
  const dir = configDir();
  if (!dir) return null;
  try {
    return JSON.parse(readFileSync(join(dir, CONFIG_FILE), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** True when the dashboard has no GitHub App yet and can run setup. */
export function setupAvailable() {
  return (
    configDir() !== null &&
    !process.env.GITHUB_CLIENT_ID?.trim() &&
    readStoredConfig() === null
  );
}

/** Returns the one-time setup token, creating it on first use. */
export function setupToken() {
  const dir = configDir();
  if (!dir) throw new Error("CROCODE_CONFIG_DIR is not set");
  const path = join(dir, TOKEN_FILE);
  try {
    return readFileSync(path, "utf8").trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const token = randomBytes(24).toString("base64url");
  mkdirSync(dir, { recursive: true });
  // `wx` fails if another request created the token first.
  try {
    writeFileSync(path, token, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return readFileSync(path, "utf8").trim();
  }
  return token;
}

/**
 * Publishes the credentials atomically and only once: `link` fails with
 * EEXIST when another setup callback finished first, so a stored app is never
 * replaced. Mode 0640: the API and worker read the
 * file through the directory's shared group (see web/Dockerfile).
 */
export function writeStoredConfig(config: StoredConfig) {
  const dir = configDir();
  if (!dir) throw new Error("CROCODE_CONFIG_DIR is not set");
  const path = join(dir, CONFIG_FILE);
  const temp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(temp, JSON.stringify(config), { mode: 0o640, flag: "wx" });
  try {
    linkSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
  rmSync(join(dir, TOKEN_FILE), { force: true });
}
