import { AlertTriangle, GitPullRequest, History } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActivityChart } from "@/components/activity-chart";
import { AgentHealthTable } from "@/components/agent-health";
import { FindingsBreakdown } from "@/components/findings-breakdown";
import { OpenPullsTable } from "@/components/open-pulls-table";
import { StatGrid } from "@/components/page-header";
import { ReviewsTable } from "@/components/reviews-table";
import { severityColor } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Meter } from "@/components/ui/meter";
import { api, optionalApi } from "@/lib/api";
import { formatSeconds, validCursor, validInstallationId } from "@/lib/format";
import {
  type Agents,
  type Installation,
  type OpenPulls,
  type Review,
  SEVERITIES,
  type Stats,
} from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Installation" };
const PAGE_SIZE = 20;

export default async function InstallationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ before?: string }>;
}) {
  const { id } = await params;
  const { before } = await searchParams;
  if (
    !validInstallationId(id) ||
    (before !== undefined && !validCursor(before))
  )
    notFound();
  const query = new URLSearchParams({
    limit: String(PAGE_SIZE),
    ...(before ? { before } : {}),
  });
  const [installation, reviews, stats, pulls, agents] = await Promise.all([
    api<Installation>(`/api/v1/installations/${id}`),
    api<Review[]>(`/api/v1/installations/${id}/reviews?${query}`),
    api<Stats>(`/api/v1/installations/${id}/stats`),
    optionalApi<OpenPulls>(`/api/v1/installations/${id}/pulls`),
    optionalApi<Agents>("/api/v1/agents"),
  ]);
  const webUrl = (
    process.env.GITHUB_WEB_URL?.trim() || "https://github.com"
  ).replace(/\/$/, "");
  const oldest = reviews.at(-1)?.created_at;
  const finished = stats.succeeded + stats.failed;
  const unreviewed = pulls?.pulls.filter((p) => !p.review).length ?? 0;
  const severity = new Map(stats.severity.map((s) => [s.name, s.count]));

  return (
    <>
      <StatGrid
        label={`Review statistics, last ${stats.days} days`}
        className="sm:grid-cols-3 lg:grid-cols-5"
        stats={[
          {
            label: "Open pull requests",
            value: pulls
              ? `${pulls.pulls.length}${pulls.truncated ? "+" : ""}`
              : "–",
            hint: pulls
              ? unreviewed > 0
                ? `${unreviewed} not reviewed`
                : "All have a review"
              : "GitHub did not answer",
          },
          {
            label: `Reviews, ${stats.days} days`,
            value: stats.reviews,
            hint: `${stats.pull_requests} pull ${stats.pull_requests === 1 ? "request" : "requests"} in ${stats.repositories} ${stats.repositories === 1 ? "repository" : "repositories"}`,
          },
          {
            label: "Success rate",
            value: finished
              ? `${Math.round((stats.succeeded / finished) * 100)}%`
              : "–",
            extra: finished > 0 && (
              <Meter
                value={stats.succeeded}
                max={finished}
                aria-label="Succeeded reviews"
                className="[&_[data-slot=meter-indicator]]:bg-success [&_[data-slot=meter-track]]:h-1.5 [&_[data-slot=meter-track]]:rounded-full"
              />
            ),
            hint: `${stats.succeeded} of ${finished} finished`,
          },
          {
            label: `Findings, ${stats.days} days`,
            value: stats.findings,
            extra: stats.findings > 0 && (
              <div
                aria-hidden="true"
                className="flex h-1.5 gap-0.5 overflow-hidden rounded-full"
              >
                {SEVERITIES.map((s) =>
                  severity.get(s) ? (
                    <div
                      key={s}
                      className={cn("h-full", severityColor[s])}
                      style={{ flexGrow: severity.get(s) }}
                    />
                  ) : null,
                )}
              </div>
            ),
            hint: `${stats.published} posted on GitHub`,
          },
          {
            label: "Median review time",
            value: formatSeconds(stats.median_duration_secs) ?? "–",
            hint:
              stats.in_progress > 0
                ? `${stats.in_progress} queued or running`
                : "From push to result",
          },
        ]}
      />

      <Card className="overflow-hidden">
        <CardHeader className="border-b p-4 sm:p-5">
          <CardTitle render={<h2 />} className="text-sm">
            Open pull requests
          </CardTitle>
          <CardDescription>
            Live from GitHub, last updated first, with the newest CroCode
            review of each.
          </CardDescription>
        </CardHeader>
        {pulls === null ? (
          <CardPanel className="p-4 sm:p-5">
            <Alert variant="warning">
              <AlertTriangle />
              <AlertTitle>Cannot load open pull requests</AlertTitle>
              <AlertDescription>
                GitHub did not answer. Reload the page to try again. Review
                data below is not affected.
              </AlertDescription>
            </Alert>
          </CardPanel>
        ) : pulls.pulls.length === 0 ? (
          <Empty className="py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <GitPullRequest aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle className="text-base">No open pull requests</EmptyTitle>
              <EmptyDescription>
                Open a pull request in a repository of{" "}
                {installation.account_login}. CroCode reviews it when reviews
                are on.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <OpenPullsTable pulls={pulls.pulls} webUrl={webUrl} />
            {pulls.truncated && (
              <CardFooter className="border-t px-4 py-3 sm:px-5 text-xs text-muted-foreground">
                GitHub returned the {pulls.pulls.length} most recently updated
                pull requests that you can access.
              </CardFooter>
            )}
          </>
        )}
      </Card>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader className="p-4 pb-3 sm:p-5 sm:pb-3">
            <CardTitle render={<h2 />} className="text-sm">
              Reviews per day
            </CardTitle>
            <CardDescription>
              Last {stats.days} days, in UTC. Red shows failed reviews.
            </CardDescription>
          </CardHeader>
          <CardPanel className="p-4 pt-0 sm:p-5 sm:pt-0">
            <ActivityChart daily={stats.daily} />
          </CardPanel>
        </Card>
        <Card>
          <CardHeader className="p-4 pb-3 sm:p-5 sm:pb-3">
            <CardTitle render={<h2 />} className="text-sm">
              Findings by severity
            </CardTitle>
            <CardDescription>
              Last {stats.days} days.
            </CardDescription>
          </CardHeader>
          <CardPanel className="p-4 pt-0 sm:p-5 sm:pt-0">
            <FindingsBreakdown stats={stats} />
          </CardPanel>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="border-b p-4 sm:p-5">
          <CardTitle render={<h2 />} className="text-sm">
            Agent health and usage
          </CardTitle>
          <CardDescription>
            Harness shows whether the agent CLI answered its last model list
            check in the sandbox. It does not test credentials. Time and tokens
            cover this installation for the last {stats.days} days, as each
            CLI reports them.
          </CardDescription>
        </CardHeader>
        <AgentHealthTable
          agents={agents}
          usage={stats.agents ?? []}
          days={stats.days}
        />
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="border-b p-4 sm:p-5">
          <CardTitle render={<h2 />} className="text-sm">
            {before ? "Older reviews" : "Recent reviews"}
          </CardTitle>
          {before && (
            <CardAction className="self-center">
              <Button
                variant="outline"
                size="sm"
                render={<Link href={`/installations/${id}`} />}
              >
                Back to latest
              </Button>
            </CardAction>
          )}
        </CardHeader>
        {reviews.length === 0 ? (
          <Empty className="py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <History aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle className="text-base">
                {before ? "No older reviews" : "No reviews yet"}
              </EmptyTitle>
              <EmptyDescription>
                {before
                  ? `CroCode keeps reviews for ${stats.days} days.`
                  : installation.settings.enabled
                    ? "Open or update a pull request in a repository where the app is installed."
                    : "Reviews are off. Turn them on in Settings to review new pull requests."}
              </EmptyDescription>
            </EmptyHeader>
            {!before && !installation.settings.enabled && (
              <EmptyContent>
                <Button
                  variant="outline"
                  render={<Link href={`/installations/${id}/settings`} />}
                >
                  Open settings
                </Button>
              </EmptyContent>
            )}
          </Empty>
        ) : (
          <ReviewsTable reviews={reviews} />
        )}
        {reviews.length === PAGE_SIZE && oldest && (
          <CardFooter className="border-t px-4 py-3 sm:px-5">
            <Button
              variant="outline"
              size="sm"
              render={
                <Link
                  href={`/installations/${id}?${new URLSearchParams({ before: oldest })}`}
                />
              }
            >
              Load older reviews
            </Button>
          </CardFooter>
        )}
      </Card>
    </>
  );
}
