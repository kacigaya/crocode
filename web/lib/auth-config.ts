import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import type { Env } from "./env";

/** GitHub App user access tokens expire after 8 hours. */
export const SESSION_TTL = 8 * 60 * 60;

/**
 * Stateless Better Auth: no database. The session and the GitHub account
 * (with its user access token) live in encrypted cookies.
 *
 * Kept free of `server-only` so the smoke test can build the same instance.
 */
export function createAuth(
  env: Pick<Env, "clientId" | "clientSecret" | "authSecret" | "authUrl">,
) {
  return betterAuth({
    appName: "CroCode",
    baseURL: env.authUrl,
    secret: env.authSecret,
    // These return OAuth tokens to the caller. The server calls them through
    // auth.api; browser JavaScript must not.
    disabledPaths: ["/get-access-token", "/refresh-token"],
    session: {
      expiresIn: SESSION_TTL,
      cookieCache: {
        enabled: true,
        strategy: "jwe",
        maxAge: SESSION_TTL,
        refreshCache: false,
      },
    },
    account: { storeStateStrategy: "cookie", storeAccountCookie: true },
    advanced: { cookiePrefix: "crocode" },
    telemetry: { enabled: false },
    // OAuth failures go back to the sign-in page as `?error=<code>`.
    onAPIError: { errorURL: `${env.authUrl}/` },
    socialProviders: {
      github: {
        clientId: env.clientId,
        clientSecret: env.clientSecret,
        // GitHub Apps ignore OAuth scopes; permissions come from the App.
        disableDefaultScope: true,
        // The dashboard never uses email. A placeholder keeps the App free of
        // the "Email addresses" permission and keeps real addresses out of
        // the cookie.
        mapProfileToUser: (profile) => ({
          email: `${profile.id}@github.invalid`,
          emailVerified: false,
        }),
        // GitHub rotates refresh tokens. A refresh during a server component
        // render cannot save the new cookie and would break the session, so
        // an expired token sends the user back to sign in.
        refreshAccessToken: async () => {
          throw new Error("Token refresh is disabled");
        },
      },
    },
    plugins: [nextCookies()],
  });
}
