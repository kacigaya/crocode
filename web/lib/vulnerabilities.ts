import type { DependencyAlert } from "./types";

export const severityOptions = [
  "all",
  "critical",
  "high",
  "medium",
  "low",
] as const;
export const scopeOptions = [
  "all",
  "runtime",
  "development",
  "unknown",
] as const;
export const fixOptions = ["all", "available", "missing"] as const;

export type VulnerabilityFilters = {
  q: string;
  repository: string;
  package: string;
  severity: (typeof severityOptions)[number];
  scope: (typeof scopeOptions)[number];
  fix: (typeof fixOptions)[number];
};

export function parseVulnerabilityFilters(
  params: Record<string, string | string[] | undefined>,
): VulnerabilityFilters {
  const text = (key: string) =>
    typeof params[key] === "string" ? params[key].trim().slice(0, 200) : "";
  const option = <T extends string>(key: string, options: readonly T[]): T =>
    options.find((value) => value === text(key)) ?? options[0];
  return {
    q: text("q"),
    repository: text("repository"),
    package: text("package"),
    severity: option("severity", severityOptions),
    scope: option("scope", scopeOptions),
    fix: option("fix", fixOptions),
  };
}

export function matchesVulnerability(
  repo: string,
  alert: DependencyAlert,
  filters: VulnerabilityFilters,
): boolean {
  const contains = (value: string, search: string) =>
    value.toLowerCase().includes(search.toLowerCase());
  const {
    dependency,
    security_advisory: advisory,
    security_vulnerability: vulnerability,
  } = alert;
  if (
    !contains(repo, filters.repository) ||
    !contains(dependency.package.name, filters.package)
  )
    return false;
  if (filters.severity !== "all" && vulnerability.severity !== filters.severity)
    return false;
  if (
    filters.scope !== "all" &&
    (dependency.scope ?? "unknown") !== filters.scope
  )
    return false;
  const patched = vulnerability.first_patched_version !== null;
  if (
    (filters.fix === "available" && !patched) ||
    (filters.fix === "missing" && patched)
  )
    return false;
  return contains(
    [
      repo,
      advisory.cve_id ?? "",
      advisory.ghsa_id,
      advisory.summary,
      dependency.package.name,
      dependency.package.ecosystem,
      dependency.manifest_path,
    ].join(" "),
    filters.q,
  );
}

export function vulnerabilityPageHref(
  page: number,
  filters: VulnerabilityFilters,
): string {
  const query = new URLSearchParams({ page: String(page) });
  for (const [key, value] of Object.entries(filters)) {
    if (
      value &&
      (["q", "repository", "package"].includes(key) || value !== "all")
    )
      query.set(key, value);
  }
  return `?${query}`;
}

export function hasVulnerabilityFilters(
  filters: VulnerabilityFilters,
): boolean {
  return Boolean(
    filters.q ||
      filters.repository ||
      filters.package ||
      filters.severity !== "all" ||
      filters.scope !== "all" ||
      filters.fix !== "all",
  );
}
