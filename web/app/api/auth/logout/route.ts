import { NextRequest, NextResponse } from "next/server";
import { cookieOptions, SESSION_COOKIE, STATE_COOKIE } from "@/lib/auth";
import { getEnv } from "@/lib/env";

export async function POST(request: NextRequest) {
  const env = getEnv();
  if (request.headers.get("origin") !== env.publicUrl)
    return new Response("Forbidden", { status: 403 });
  const response = NextResponse.redirect(new URL("/", env.publicUrl), 303);
  response.headers.set("Cache-Control", "no-store");
  for (const name of [SESSION_COOKIE, STATE_COOKIE])
    response.cookies.set(name, "", { ...cookieOptions(), maxAge: 0 });
  return response;
}
