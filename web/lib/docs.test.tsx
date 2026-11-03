import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CodeBlock } from "../components/code-block";
import { DOCS_CONTENT } from "./docs-content";
import { DOCS_PAGES, findDoc } from "./docs-nav";

describe("documentation", () => {
  test("matches only known routes", () => {
    expect(findDoc()?.href).toBe("/docs");
    expect(findDoc(["configuration", "agents"])?.title).toBe("Agents");
    for (const slug of [["missing"], ["..", "security"], ["constructor"], ["configuration", "agents", "extra"]]) {
      expect(findDoc(slug)).toBeUndefined();
    }
  });

  test("every internal article link and outline target exists", () => {
    expect(new Set(DOCS_PAGES.map((page) => page.href)).size).toBe(DOCS_PAGES.length);
    for (const page of DOCS_PAGES) {
      const sections = DOCS_CONTENT[page.href];
      expect(sections.length).toBeGreaterThan(0);
      expect(new Set(sections.map((section) => section.id)).size).toBe(sections.length);
      for (const section of sections) {
        const html = renderToStaticMarkup(<>{section.content}</>);
        for (const match of html.matchAll(/href="(\/docs[^\"]*)"/g)) {
          const [href, anchor] = match[1].split("#");
          const target = DOCS_PAGES.find((item) => item.href === href);
          expect(target, `Unknown link ${match[1]} in ${page.href}`).toBeDefined();
          if (target && anchor) {
            expect(DOCS_CONTENT[target.href].some((item) => item.id === anchor), `Unknown anchor ${match[1]}`).toBe(true);
          }
        }
      }
    }
  });

  test("code examples render as escaped text", () => {
    for (const lang of ["text", "bash"] as const) {
      const html = renderToStaticMarkup(<CodeBlock label="Example" lang={lang} code={'<img src=x onerror="alert(1)">'} />);
      expect(html).toContain("&#x3C;");
      expect(html).not.toContain("<img");
      expect(html).toContain('role="status"');
      expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    }
  });
});
