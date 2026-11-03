import { AlertTriangle, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/brand";
import { PageHeader } from "@/components/page-header";
import { ReviewControls } from "@/components/review-controls";
import { ReviewFindings } from "@/components/review-findings";
import { severityColor, StatusBadge } from "@/components/status-badge";
import { TimeAgo } from "@/components/time-ago";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import { api, optionalApi } from "@/lib/api";
import { accountAvatar } from "@/lib/avatar";
import { canCancel, canRetry, explainReview } from "@/lib/failure";
import {
  formatCount,
  formatDuration,
  formatSeconds,
  formatTime,
  validReviewId,
} from "@/lib/format";
import {
  type Installation,
  type PullDetail,
  type Review,
  type ReviewDetail,
  SEVERITIES,
} from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Review" };

const pullState: Record<
  PullDetail["state"] | "draft",
  { label: string; variant: BadgeProps["variant"] }
> = {
  open: { label: "Open", variant: "success" },
  draft: { label: "Draft", variant: "outline" },
  merged: { label: "Merged", variant: "info" },
  closed: { label: "Closed", variant: "secondary" },
};

const notices: Record<string, string> = {
  retry: "The review is queued again. Reload the page to follow it.",
  cancel:
    "The review is cancelled. A running agent stops within about 20 seconds.",
};
const errors: Record<string, string> = {
  forbidden: "Only an account owner or organization admin can control reviews.",
  conflict:
    "The review changed state, or a newer review of this pull request exists. Reload the page.",
  api: "Cannot reach the CroCode API. Try again.",
};

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const { id } = await params;
  const { done, error } = await searchParams;
  if (!validReviewId(id)) notFound();
  const {
    review,
    summary,
    findings,
    files = [],
    sast = { status: null, results: [] },
  } = await api<ReviewDetail>(`/api/v1/reviews/${id}`);
  const timelineQuery = new URLSearchParams({
    repo: review.repo_full_name,
    pr: String(review.pr_number),
    limit: "50",
  });
  const [installation, pull, timeline] = await Promise.all([
    api<Installation>(`/api/v1/installations/${review.installation_id}`),
    optionalApi<PullDetail>(`/api/v1/reviews/${id}/pull`),
    api<Review[]>(
      `/api/v1/installations/${review.installation_id}/reviews?${timelineQuery}`,
    ),
  ]);
  const counts = SEVERITIES.map((severity) => ({
    severity,
    count: findings.filter((f) => f.severity === severity).length,
  })).filter(({ count }) => count > 0);
  const webUrl = (
    process.env.GITHUB_WEB_URL?.trim() || "https://github.com"
  ).replace(/\/$/, "");
  const pullUrl = `${webUrl}/${review.repo_full_name}/pull/${review.pr_number}`;
  const state = pull
    ? pullState[pull.state === "open" && pull.draft ? "draft" : pull.state]
    : null;
  const failure = explainReview(review);
  // Only the newest review of a pull request can run again.
  const newest = timeline[0]?.id === review.id;
  const showControls =
    installation.can_admin &&
    (canCancel(review.status) || (canRetry(review.status) && newest));
  const tokens =
    review.input_tokens === null && review.output_tokens === null
      ? "Not reported"
      : `${formatCount(review.input_tokens) ?? "–"} in · ${formatCount(review.output_tokens) ?? "–"} out`;
  const details = [
    ["Agent", review.agent ?? "Not picked yet"],
    ["Model", review.model ?? "Agent default"],
    ["Duration", formatDuration(review.created_at, review.finished_at) ?? "–"],
    [
      "Agent time",
      formatSeconds(
        review.agent_duration_ms === null
          ? null
          : review.agent_duration_ms / 1000,
      ) ?? "–",
    ],
    ["Tokens", tokens],
    [
      "Cached input",
      formatCount(review.cached_input_tokens) ?? "Not reported",
    ],
    ["Attempts", String(review.attempts)],
    ["Queued", formatTime(review.created_at)],
    [
      "Finished",
      review.finished_at ? formatTime(review.finished_at) : "Not finished",
    ],
    ["Commit", review.head_sha.slice(0, 12)],
  ];

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
        title={
          <>
            {review.pr_title}{" "}
            <span className="font-normal text-muted-foreground">
              #{review.pr_number}
            </span>
          </>
        }
        meta={
          <>
            {state && <Badge variant={state.variant}>{state.label}</Badge>}
            <span className="sr-only">Review status:</span>
            <StatusBadge value={review.status} />
            <span className="font-mono text-xs text-muted-foreground">
              {review.repo_full_name}
            </span>
          </>
        }
        actions={
          <>
            {showControls && (
              <ReviewControls
                id={review.id}
                retry={canRetry(review.status) && newest}
                cancel={canCancel(review.status)}
              />
            )}
            <Button variant="outline" render={<a href={pullUrl} />}>
              View on GitHub
              <ExternalLink aria-hidden="true" />
            </Button>
          </>
        }
      />

      {error && errors[error] && (
        <Alert variant="error" role="alert">
          <AlertDescription>{errors[error]}</AlertDescription>
        </Alert>
      )}
      {!error && done && notices[done] && (
        <Alert variant="success" role="status">
          <AlertDescription>{notices[done]}</AlertDescription>
        </Alert>
      )}

      {pull && (
        <section
          aria-label="Pull request"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground"
        >
          {pull.author && (
            <span className="flex items-center gap-2">
              <Avatar
                name={pull.author}
                image={pull.author_id ? accountAvatar(pull.author_id) : null}
              />
              <span className="text-foreground">{pull.author}</span>
            </span>
          )}
          <span className="flex min-w-0 items-center gap-1.5 font-mono text-xs">
            <span className="truncate rounded-sm bg-muted px-1.5 py-0.5 text-foreground">
              {pull.base_ref}
            </span>
            <span aria-hidden="true">←</span>
            <span className="sr-only">from</span>
            <span className="truncate rounded-sm bg-muted px-1.5 py-0.5 text-foreground">
              {pull.head_ref}
            </span>
          </span>
          <span className="tabular-nums">
            {pull.changed_files} {pull.changed_files === 1 ? "file" : "files"} ·{" "}
            {pull.commits} {pull.commits === 1 ? "commit" : "commits"}
          </span>
          <span className="font-mono text-xs tabular-nums">
            <span className="text-success-foreground">
              +{pull.additions.toLocaleString("en")}
            </span>{" "}
            <span className="text-destructive-foreground">
              −{pull.deletions.toLocaleString("en")}
            </span>
          </span>
        </section>
      )}

      {failure && (
        <Alert variant={review.status === "failed" ? "error" : "info"}>
          <AlertTriangle />
          <AlertTitle>{failure.title}</AlertTitle>
          <AlertDescription>
            <p>
              {failure.detail}
              {failure.action && ` ${failure.action}`}
            </p>
            {review.error && (
              <details className="mt-1 w-full">
                <summary className="w-fit cursor-pointer rounded-sm text-xs">
                  Error details
                </summary>
                {/* Agent output is untrusted: render it as plain text, never as HTML. */}
                <p className="mt-1 whitespace-pre-wrap break-words font-mono text-xs">
                  {review.error}
                </p>
              </details>
            )}
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue={findings.length > 0 ? "findings" : "summary"}>
        <TabsList variant="underline" className="w-full justify-start border-b">
          <TabsTab value="summary" className="grow-0">
            Summary
          </TabsTab>
          <TabsTab value="findings" className="grow-0">
            Findings
            <span className="tabular-nums text-muted-foreground">
              {findings.length}
            </span>
          </TabsTab>
          <TabsTab value="sast" className="grow-0">
            Static analysis
            <span className="tabular-nums text-muted-foreground">
              {sast.results.length}
            </span>
          </TabsTab>
          <TabsTab value="timeline" className="grow-0">
            Timeline
            <span className="tabular-nums text-muted-foreground">
              {timeline.length}
            </span>
          </TabsTab>
        </TabsList>

        <TabsPanel value="summary" keepMounted className="space-y-6 pt-4">
          {/* Agent output is untrusted: render it as plain text, never as HTML. */}
          <p className="max-w-3xl whitespace-pre-wrap break-words text-pretty leading-relaxed">
            {summary || "No summary is available for this review."}
          </p>
          {counts.length > 0 && (
            <ul
              aria-label="Findings by severity"
              className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground"
            >
              {counts.map(({ severity, count }) => (
                <li key={severity} className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className={cn("size-2 rounded-full", severityColor[severity])}
                  />
                  <span className="tabular-nums text-foreground">{count}</span>
                  <span className="capitalize">{severity}</span>
                </li>
              ))}
            </ul>
          )}
          <dl className="grid max-w-3xl grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 rounded-xl border bg-card p-4 text-sm sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
            {details.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="truncate font-mono text-xs leading-5 tabular-nums">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </TabsPanel>

        <TabsPanel value="findings" keepMounted className="pt-4">
          {findings.length === 0 ? (
            <p className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
              {review.status === "succeeded"
                ? "The agent found no problems in this pull request."
                : review.status === "queued" || review.status === "running"
                  ? "This review is not finished. Reload the page to see new findings."
                  : "This review has no findings. See the Summary tab for the reason."}
            </p>
          ) : (
            <ReviewFindings findings={findings} files={files} />
          )}
        </TabsPanel>

        <TabsPanel value="sast" keepMounted className="space-y-3 pt-4">
          <p className="max-w-3xl text-sm text-muted-foreground">
            {sast.status === null
              ? "Static analysis did not run for this review."
              : sast.status === "completed"
                ? "OpenGrep results on added lines. The agent received them as hints and reported only the ones it confirmed. Results can be false positives."
                : sast.status === "partial"
                  ? "OpenGrep finished with errors, so some results can be missing. The agent received the results below as hints. Results can be false positives."
                  : sast.status === "timed_out"
                  ? "Static analysis timed out. The agent reviewed without it."
                  : "Static analysis failed. The agent reviewed without it."}
          </p>
          {(sast.status === "completed" || sast.status === "partial") &&
            sast.results.length === 0 && (
            <p className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
              OpenGrep found nothing on the added lines.
            </p>
          )}
          {sast.results.length > 0 && (
            <ul aria-label="Static analysis results" className="max-w-3xl divide-y rounded-xl border">
              {sast.results.map((r) => (
                <li key={`${r.rule_id}:${r.path}:${r.line}`} className="space-y-1 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        r.severity === "error"
                          ? "error"
                          : r.severity === "warning"
                            ? "warning"
                            : "secondary"
                      }
                      className="capitalize"
                    >
                      {r.severity}
                    </Badge>
                    <span className="break-all font-mono text-xs">
                      {r.path}:{r.line}
                      {r.end_line > r.line && `-${r.end_line}`}
                    </span>
                  </div>
                  {/* Rule text and paths are rendered as plain text. */}
                  <p className="text-sm break-words">{r.message}</p>
                  <p className="break-all font-mono text-xs text-muted-foreground">
                    {r.rule_id}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </TabsPanel>

        <TabsPanel value="timeline" keepMounted className="pt-4">
          <ol aria-label="Reviews of this pull request" className="max-w-3xl">
            {timeline.map((run, index) => {
              const current = run.id === review.id;
              return (
                <li key={run.id} className="relative flex gap-3 pb-5 last:pb-0">
                  {index < timeline.length - 1 && (
                    <span
                      aria-hidden="true"
                      className="absolute top-5 bottom-0 left-[5px] w-px bg-border"
                    />
                  )}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-1.5 size-[11px] shrink-0 rounded-full border-2 border-background",
                      run.status === "succeeded" && "bg-success",
                      run.status === "failed" && "bg-destructive",
                      run.status === "running" && "bg-info",
                      !["succeeded", "failed", "running"].includes(run.status) &&
                        "bg-muted-foreground/50",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <StatusBadge value={run.status} />
                      {current ? (
                        <span className="font-mono text-xs">
                          {run.head_sha.slice(0, 7)}
                        </span>
                      ) : (
                        <Link
                          href={`/reviews/${run.id}`}
                          className="rounded-sm font-mono text-xs underline-offset-2 hover:underline"
                        >
                          {run.head_sha.slice(0, 7)}
                          <span className="sr-only">, open this review</span>
                        </Link>
                      )}
                      {current && <Badge variant="outline">This review</Badge>}
                      <span className="text-xs text-muted-foreground">
                        <TimeAgo value={run.created_at} />
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {run.finding_count}{" "}
                      {run.finding_count === 1 ? "finding" : "findings"} ·{" "}
                      {run.agent ?? "no agent yet"}
                      {run.model && ` (${run.model})`}
                      {formatDuration(run.created_at, run.finished_at) &&
                        ` · ${formatDuration(run.created_at, run.finished_at)}`}
                    </p>
                    {explainReview(run) && (
                      <p
                        className={cn(
                          "mt-1 text-xs",
                          run.status === "failed"
                            ? "text-destructive-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {explainReview(run)?.title}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </TabsPanel>
      </Tabs>
    </>
  );
}
