import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { ReviewStatus, Severity } from "@/lib/types";

const variants: Record<ReviewStatus | Severity, BadgeProps["variant"]> = {
  queued: "secondary",
  running: "info",
  succeeded: "success",
  failed: "error",
  cancelled: "outline",
  skipped: "outline",
  critical: "error",
  high: "error",
  medium: "warning",
  low: "secondary",
  info: "info",
};

export function StatusBadge({ value }: { value: ReviewStatus | Severity }) {
  return (
    <Badge variant={variants[value]} className="capitalize">
      {value}
    </Badge>
  );
}

/** Mark color for each severity. Always show the severity name next to it. */
export const severityColor: Record<Severity, string> = {
  critical: "bg-destructive",
  high: "bg-destructive/70",
  medium: "bg-warning",
  low: "bg-info",
  info: "bg-muted-foreground/50",
};
