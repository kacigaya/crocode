/**
 * Helpers for the GitHub PR patches stored with a review. GitHub returns only
 * the hunks of a file, without the `diff --git` header a patch parser needs.
 */

/**
 * Adds the git file header. Null when the path cannot appear in a header.
 *
 * GitHub can drop the leading space of an empty context line. The diff parser
 * would skip such a line and shift every later line, so it gets its space back.
 */
export function filePatch(path: string, patch: string): string | null {
  if (!path || /[\r\n\t"\\]/.test(path) || !patch.startsWith("@@")) return null;
  const body = patch
    .replace(/\n$/, "")
    .split("\n")
    .map((line) => (line === "" ? " " : line))
    .join("\n");
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${body}\n`;
}

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * Lines `start` to `end` of the new file, as far as the patch shows them.
 * Null when the patch does not cover the whole range.
 */
export function newSideLines(
  patch: string,
  start: number,
  end: number,
): string[] | null {
  const lines = new Map<number, string>();
  let next = 0;
  let remaining = 0;
  for (const raw of patch.replace(/\n$/, "").split("\n")) {
    const hunk = HUNK.exec(raw);
    if (hunk) {
      next = Number(hunk[1]);
      remaining = hunk[2] === undefined ? 1 : Number(hunk[2]);
      continue;
    }
    if (remaining === 0 || next === 0 || raw.startsWith("-") || raw.startsWith("\\")) continue;
    if (raw.startsWith("+") || raw.startsWith(" ") || raw === "") {
      lines.set(next, raw.slice(1));
      next += 1;
      remaining -= 1;
    }
  }
  const out: string[] = [];
  for (let n = start; n <= end; n++) {
    const line = lines.get(n);
    if (line === undefined) return null;
    out.push(line);
  }
  return out;
}
