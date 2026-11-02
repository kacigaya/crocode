export default function Loading() {
  return (
    <div role="status" aria-busy="true" className="space-y-8">
      <span className="sr-only">Loading…</span>
      <div aria-hidden="true" className="space-y-3">
        <div className="h-4 w-32 rounded bg-muted" />
        <div className="h-7 w-56 rounded bg-muted" />
      </div>
      <div aria-hidden="true" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-xl border bg-card" />
        ))}
      </div>
      <div aria-hidden="true" className="h-80 rounded-xl border bg-card" />
    </div>
  );
}
