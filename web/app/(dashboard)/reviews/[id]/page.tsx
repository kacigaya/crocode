import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/status-badge";
import { api } from "@/lib/api";
import { formatTime, validReviewId } from "@/lib/format";
import { SEVERITIES, type ReviewDetail } from "@/lib/types";

export const metadata: Metadata = { title: "Review" };

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
  return (
    <>
      <div>
        <Link
          href={`/installations/${review.installation_id}`}
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          Back to installation
        </Link>
        <p className="mt-5 break-all font-mono text-sm text-muted-foreground">
          {review.repo_full_name} #{review.pr_number}
        </p>
        <h1 className="mt-2 break-words text-2xl font-semibold">
          {review.pr_title}
        </h1>
        <div className="mt-3">
          <StatusBadge value={review.status} />
        </div>
      </div>
      <dl className="grid gap-5 rounded-xl border bg-card p-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Agent", review.agent],
          ["Model", review.model ?? "Agent default"],
          ["Attempts", String(review.attempts)],
          ["Findings", String(review.finding_count)],
          ["Commit", review.head_sha],
          ["Created", formatTime(review.created_at)],
          [
            "Finished",
            review.finished_at
              ? formatTime(review.finished_at)
              : "Not finished",
          ],
          ["Review ID", review.id],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 break-all font-mono text-xs tabular-nums">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {review.error && (
        <section className="rounded-xl border border-destructive/40 p-5">
          <h2 className="font-semibold">Review error</h2>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm">
            {review.error}
          </p>
        </section>
      )}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Summary</h2>
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
          {summary || "No summary is available for this review."}
        </p>
      </section>
      <section aria-labelledby="findings-title" className="space-y-6">
        <h2 id="findings-title" className="text-lg font-semibold">
          Findings{" "}
          <span className="font-mono text-muted-foreground">
            ({findings.length})
          </span>
        </h2>
        {findings.length === 0 && (
          <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
            {review.status === "succeeded"
              ? "No findings in this review."
              : "No findings are available for this review."}
          </p>
        )}
        {SEVERITIES.map((severity) => {
          const group = findings
            .filter((finding) => finding.severity === severity)
            .sort(
              (a, b) =>
                a.path.localeCompare(b.path) ||
                a.line - b.line ||
                a.id.localeCompare(b.id),
            );
          if (!group.length) return null;
          return (
            <section
              key={severity}
              aria-labelledby={`severity-${severity}`}
              className="space-y-3"
            >
              <h3
                id={`severity-${severity}`}
                className="text-sm font-semibold capitalize"
              >
                {severity}{" "}
                <span className="text-muted-foreground">({group.length})</span>
              </h3>
              {group.map((finding) => (
                <article
                  key={finding.id}
                  className="min-w-0 space-y-3 rounded-xl border bg-card p-5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge value={finding.severity} />
                    <span className="text-xs text-muted-foreground">
                      {finding.category} ·{" "}
                      {finding.published ? "Published" : "Not published"}
                    </span>
                  </div>
                  <h4 className="break-words font-semibold">{finding.title}</h4>
                  <p className="break-all font-mono text-xs text-muted-foreground">
                    {finding.path}:
                    {finding.start_line !== null &&
                    finding.start_line !== finding.line
                      ? `${finding.start_line}-`
                      : ""}
                    {finding.line}
                  </p>
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                    {finding.body}
                  </p>
                  {finding.suggestion !== null && (
                    <div>
                      <h5 className="mb-2 text-xs font-medium text-muted-foreground">
                        Suggested change
                      </h5>
                      <pre
                        tabIndex={0}
                        aria-label="Suggested code change"
                        className="max-w-full overflow-x-auto rounded-lg border bg-muted p-4 font-mono text-xs leading-relaxed"
                      >
                        <code>{finding.suggestion}</code>
                      </pre>
                    </div>
                  )}
                </article>
              ))}
            </section>
          );
        })}
      </section>
    </>
  );
}
