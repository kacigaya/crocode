export function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return (
    new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(date) + " UTC"
  );
}

export function validInstallationId(value: string) {
  return /^[1-9]\d{0,19}$/.test(value);
}

export function validReviewId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function validCursor(value: string) {
  return (
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(
      value,
    ) && Number.isFinite(Date.parse(value))
  );
}

const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

/** "3 minutes ago" for recent times, otherwise the absolute UTC time. */
export function formatRelative(value: string, now = Date.now()) {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return value;
  const seconds = Math.round((time - now) / 1000);
  if (Math.abs(seconds) < 60) return "just now";
  if (Math.abs(seconds) >= 7 * 86_400) return formatTime(value);
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, size] of units)
    if (Math.abs(seconds) >= size)
      return format.format(Math.trunc(seconds / size), unit);
  return formatTime(value);
}

/** "2m 41s" between two times, or null when either is missing. */
export function formatDuration(start: string, end: string | null) {
  if (!end) return null;
  const seconds = Math.round((Date.parse(end) - Date.parse(start)) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
