import { AlertTriangle, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { ReviewFindings } from "@/components/review-findings";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { formatDuration, formatTime, validReviewId } from "@/lib/format";
import {
  type Installation,
  type ReviewDetail,
  SEVERITIES,
  type Severity,
} from "@/lib/types";
import { cn } from "@/lib/utils";

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
  const {
    review,
    summary,
    findings,
    files = [],
  } = await api<ReviewDetail>(`/api/v1/reviews/${id}`);
  const installation = await api<Installation>(
    `/api/v1/installations/${review.installation_id}`,
  );
  const duration = formatDuration(review.created_at, review.finished_at);
  const counts = SEVERITIES.map((severity) => ({
    severity,
    count: findings.filter((f) => f.severity === severity).length,
  })).filter(({ count }) => count > 0);
  const webUrl = (
    process.env.GITHUB_WEB_URL?.trim() || "https://github.com"
  ).replace(/\/$/, "");
  const details = [
    ["Agent", review.agent ?? "–"],
    ["Model", review.model ?? "Agent default"],
    ["Duration", duration ?? "–"],
    ["Attempts", String(review.attempts)],
    [
      "Finished",
      review.finished_at ? formatTime(review.finished_at) : "Not finished",
    ],
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
        title={review.pr_title}
        meta={
          <>
            <StatusBadge value={review.status} />
            <span
              className="font-mono text-xs text-muted-foreground"
              title={review.head_sha}
            >
              {review.repo_full_name}#{review.pr_number} ·{" "}
              {review.head_sha.slice(0, 7)}
            </span>
          </>
        }
        actions={
          <Button
            variant="outline"
            render={
              <a
                href={`${webUrl}/${review.repo_full_name}/pull/${review.pr_number}`}
              />
            }
          >
            View pull request
            <ExternalLink aria-hidden="true" />
          </Button>
        }
      />

      <section aria-label="Review details" className="space-y-4">
        <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {details.map(([label, value]) => (
            <div key={label} className="flex gap-1.5">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-mono text-xs leading-5 tabular-nums">
                {value}
              </dd>
            </div>
          ))}
        </dl>
        {/* Agent output is untrusted: render it as plain text, never as HTML. */}
        <p className="max-w-3xl text-pretty whitespace-pre-wrap break-words leading-relaxed text-muted-foreground">
          {summary || "No summary is available for this review."}
        </p>
      </section>

      {review.error && (
        <section
          role="alert"
          className="flex gap-3 border-l-2 border-destructive py-1 ps-4"
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

      <section aria-labelledby="findings-title" className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h2 id="findings-title" className="font-semibold">
            Findings{" "}
            <span className="font-normal tabular-nums text-muted-foreground">
              {findings.length}
            </span>
          </h2>
          {counts.length > 0 && (
            <ul
              aria-label="Findings by severity"
              className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground"
            >
              {counts.map(({ severity, count }) => (
                <li key={severity} className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className={cn("size-2 rounded-full", dot[severity])}
                  />
                  <span className="tabular-nums text-foreground">{count}</span>
                  <span className="capitalize">{severity}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {findings.length === 0 ? (
          <p className="border-y border-dashed py-10 text-center text-sm text-muted-foreground">
            {review.status === "succeeded"
              ? "No findings in this review."
              : "No findings are available for this review."}
          </p>
        ) : (
          <ReviewFindings findings={findings} files={files} />
        )}
      </section>
    </>
  );
}
