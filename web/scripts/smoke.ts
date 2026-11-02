import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { createAuth } from "../lib/auth-config";
import { DOCS_PAGES } from "../lib/docs-nav";

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
let pullsFail = false;
let vulnerabilitiesFail = false;
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
      return Response.json({
        agents: ["codex", "claude"],
        default: "codex",
        models: {
          codex: [{ id: "gpt-smoke", name: "GPT Smoke" }],
          claude: [{ id: "opus", name: "opus" }],
        },
      });
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
    if (url.pathname === "/api/v1/installations/123/vulnerabilities") {
      if (vulnerabilitiesFail) return Response.json({ error: "GitHub" }, { status: 502 });
      return Response.json({
        total_repositories: 6, next_page: url.searchParams.get("page") === "2" ? null : 2,
        repositories: [
          { repo_full_name: "acme/api", coverage: "readable", checked_at: "2026-11-02T10:00:00Z", last_success_at: "2026-11-02T10:00:00Z", alerts: [{
            number: 1,
            dependency: { package: { ecosystem: "npm", name: "example" }, manifest_path: "bun.lock", scope: "runtime" },
            security_advisory: { ghsa_id: "GHSA-example", cve_id: "CVE-2026-1234", epss: { percentage: 0.00045 }, summary: "<script>untrusted-advisory</script>" },
            security_vulnerability: { severity: "critical", vulnerable_version_range: "< 2", first_patched_version: { identifier: "2.0.0" } },
          }, {
            number: 2,
            dependency: { package: { ecosystem: "npm", name: "other" }, manifest_path: "bun.lock", scope: null },
            security_advisory: { ghsa_id: "GHSA-without-cve", cve_id: null, summary: "No CVE assigned" },
            security_vulnerability: { severity: "low", vulnerable_version_range: "< 3", first_patched_version: null },
          }] },
          { repo_full_name: "acme/denied", coverage: "access_denied", checked_at: "2026-11-02T10:00:00Z", last_success_at: null, alerts: null },
          { repo_full_name: "acme/empty", coverage: "readable", checked_at: "2026-11-02T10:00:00Z", last_success_at: "2026-11-02T09:00:00Z", alerts: [] },
        ],
      });
    }
    if (url.pathname === "/api/v1/installations/123/stats")
      return Response.json({
        days: 30,
        reviews: 20,
        succeeded: 19,
        failed: 1,
        in_progress: 0,
        pull_requests: 2,
        repositories: 1,
        median_duration_secs: 180,
        findings: 2,
        published: 2,
        severity: [
          { name: "high", count: 1 },
          { name: "low", count: 1 },
        ],
        categories: [{ name: "security", count: 2 }],
        daily: Array.from({ length: 30 }, (_, i) => ({
          date: `2026-10-${String(i + 1).padStart(2, "0")}`,
          reviews: i === 29 ? 20 : 0,
          failed: i === 29 ? 1 : 0,
        })),
      });
    if (url.pathname === "/api/v1/installations/123/pulls") {
      if (pullsFail) return Response.json({ error: "GitHub" }, { status: 502 });
      return Response.json({
        truncated: false,
        pulls: [
          {
            repo_full_name: "acme/api",
            number: 43,
            title: "<b>Open pull request</b>",
            draft: false,
            author: "octocat",
            author_id: 1,
            comments: 0,
            created_at: "2026-11-01T09:00:00Z",
            updated_at: "2026-11-01T10:00:00Z",
            review: null,
          },
        ],
      });
    }
    if (url.pathname === `/api/v1/reviews/${reviewId}/pull`)
      return Response.json({ error: "Not found" }, { status: 404 });
    if (
      url.pathname === "/api/v1/installations/123/reviews" &&
      url.searchParams.has("pr")
    )
      return Response.json([review]);
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

/** Cookie header from a response's Set-Cookie list, without cleared cookies. */
function cookieHeader(response: Response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .filter((pair) => !pair.endsWith("="))
    .join("; ");
}

/**
 * Runs the real Better Auth GitHub flow in this process against a fake
 * GitHub, then returns the session cookies. The app uses the same secret, so
 * it accepts them.
 */
async function signInCookies(expiresIn: number) {
  const auth = createAuth({
    clientId: "smoke-client",
    clientSecret: "smoke-secret",
    authSecret: secret,
    authUrl: origin,
  });
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "https://github.com/login/oauth/access_token")
      return Response.json({
        access_token: token,
        token_type: "bearer",
        expires_in: expiresIn,
        refresh_token: "smoke-refresh-token",
        refresh_token_expires_in: 15_897_600,
      });
    if (url === "https://api.github.com/user")
      return Response.json({
        id: 1,
        login: "octocat",
        name: "The Octocat",
        email: "octocat@example.com",
        avatar_url: "https://avatars.githubusercontent.com/u/1",
      });
    if (url === "https://api.github.com/user/emails")
      return Response.json({ message: "Forbidden" }, { status: 403 });
    return realFetch(input, init);
  }) as typeof fetch;
  try {
    const start = await auth.handler(
      new Request(`${origin}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify({
          provider: "github",
          callbackURL: "/installations",
        }),
      }),
    );
    const { url } = (await start.json()) as { url: string };
    const state = new URL(url).searchParams.get("state") ?? "";
    const callback = await auth.handler(
      new Request(
        `${origin}/api/auth/callback/github?${new URLSearchParams({ code: "smoke", state })}`,
        { headers: { Cookie: cookieHeader(start) } },
      ),
    );
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get("location"), "/installations");
    const cookies = cookieHeader(callback);
    const session = await auth.api.getSession({
      headers: new Headers({ Cookie: cookies }),
    });
    assert.equal(session?.user.email, "1@github.invalid");
    assert.equal(session?.user.emailVerified, false);
    return cookies;
  } finally {
    globalThis.fetch = realFetch;
  }
}
const sessionCookie = await signInCookies(28_800);
// Inside Better Auth's 5-second refresh window, so the token counts as expired.
const expiredCookie = await signInCookies(1);
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
      BETTER_AUTH_SECRET: secret,
      GITHUB_CLIENT_ID: "smoke-client",
      GITHUB_CLIENT_SECRET: "smoke-secret",
      GITHUB_APP_SLUG: "crocode",
      BETTER_AUTH_URL: origin,
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

async function get(path: string, cookie: string | null = sessionCookie) {
  return fetch(origin + path, {
    headers: cookie ? { Cookie: cookie } : {},
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
}

/** Server Action fields of the first form whose markup contains `marker`. */
function actionForm(html: string, marker: string) {
  const markup = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)]
    .map((match) => match[0])
    .find((candidate) => candidate.includes(marker));
  assert.ok(markup, `Form containing ${marker}`);
  const form = new FormData();
  const decode = (text: string) =>
    text
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
  for (const tag of markup.matchAll(/<input\b[^>]*>/g)) {
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
  return form;
}

async function submit(
  path: string,
  form: FormData,
  headers: Record<string, string>,
) {
  return fetch(origin + path, {
    method: "POST",
    headers,
    body: form,
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
}

try {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (app.exitCode !== null) throw new Error(`Standalone exited: ${output}`);
    try {
      await get("/", null);
      break;
    } catch {
      await Bun.sleep(100);
    }
  }
  let response = await get("/", null);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Sign in with GitHub/);
  response = await get("/");
  assert.match(response.headers.get("location") ?? "", /\/installations$/);
  response = await get("/installations", null);
  assert.equal(response.headers.get("location"), "/");
  console.log("Checking public documentation");
  const apiCallsBeforeDocs = calls.length;
  for (const page of DOCS_PAGES) {
    const docResponse = await get(page.href, null);
    assert.equal(docResponse.status, 200, page.href);
    const html = await docResponse.text();
    assert.ok(html.includes(`<h1 id="doc-title"`), `${page.href} has an article`);
    assert.ok(html.includes(`${page.title} · Docs · CroCode`), `${page.href} has a page title`);
    assert.ok(html.includes('aria-current="page"'), `${page.href} has an active nav item`);
    assert.ok(!html.includes(token), `${page.href} has no access token`);
  }
  assert.equal(calls.length, apiCallsBeforeDocs, "Docs make no authenticated API calls");
  const missingDoc = await get("/docs/missing", null);
  assert.equal(missingDoc.status, 404);
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
  console.log("Checking installation overview");
  response = await get("/installations/123");
  const overview = await response.text();
  assert.equal(response.status, 200);
  assert.match(overview, /Load older/);
  assert.match(overview, /Not reviewed/);
  assert.ok(overview.includes("&lt;b&gt;Open pull request&lt;/b&gt;"));
  assert.ok(!overview.includes("<b>Open pull request</b>"));
  assert.ok(!overview.includes('name="agent"'), "Settings live in their own tab");
  pullsFail = true;
  const degraded = await get("/installations/123");
  assert.equal(degraded.status, 200);
  assert.match(await degraded.text(), /Cannot load open pull requests/);
  pullsFail = false;
  console.log("Checking vulnerabilities");
  response = await get("/installations/123/vulnerabilities");
  const vulnerabilities = await response.text();
  assert.equal(response.status, 200);
  assert.match(vulnerabilities, /CVE-2026-1234/);
  assert.match(vulnerabilities, /GHSA-without-cve/);
  assert.match(vulnerabilities, /2.0.0/);
  assert.match(vulnerabilities, /Not supplied/);
  assert.match(vulnerabilities, /Some repositories could not be checked/);
  assert.match(vulnerabilities, /No open Dependabot alerts reported/);
  assert.match(vulnerabilities, /Next repositories/);
  assert.ok(vulnerabilities.includes("&lt;script&gt;untrusted-advisory&lt;/script&gt;"));
  assert.ok(!vulnerabilities.includes("<script>untrusted-advisory</script>"));
  assert.ok(!vulnerabilities.includes(token));
  assert.match(vulnerabilities, /Security coverage/);
  assert.match(vulnerabilities, /Access denied/);
  assert.match(vulnerabilities, /No successful read recorded/);
  const filtered = await (await get("/installations/123/vulnerabilities?severity=critical&scope=runtime&fix=available")).text();
  assert.match(filtered, /CVE-2026-1234/);
  assert.ok(!filtered.includes("GHSA-without-cve"));
  assert.match(filtered, /1 matching alert from/);
  assert.match(filtered, /acme\/denied/); // Coverage stays visible while filtering.
  assert.match(filtered, /page=2&amp;severity=critical&amp;scope=runtime&amp;fix=available/);
  const noMatches = await (await get("/installations/123/vulnerabilities?q=not-a-match")).text();
  assert.match(noMatches, /No alerts match these filters on this repository page/);
  assert.match(noMatches, /acme\/denied/);
  const lastRepoPage = await (await get("/installations/123/vulnerabilities?page=2")).text();
  assert.match(lastRepoPage, /Previous repositories/);
  assert.ok(!lastRepoPage.includes("Next repositories"));
  const invalidPage = await (await get("/installations/123/vulnerabilities?page=0")).text();
  assert.match(invalidPage, /Page not found/);
  assert.ok(!calls.includes("/api/v1/installations/123/vulnerabilities?page=0"));
  vulnerabilitiesFail = true;
  assert.match(await (await get("/installations/123/vulnerabilities")).text(), /Cannot load vulnerabilities/);
  vulnerabilitiesFail = false;
  console.log("Checking fix priority queue");
  const priority = await (await get("/installations/123/vulnerabilities?view=priority")).text();
  assert.match(priority, /Fix priority queue/);
  assert.match(priority, /Exploit probability/);
  assert.match(priority, /0.05%/);
  assert.match(priority, /Unknown/);
  assert.match(priority, /The queue is incomplete/);
  assert.match(priority, /name="view"[^>]*value="priority"/);
  assert.match(priority, /page=2&amp;view=priority/);
  assert.ok(!priority.includes("<script>untrusted-advisory</script>"));
  const filteredQueue = await (await get("/installations/123/vulnerabilities?view=priority&severity=critical")).text();
  assert.match(filteredQueue, /CVE-2026-1234/);
  assert.ok(!filteredQueue.includes("GHSA-without-cve"));
  assert.match(filteredQueue, /page=2&amp;view=priority&amp;severity=critical/);
  const emptyQueue = await (await get("/installations/123/vulnerabilities?view=priority&q=not-a-match")).text();
  assert.match(emptyQueue, /No alerts match these filters on this repository page/);
  vulnerabilitiesFail = true;
  assert.match(await (await get("/installations/123/vulnerabilities?view=priority")).text(), /Cannot load the priority queue/);
  vulnerabilitiesFail = false;
  console.log("Checking settings");
  response = await get("/installations/123/settings");
  const settings = await response.text();
  assert.equal(response.status, 200);
  assert.match(settings, /1 model detected from the codex CLI/);
  assert.match(settings, /<input[^>]*name="model"/, "Model field submits as model");
  assert.match(settings, /<input[^>]*name="agent"/, "Agent field submits as agent");
  const form = actionForm(settings, 'name="agent"');
  form.set("agent", "codex");
  form.set("model", "  ");
  console.log("Submitting settings action");
  const save = await fetch(origin + "/installations/123/settings", {
    method: "POST",
    headers: { Cookie: sessionCookie, Origin: origin },
    body: form,
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(save.status, 303);
  assert.equal(
    save.headers.get("location"),
    "/installations/123/settings?saved=1",
  );
  assert.deepEqual(patches, [{ enabled: false, agent: "codex", model: null }]);
  assert.match(
    await (await get("/installations/123/settings?saved=1")).text(),
    /Settings saved/,
  );
  console.log("Checking read-only action");
  canAdmin = false;
  response = await get("/installations/123/settings");
  const readonly = await response.text();
  assert.match(readonly, /Read only/);
  assert.match(readonly, /<fieldset[^>]*disabled/);
  await fetch(origin + "/installations/123/settings", {
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
  assert.equal(response.status, 200, "A hidden GitHub pull request keeps the page");
  assert.match(detail, /This review/);
  assert.ok(
    calls.some((call) => call.includes("repo=acme%2Fapi") && call.includes("pr=42")),
  );
  // Match rendered headings only: the findings also appear in the React
  // Server Components payload, in API order.
  assert.deepEqual(
    [...detail.matchAll(/<h3[^>]*>(\w+) finding<\/h3>/g)].map((m) => m[1]),
    ["high", "low"],
    "Findings sorted by severity",
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
  console.log("Checking expired tokens");
  apiStatus = 401;
  const expired = await get("/installations");
  assert.ok(
    expired.headers.get("location")?.includes("/?auth=expired") ||
      (await expired.text()).includes("/?auth=expired"),
    "API 401 sends the user to sign in",
  );
  apiStatus = 200;
  empty = false;
  const stale = await get("/installations", expiredCookie);
  assert.ok(
    stale.headers.get("location")?.includes("/?auth=expired") ||
      (await stale.text()).includes("/?auth=expired"),
    "An expired GitHub token sends the user to sign in",
  );
  response = await get("/?auth=expired");
  assert.equal(response.status, 200, "No redirect loop with a stale session");
  assert.match(await response.text(), /Your session has expired/);

  console.log("Checking Better Auth endpoints");
  for (const path of [
    "/api/auth/get-access-token",
    "/api/auth/refresh-token",
  ]) {
    response = await fetch(origin + path, {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ useAccountCookie: true }),
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(response.status, 404, `${path} is disabled`);
  }
  response = await get("/api/auth/get-session");
  const sessionJson = await response.text();
  assert.equal(response.status, 200);
  assert.match(sessionJson, /1@github\.invalid/);
  assert.ok(!sessionJson.includes(token), "Session JSON has no GitHub token");
  response = await get("/?error=state_mismatch", null);
  assert.match(await response.text(), /GitHub sign-in could not finish/);
  response = await get("/?error=constructor", null);
  assert.match(await response.text(), /GitHub sign-in could not finish/);

  console.log("Checking sign-in action");
  const landing = await (await get("/", null)).text();
  const signInForm = actionForm(landing, "Sign in with GitHub");
  const blockedSignIn = await submit("/", signInForm, {});
  assert.notEqual(blockedSignIn.status, 303, "Sign-in requires Origin");
  response = await submit("/", signInForm, { Origin: origin });
  assert.equal(response.status, 303);
  const location = new URL(response.headers.get("location")!);
  assert.equal(
    location.origin + location.pathname,
    "https://github.com/login/oauth/authorize",
  );
  assert.equal(location.searchParams.get("client_id"), "smoke-client");
  assert.equal(
    location.searchParams.get("redirect_uri"),
    `${origin}/api/auth/callback/github`,
  );
  assert.equal(location.searchParams.get("scope"), null, "No OAuth scopes");
  assert.ok(location.searchParams.get("state"));
  assert.ok(location.searchParams.get("code_challenge"), "PKCE");
  assert.ok(
    response.headers
      .getSetCookie()
      .some((cookie) => /^crocode\.oauth_state=.+HttpOnly/i.test(cookie)),
    "OAuth state cookie",
  );
  response = await get(
    "/api/auth/callback/github?code=unused&state=invalid",
    null,
  );
  assert.match(
    response.headers.get("location") ?? "",
    new RegExp(`^${origin}/\\?error=`),
  );

  console.log("Checking sign-out action");
  const dashboard = await (await get("/installations")).text();
  const signOutForm = actionForm(dashboard, 'aria-label="Sign out"');
  const blockedSignOut = await submit("/installations", signOutForm, {
    Cookie: sessionCookie,
    Origin: "https://evil.example",
  });
  assert.ok(
    !blockedSignOut.headers
      .getSetCookie()
      .some((cookie) => cookie.startsWith("crocode.session_token=;")),
    "Cross-origin sign-out keeps the session",
  );
  const logout = await submit("/installations", signOutForm, {
    Cookie: sessionCookie,
    Origin: origin,
  });
  assert.equal(logout.status, 303);
  assert.equal(logout.headers.get("location"), "/");
  for (const name of ["session_token", "session_data", "account_data"])
    assert.ok(
      logout.headers
        .getSetCookie()
        .some((cookie) =>
          new RegExp(`^crocode\\.${name}=;.*Max-Age=0`, "i").test(cookie),
        ),
      `Sign-out clears ${name}`,
    );
  console.log(
    "PASS: standalone runtime; public docs, Better Auth GitHub flow, landing, installations, overview, open pull requests and GitHub failure, vulnerabilities, fix priority queue and repository pages, settings and models, admin guard, pagination, review escaping, empty/404/401, expired token, disabled token endpoints, sign-in and sign-out actions.",
  );
} catch (error) {
  console.error(output, calls);
  throw error;
} finally {
  app.kill("SIGKILL");
  mock.stop(true);
}
