"use client";

import { DEFAULT_THEMES } from "@pierre/diffs";
import {
  type DiffLineAnnotation,
  type FileDiffOptions,
  MultiFileDiff,
  PatchDiff,
} from "@pierre/diffs/react";
import { useMemo } from "react";
import { StatusBadge } from "@/components/status-badge";
import { useIsDark } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { filePatch, newSideLines } from "@/lib/patch";
import { SEVERITIES, type Finding, type ReviewFile } from "@/lib/types";

type ThemeType = "system" | "light" | "dark";

const rank = (f: Finding) => SEVERITIES.indexOf(f.severity);

/**
 * Findings grouped by file. A file with a stored patch shows its PR diff with
 * each finding under its line, like a GitHub review. Other findings show as a
 * plain list.
 */
export function ReviewFindings({
  findings,
  files,
}: {
  findings: Finding[];
  files: ReviewFile[];
}) {
  const dark = useIsDark();
  const themeType: ThemeType = dark === null ? "system" : dark ? "dark" : "light";
  const patches = new Map(files.map((f) => [f.path, f.patch]));
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    groups.set(finding.path, [...(groups.get(finding.path) ?? []), finding]);
  }
  // Worst severity first, then path.
  const ordered = [...groups].sort(
    ([a, fa], [b, fb]) =>
      Math.min(...fa.map(rank)) - Math.min(...fb.map(rank)) || a.localeCompare(b),
  );
  return (
    <div className="space-y-6">
      {ordered.map(([path, list]) => (
        <FileFindings
          key={path}
          path={path}
          patch={patches.get(path) ?? null}
          findings={list.toSorted((a, b) => a.line - b.line || rank(a) - rank(b))}
          themeType={themeType}
        />
      ))}
    </div>
  );
}

function FileFindings({
  path,
  patch,
  findings,
  themeType,
}: {
  path: string;
  patch: string | null;
  findings: Finding[];
  themeType: ThemeType;
}) {
  const { full, annotations, rest } = useMemo(() => {
    const full = patch === null ? null : filePatch(path, patch);
    // A finding outside the patch would not render in the diff, so it goes
    // into the list below the diff instead.
    const inDiff = (f: Finding) =>
      full !== null && patch !== null && newSideLines(patch, f.line, f.line) !== null;
    return {
      full,
      annotations: findings.filter(inDiff).map(
        (f): DiffLineAnnotation<Finding> => ({
          side: "additions",
          lineNumber: f.line,
          metadata: f,
        }),
      ),
      rest: findings.filter((f) => !inDiff(f)),
    };
  }, [path, patch, findings]);
  const options = useMemo<FileDiffOptions<Finding, undefined>>(
    () => ({
      theme: DEFAULT_THEMES,
      themeType,
      diffStyle: "unified",
      overflow: "wrap",
      lineDiffType: "word",
    }),
    [themeType],
  );

  return (
    <section aria-label={path} className="overflow-hidden rounded-xl border">
      {full !== null && annotations.length > 0 ? (
        <PatchDiff
          patch={full}
          options={options}
          lineAnnotations={annotations}
          renderAnnotation={(annotation) => (
            <FindingNote
              finding={annotation.metadata}
              original={
                patch === null
                  ? null
                  : newSideLines(
                      patch,
                      annotation.metadata.start_line ?? annotation.metadata.line,
                      annotation.metadata.line,
                    )
              }
              themeType={themeType}
            />
          )}
        />
      ) : (
        <p className="border-b bg-muted/40 px-4 py-2 font-mono text-xs break-all">
          {path}
        </p>
      )}
      {rest.length > 0 && (
        <ol className="divide-y">
          {rest.map((finding) => (
            <li key={finding.id}>
              <FindingNote finding={finding} original={null} themeType={themeType} showLine />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function FindingNote({
  finding,
  original,
  themeType,
  showLine = false,
}: {
  finding: Finding;
  original: string[] | null;
  themeType: ThemeType;
  showLine?: boolean;
}) {
  const range =
    finding.start_line !== null && finding.start_line !== finding.line
      ? `${finding.start_line}–${finding.line}`
      : String(finding.line);
  return (
    <article className="space-y-2 bg-background px-4 py-3 font-sans">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge value={finding.severity} />
        <Badge variant="outline" className="capitalize">
          {finding.category}
        </Badge>
        {showLine && (
          <span className="font-mono text-xs text-muted-foreground">
            Line {range}
          </span>
        )}
        <span className="ms-auto text-xs text-muted-foreground">
          {finding.published ? "Posted on GitHub" : "Not posted"}
        </span>
      </div>
      <h3 className="text-sm font-semibold text-pretty break-words">
        {finding.title}
      </h3>
      {/* Agent output is untrusted: render it as plain text, never as HTML. */}
      <p className="text-sm leading-relaxed whitespace-pre-wrap text-pretty break-words text-muted-foreground">
        {finding.body}
      </p>
      {finding.suggestion !== null && (
        <Suggestion
          path={finding.path}
          original={original}
          suggestion={finding.suggestion}
          themeType={themeType}
        />
      )}
    </article>
  );
}

/** The suggested change as a diff against the lines it replaces. */
function Suggestion({
  path,
  original,
  suggestion,
  themeType,
}: {
  path: string;
  original: string[] | null;
  suggestion: string;
  themeType: ThemeType;
}) {
  const oldFile = useMemo(
    () => ({ name: path, contents: original === null ? "" : `${original.join("\n")}\n` }),
    [path, original],
  );
  const newFile = useMemo(
    () => ({ name: path, contents: `${suggestion.replace(/\n$/, "")}\n` }),
    [path, suggestion],
  );
  const options = useMemo<FileDiffOptions<undefined, undefined>>(
    () => ({
      theme: DEFAULT_THEMES,
      themeType,
      diffStyle: "unified",
      overflow: "wrap",
      lineDiffType: "word",
      disableFileHeader: true,
      disableLineNumbers: true,
    }),
    [themeType],
  );
  return (
    <figure className="overflow-hidden rounded-lg border">
      <figcaption className="border-b bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
        Suggested change
      </figcaption>
      <MultiFileDiff oldFile={oldFile} newFile={newFile} options={options} />
    </figure>
  );
}
