import type { Stats } from "@/lib/types";
import { cn } from "@/lib/utils";

const dayLabel = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function label(date: string) {
  return dayLabel.format(new Date(`${date}T00:00:00Z`));
}

/** Smallest of 1, 2, 5 × 10ⁿ that is at least `value`, for a clean top tick. */
function niceMax(value: number) {
  if (value <= 1) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 5, 10].map((m) => m * power).find((m) => m >= value) ?? value;
}

/**
 * Reviews per UTC day as columns. The red part of a column is failed reviews.
 * Hover shows the numbers; the table below the chart has every value.
 */
export function ActivityChart({ daily }: { daily: Stats["daily"] }) {
  const max = niceMax(Math.max(0, ...daily.map((d) => d.reviews)));
  const active = daily.filter((d) => d.reviews > 0);
  return (
    <figure className="space-y-3">
      <div className="flex gap-2">
        <div
          aria-hidden="true"
          className="flex h-32 flex-col justify-between text-right text-xs tabular-nums text-muted-foreground"
        >
          <span className="-translate-y-1/2">{max}</span>
          <span className="translate-y-1/2">0</span>
        </div>
        <div aria-hidden="true" className="relative min-w-0 flex-1">
          <div className="absolute inset-x-0 top-0 border-t" />
          <div className="flex h-32 items-end gap-0.5 border-b">
            {daily.map((day, index) => {
              const ok = day.reviews - day.failed;
              const edge =
                index < 4 ? "start" : index > daily.length - 5 ? "end" : "mid";
              return (
                <div
                  key={day.date}
                  className="group relative flex h-full max-w-6 flex-1 flex-col justify-end gap-0.5"
                >
                  {day.failed > 0 && (
                    <div
                      className={cn(
                        "bg-red-600 dark:bg-red-500",
                        "rounded-t-[4px]",
                      )}
                      style={{ height: `${(day.failed / max) * 100}%` }}
                    />
                  )}
                  {ok > 0 && (
                    <div
                      className={cn(
                        "bg-neutral-400 transition-colors group-hover:bg-neutral-500 dark:group-hover:bg-neutral-300",
                        day.failed === 0 && "rounded-t-[4px]",
                      )}
                      style={{ height: `${(ok / max) * 100}%` }}
                    />
                  )}
                  <div
                    className={cn(
                      "pointer-events-none invisible absolute bottom-full z-10 mb-1.5 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md/5 group-hover:visible",
                      edge === "start" && "left-0",
                      edge === "end" && "right-0",
                      edge === "mid" && "left-1/2 -translate-x-1/2",
                    )}
                  >
                    <span className="font-semibold tabular-nums">
                      {day.reviews}
                    </span>{" "}
                    {day.reviews === 1 ? "review" : "reviews"}
                    {day.failed > 0 && (
                      <>
                        ,{" "}
                        <span className="font-semibold tabular-nums">
                          {day.failed}
                        </span>{" "}
                        failed
                      </>
                    )}
                    <span className="block text-muted-foreground">
                      {label(day.date)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
            <span>{daily.length > 0 && label(daily[0].date)}</span>
            <span>Today</span>
          </div>
        </div>
      </div>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-[2px] bg-neutral-400" />
          Reviews
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2.5 rounded-[2px] bg-red-600 dark:bg-red-500"
          />
          Failed reviews
        </span>
      </figcaption>
      {active.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No reviews in the last {daily.length} days.
        </p>
      ) : (
        <details className="text-sm">
          <summary className="w-fit cursor-pointer rounded-sm text-muted-foreground hover:text-foreground">
            Show as table
          </summary>
          <table className="mt-2 w-full max-w-sm text-left tabular-nums">
            <caption className="sr-only">
              Reviews per day. Days without reviews are left out.
            </caption>
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th scope="col" className="py-1.5 font-medium">
                  Day (UTC)
                </th>
                <th scope="col" className="py-1.5 text-right font-medium">
                  Reviews
                </th>
                <th scope="col" className="py-1.5 text-right font-medium">
                  Failed
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {active.map((day) => (
                <tr key={day.date}>
                  <th scope="row" className="py-1.5 font-normal">
                    {label(day.date)}
                  </th>
                  <td className="py-1.5 text-right">{day.reviews}</td>
                  <td className="py-1.5 text-right">{day.failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </figure>
  );
}
