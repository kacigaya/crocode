import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createAuth } from "./auth-config";
import { getEnv } from "./env";

/**
 * One instance per request. Without a database, Better Auth writes each
 * sign-in's user, account, and session to an in-memory store that is never
 * pruned. A process-wide instance would keep every GitHub token until restart.
 * All state the dashboard needs is in the cookies.
 */
export const getAuth = cache(() => createAuth(getEnv()));

export async function readSession() {
  return getAuth().api.getSession({ headers: await headers() });
}

/** Returns the GitHub user access token, or sends the user to sign in. */
export async function requireAccessToken() {
  const requestHeaders = await headers();
  if (!(await getAuth().api.getSession({ headers: requestHeaders })))
    redirect("/");
  let token: string | undefined;
  try {
    ({ accessToken: token } = await getAuth().api.getAccessToken({
      body: { useAccountCookie: true },
      headers: requestHeaders,
    }));
  } catch {
    // Expired token: refresh is disabled, see auth-config.ts.
  }
  if (!token) redirect("/?auth=expired");
  return token;
}

/** Server actions only: Next.js allows a POST that has no Origin header. */
export async function requireSameOrigin() {
  const origin = (await headers()).get("origin");
  if (origin !== new URL(getEnv().authUrl).origin)
    throw new Error("Request origin is not allowed");
}
