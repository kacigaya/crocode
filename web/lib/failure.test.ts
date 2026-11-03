import { describe, expect, test } from "bun:test";
import { canCancel, canRetry, explainReview } from "./failure";

const title = (status: "failed" | "cancelled" | "succeeded", error: string | null) =>
  explainReview({ status, error })?.title;

describe("explainReview", () => {
  test("maps stored worker errors to plain reasons", () => {
    for (const [error, expected] of [
      ["agent timed out after 900s", "The agent took too long"],
      ["worker lost", "The worker stopped during the review"],
      ["codex error: You've hit your usage limit", "The agent reached a usage limit"],
      [
        "claude returned no structured output: Not logged in (exit ok: false; stderr: )",
        "The agent could not sign in",
      ],
      [
        "agent JSON does not match the review schema (exit ok: true; stderr: )",
        "The agent returned no valid review",
      ],
      ["start agent process: No such file or directory", "The sandbox could not start"],
      ["git fetch failed: fatal: couldn't find remote ref", "The pull request could not be fetched"],
      ["create installation token: GitHub", "A GitHub request failed"],
      ["invalid .crocode.yml: unknown field", "The repository config is not valid"],
      ["agent opencode is not enabled on this server", "The agent or model is not available"],
      ["something new", "The review failed"],
      [null, "The review failed"],
    ] as const)
      expect(title("failed", error)).toBe(expected);
  });

  test("explains each cancel reason", () => {
    expect(title("cancelled", "superseded")).toBe("A newer commit replaced this review");
    expect(title("cancelled", "cancelled from the dashboard")).toBe(
      "An admin cancelled this review",
    );
    expect(title("cancelled", null)).toBe("The review was cancelled");
    expect(explainReview({ status: "cancelled", error: "odd" })?.detail).toBe("odd");
  });

  test("has no reason for other states", () => {
    expect(title("succeeded", "ignored")).toBeUndefined();
  });

  test("allows controls only in matching states", () => {
    expect([canRetry("failed"), canRetry("cancelled"), canRetry("running")]).toEqual([
      true,
      true,
      false,
    ]);
    expect([canCancel("queued"), canCancel("running"), canCancel("failed")]).toEqual([
      true,
      true,
      false,
    ]);
  });
});
