export default function Loading() {
  return (
    <div role="status" className="mx-auto max-w-6xl space-y-4 px-6 py-10">
      <p className="text-sm text-muted-foreground">Loading Crocode…</p>
      <div aria-hidden="true" className="h-8 w-48 rounded bg-muted" />
      <div aria-hidden="true" className="h-48 rounded-xl border bg-muted" />
    </div>
  );
}
