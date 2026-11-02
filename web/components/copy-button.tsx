"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/** Icon button that copies `value` and announces the result. */
export function CopyButton({ value, label }: { value: string; label: string }) {
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

  return (
    <span className="inline-flex shrink-0 items-center gap-2">
      <span role="status" className="text-xs text-foreground">{status}</span>
      <Button variant="ghost" size="icon-sm" aria-label={`Copy ${label}`} onClick={copy}>
        {status === "Copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </Button>
    </span>
  );
}
