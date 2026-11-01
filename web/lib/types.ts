export type User = { id: number; login: string };
export type Agents = { agents: string[]; default: string };
export type Settings = {
  enabled: boolean;
  agent: string;
  model: string | null;
};
export type Installation = {
  id: number;
  account_login: string;
  account_type: string;
  repository_selection: string;
  suspended: boolean;
  created_at: string;
  settings: Settings;
  can_admin: boolean;
};
export type ReviewStatus =
  "queued" | "running" | "succeeded" | "failed" | "cancelled" | "skipped";
export type Review = {
  id: string;
  installation_id: number;
  repo_full_name: string;
  pr_number: number;
  pr_title: string;
  head_sha: string;
  status: ReviewStatus;
  agent: string;
  model: string | null;
  attempts: number;
  finding_count: number;
  error: string | null;
  created_at: string;
  finished_at: string | null;
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
export type ReviewDetail = {
  review: Review;
  summary: string | null;
  findings: Finding[];
};
