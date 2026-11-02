import { ChevronRight } from "lucide-react";
import Link from "next/link";

export type Crumb = { label: string; href?: string };

export function PageHeader({
  crumbs,
  title,
  description,
  leading,
  meta,
  actions,
}: {
  crumbs?: Crumb[];
  title: React.ReactNode;
  description?: React.ReactNode;
  leading?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
            {crumbs.map((crumb, index) => (
              <li key={index} className="flex min-w-0 items-center gap-1">
                {index > 0 && (
                  <ChevronRight aria-hidden="true" className="size-3.5" />
                )}
                {crumb.href ? (
                  <Link
                    href={crumb.href}
                    className="truncate rounded-sm hover:text-foreground"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span
                    aria-current="page"
                    className="truncate text-foreground"
                  >
                    {crumb.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          {leading}
          <div className="min-w-0">
            <h1 className="text-balance break-words text-2xl font-semibold">
              {title}
            </h1>
            {description && (
              <p className="mt-1 text-pretty text-sm text-muted-foreground">
                {description}
              </p>
            )}
            {meta && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {meta}
              </div>
            )}
          </div>
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function StatGrid({
  label,
  stats,
}: {
  label: string;
  stats: { label: string; value: React.ReactNode; hint?: string }[];
}) {
  return (
    <section aria-label={label}>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border bg-card p-4">
            <dt className="text-xs font-medium text-muted-foreground">
              {stat.label}
            </dt>
            <dd className="mt-1.5 text-2xl font-semibold tabular-nums">
              {stat.value}
            </dd>
            {stat.hint && (
              <dd className="mt-1 text-xs text-muted-foreground">
                {stat.hint}
              </dd>
            )}
          </div>
        ))}
      </dl>
    </section>
  );
}
