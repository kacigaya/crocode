import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SettingsForm } from "@/components/settings-form";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { formatTime, validCursor, validInstallationId } from "@/lib/format";
import type { Agents, Installation, Review } from "@/lib/types";

export const metadata: Metadata = { title: "Installation settings" };
const PAGE_SIZE = 20;

export default async function InstallationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ before?: string; saved?: string; error?: string }>;
}) {
  const { id } = await params;
  const { before, saved, error } = await searchParams;
  const errors: Record<string, string> = {
    forbidden:
      "Only an account owner or organization admin can change settings.",
    agent: "Select an available agent.",
    model: "Enter a model, or leave the field empty.",
    validation:
      "The API did not accept these settings. Check the agent and model.",
    api: "Cannot save settings. Check that the Crocode API is available, then try again.",
  };
  if (
    !validInstallationId(id) ||
    (before !== undefined && !validCursor(before))
  )
    notFound();
  const query = new URLSearchParams({
    limit: String(PAGE_SIZE),
    ...(before ? { before } : {}),
  });
  const [installation, agents, reviews] = await Promise.all([
    api<Installation>(`/api/v1/installations/${id}`),
    api<Agents>("/api/v1/agents"),
    api<Review[]>(`/api/v1/installations/${id}/reviews?${query}`),
  ]);
  const oldest = reviews.at(-1)?.created_at;
  return (
    <>
      <div>
        <Link
          href="/installations"
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          Installations
        </Link>
        <h1 className="mt-3 break-words text-2xl font-semibold">
          {installation.account_login}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {installation.account_type} · Installation{" "}
          <span className="font-mono">{installation.id}</span>
        </p>
        {installation.suspended && (
          <p className="mt-3">
            <Badge variant="warning">Suspended on GitHub</Badge>
          </p>
        )}
      </div>
      <section aria-label="Installation settings" className="space-y-3">
        {error && errors[error] && (
          <p role="alert" className="text-sm text-destructive-foreground">
            {errors[error]}
          </p>
        )}
        {!error && saved === "1" && (
          <p role="status" className="text-sm">
            Settings saved.
          </p>
        )}
        <SettingsForm installation={installation} agents={agents} />
      </section>
      <section aria-labelledby="history-title" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="history-title" className="text-lg font-semibold">
            Review history
          </h2>
          {before && (
            <Link
              href={`/installations/${id}`}
              className="text-sm underline underline-offset-4"
            >
              Back to latest
            </Link>
          )}
        </div>
        {reviews.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
            {before
              ? "No older reviews."
              : "No reviews yet. Open or update a pull request in an enabled repository."}
          </p>
        ) : (
          <div
            className="overflow-x-auto rounded-xl border"
            role="region"
            aria-label="Review history"
            tabIndex={0}
          >
            <table className="w-full min-w-2xl text-left text-sm">
              <caption className="sr-only">
                {before ? "Older reviews" : "Latest reviews"}, newest first. All
                times are UTC.
              </caption>
              <thead className="bg-muted text-xs text-muted-foreground">
                <tr>
                  {[
                    "Pull request",
                    "Status",
                    "Agent",
                    "Findings",
                    "Created",
                  ].map((label) => (
                    <th
                      key={label}
                      scope="col"
                      className="px-4 py-3 font-medium"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {reviews.map((review) => (
                  <tr key={review.id}>
                    <td className="max-w-sm px-4 py-4">
                      <Link
                        href={`/reviews/${review.id}`}
                        className="break-words font-medium underline-offset-4 hover:underline"
                      >
                        {review.pr_title}
                      </Link>
                      <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                        {review.repo_full_name} #{review.pr_number}
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge value={review.status} />
                    </td>
                    <td className="px-4 py-4 font-mono text-xs">
                      {review.agent}
                    </td>
                    <td className="px-4 py-4 tabular-nums">
                      {review.finding_count}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-xs tabular-nums text-muted-foreground">
                      <time dateTime={review.created_at}>
                        {formatTime(review.created_at)}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {reviews.length === PAGE_SIZE && oldest && (
          <Button
            variant="outline"
            render={
              <Link
                href={`/installations/${id}?${new URLSearchParams({ before: oldest })}`}
              />
            }
          >
            Load older
          </Button>
        )}
      </section>
    </>
  );
}
