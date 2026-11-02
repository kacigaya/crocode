import { AlertTriangle, FileCode } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { formatDuration, formatTime, validReviewId } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  SEVERITIES,
  type Finding,
  type Installation,
  type ReviewDetail,
  type Severity,
} from "@/lib/types";

export const metadata: Metadata = { title: "Review" };

const dot: Record<Severity, string> = {
  critical: "bg-destructive",
  high: "bg-destructive/70",
  medium: "bg-warning",
  low: "bg-info",
  info: "bg-muted-foreground/50",
};

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!validReviewId(id)) notFound();
  const { review, summary, findings } = await api<ReviewDetail>(
    `/api/v1/reviews/${id}`,
  );
  const installation = await api<Installation>(
    `/api/v1/installations/${review.installation_id}`,
  );
  const duration = formatDuration(review.created_at, review.finished_at);
  const counts = SEVERITIES.map((severity) => ({
    severity,
    count: findings.filter((f) => f.severity === severity).length,
  }));

  return (
    <>
      <PageHeader
        crumbs={[
          { label: "Installations", href: "/installations" },
          {
            label: installation.account_login,
            href: `/installations/${installation.id}`,
          },
          { label: `${review.repo_full_name}#${review.pr_number}` },
        ]}
        title={review.pr_title}
        meta={
          <>
            <StatusBadge value={review.status} />
            <span className="font-mono text-xs text-muted-foreground">
              {review.repo_full_name}#{review.pr_number} ·{" "}
              {review.head_sha.slice(0, 7)}
            </span>
          </>
        }
      />

      <section aria-label="Findings by severity">
        <dl className="flex flex-wrap gap-2">
          {counts.map(({ severity, count }) => (
            <div
              key={severity}
              className={cn(
                "flex items-center gap-2 rounded-lg border bg-card px-3 py-2",
                count === 0 && "opacity-60",
              )}
            >
              <span
                aria-hidden="true"
                className={cn("size-2 rounded-full", dot[severity])}
              />
              <dt className="text-sm capitalize text-muted-foreground">
                {severity}
              </dt>
              <dd className="text-sm font-semibold tabular-nums">{count}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-6">
          {review.error && (
            <section
              role="alert"
              className="flex gap-3 rounded-xl border border-destructive/30 bg-card p-4"
            >
              <AlertTriangle
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-destructive-foreground"
              />
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">Review error</h2>
                <p className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
                  {review.error}
                </p>
              </div>
            </section>
          )}

          <section
            aria-labelledby="summary-title"
            className="rounded-xl border bg-card p-4"
          >
            <h2 id="summary-title" className="text-sm font-semibold">
              Summary
            </h2>
            <p className="mt-2 whitespace-pre-wrap text-pretty break-words text-sm leading-relaxed text-muted-foreground">
              {summary || "No summary is available for this review."}
            </p>
          </section>

          <section aria-labelledby="findings-title" className="space-y-4">
            <h2 id="findings-title" className="text-sm font-semibold">
              Findings{" "}
              <span className="font-normal tabular-nums text-muted-foreground">
                {findings.length}
              </span>
            </h2>
            {findings.length === 0 ? (
              <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                {review.status === "succeeded"
                  ? "No findings in this review."
                  : "No findings are available for this review."}
              </p>
            ) : (
              <ol className="space-y-4">
                {sortFindings(findings).map((finding) => (
                  <li key={finding.id}>
                    <FindingCard finding={finding} />
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <aside
          aria-labelledby="details-title"
          className="rounded-xl border bg-card lg:sticky lg:top-8"
        >
          <h2
            id="details-title"
            className="border-b px-4 py-3 text-sm font-semibold"
          >
            Details
          </h2>
          <dl className="divide-y text-sm">
            {[
              ["Agent", review.agent ?? "–"],
              ["Model", review.model ?? "Agent default"],
              ["Attempts", String(review.attempts)],
              ["Duration", duration ?? "–"],
              ["Created", formatTime(review.created_at)],
              [
                "Finished",
                review.finished_at
                  ? formatTime(review.finished_at)
                  : "Not finished",
              ],
              ["Commit", review.head_sha],
              ["Review ID", review.id],
            ].map(([label, value]) => (
              <div key={label} className="px-4 py-2.5">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-0.5 break-all font-mono text-xs tabular-nums">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>
    </>
  );
}

function sortFindings(findings: Finding[]) {
  const rank = (s: Severity) => SEVERITIES.indexOf(s);
  return [...findings].sort(
    (a, b) =>
      rank(a.severity) - rank(b.severity) ||
      a.path.localeCompare(b.path) ||
      a.line - b.line ||
      a.id.localeCompare(b.id),
  );
}

function FindingCard({ finding }: { finding: Finding }) {
  const range =
    finding.start_line !== null && finding.start_line !== finding.line
      ? `${finding.start_line}-${finding.line}`
      : String(finding.line);
  return (
    <article className="overflow-hidden rounded-xl border bg-card">
      <header className="flex flex-wrap items-center gap-2 border-b bg-muted/50 px-4 py-2">
        <FileCode
          aria-hidden="true"
          className="size-3.5 text-muted-foreground"
        />
        <span className="min-w-0 flex-1 break-all font-mono text-xs">
          {finding.path}
          <span className="text-muted-foreground">:{range}</span>
        </span>
        <StatusBadge value={finding.severity} />
        <Badge variant="outline" className="capitalize">
          {finding.category}
        </Badge>
      </header>
      <div className="space-y-2 p-4">
        <h3 className="text-pretty break-words font-semibold">
          {finding.title}
        </h3>
        {/* Agent output is untrusted: render it as plain text, never as HTML. */}
        <p className="whitespace-pre-wrap text-pretty break-words text-sm leading-relaxed text-muted-foreground">
          {finding.body}
        </p>
        <p className="text-xs text-muted-foreground">
          {finding.published ? "Posted on the pull request" : "Not posted"}
        </p>
      </div>
      {finding.suggestion !== null && (
        <div className="border-t">
          <p className="px-4 pt-3 text-xs font-medium text-muted-foreground">
            Suggested change
          </p>
          <pre
            tabIndex={0}
            aria-label="Suggested code change"
            className="m-4 mt-2 max-w-full overflow-x-auto rounded-lg border bg-success/5 py-2 font-mono text-xs leading-relaxed"
          >
            <code>
              {finding.suggestion.split("\n").map((line, index) => (
                <span key={index} className="flex">
                  <span
                    aria-hidden="true"
                    className="w-8 shrink-0 select-none text-center text-success-foreground"
                  >
                    +
                  </span>
                  <span className="pr-4">{line || " "}</span>
                </span>
              ))}
            </code>
          </pre>
        </div>
      )}
    </article>
  );
}
