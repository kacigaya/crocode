import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { cookieOptions, SESSION_COOKIE, STATE_COOKIE } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { encryptSession } from "@/lib/session-codec";

export async function GET() {
  const env = getEnv();
  const state = randomBytes(32).toString("base64url");
  const target = new URL("https://github.com/login/oauth/authorize");
  target.search = new URLSearchParams({
    client_id: env.clientId,
    redirect_uri: `${env.publicUrl}/api/auth/callback`,
    state,
  }).toString();
  const response = NextResponse.redirect(target);
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(SESSION_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
  response.cookies.set(
    STATE_COOKIE,
    encryptSession(
      { token: state, expiresAt: Date.now() + 600_000 },
      env.sessionSecret,
      "oauth-state",
    ),
    { ...cookieOptions(), maxAge: 600 },
  );
  return response;
}
