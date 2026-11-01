import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getEnv } from "./env";
import { decryptSession } from "./session-codec";

export const SESSION_COOKIE = "crocode_session";
export const STATE_COOKIE = "crocode_oauth_state";

export function cookieOptions() {
  return {
    httpOnly: true,
    secure: getEnv().publicUrl.startsWith("https:"),
    sameSite: "lax" as const,
    path: "/",
  };
}

export async function readSession() {
  const env = getEnv();
  return decryptSession(
    (await cookies()).get(SESSION_COOKIE)?.value,
    env.sessionSecret,
  );
}

export async function requireSession() {
  const session = await readSession();
  if (!session) redirect("/api/auth/login");
  return session;
}
