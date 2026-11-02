import { cp, rm } from "node:fs/promises";
import { resolve } from "node:path";

const webDir = resolve(import.meta.dir, "..");
const publicDir = resolve(webDir, "site/public");

await rm(publicDir, { recursive: true, force: true });
await cp(resolve(webDir, "public"), publicDir, { recursive: true });

const build = Bun.spawn([
  process.execPath, "--bun", resolve(webDir, "node_modules/next/dist/bin/next"),
  "build", resolve(webDir, "site"),
], { cwd: webDir, stdout: "inherit", stderr: "inherit" });

process.exitCode = await build.exited;
