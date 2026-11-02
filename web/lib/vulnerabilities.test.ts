import { describe, expect, test } from "bun:test";
import type { DependencyAlert } from "./types";
import {
  epssProbability,
  formatEpss,
  prioritizeVulnerabilities,
  hasVulnerabilityFilters,
  matchesVulnerability,
  parseVulnerabilityFilters,
  vulnerabilityPageHref,
} from "./vulnerabilities";

const alert: DependencyAlert = {
  number: 1,
  dependency: {
    package: { ecosystem: "npm", name: "@acme/parser" },
    manifest_path: "web/bun.lock",
    scope: "runtime",
  },
  security_advisory: {
    ghsa_id: "GHSA-example",
    cve_id: "CVE-2026-1234",
    summary: "Unsafe parsing",
  },
  security_vulnerability: {
    severity: "high",
    vulnerable_version_range: "< 2",
    first_patched_version: { identifier: "2.0.0" },
  },
};
const match = (params: Record<string, string | undefined>, value = alert) =>
  matchesVulnerability("acme/api", value, parseVulnerabilityFilters(params));

describe("vulnerability filters", () => {
  test("matches text without case sensitivity, including GHSA-only advisories", () => {
    for (const q of ["cve-2026-1234", "GHSA-EXAMPLE", "UNSAFE", "bun.lock"])
      expect(match({ q })).toBe(true);
    expect(
      match(
        { q: "GHSA-EXAMPLE" },
        {
          ...alert,
          security_advisory: { ...alert.security_advisory, cve_id: null },
        },
      ),
    ).toBe(true);
    expect(match({ q: "no match" })).toBe(false);
  });
  test("combines repository, package, severity, scope and patch filters", () => {
    expect(
      match({
        repository: "ACME/",
        package: "PARSER",
        severity: "high",
        scope: "runtime",
        fix: "available",
      }),
    ).toBe(true);
    for (const params of [
      { repository: "other" },
      { package: "other" },
      { severity: "low" },
      { scope: "development" },
      { fix: "missing" },
    ])
      expect(match(params)).toBe(false);
    const unpatched = {
      ...alert,
      dependency: { ...alert.dependency, scope: null },
      security_vulnerability: {
        ...alert.security_vulnerability,
        first_patched_version: null,
      },
    };
    expect(match({ scope: "unknown", fix: "missing" }, unpatched)).toBe(true);
    expect(match({ scope: "runtime" }, unpatched)).toBe(false);
  });
  test("sanitizes enum, duplicate and oversized inputs", () => {
    const filters = parseVulnerabilityFilters({
      severity: "bogus",
      q: ["one", "two"],
      package: " x ",
      repository: "z".repeat(201),
    });
    expect(filters.severity).toBe("all");
    expect(filters.q).toBe("");
    expect(filters.package).toBe("x");
    expect(filters.repository).toHaveLength(200);
  });
  test("preserves filters in encoded repository page links", () => {
    const filters = parseVulnerabilityFilters({
      q: "all",
      repository: "acme/api",
      package: "a&b",
      severity: "high",
    });
    expect(hasVulnerabilityFilters(filters)).toBe(true);
    expect(hasVulnerabilityFilters(parseVulnerabilityFilters({}))).toBe(false);
    expect(
      new URLSearchParams(vulnerabilityPageHref(2, filters).slice(1)).get("q"),
    ).toBe("all");
    expect(
      new URLSearchParams(vulnerabilityPageHref(2, filters).slice(1)).get(
        "package",
      ),
    ).toBe("a&b");
    expect(vulnerabilityPageHref(1, parseVulnerabilityFilters({}))).toBe(
      "?page=1",
    );
  });
});

const repository = (repo: string, alerts: DependencyAlert[] | null) => ({
  repo_full_name: repo,
  alerts,
  coverage:
    alerts === null ? ("access_denied" as const) : ("readable" as const),
  checked_at: "2026-11-02T10:00:00Z",
  last_success_at: null,
});
const rankedAlert = (
  number: number,
  severity: string,
  probability: number | null,
  patched: boolean,
): DependencyAlert => ({
  ...alert,
  number,
  security_advisory: {
    ...alert.security_advisory,
    epss: probability === null ? null : { percentage: probability },
  },
  security_vulnerability: {
    ...alert.security_vulnerability,
    severity,
    first_patched_version: patched ? { identifier: "2.0.0" } : null,
  },
});

describe("fix priority queue", () => {
  test("orders severity, known EPSS, then patch availability without mutating the source", () => {
    const alerts = [
      rankedAlert(1, "high", null, true),
      rankedAlert(2, "low", 1, true),
      rankedAlert(3, "high", 0, false),
      rankedAlert(4, "high", 0.8, false),
      rankedAlert(5, "critical", null, false),
      rankedAlert(6, "high", 0.8, true),
      rankedAlert(7, "unknown", 1, true),
    ];
    const before = [...alerts];
    const entries = prioritizeVulnerabilities(
      [repository("acme/api", alerts)],
      parseVulnerabilityFilters({}),
    );
    expect(entries.map((row) => row.alert.number)).toEqual([
      5, 6, 4, 3, 1, 2, 7,
    ]);
    expect(alerts).toEqual(before);
  });
  test("keeps missing and invalid scores unknown, including NaN and out-of-range values", () => {
    expect(epssProbability(alert)).toBeNull();
    for (const value of [null, -1, 1.1, NaN, Infinity])
      expect(epssProbability(rankedAlert(1, "high", value, true))).toBeNull();
    expect(epssProbability(rankedAlert(1, "high", 0, true))).toBe(0);
    expect(epssProbability(rankedAlert(1, "high", 1, true))).toBe(1);
  });
  test("formats probability as percent without rounding tiny positive values to zero", () => {
    expect(formatEpss(0.00045)).toBe("0.05%");
    expect(formatEpss(0)).toBe("0%");
    expect(formatEpss(1)).toBe("100%");
    expect(formatEpss(0.000001)).toBe("< 0.01%");
    expect(formatEpss(0.999999)).toBe("> 99.99%");
    for (const value of [null, -0.01, 2, NaN])
      expect(formatEpss(value)).toBe("Unknown");
  });
  test("filters across readable repositories and uses deterministic ties", () => {
    const repositories = [
      repository("z/api", [rankedAlert(1, "high", 0.5, true)]),
      repository("a/api", [
        rankedAlert(3, "high", 0.5, true),
        rankedAlert(2, "high", 0.5, true),
      ]),
      repository("hidden/api", null),
    ];
    const entries = prioritizeVulnerabilities(
      repositories,
      parseVulnerabilityFilters({
        severity: "high",
        scope: "runtime",
        fix: "available",
      }),
    );
    expect(entries.map((row) => `${row.repo}:${row.alert.number}`)).toEqual([
      "a/api:2",
      "a/api:3",
      "z/api:1",
    ]);
    expect(
      prioritizeVulnerabilities(
        repositories,
        parseVulnerabilityFilters({ q: "missing" }),
      ),
    ).toEqual([]);
  });
  test("preserves priority view and filters in page links", () => {
    const url = vulnerabilityPageHref(
      2,
      parseVulnerabilityFilters({ q: "all", fix: "available" }),
      "priority",
    );
    expect(new URLSearchParams(url.slice(1)).get("view")).toBe("priority");
    expect(new URLSearchParams(url.slice(1)).get("q")).toBe("all");
    expect(new URLSearchParams(url.slice(1)).get("fix")).toBe("available");
    expect(
      new URLSearchParams(
        vulnerabilityPageHref(2, parseVulnerabilityFilters({})).slice(1),
      ).has("view"),
    ).toBe(false);
  });
});
