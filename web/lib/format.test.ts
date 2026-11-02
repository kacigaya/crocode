import { describe, expect, test } from "bun:test";
import { formatDuration, formatRelative } from "./format";

const now = Date.parse("2026-11-01T14:00:00Z");

describe("formatRelative", () => {
  test("uses relative units for the last week", () => {
    expect(formatRelative("2026-11-01T13:59:30Z", now)).toBe("just now");
    expect(formatRelative("2026-11-01T13:55:00Z", now)).toBe("5 minutes ago");
    expect(formatRelative("2026-11-01T11:00:00Z", now)).toBe("3 hours ago");
    expect(formatRelative("2026-10-31T14:00:00Z", now)).toBe("yesterday");
  });

  test("falls back to the absolute time", () => {
    expect(formatRelative("2026-10-01T14:00:00Z", now)).toBe(
      "1 Oct 2026, 14:00 UTC",
    );
    expect(formatRelative("not a date", now)).toBe("not a date");
  });
});

describe("formatDuration", () => {
  test("formats seconds, minutes, and hours", () => {
    const start = "2026-11-01T10:00:00Z";
    expect(formatDuration(start, "2026-11-01T10:00:42Z")).toBe("42s");
    expect(formatDuration(start, "2026-11-01T10:02:41Z")).toBe("2m 41s");
    expect(formatDuration(start, "2026-11-01T11:05:00Z")).toBe("1h 5m");
  });

  test("returns null for missing or negative spans", () => {
    expect(formatDuration("2026-11-01T10:00:00Z", null)).toBeNull();
    expect(
      formatDuration("2026-11-01T10:00:00Z", "2026-11-01T09:00:00Z"),
    ).toBeNull();
  });
});
