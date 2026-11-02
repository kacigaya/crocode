import { ChevronRight, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/brand";
import { PageHeader, StatGrid } from "@/components/page-header";
import { SettingsForm } from "@/components/settings-form";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { accountAvatar } from "@/lib/avatar";
import {
  formatRelative,
  formatTime,
  validCursor,
  validInstallationId,
} from "@/lib/format";
import type { Agents, Installation, Review } from "@/lib/types";

export const metadata: Metadata = { title: "Installation" };
const PAGE_SIZE = 20;

const errors: Record<string, string> = {
  forbidden: "Only an account owner or organization admin can change settings.",
  agent: "Select an available agent.",
  model: "Enter a model, or leave the field empty.",
  validation:
    "The API did not accept these settings. Check the agent and model.",
  api: "Cannot save settings. Check that the CroCode API is available, then try again.",
};

export default async function InstallationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ before?: string; saved?: string; error?: string }>;
}) {
  const { id } = await params;
  const { before, saved, error } = await searchParams;
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
  const finished = reviews.filter(
    (r) => r.status === "succeeded" || r.status === "failed",
  );
  const succeeded = finished.filter((r) => r.status === "succeeded").length;
  const scope = before ? "This page" : `Last ${reviews.length} reviews`;
  const githubUrl =
    installation.account_type === "Organization"
      ? `https://github.com/organizations/${encodeURIComponent(installation.account_login)}/settings/installations/${installation.id}`
      : `https://github.com/settings/installations/${installation.id}`;

  return (
    <>
      <PageHeader
        crumbs={[
          { label: "Installations", href: "/installations" },
          { label: installation.account_login },
        ]}
        leading={
          <Avatar
            name={installation.account_login}
            image={accountAvatar(installation.account_id)}
            size="lg"
          />
        }
        title={installation.account_login}
        description={
          <>
            {installation.account_type} ·{" "}
            {installation.repository_selection === "all"
              ? "All repositories"
              : "Selected repositories"}{" "}
            · Installation{" "}
            <span className="font-mono tabular-nums">{installation.id}</span>
          </>
        }
        meta={
          <>
            {installation.suspended ? (
              <Badge variant="warning">Suspended on GitHub</Badge>
            ) : (
              <Badge
                variant={
                  installation.settings.enabled ? "success" : "secondary"
                }
              >
                {installation.settings.enabled ? "Reviews on" : "Reviews off"}
              </Badge>
            )}
            <Badge variant="outline">
              {installation.can_admin ? "Admin" : "Read only"}
            </Badge>
          </>
        }
        actions={
          <Button variant="outline" render={<a href={githubUrl} />}>
            Manage on GitHub
            <ExternalLink aria-hidden="true" />
          </Button>
        }
      />

      {reviews.length > 0 && (
        <StatGrid
          label="Review statistics"
          stats={[
            { label: "Reviews", value: reviews.length, hint: scope },
            {
              label: "Success rate",
              value: finished.length
                ? `${Math.round((succeeded / finished.length) * 100)}%`
                : "–",
              hint: `${succeeded} of ${finished.length} finished`,
            },
            {
              label: "Findings",
              value: reviews.reduce((sum, r) => sum + r.finding_count, 0),
              hint: scope,
            },
            {
              label: "In progress",
              value: reviews.filter(
                (r) => r.status === "queued" || r.status === "running",
              ).length,
              hint: "Queued or running",
            },
          ]}
        />
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section
          aria-labelledby="history-title"
          className="min-w-0 overflow-hidden rounded-xl border bg-card"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
            <h2 id="history-title" className="text-sm font-semibold">
              {before ? "Older reviews" : "Recent reviews"}
            </h2>
            {before && (
              <Link
                href={`/installations/${id}`}
                className="rounded-sm text-sm text-muted-foreground hover:text-foreground"
              >
                Back to latest
              </Link>
            )}
          </div>
          {reviews.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-muted-foreground">
              {before
                ? "No older reviews."
                : "No reviews yet. Open or update a pull request in a repository where the app is installed."}
            </p>
          ) : (
            <div
              className="overflow-x-auto"
              role="region"
              aria-labelledby="history-title"
              tabIndex={0}
            >
              <table className="w-full sm:min-w-lg text-left text-sm">
                <caption className="sr-only">
                  Reviews, newest first. Hover a time to see it in UTC.
                </caption>
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      Pull request
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      Status
                    </th>
                    <th
                      scope="col"
                      className="hidden px-4 py-2.5 text-right font-medium sm:table-cell"
                    >
                      Findings
                    </th>
                    <th
                      scope="col"
                      className="hidden px-4 py-2.5 font-medium sm:table-cell"
                    >
                      Created
                    </th>
                    <th scope="col" className="hidden w-8 px-2 sm:table-cell">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {reviews.map((review) => (
                    <tr
                      key={review.id}
                      className="group relative transition-colors hover:bg-accent"
                    >
                      <td className="max-w-48 px-4 py-3 sm:max-w-xs">
                        <Link
                          href={`/reviews/${review.id}`}
                          className="block truncate rounded-sm font-medium after:absolute after:inset-0"
                        >
                          {review.pr_title}
                        </Link>
                        <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                          {review.repo_full_name}#{review.pr_number}
                          <span className="sm:hidden">
                            {" · "}
                            {formatRelative(review.created_at)}
                          </span>
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge value={review.status} />
                      </td>
                      <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">
                        {review.finding_count}
                      </td>
                      <td className="hidden whitespace-nowrap px-4 py-3 text-xs text-muted-foreground sm:table-cell">
                        <time
                          dateTime={review.created_at}
                          title={formatTime(review.created_at)}
                        >
                          {formatRelative(review.created_at)}
                        </time>
                      </td>
                      <td className="hidden px-2 py-3 text-muted-foreground sm:table-cell">
                        <ChevronRight
                          aria-hidden="true"
                          className="size-4 transition-transform group-hover:translate-x-0.5"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {reviews.length === PAGE_SIZE && oldest && (
            <div className="border-t px-4 py-3">
              <Button
                variant="outline"
                size="sm"
                render={
                  <Link
                    href={`/installations/${id}?${new URLSearchParams({ before: oldest })}`}
                  />
                }
              >
                Load older
              </Button>
            </div>
          )}
        </section>

        <aside aria-label="Settings" className="space-y-3 lg:sticky lg:top-8">
          {error && errors[error] && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 px-3 py-2 text-sm text-destructive-foreground"
            >
              {errors[error]}
            </p>
          )}
          {!error && saved === "1" && (
            <p
              role="status"
              className="rounded-lg border border-success/30 px-3 py-2 text-sm text-success-foreground"
            >
              Settings saved.
            </p>
          )}
          <SettingsForm installation={installation} agents={agents} />
        </aside>
      </div>
    </>
  );
}
