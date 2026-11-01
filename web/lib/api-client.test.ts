import { describe, expect, test } from "bun:test";
import { ApiError, apiRequest } from "./api-client";

describe("server API transport", () => {
  test("uses bearer auth without caching or following redirects", async () => {
    const fetcher: typeof fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("http://api:8080/api/v1/me");
        expect(new Headers(init?.headers).get("Authorization")).toBe(
          "Bearer test-token",
        );
        expect(init?.cache).toBe("no-store");
        expect(init?.redirect).toBe("error");
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        return Response.json({ login: "octocat" });
      },
      { preconnect: fetch.preconnect },
    );
    expect(
      await apiRequest(
        "http://api:8080/",
        "test-token",
        "/api/v1/me",
        {},
        fetcher,
      ),
    ).toEqual({ login: "octocat" });
  });
  test("serializes PATCH with nullable model", async () => {
    const body = { enabled: false, agent: "codex", model: null };
    const fetcher: typeof fetch = Object.assign(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.method).toBe("PATCH");
        expect(new Headers(init?.headers).get("Content-Type")).toBe(
          "application/json",
        );
        expect(JSON.parse(String(init?.body))).toEqual(body);
        return Response.json(body);
      },
      { preconnect: fetch.preconnect },
    );
    expect(
      await apiRequest(
        "http://api",
        "token",
        "/api/v1/installations/1/settings",
        { method: "PATCH", body },
        fetcher,
      ),
    ).toEqual(body);
  });
  for (const status of [401, 403, 404, 422, 500]) {
    test(`preserves ${status} without exposing upstream text`, async () => {
      const fetcher: typeof fetch = Object.assign(
        async () => new Response("private upstream details", { status }),
        { preconnect: fetch.preconnect },
      );
      try {
        await apiRequest("http://api", "token", "/api/v1/me", {}, fetcher);
        throw new Error("Expected API failure");
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        if (!(error instanceof ApiError)) throw error;
        expect(error.status).toBe(status);
        expect(error.message).not.toContain("private");
      }
    });
  }
  test("maps network failure and invalid JSON to safe errors", async () => {
    const offline: typeof fetch = Object.assign(
      async () => {
        throw new Error("secret token in diagnostic");
      },
      { preconnect: fetch.preconnect },
    );
    const invalid: typeof fetch = Object.assign(
      async () => new Response("not json"),
      { preconnect: fetch.preconnect },
    );
    await expect(
      apiRequest("http://api", "token", "/api/v1/me", {}, offline),
    ).rejects.toMatchObject({ status: 0 });
    await expect(
      apiRequest("http://api", "token", "/api/v1/me", {}, invalid),
    ).rejects.toMatchObject({ status: 502 });
  });
  test("rejects unsafe paths before sending the token", async () => {
    const fetcher: typeof fetch = Object.assign(
      async () => {
        throw new Error("Must not fetch");
      },
      { preconnect: fetch.preconnect },
    );
    for (const path of [
      "https://evil.example/api/v1/me",
      "//evil.example",
      "/api/v1/../secret",
      "/api/v1/\\evil",
      "/api/v1/me#fragment",
    ]) {
      await expect(
        apiRequest("http://api", "token", path, {}, fetcher),
      ).rejects.toThrow("Invalid API path");
    }
  });
});
