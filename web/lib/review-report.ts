export type ReportBlock =
  | { kind: "text" | "quote"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "table"; headers: string[]; rows: string[][] };

export type ReportSection = { title: string; blocks: ReportBlock[] };

function cells(line: string): string[] {
  const source = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const result: string[] = [];
  let cell = "";
  let codeFence = 0;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === "\\" && source[index + 1] === "|") {
      cell += "|";
      index++;
    } else if (char === "`") {
      let length = 1;
      while (source[index + length] === "`") length++;
      if (codeFence === 0) codeFence = length;
      else if (codeFence === length) codeFence = 0;
      cell += "`".repeat(length);
      index += length - 1;
    } else if (char === "|" && codeFence === 0) {
      result.push(cell.trim());
      cell = "";
    } else cell += char;
  }
  result.push(cell.trim());
  return result;
}

// Only the report's headings, lists, quotes, and tables are supported.
// HTML, images, links, and scripts remain escaped text in React.
export function parseReviewReport(text: string): ReportSection[] {
  const sections: ReportSection[] = [{ title: "", blocks: [] }];
  let tableCells = 0;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || /^(?:🟦|⬜){10}$/u.test(line)) continue;
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    if (heading) {
      sections.push({ title: heading[1], blocks: [] });
      continue;
    }
    const blocks = sections[sections.length - 1].blocks;
    if (line.startsWith("|") && i + 1 < lines.length && cells(lines[i + 1]).every((cell) => /^:?-{3,}:?$/.test(cell))) {
      const headers = cells(line);
      const rawLines = [lines[i], lines[i + 1]];
      const rawRows: string[][] = [];
      i++;
      while (i + 1 < lines.length && lines[i + 1].trim().startsWith("|")) {
        rawLines.push(lines[++i]);
        rawRows.push(cells(lines[i]));
      }
      const cellCount = headers.length * (rawRows.length + 1);
      // Sparse attacker-controlled rows must not expand into thousands of cells.
      if (headers.length > 8 || rawRows.length > 100 || tableCells + cellCount > 400) {
        blocks.push({ kind: "text", text: rawLines.join("\n") });
        continue;
      }
      tableCells += cellCount;
      const rows = rawRows.map((row) => headers.map((_, index) => index === headers.length - 1 ? row.slice(index).join(" | ") : row[index] ?? ""));
      blocks.push({ kind: "table", headers, rows });
    } else if (line.startsWith("- ")) {
      const previous = blocks.at(-1);
      if (previous?.kind === "list") previous.items.push(line.slice(2));
      else blocks.push({ kind: "list", items: [line.slice(2)] });
    } else if (line.startsWith(">")) {
      blocks.push({ kind: "quote", text: line.replace(/^>\s?/, "") });
    } else {
      blocks.push({ kind: "text", text: line });
    }
  }
  return sections.filter((section) => section.title || section.blocks.length);
}

export function reportConfidence(text: string): number | null {
  const match = /^\*\*Confidence:\*\* (\d{1,3})\/100 \(agent estimate\)/.exec(text);
  const value = match ? Number(match[1]) : null;
  return value !== null && value <= 100 ? value : null;
}
