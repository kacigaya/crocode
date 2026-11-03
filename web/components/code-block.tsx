import { CopyButton } from "@/components/copy-button";

export function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <div className="docs-code my-5 min-w-0 overflow-hidden rounded-2xl border bg-card">
      <div className="flex items-center justify-between gap-3 border-b bg-muted px-6 py-2">
        <span className="min-w-0 break-all font-mono text-xs text-foreground">{label}</span>
        <CopyButton value={code} label={label} />
      </div>
      <pre role="region" tabIndex={0} aria-label={label} className="overflow-x-auto p-6 text-sm leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}
