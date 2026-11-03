# GitHub App setup

The dashboard can create the app for you. See the [quick start](../README.md#quick-start).
It uses GitHub's [manifest flow](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest)
with the same settings as the manual steps below.
GitHub has no API for app logos. Upload `web/public/crocode-app-logo.png` on the app settings page.
Use the manual steps when you configure an existing app or keep secrets in environment variables.

Use one GitHub App for webhook delivery, repository access, and dashboard user access.
The worker creates a separate installation token for each repository review.
It requests only `contents: read` and `pull_requests: write` for that token.

These steps follow the official [app registration guide](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app) and [permission guide](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app).

1. Choose your public HTTPS address, for example `https://crocode.example.com`.
   Set `BETTER_AUTH_URL` to that address in `web/.env`.
   Route `/webhooks/github` to the Rust API on port 8080.
   Route the dashboard and `/api/auth/*` to the web service on port 3000.
   Only the dashboard reads `BETTER_AUTH_URL`. The Rust server does not read it.

2. Open GitHub **Settings > Developer settings > GitHub Apps > New GitHub App**.
   For an organization-owned app, start from that organization's settings.
   Choose a unique app name.
   Set the homepage URL to your public site or this project's repository.

3. Set the user authorization **Callback URL** to `${BETTER_AUTH_URL}/api/auth/callback/github`.
   Replace `${BETTER_AUTH_URL}` with the actual address. GitHub does not expand environment variables.
   This is the dashboard OAuth callback, not the webhook URL.
   The Rust API does not implement this callback.
   Record the app's Client ID and create a client secret for the dashboard.
   Put them in `web/.env` as `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. Set `GITHUB_APP_SLUG` and `BETTER_AUTH_SECRET` there too.
   The dashboard does not read user email addresses. The app does not need the **Email addresses** permission.
   Do not give the client secret to an agent container.

4. Keep user token expiration enabled.
   Enable **Request user authorization (OAuth) during installation** if users must sign in during setup.
   User authorization lets the dashboard send a GitHub user access token to the REST API.
   Installing the app and authorizing user access are separate actions.
   See GitHub's [user access token guide](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app).

5. Enable the webhook.
   Set the **Webhook URL** to `https://<your address>/webhooks/github`.
   Generate a random webhook secret.

   ```sh
   openssl rand -hex 32
   ```

6. Put the same secret in GitHub's **Webhook secret** field and `.env` as `GITHUB_WEBHOOK_SECRET`.
   CroCode requires at least 16 bytes. The command above gives 64 ASCII characters.
   Keep **SSL verification** enabled.
   See GitHub's [webhook signature guide](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries).

7. Set these repository permissions.
   Leave other permissions at **No access**.

   | Repository permission | Access | Purpose |
   | --- | --- | --- |
   | Contents | Read-only | Read code and base-commit config. Fetch PR heads. |
   | Pull requests | Read and write | Read diffs. Create `COMMENT` reviews. |
   | Dependabot alerts | Read-only | Read open dependency alerts for the dashboard. |
   | Metadata | Read-only | Identify repositories. GitHub includes this permission. |

8. Set organization **Members** to **Read-only**.
   The dashboard API uses this permission to check whether a user is an active organization admin.
   The worker's repository token does not request it.
   A failed admin check denies settings changes.

9. Subscribe to **Pull request** events.
   CroCode also handles **Installation** and **Installation repositories** events.
   GitHub sends those installation events to apps by default.
   See the [event reference](https://docs.github.com/en/webhooks/webhook-events-and-payloads#installation).
   No Push or Workflow permission is needed.

10. Choose **Only on this account** for a private app, or **Any account** for a shared app.
    Create the app.
    Copy its numeric **App ID** to `GITHUB_APP_ID`.
    Do not use the Client ID in this field.

11. Generate a private key under the app's **Credentials > Key pairs** settings.
    GitHub downloads the PEM private key once.
    Keep the file private.
    See GitHub's [private key guide](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps).

12. Set `GITHUB_PRIVATE_KEY` in `.env` to the PEM contents with literal `\n` between lines.
    Use the single-quoted format in `.env.example`.
    As an alternative, mount the PEM file read-only into both `api` and `worker`.
    Set `GITHUB_PRIVATE_KEY_PATH` to its container path.
    Unset that variable when you use the inline key.
    Never commit the key or mount it into the sandbox.

13. Install the app on selected repositories.
    Start CroCode with the [Compose quick start](../README.md#quick-start).
    Check the app's webhook delivery view.
    A signed ping returns `202` with `pong`.
    Open a small PR and check that the worker claims its queued review.

A manual redelivery with the same delivery ID returns `200` with `duplicate delivery` after a successful delivery.
A new delivery ID for the same PR head does not queue another review.
An invalid signature returns `401` before the handler records a delivery.

## Enable the vulnerability panel on an existing App

1. Open the GitHub App settings.
2. Under **Permissions & events**, set repository **Dependabot alerts** to **Read-only**.
3. Save the change.
4. Approve the new permission for each installation on GitHub.
5. Enable Dependabot alerts in each repository's security settings.
6. Sign in to CroCode again if the current session still cannot read alerts.

The dashboard uses the signed-in user's access. The user must be allowed to read security alerts.
Repositories without that access show a warning. Review sandbox tokens do not receive this permission.
The opt-in weekly security digest also needs this permission. The worker reads alerts with an
installation token limited to Dependabot alerts and metadata.
