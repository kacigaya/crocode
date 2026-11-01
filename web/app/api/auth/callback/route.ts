import { NextRequest, NextResponse } from "next/server";
import { cookieOptions, SESSION_COOKIE, STATE_COOKIE } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import {
  decryptSession,
  encryptSession,
  SESSION_TTL,
  statesMatch,
} from "@/lib/session-codec";

export async function GET(request: NextRequest) {
  const env = getEnv();
  const options = cookieOptions();
  function failure(reason: "state" | "denied" | "exchange") {
    const response = NextResponse.redirect(
      new URL(`/?auth=${reason}`, env.publicUrl),
    );
    response.cookies.set(STATE_COOKIE, "", { ...options, maxAge: 0 });
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  const stored = decryptSession(
    request.cookies.get(STATE_COOKIE)?.value,
    env.sessionSecret,
    Date.now(),
    "oauth-state",
  );
  const state = request.nextUrl.searchParams.get("state");
  if (!stored || !state || !statesMatch(stored.token, state))
    return failure("state");
  const code = request.nextUrl.searchParams.get("code");
  if (request.nextUrl.searchParams.has("error") || !code)
    return failure("denied");
  try {
    const result = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: env.clientId,
        client_secret: env.clientSecret,
        code,
        redirect_uri: `${env.publicUrl}/api/auth/callback`,
      }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!result.ok) return failure("exchange");
    const data: unknown = await result.json();
    if (
      !data ||
      typeof data !== "object" ||
      "error" in data ||
      !("access_token" in data) ||
      typeof data.access_token !== "string" ||
      !data.access_token
    )
      return failure("exchange");
    let ttl = SESSION_TTL;
    if ("expires_in" in data) {
      if (
        typeof data.expires_in !== "number" ||
        !Number.isSafeInteger(data.expires_in) ||
        data.expires_in <= 0
      )
        return failure("exchange");
      ttl = Math.min(ttl, data.expires_in);
    }
    const response = NextResponse.redirect(
      new URL("/installations", env.publicUrl),
    );
    response.headers.set("Cache-Control", "no-store");
    response.cookies.set(STATE_COOKIE, "", { ...options, maxAge: 0 });
    response.cookies.set(
      SESSION_COOKIE,
      encryptSession(
        { token: data.access_token, expiresAt: Date.now() + ttl * 1000 },
        env.sessionSecret,
      ),
      { ...options, maxAge: ttl },
    );
    return response;
  } catch {
    return failure("exchange");
  }
}
