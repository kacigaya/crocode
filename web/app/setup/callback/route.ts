import { type NextRequest, NextResponse } from "next/server";
import { setupAvailable, setupToken, writeStoredConfig } from "@/lib/config";
import { toStoredConfig, verifyState } from "@/lib/setup";

/** GitHub's manifest redirect. Exchanges the one-time code for credentials. */
export async function GET(request: NextRequest) {
  const fail = (message: string, status = 400) =>
    new NextResponse(`${message}\n`, {
      status,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  if (!setupAvailable()) return fail("This instance is already set up.", 409);
  const code = request.nextUrl.searchParams.get("code") ?? "";
  const target = verifyState(
    setupToken(),
    request.nextUrl.searchParams.get("state") ?? "",
  );
  if (!target || !/^[\w-]{1,100}$/.test(code))
    return fail("Setup link is invalid or expired. Start again at /setup.");
  const apiUrl = (
    process.env.GITHUB_API_URL?.trim() || "https://api.github.com"
  ).replace(/\/$/, "");
  let response: Response;
  try {
    response = await fetch(`${apiUrl}/app-manifests/${code}/conversions`, {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return fail("Could not reach GitHub. Start again at /setup.", 502);
  }
  if (!response.ok)
    return fail(
      `GitHub refused the setup code (${response.status}). Start again at /setup.`,
      502,
    );
  try {
    writeStoredConfig(
      toStoredConfig(await response.json(), target.origin, target.owner),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      return fail("This instance is already set up.", 409);
    return fail("GitHub returned an unexpected response. Start again at /setup.", 502);
  }
  return NextResponse.redirect(new URL("/setup/done", target.origin), 303);
}
