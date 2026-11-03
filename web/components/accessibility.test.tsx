import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Autocomplete, AutocompleteInput } from "./ui/autocomplete";
import { Button } from "./ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { TimeAgo } from "./time-ago";

test("autocomplete affordances have names and keyboard focus styles", () => {
  const html = renderToStaticMarkup(
    <Autocomplete value="model">
      <AutocompleteInput aria-label="Model" showTrigger showClear />
    </Autocomplete>,
  );
  for (const slot of ["autocomplete-trigger", "autocomplete-clear"]) {
    const button = html.match(new RegExp(`<button[^>]*data-slot="${slot}"[^>]*>`))?.[0];
    expect(button).toBeDefined();
    expect(button).toMatch(/aria-label="[^"]+"/);
    expect(button).toContain("focus-visible:ring-2");
  }
});

test("loading buttons expose busy state and keep their action name", () => {
  const html = renderToStaticMarkup(<Button loading>Save settings</Button>);
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain("disabled");
  expect(html).toContain("Save settings");
  expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
  expect(html).not.toContain('role="status"');
});

test("wide tables have a named keyboard scroll target and column headers", () => {
  const html = renderToStaticMarkup(
    <Table aria-label="Agent usage">
      <TableHeader><TableRow><TableHead>Agent</TableHead></TableRow></TableHeader>
      <TableBody><TableRow><TableCell>Codex</TableCell></TableRow></TableBody>
    </Table>,
  );
  expect(html).toMatch(/<div[^>]*tabindex="0"[^>]*role="region"[^>]*aria-label="Agent usage"/);
  expect(html).toContain('scope="col"');
});

test("relative times expose exact UTC time without hover", () => {
  const html = renderToStaticMarkup(<TimeAgo value="2026-11-01T10:00:00Z" />);
  expect(html).toContain('aria-label="1 Nov 2026, 10:00 UTC"');
});
