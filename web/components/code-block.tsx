"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export function CodeBlock({ code, label }: { code: string; label: string }) {
  const [status, setStatus] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, []);

  async function copy() {
    let message: string;
    try {
      await navigator.clipboard.writeText(code);
      message = "Copied";
    } catch {
      message = "Copy failed";
    }
    if (!mounted.current) return;
    setStatus(message);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus(""), 1500);
  }

  return (
    <div className="docs-code my-5 min-w-0 overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-3 border-b bg-muted px-4 py-2">
        <span className="min-w-0 break-all font-mono text-xs text-foreground">{label}</span>
        <div className="flex shrink-0 items-center gap-2">
          <span role="status" className="text-xs text-foreground">{status}</span>
          <Button variant="ghost" size="icon-sm" aria-label={`Copy ${label}`} onClick={copy}>
            {status === "Copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          </Button>
        </div>
      </div>
      <pre role="region" tabIndex={0} aria-label={label} className="overflow-x-auto p-4 text-[0.8125rem] leading-7 sm:p-5">
        <code>{code}</code>
      </pre>
    </div>
  );
}
