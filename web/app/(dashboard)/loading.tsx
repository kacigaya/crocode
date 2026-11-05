export default function Loading() {
  return (
    <div role="status" aria-busy="true" className="space-y-8">
      <span className="sr-only">Loading…</span>
      <div aria-hidden="true" className="space-y-3">
        <div className="h-4 w-32 rounded bg-muted" />
        <div className="h-7 w-56 rounded bg-muted" />
      </div>
      <div aria-hidden="true" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-2xl border bg-card shadow-xs/5" />
        ))}
      </div>
      <div aria-hidden="true" className="h-80 rounded-2xl border bg-card shadow-xs/5" />
    </div>
  );
}
