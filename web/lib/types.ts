export type User = { id: number; login: string };
export type AgentModel = { id: string; name: string };
/** Result of the latest model list run in the sandbox. */
export type AgentHealth = { available: boolean; checked_at: string };
export type Agents = {
  agents: string[];
  default: string;
  /** Models each enabled agent CLI reports. Empty until the worker detects them. */
  models: Record<string, AgentModel[]>;
  /** Null until the worker checks the agent. */
  health: Record<string, AgentHealth | null>;
};
/** Form value for "use the server default agent". The API stores it as null. */
export const DEFAULT_AGENT = "default";

export type Settings = {
  enabled: boolean;
  /** Null means the server default agent. */
  agent: string | null;
  model: string | null;
};
export type Installation = {
  id: number;
  account_id: number;
  account_login: string;
  account_type: string;
  repository_selection: string;
  suspended: boolean;
  created_at: string;
  settings: Settings;
  digest: Digest;
  can_admin: boolean;
};
/** Opt-in weekly security digest. The API never returns the webhook URL. */
export type Digest = {
  enabled: boolean;
  webhook_host: string | null;
  sent_at: string | null;
  attempted_at: string | null;
  error: string | null;
};
export type ReviewStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped";
export type Review = {
  id: string;
  installation_id: number;
  repo_full_name: string;
  pr_number: number;
  pr_title: string;
  head_sha: string;
  status: ReviewStatus;
  /** Null until the worker picks an agent. */
  agent: string | null;
  model: string | null;
  attempts: number;
  finding_count: number;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  /** Time in agent processes. Null when no agent finished. */
  agent_duration_ms: number | null;
  /** Token counts that the agent CLI reported. Input includes cached input. */
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
};
export const SEVERITIES = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
] as const;
export type Severity = (typeof SEVERITIES)[number];
export type Finding = {
  id: string;
  path: string;
  start_line: number | null;
  line: number;
  severity: Severity;
  category: string;
  title: string;
  body: string;
  suggestion: string | null;
  published: boolean;
};
/** GitHub PR patch of one file with findings, stored at review time. */
export type ReviewFile = { path: string; patch: string };
/** One OpenGrep result on an added line, as the agent received it. */
export type SastResult = {
  rule_id: string;
  path: string;
  line: number;
  end_line: number;
  severity: string;
  message: string;
};
export type Sast = {
  /** Null when the scan did not run. */
  status: "completed" | "partial" | "failed" | "timed_out" | null;
  results: SastResult[];
};
export type ReviewDetail = {
  review: Review;
  summary: string | null;
  findings: Finding[];
  /** Empty for reviews stored before patches were kept. */
  files?: ReviewFile[];
  /** Absent from APIs older than static analysis. */
  sast?: Sast;
};

export type NameCount = { name: string; count: number };
/** Totals for the last `days` days. */
export type Stats = {
  days: number;
  reviews: number;
  succeeded: number;
  failed: number;
  in_progress: number;
  pull_requests: number;
  repositories: number;
  /** From queue to result, for succeeded reviews. */
  median_duration_secs: number | null;
  findings: number;
  published: number;
  severity: NameCount[];
  categories: NameCount[];
  /** One entry per UTC day, oldest first. */
  daily: { date: string; reviews: number; failed: number }[];
  /** Reviews with a picked agent, most used first. */
  agents: AgentUsage[];
};
export type AgentUsage = {
  name: string;
  reviews: number;
  succeeded: number;
  failed: number;
  median_agent_secs: number | null;
  /** Reviews that reported token usage. Token sums cover only these. */
  usage_reviews: number;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  models: string[];
};
export type OpenPull = {
  repo_full_name: string;
  number: number;
  title: string;
  draft: boolean;
  author: string | null;
  author_id: number | null;
  comments: number;
  created_at: string;
  updated_at: string;
  review: {
    id: string;
    status: ReviewStatus;
    head_sha: string;
    finding_count: number;
    created_at: string;
  } | null;
};
export type OpenPulls = { truncated: boolean; pulls: OpenPull[] };
/** Live pull request details from GitHub. */
export type PullDetail = {
  state: "open" | "closed" | "merged";
  draft: boolean;
  author: string | null;
  author_id: number | null;
  base_ref: string;
  head_ref: string;
  additions: number;
  deletions: number;
  changed_files: number;
  commits: number;
  created_at: string;
};

export type DependencyAlert = {
  number: number;
  dependency: {
    package: { ecosystem: string; name: string };
    manifest_path: string;
    scope: string | null;
  };
  security_advisory: {
    ghsa_id: string;
    cve_id: string | null;
    summary: string;
    epss?: { percentage: number | null } | null;
  };
  security_vulnerability: {
    severity: string;
    vulnerable_version_range: string;
    first_patched_version: { identifier: string } | null;
  };
};
export type CoverageStatus =
  | "readable"
  | "access_denied"
  | "unavailable"
  | "rate_limited"
  | "timed_out"
  | "failed";
export type RepositoryAlerts = {
  repo_full_name: string;
  alerts: DependencyAlert[] | null;
  coverage: CoverageStatus;
  checked_at: string;
  last_success_at: string | null;
};
export type VulnerabilityReport = {
  total_repositories: number;
  next_page: number | null;
  repositories: RepositoryAlerts[];
};
