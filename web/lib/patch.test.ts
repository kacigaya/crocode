import { describe, expect, test } from "bun:test";
import { parsePatchFiles } from "@pierre/diffs";
import { filePatch, newSideLines } from "./patch";

const patch = [
  "@@ -14,4 +14,4 @@ def list_users():",
  "     if page < 1:",
  "-    offset = (page - 1) * PAGE_SIZE",
  "+    offset = page * PAGE_SIZE",
  "     return rows",
  "@@ -30,0 +30,2 @@",
  "+def search(q):",
  "+    return q",
  "\\ No newline at end of file",
].join("\n");

describe("filePatch", () => {
  test("adds the git header", () => {
    expect(filePatch("app/a.py", "@@ -1 +1 @@\n-a\n+b")).toBe(
      "diff --git a/app/a.py b/app/a.py\n--- a/app/a.py\n+++ b/app/a.py\n@@ -1 +1 @@\n-a\n+b\n",
    );
  });
  test("keeps empty context lines that GitHub sends without a space", () => {
    const raw = "@@ -1,3 +1,4 @@\n a\n\n+b\n c";
    const full = filePatch("x.py", raw);
    expect(full).not.toBeNull();
    const [file] = parsePatchFiles(full ?? "").flatMap((p) => p.files);
    const hunk = file?.hunks[0];
    // a, the empty line, +b, c: the same four lines newSideLines counts.
    expect(hunk?.unifiedLineCount).toBe(4);
    expect(newSideLines(raw, 4, 4)).toEqual(["c"]);
  });
  test("rejects paths that break the header and non-hunk text", () => {
    expect(filePatch("a\nb.py", "@@ -1 +1 @@")).toBeNull();
    expect(filePatch("", "@@ -1 +1 @@")).toBeNull();
    expect(filePatch("a\tb.py", "@@ -1 +1 @@")).toBeNull();
    expect(filePatch("a.py", "Binary files differ")).toBeNull();
  });
});

describe("newSideLines", () => {
  test("follows new-file numbering across hunks and skips deletions", () => {
    expect(newSideLines(patch, 15, 15)).toEqual(["    offset = page * PAGE_SIZE"]);
    expect(newSideLines(patch, 14, 16)).toEqual([
      "    if page < 1:",
      "    offset = page * PAGE_SIZE",
      "    return rows",
    ]);
    expect(newSideLines(patch, 30, 31)).toEqual(["def search(q):", "    return q"]);
  });
  test("does not count a terminal newline or lines past the hunk", () => {
    expect(newSideLines("@@ -1 +1 @@\n-a\n+b\n", 2, 2)).toBeNull();
    expect(newSideLines("@@ -1 +1 @@\n-a\n+b\n ", 2, 2)).toBeNull();
    expect(newSideLines("@@ -1 +1,0 @@\n-a\n", 1, 1)).toBeNull();
  });
  test("returns null outside the patch", () => {
    expect(newSideLines(patch, 17, 17)).toBeNull();
    expect(newSideLines(patch, 29, 30)).toBeNull();
  });
});
