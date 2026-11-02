import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { VulnerabilityFiltersForm } from "@/components/vulnerability-filters";
import { VulnerabilityCoverage } from "@/components/vulnerability-coverage";
import {
  parseVulnerabilityFilters,
  vulnerabilityPageHref,
} from "@/lib/vulnerabilities";
import { VulnerabilityPriorityQueue } from "@/components/vulnerability-priority-queue";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/ui/segmented-control";
import { VulnerabilitiesPanel } from "@/components/vulnerabilities-panel";
import { Button } from "@/components/ui/button";
import { optionalApi } from "@/lib/api";
import { validInstallationId } from "@/lib/format";
import type { VulnerabilityReport } from "@/lib/types";

export const metadata: Metadata = {
  title: "Vulnerabilities",
  description: "Open dependency vulnerabilities reported by GitHub Dependabot.",
};

export default async function VulnerabilitiesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const search = await searchParams;
  const { page: value } = search;
  const filters = parseVulnerabilityFilters(search);
  const view = search.view === "priority" ? "priority" : "repositories";
  if (
    !validInstallationId(id) ||
    (value !== undefined &&
      (typeof value !== "string" || !/^[1-9]\d{0,6}$/.test(value)))
  )
    notFound();
  const page = Number(value ?? "1");
  if (page > 1_000_000) notFound();
  const report = await optionalApi<VulnerabilityReport>(
    `/api/v1/installations/${id}/vulnerabilities?page=${page}`,
  );
  const webUrl = (
    process.env.GITHUB_WEB_URL?.trim() || "https://github.com"
  ).replace(/\/$/, "");
  return (
    <>
      {report && <VulnerabilityCoverage report={report} webUrl={webUrl} />}
      <SegmentedControl aria-label="Vulnerability view" render={<nav />}>
        {(["repositories", "priority"] as const).map((mode) => (
          <SegmentedControlItem
            key={mode}
            render={
              <Link
                href={vulnerabilityPageHref(page, filters, mode)}
                aria-current={view === mode ? "page" : undefined}
              />
            }
          >
            {mode === "priority" ? "Fix priority queue" : "By repository"}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
      <VulnerabilityFiltersForm
        key={vulnerabilityPageHref(page, filters, view)}
        filters={filters}
        page={page}
        view={view}
      />
      {view === "priority" ? (
        <VulnerabilityPriorityQueue
          report={report}
          webUrl={webUrl}
          filters={filters}
        />
      ) : (
        <VulnerabilitiesPanel
          report={report}
          webUrl={webUrl}
          filters={filters}
        />
      )}
      <nav
        aria-label="Repository pages"
        className="flex flex-wrap items-center gap-3"
      >
        {page > 1 && (
          <Button
            variant="outline"
            render={
              <Link href={vulnerabilityPageHref(page - 1, filters, view)} />
            }
          >
            Previous repositories
          </Button>
        )}
        <span className="text-sm text-muted-foreground tabular-nums">
          Repository page {page}
        </span>
        {report?.next_page && (
          <Button
            variant="outline"
            render={
              <Link
                href={vulnerabilityPageHref(report.next_page, filters, view)}
              />
            }
          >
            Next repositories
          </Button>
        )}
      </nav>
    </>
  );
}
