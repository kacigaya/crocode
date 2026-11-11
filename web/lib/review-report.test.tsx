import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ReviewReport } from "@/components/review-report";
import { parseReviewReport, reportConfidence } from "./review-report";

const report = `#### Summary

- Static review complete.

#### Checks performed (agent report)

- Read TimeFormatTest.
- Traced callers.

#### Confidence

- **Confidence:** 80/100 (agent estimate). Runtime tests not run.

🟦🟦🟦🟦🟦🟦🟦🟦⬜⬜

#### Worker checks

| Check | Status | Result |
| --- | --- | --- |
| OpenGrep | 🟢 Completed | No results on added lines. |
| Test execution | ⚪ Not run | Repository execution is prohibited. |

#### Merge recommendation

> **🟢 No blocking findings**
>
> You decide whether to merge.`;

describe("review report", () => {
  test("renders report sections, native disclosure, tables, and a labeled confidence meter", () => {
    const html = renderToStaticMarkup(<ReviewReport text={report} />);
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    expect(html).toContain('aria-label="Worker checks"');
    expect(html).toContain('scope="col"');
    expect(html).toContain("text-success-foreground");
    expect(html).toContain("No results on added lines.");
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-valuenow="80"');
    expect(html).toContain("Agent confidence: 80 out of 100");
    expect(html).not.toContain("🟦");
    expect(html).toContain("Repository execution is prohibited.");
  });

  test("renders old text and hostile markup as text without links or executable HTML", () => {
    const text = 'Legacy summary.\n<script>alert(1)</script>\n![image](https://example.com/private)\n<a href="javascript:alert(1)">link</a>';
    const html = renderToStaticMarkup(<ReviewReport text={text} />);
    expect(html).toContain("Legacy summary.");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<img");
  });

  test("normalizes line endings, groups bullets, and keeps incomplete table rows visible", () => {
    const sections = parseReviewReport("#### Checks\r\n\r\n- One\r\n- Two\r\n\r\n| Check | Result |\r\n| --- | --- |\r\n| Partial |\r\n");
    expect(sections[0].blocks[0]).toEqual({ kind: "list", items: ["One", "Two"] });
    expect(sections[0].blocks[1]).toEqual({ kind: "table", headers: ["Check", "Result"], rows: [["Partial", ""]] });
  });

  test("preserves evidence after literal, escaped, and code pipes in tables", () => {
    for (const row of ["| `read | write` | bypasses permission checks |", "| read \\| write | bypasses permission checks |", "| read | write | bypasses permission checks |"] ) {
      const text = `| Check | Impact |\n| --- | --- |\n${row}`;
      const html = renderToStaticMarkup(<ReviewReport text={text} />);
      expect(html).toContain("bypasses permission checks");
    }
    expect(renderToStaticMarkup(<ReviewReport text="&lt;img&gt;" />)).toContain("&lt;img&gt;");
    expect(renderToStaticMarkup(<ReviewReport text="&lt;img&gt;" />)).not.toContain("<img");
  });

  test("keeps oversized and sparse tables as escaped text without cell amplification", () => {
    const text = `|${"h|".repeat(200)}\n|${"---|".repeat(200)}\n${"|\n".repeat(900)}`;
    expect(text.length).toBeLessThan(4_000);
    const section = parseReviewReport(text)[0];
    expect(section.blocks).toEqual([{ kind: "text", text: text.trimEnd() }]);
    const html = renderToStaticMarkup(<ReviewReport text={text} />);
    expect(html).not.toContain("<table");
    expect(html.length).toBeLessThan(text.length + 1_000);

    const smallTable = "| Check | Result |\n| --- | --- |\n" + "| One | Two |\n".repeat(50);
    const sections = parseReviewReport(Array(5).fill(smallTable).join("\n"));
    let count = 0;
    let plain = 0;
    for (const section of sections) for (const block of section.blocks) {
      if (block.kind === "table") count += block.headers.length * (block.rows.length + 1);
      if (block.kind === "text") plain++;
    }
    expect(count).toBeLessThanOrEqual(400);
    expect(plain).toBeGreaterThan(0);
  });

  test("does not invent or accept invalid confidence scores", () => {
    expect(reportConfidence("**Confidence:** 0/100 (agent estimate)")).toBe(0);
    expect(reportConfidence("**Confidence:** 100/100 (agent estimate)")).toBe(100);
    expect(reportConfidence("**Confidence:** 101/100 (agent estimate)")).toBeNull();
    expect(reportConfidence("**Confidence:** Not reported.")).toBeNull();
    expect(renderToStaticMarkup(<ReviewReport text="**Confidence:** Not reported." />)).not.toContain('role="meter"');
  });
});
