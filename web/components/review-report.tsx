import type { ReactNode } from "react";
import { Meter, MeterIndicator, MeterTrack } from "@/components/ui/meter";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { parseReviewReport, reportConfidence, type ReportBlock } from "@/lib/review-report";
import { cn } from "@/lib/utils";

function InlineText({ text }: { text: string }) {
  return text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index} className="font-medium text-foreground">{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index} className="rounded bg-muted px-1 font-mono text-xs">{part.slice(1, -1)}</code>;
    return part;
  });
}

function Text({ text }: { text: string }) {
  const confidence = reportConfidence(text);
  return <>
    <InlineText text={text} />
    {confidence !== null && <Meter
      value={confidence} min={0} max={100}
      aria-label={`Agent confidence: ${confidence} out of 100. Estimate, not a measured probability.`}
      className="mt-3 max-w-sm"
    ><MeterTrack className="rounded bg-muted"><MeterIndicator className="h-full bg-info transition-none" /></MeterTrack></Meter>}
  </>;
}

function statusColor(text: string): string {
  if (/^(?:🟢|🟩)/u.test(text)) return "text-success-foreground";
  if (/^(?:🟡|🟠)/u.test(text)) return "text-warning-foreground";
  if (/^🔴/u.test(text)) return "text-destructive-foreground";
  return "text-muted-foreground";
}

function Content({ blocks, title }: { blocks: ReportBlock[]; title: string }) {
  return blocks.map((block, index): ReactNode => {
    if (block.kind === "table") return <Table key={index} aria-label={title || "Review checks"} className="table-fixed">
      <TableHeader><TableRow>{block.headers.map((header, column) => <TableHead key={column} scope="col" className="whitespace-normal break-words"><InlineText text={header} /></TableHead>)}</TableRow></TableHeader>
      <TableBody>{block.rows.map((row, rowIndex) => <TableRow key={rowIndex}>{row.map((cell, column) => <TableCell key={column} className={cn("whitespace-normal break-words align-top", statusColor(cell))}><Text text={cell} /></TableCell>)}</TableRow>)}</TableBody>
    </Table>;
    if (block.kind === "list") return <ul key={index} className="list-disc space-y-2 ps-5 marker:text-muted-foreground">{block.items.map((item, itemIndex) => <li key={itemIndex}><Text text={item} /></li>)}</ul>;
    if (block.kind === "quote") return block.text ? <blockquote key={index} className={cn("border-s-2 border-border ps-4", statusColor(block.text.replaceAll("**", "")))}><Text text={block.text} /></blockquote> : null;
    return <div key={index} className="whitespace-pre-wrap"><Text text={block.text} /></div>;
  });
}

export function ReviewReport({ text, className }: { text: string; className?: string }) {
  const sections = parseReviewReport(text);
  return <div className={cn("min-w-0 space-y-6 break-words text-pretty text-sm leading-relaxed text-muted-foreground", className)}>
    {sections.map((section, index) => section.title === "Checks performed (agent report)" ?
      <details key={index} className="rounded-lg border border-border p-4">
        <summary className="cursor-pointer rounded-sm font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">Checks performed <span className="font-normal text-muted-foreground">(agent report)</span></summary>
        <div className="mt-4 space-y-3"><Content blocks={section.blocks} title={section.title} /></div>
      </details> :
      <section key={index} aria-label={section.title || "Review details"} className="space-y-3">
        {section.title && <h2 className="font-medium text-foreground">{section.title}</h2>}
        <Content blocks={section.blocks} title={section.title} />
      </section>
    )}
  </div>;
}
