import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { DOCS_PAGES } from "../lib/docs-nav";
import { canonicalDocUrl } from "../lib/docs-site";

const out = resolve(import.meta.dir, "../site/out");
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/crocode";

for (const page of DOCS_PAGES) {
  const html = await readFile(join(out, page.href, "index.html"), "utf8");
  assert.ok(html.includes(canonicalDocUrl(page.href)), `${page.href} has a public canonical URL`);
  assert.ok(html.includes('name="robots" content="index, follow"'), `${page.href} permits indexing`);
}

let htmlCount = 0;
let styles = "";
for (const entry of await readdir(out, { recursive: true, withFileTypes: true })) {
  assert.ok(!entry.isSymbolicLink(), "The Pages artifact contains no symbolic links");
  assert.ok(!entry.name.startsWith(".env"), "The export contains no environment files");
  if (entry.isFile() && entry.name.endsWith(".css")) {
    styles += await readFile(join(entry.parentPath, entry.name), "utf8");
  }
  if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
  htmlCount++;
  const html = await readFile(join(entry.parentPath, entry.name), "utf8");
  for (const match of html.matchAll(/(?:href|src)="(\/[^"]*)"/g)) {
    const url = new URL(match[1].replaceAll("&amp;", "&"), "https://example.invalid");
    assert.ok(url.pathname.startsWith(`${basePath}/`), `Unprefixed asset or link: ${url.pathname}`);
    let target = join(out, decodeURIComponent(url.pathname.slice(basePath.length)));
    if (!extname(target) || url.pathname.endsWith("/")) target = join(target, "index.html");
    await access(target);
  }
}

const rootEntries = await readdir(out);
for (const selector of [".md\\:hidden", ".xl\\:grid", ".text-brand"]) {
  assert.ok(styles.includes(selector), `Missing shared component styles: ${selector}`);
}
for (const route of ["api", "installations", "reviews", "setup"]) {
  assert.ok(!rootEntries.includes(route), `${route} is absent from the static site`);
}
console.log(`PASS: ${DOCS_PAGES.length} docs routes; ${htmlCount} HTML files; local links, assets, canonicals, and static route boundary.`);
