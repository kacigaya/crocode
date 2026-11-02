import { describe, expect, test } from "bun:test";
import type { DependencyAlert } from "./types";
import {
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
