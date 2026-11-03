import { formatRelative, formatTime } from "@/lib/format";

/** Relative time with the exact UTC time on hover. */
export function TimeAgo({ value }: { value: string }) {
  return (
    <time dateTime={value} title={formatTime(value)} aria-label={formatTime(value)}>
      {formatRelative(value)}
    </time>
  );
}
