import { severityColor } from "@/components/status-badge";
import { SEVERITIES, type Stats } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Findings by severity and the most common categories. */
export function FindingsBreakdown({ stats }: { stats: Stats }) {
  if (stats.findings === 0)
    return (
      <p className="text-sm text-muted-foreground">
        {stats.reviews === 0
          ? `No reviews in the last ${stats.days} days.`
          : `No findings in the last ${stats.days} days.`}
      </p>
    );
  const counts = new Map(stats.severity.map((s) => [s.name, s.count]));
  const top = Math.max(...stats.severity.map((s) => s.count));
  return (
    <div className="space-y-5">
      <table className="w-full text-sm">
        <caption className="sr-only">Findings by severity</caption>
        <tbody>
          {SEVERITIES.map((severity) => {
            const count = counts.get(severity) ?? 0;
            return (
              <tr key={severity}>
                <th
                  scope="row"
                  className="w-20 py-1 text-left font-normal capitalize text-muted-foreground"
                >
                  {severity}
                </th>
                <td className="py-1">
                  <div aria-hidden="true" className="h-2">
                    {count > 0 && (
                      <div
                        className={cn("h-full rounded-e-[4px]", severityColor[severity])}
                        style={{ width: `${Math.max((count / top) * 100, 4)}%` }}
                      />
                    )}
                  </div>
                </td>
                <td className="w-10 py-1 text-right tabular-nums">{count}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {stats.categories.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-muted-foreground">
            Top categories
          </h3>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {stats.categories.map((category) => (
              <li
                key={category.name}
                className="flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs"
              >
                <span className="capitalize">{category.name}</span>
                <span className="tabular-nums text-muted-foreground">
                  {category.count}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
