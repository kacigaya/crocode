import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DependencyAlert, VulnerabilityReport } from "@/lib/types";
import {
  type VulnerabilityFilters,
  matchesVulnerability,
  hasVulnerabilityFilters,
} from "@/lib/vulnerabilities";

const severityOrder = ["critical", "high", "medium", "low"];
function rank(alert: DependencyAlert) {
  const index = severityOrder.indexOf(alert.security_vulnerability.severity);
  return index < 0 ? severityOrder.length : index;
}

export function VulnerabilitiesPanel({
  report,
  webUrl,
  filters,
}: {
  report: VulnerabilityReport | null;
  webUrl: string;
  filters: VulnerabilityFilters;
}) {
  const readable =
    report?.repositories.filter((r) => r.alerts !== null).length ?? 0;
  const count =
    report?.repositories.reduce((n, r) => n + (r.alerts?.length ?? 0), 0) ?? 0;
  const hasFilters = hasVulnerabilityFilters(filters);
  const visibleRepositories =
    report?.repositories
      .map((repo) => ({
        ...repo,
        alerts:
          repo.alerts?.filter((alert) =>
            matchesVulnerability(repo.repo_full_name, alert, filters),
          ) ?? null,
      }))
      .filter(
        (repo) =>
          !hasFilters || (repo.alerts !== null && repo.alerts.length > 0),
      ) ?? [];
  const matching = visibleRepositories.reduce(
    (total, repo) => total + (repo.alerts?.length ?? 0),
    0,
  );
  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader className="border-b p-4 sm:p-5">
        <CardTitle render={<h2 />} className="text-sm">
          CVEs and dependency advisories
        </CardTitle>
        <CardDescription>
          Open Dependabot alerts on the default branch. Includes advisories
          without a CVE ID. Fixed and dismissed alerts are excluded.
        </CardDescription>
      </CardHeader>
      <CardPanel className="space-y-5 p-4 sm:p-5">
        {report === null ? (
          <Alert variant="warning">
            <AlertTitle>Cannot load vulnerabilities</AlertTitle>
            <AlertDescription>
              GitHub did not return the repository list. Reload this page to try
              again.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <p className="text-sm text-muted-foreground tabular-nums">
              {hasFilters ? `${matching} matching ${matching === 1 ? "alert" : "alerts"} from ` : ""}
              {count} open {count === 1 ? "alert" : "alerts"} in {readable}{" "}
              readable {readable === 1 ? "repository" : "repositories"} on this
              page. {report.total_repositories} repositories in this
              installation. Use the repository pages to see the full list.
            </p>
            {report.repositories.some((r) => r.alerts === null) && (
              <Alert variant="warning">
                <AlertTitle>Some repositories could not be checked</AlertTitle>
                <AlertDescription>
                  <p>
                    Enable Dependabot alerts and approve the App’s read-only
                    Dependabot alerts permission on GitHub. Your user must also
                    have access to security alerts. Rate limits or a timeout can
                    also block a request.{" "}
                    <Link
                      className="underline"
                      href="/docs/getting-started/github-app"
                    >
                      Setup instructions
                    </Link>
                    . Reload to try again.
                  </p>
                </AlertDescription>
              </Alert>
            )}
            {report.repositories.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No repositories on this page.
              </p>
            )}
            {hasFilters && matching === 0 && (
              <p role="status" className="text-sm text-muted-foreground">
                No alerts match these filters on this repository page. Clear
                filters or check another repository page. Unreadable
                repositories are listed in Security coverage.
              </p>
            )}
            {visibleRepositories.map(({ repo_full_name: repo, alerts }) => (
              <section key={repo} className="min-w-0 space-y-2">
                <h3 className="break-all text-sm font-medium">
                  <a
                    className="rounded-sm underline-offset-4 hover:underline"
                    href={`${webUrl}/${repo}/security/dependabot`}
                  >
                    {repo}
                  </a>
                </h3>
                {alerts === null ? (
                  <p className="text-sm text-muted-foreground">
                    Alerts unavailable. This repository was not checked.
                  </p>
                ) : alerts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No open Dependabot alerts reported. This is not a full
                    security scan.
                  </p>
                ) : (
                  <Table aria-label={`Dependency advisories for ${repo}`}>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Advisory</TableHead>
                        <TableHead>Severity</TableHead>
                        <TableHead>Dependency</TableHead>
                        <TableHead>Affected range</TableHead>
                        <TableHead>First patched version</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...alerts]
                        .sort(
                          (a, b) => rank(a) - rank(b) || a.number - b.number,
                        )
                        .map((alert) => {
                          const advisory = alert.security_advisory;
                          const vulnerability = alert.security_vulnerability;
                          return (
                            <TableRow key={alert.number}>
                              <TableCell className="min-w-56 max-w-96 whitespace-normal">
                                <a
                                  className="rounded-sm font-mono text-xs underline-offset-4 hover:underline"
                                  href={`${webUrl}/${repo}/security/dependabot/${alert.number}`}
                                >
                                  {advisory.cve_id ?? advisory.ghsa_id}
                                </a>
                                <p className="mt-1 break-words text-xs text-muted-foreground">
                                  {advisory.summary}
                                </p>
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant={
                                    vulnerability.severity === "critical" ||
                                    vulnerability.severity === "high"
                                      ? "error"
                                      : vulnerability.severity === "medium"
                                        ? "warning"
                                        : "secondary"
                                  }
                                  className="capitalize"
                                >
                                  {vulnerability.severity}
                                </Badge>
                              </TableCell>
                              <TableCell className="min-w-44 max-w-72 whitespace-normal break-words">
                                <p className="font-mono text-xs">
                                  {alert.dependency.package.name}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {alert.dependency.package.ecosystem} ·{" "}
                                  {alert.dependency.scope ?? "Scope unknown"}
                                </p>
                                <p className="break-all font-mono text-xs text-muted-foreground">
                                  {alert.dependency.manifest_path}
                                </p>
                              </TableCell>
                              <TableCell className="font-mono text-xs">
                                {vulnerability.vulnerable_version_range}
                              </TableCell>
                              <TableCell className="font-mono text-xs">
                                {vulnerability.first_patched_version
                                  ?.identifier ?? "Not supplied"}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                    </TableBody>
                  </Table>
                )}
              </section>
            ))}
          </>
        )}
      </CardPanel>
    </Card>
  );
}
