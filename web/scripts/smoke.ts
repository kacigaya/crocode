import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { encryptSession } from "../lib/session-codec";

const secret = randomBytes(32).toString("hex");
const token = "smoke-test-only-token";
const reviewId = "6f1c0b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const installation = {
  id: 123,
  account_login: "acme",
  account_type: "Organization",
  repository_selection: "selected",
  suspended: false,
  created_at: "2026-11-01T10:00:00Z",
  settings: { enabled: true, agent: "codex", model: null },
  can_admin: true,
};
const review = {
  id: reviewId,
  installation_id: 123,
  repo_full_name: "acme/api",
  pr_number: 42,
  pr_title: "Add login",
  head_sha: "abc123",
  status: "succeeded",
  agent: "codex",
  model: null,
  attempts: 1,
  finding_count: 2,
  error: null,
  created_at: "2026-11-01T10:00:00.123456Z",
  finished_at: "2026-11-01T10:03:00Z",
};
let apiStatus = 200;
let canAdmin = true;
let empty = false;
const calls: string[] = [];
const patches: unknown[] = [];
const mock = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    assert.equal(request.headers.get("authorization"), `Bearer ${token}`);
    const url = new URL(request.url);
    calls.push(url.pathname + url.search);
    if (apiStatus !== 200)
      return Response.json({ error: "Mock error" }, { status: apiStatus });
    if (url.pathname.endsWith("/me"))
      return Response.json({ id: 1, login: "octocat" });
    if (url.pathname.endsWith("/agents"))
      return Response.json({ agents: ["codex", "claude"], default: "codex" });
    if (url.pathname.endsWith("/settings") && request.method === "PATCH") {
      const body: unknown = await request.json();
      patches.push(body);
      return Response.json(installation);
    }
    if (url.pathname === "/api/v1/installations")
      return Response.json(
        empty ? [] : [{ ...installation, can_admin: canAdmin }],
      );
    if (url.pathname === "/api/v1/installations/123")
      return Response.json({ ...installation, can_admin: canAdmin });
    if (url.pathname === "/api/v1/installations/123/reviews")
      return Response.json(
        empty || url.searchParams.has("before")
          ? []
          : Array.from({ length: 20 }, (_, i) => ({
              ...review,
              id: i === 0 ? reviewId : `review-${i}`,
            })),
      );
    if (url.pathname === `/api/v1/reviews/${reviewId}`)
      return Response.json({
        review,
        summary: '<script>alert("summary")</script>',
        findings: ["low", "high"].map((severity, i) => ({
          id: `finding-${i}`,
          path: "src/auth.rs",
          start_line: 119,
          line: 120,
          severity,
          category: "security",
          title: `${severity} finding`,
          body: '<img src=x onerror="alert(1)">',
          suggestion: "<script>untrusted</script>",
          published: true,
        })),
      });
    return Response.json({ error: "Not found" }, { status: 404 });
  },
});
const reserve = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () => new Response(),
});
const port = reserve.port;
reserve.stop(true);
const origin = `http://127.0.0.1:${port}`;
const sessionCookie = `crocode_session=${encryptSession({ token, expiresAt: Date.now() + 600_000 }, secret)}`;
const app = spawn(
  process.env.CROCODE_SMOKE_RUNTIME ?? process.execPath,
  [resolve(".next/standalone/server.js")],
  {
    env: {
      ...process.env,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      SESSION_SECRET: secret,
      GITHUB_CLIENT_ID: "smoke-client",
      GITHUB_CLIENT_SECRET: "smoke-secret",
      GITHUB_APP_SLUG: "crocode",
      PUBLIC_URL: origin,
      CROCODE_API_URL: `http://127.0.0.1:${mock.port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "";
app.stdout?.on("data", (data) => {
  output += String(data);
});
app.stderr?.on("data", (data) => {
  output += String(data);
});

async function get(path: string, authenticated = true) {
  return fetch(origin + path, {
    headers: authenticated ? { Cookie: sessionCookie } : {},
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
}

function actionForm(html: string) {
  const form = new FormData();
  const decode = (text: string) =>
    text
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
  for (const tag of html.matchAll(/<input\b[^>]*>/g)) {
    const name = tag[0].match(/name="([^"]+)"/)?.[1];
    if (name?.startsWith("$ACTION_"))
      form.append(
        decode(name),
        decode(tag[0].match(/value="([^"]*)"/)?.[1] ?? ""),
      );
  }
  assert.ok(
    [...form.keys()].some(
      (name) =>
        name.startsWith("$ACTION_REF_") || name.startsWith("$ACTION_ID_"),
    ),
    "Server Action form metadata",
  );
  form.set("agent", "codex");
  form.set("model", "  ");
  return form;
}

try {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (app.exitCode !== null) throw new Error(`Standalone exited: ${output}`);
    try {
      await get("/", false);
      break;
    } catch {
      await Bun.sleep(100);
    }
  }
  let response = await get("/", false);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Sign in with GitHub/);
  response = await get("/");
  assert.match(response.headers.get("location") ?? "", /\/installations$/);
  response = await get("/installations", false);
  assert.match(response.headers.get("location") ?? "", /\/api\/auth\/login$/);
  console.log("Checking installations");
  response = await get("/installations");
  const installations = await response.text();
  assert.equal(response.status, 200);
  assert.match(installations, /octocat/);
  assert.match(installations, /acme/);
  assert.ok(
    !installations.includes(token),
    "Token must not appear in client HTML or RSC data",
  );
  console.log("Checking settings");
  response = await get("/installations/123");
  const settings = await response.text();
  assert.equal(response.status, 200);
  assert.match(settings, /Load older/);
  const form = actionForm(settings);
  console.log("Submitting settings action");
  const save = await fetch(origin + "/installations/123", {
    method: "POST",
    headers: { Cookie: sessionCookie, Origin: origin },
    body: form,
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(save.status, 303);
  assert.equal(save.headers.get("location"), "/installations/123?saved=1");
  assert.deepEqual(patches, [{ enabled: false, agent: "codex", model: null }]);
  assert.match(
    await (await get("/installations/123?saved=1")).text(),
    /Settings saved/,
  );
  console.log("Checking read-only action");
  canAdmin = false;
  response = await get("/installations/123");
  const readonly = await response.text();
  assert.match(readonly, /Read only/);
  assert.match(readonly, /<fieldset[^>]*disabled/);
  await fetch(origin + "/installations/123", {
    method: "POST",
    headers: { Cookie: sessionCookie, Origin: origin },
    body: form,
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(
    patches.length,
    1,
    "Read-only users cannot PATCH with a forged form",
  );
  console.log("Checking pagination and review detail");
  canAdmin = true;
  const cursor = review.created_at;
  await get(`/installations/123?${new URLSearchParams({ before: cursor })}`);
  assert.ok(
    calls.some(
      (call) =>
        call.includes("before=") &&
        new URL(`http://api${call}`).searchParams.get("before") === cursor,
    ),
  );
  response = await get(`/reviews/${reviewId}`);
  const detail = await response.text();
  assert.equal(response.status, 200);
  assert.ok(
    detail.indexOf('id="severity-high"') < detail.indexOf('id="severity-low"'),
  );
  assert.ok(!detail.includes('<script>alert("summary")</script>'));
  assert.ok(detail.includes("&lt;script&gt;"));
  assert.ok(!detail.includes('<img src=x onerror="alert(1)">'));
  assert.match(await (await get("/reviews/invalid")).text(), /Page not found/);
  empty = true;
  assert.match(
    await (await get("/installations")).text(),
    /No installations yet/,
  );
  apiStatus = 401;
  const expired = await get("/installations");
  const expiredHtml = await expired.text();
  assert.ok(
    expired.headers.get("location")?.includes("/api/auth/login") ||
      expiredHtml.includes("/api/auth/login"),
    "API 401 redirects to login",
  );
  response = await get("/api/auth/login", false);
  const location = new URL(response.headers.get("location")!);
  assert.equal(location.origin, "https://github.com");
  assert.equal(
    location.searchParams.get("redirect_uri"),
    `${origin}/api/auth/callback`,
  );
  assert.equal(location.searchParams.get("state")?.length, 43);
  assert.ok(
    response.headers
      .getSetCookie()
      .some((cookie) => /crocode_session=;.*Max-Age=0/i.test(cookie)),
  );
  assert.ok(
    response.headers
      .getSetCookie()
      .some((cookie) => /crocode_oauth_state=.+HttpOnly/i.test(cookie)),
  );
  response = await get("/api/auth/callback?code=unused&state=invalid", false);
  assert.equal(response.headers.get("location"), `${origin}/?auth=state`);
  const blocked = await fetch(origin + "/api/auth/logout", {
    method: "POST",
    headers: { Origin: "https://evil.example", Cookie: sessionCookie },
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(blocked.status, 403);
  const logout = await fetch(origin + "/api/auth/logout", {
    method: "POST",
    headers: { Origin: origin, Cookie: sessionCookie },
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(logout.status, 303);
  assert.ok(
    logout.headers
      .getSetCookie()
      .some((cookie) => /crocode_session=;.*Max-Age=0/i.test(cookie)),
  );
  console.log(
    "PASS: standalone runtime; landing, installations, settings, admin guard, pagination, review escaping, empty/404/401, OAuth state, logout CSRF.",
  );
} catch (error) {
  console.error(output, calls);
  throw error;
} finally {
  app.kill("SIGKILL");
  mock.stop(true);
}
