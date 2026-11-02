import type { DependencyAlert, RepositoryAlerts } from "./types";

export type VulnerabilityView = "repositories" | "priority";

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
  view: VulnerabilityView = "repositories",
): string {
  const query = new URLSearchParams({ page: String(page) });
  if (view === "priority") query.set("view", view);
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

/** EPSS is a 0–1 probability. Missing or invalid values stay unknown. */
export function epssProbability(alert: DependencyAlert): number | null {
  const value = alert.security_advisory.epss?.percentage;
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
    ? value
    : null;
}

export function formatEpss(probability: number | null): string {
  if (
    probability === null ||
    !Number.isFinite(probability) ||
    probability < 0 ||
    probability > 1
  )
    return "Unknown";
  if (probability > 0 && probability < 0.0001) return "< 0.01%";
  if (probability < 1 && probability > 0.9999) return "> 99.99%";
  return new Intl.NumberFormat("en", {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(probability);
}

export type PriorityAlert = {
  repo: string;
  alert: DependencyAlert;
  probability: number | null;
};

/** Severity, known EPSS probability, then patch availability. No synthetic risk score. */
export function prioritizeVulnerabilities(
  repositories: RepositoryAlerts[],
  filters: VulnerabilityFilters,
): PriorityAlert[] {
  const severity = (alert: DependencyAlert) => {
    const index = severityOptions.findIndex(
      (value) => value === alert.security_vulnerability.severity,
    );
    return index <= 0 ? severityOptions.length : index;
  };
  const entries = repositories.flatMap(({ repo_full_name: repo, alerts }) =>
    (alerts ?? [])
      .filter((alert) => matchesVulnerability(repo, alert, filters))
      .map((alert) => ({ repo, alert, probability: epssProbability(alert) })),
  );
  return entries.sort((a, b) => {
    const rank = severity(a.alert) - severity(b.alert);
    if (rank) return rank;
    if (a.probability === null && b.probability !== null) return 1;
    if (b.probability === null && a.probability !== null) return -1;
    const probability = (b.probability ?? 0) - (a.probability ?? 0);
    if (probability) return probability;
    const patched =
      Number(b.alert.security_vulnerability.first_patched_version !== null) -
      Number(a.alert.security_vulnerability.first_patched_version !== null);
    return (
      patched ||
      a.repo.localeCompare(b.repo, "en") ||
      a.alert.number - b.alert.number
    );
  });
}
