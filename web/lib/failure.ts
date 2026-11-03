import type { Review } from "./types";

export type FailureReason = {
  title: string;
  /** What happened, in plain words. */
  detail: string;
  /** What to do next. Empty when no action helps. */
  action: string;
};

/** Patterns match the messages that the worker and webhook store. */
const failed: [RegExp, FailureReason][] = [
  [
    /usage limit|rate.?limit|insufficient_quota|you've hit your|free usage limit/i,
    {
      title: "The agent reached a usage limit",
      detail: "The model provider refused more requests for now.",
      action:
        "Wait until the limit resets, then retry. Set CROCODE_FALLBACK_AGENT to switch agents automatically.",
    },
  ],
  [
    /not logged in|invalid api key|authentication|unauthori[sz]ed|oauth|credential|login/i,
    {
      title: "The agent could not sign in",
      detail: "The agent CLI rejected its credentials.",
      action:
        "Check the agent key or subscription token on the worker, then retry.",
    },
  ],
  [
    /agent timed out/i,
    {
      title: "The agent took too long",
      detail: "The agent did not finish before the worker timeout.",
      action:
        "Retry. If it fails again, raise CROCODE_AGENT_TIMEOUT_SECS or split the pull request.",
    },
  ],
  [
    /^worker lost$/,
    {
      title: "The worker stopped during the review",
      detail:
        "A worker crashed or restarted and stopped sending heartbeats too many times.",
      action: "Check the worker logs, then retry.",
    },
  ],
  [
    /structured output|no JSON object|review schema|no final message|codex error|opencode error/i,
    {
      title: "The agent returned no valid review",
      detail: "The agent output did not match the review format.",
      action: "Retry. If it fails again, choose another model.",
    },
  ],
  [
    /start agent process|docker|sandbox/i,
    {
      title: "The sandbox could not start",
      detail: "The worker could not run the agent container.",
      action:
        "Check Docker access, DOCKER_GID, and the sandbox image on the worker, then retry.",
    },
  ],
  [
    /^git .*(failed|timed out)|run git/i,
    {
      title: "The pull request could not be fetched",
      detail: "Git could not download the pull request commit.",
      action: "Check that the commit still exists, then retry.",
    },
  ],
  [
    /installation token|GitHub|status code|HTTP \d{3}/i,
    {
      title: "A GitHub request failed",
      detail: "GitHub refused or could not answer a request for this review.",
      action:
        "Check that the app can still access the repository, then retry.",
    },
  ],
  [
    /^invalid \.crocode\.yml/i,
    {
      title: "The repository config is not valid",
      detail: "CroCode reads .crocode.yml from the base branch.",
      action: "Fix .crocode.yml on the base branch, then retry.",
    },
  ],
  [
    /is not enabled on this server|unknown agent|invalid model name/i,
    {
      title: "The agent or model is not available",
      detail: "The selected agent or model cannot run on this server.",
      action:
        "Choose an enabled agent and a valid model in Settings or .crocode.yml, then retry.",
    },
  ],
  [
    /^installation not found$/,
    {
      title: "The installation is gone",
      detail: "The GitHub App installation no longer exists.",
      action: "",
    },
  ],
];

const cancelled: Record<string, FailureReason> = {
  superseded: {
    title: "A newer commit replaced this review",
    detail: "CroCode reviews only the newest commit of a pull request.",
    action: "",
  },
  "pull request closed": {
    title: "The pull request was closed",
    detail: "CroCode stops reviews of closed pull requests.",
    action: "",
  },
  "pull request converted to draft": {
    title: "The pull request became a draft",
    detail: "CroCode stops reviews of drafts unless review_drafts is on.",
    action: "",
  },
  "installation removed": {
    title: "The app was suspended or removed",
    detail: "The GitHub App installation stopped while this review waited.",
    action: "",
  },
  "cancelled from the dashboard": {
    title: "An admin cancelled this review",
    detail: "Someone cancelled the review from the dashboard.",
    action: "",
  },
};

/** Plain-language reason for a failed or cancelled review. Null otherwise. */
export function explainReview(
  review: Pick<Review, "status" | "error">,
): FailureReason | null {
  const error = review.error?.trim() ?? "";
  if (review.status === "cancelled")
    return (
      cancelled[error] ?? {
        title: "The review was cancelled",
        detail: error || "The review stopped before it finished.",
        action: "",
      }
    );
  if (review.status !== "failed") return null;
  return (
    failed.find(([pattern]) => pattern.test(error))?.[1] ?? {
      title: "The review failed",
      detail: "The worker stopped with an unexpected error.",
      action: "See the error details. Retry if the cause was temporary.",
    }
  );
}

export const canRetry = (status: Review["status"]) =>
  status === "failed" || status === "cancelled";
export const canCancel = (status: Review["status"]) =>
  status === "queued" || status === "running";
