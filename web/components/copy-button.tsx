"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/** Copies `value` and holds the result message for 1.5 seconds. */
function useCopy(value: string) {
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
      await navigator.clipboard.writeText(value);
      message = "Copied";
    } catch {
      message = "Copy failed";
    }
    if (!mounted.current) return;
    setStatus(message);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus(""), 1500);
  }

  return { status, copy };
}

/** Icon button that copies `value` and announces the result. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const { status, copy } = useCopy(value);

  return (
    <span className="inline-flex shrink-0 items-center gap-2">
      <span role="status" className="text-xs text-foreground">{status}</span>
      <Button variant="ghost" size="icon-sm" aria-label={`Copy ${label}`} onClick={copy}>
        {status === "Copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </Button>
    </span>
  );
}

/** Copy button over the top-right corner of a code block. */
export function CodeCopyButton({ value, label }: { value: string; label: string }) {
  const { status, copy } = useCopy(value);

  return (
    <>
      <span
        role="status"
        className={
          status
            ? "absolute top-3 right-12 z-10 rounded-md border bg-background px-2 py-1 text-xs text-foreground shadow-sm"
            : "sr-only"
        }
      >
        {status}
      </span>
      <Button
        variant="outline"
        size="icon-xs"
        aria-label={`Copy ${label}`}
        onClick={copy}
        className="absolute top-3 right-3 z-10"
      >
        {status === "Copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </Button>
    </>
  );
}
