"use client";

import { useActionState, useEffect, useRef } from "react";
import { prepareManifest, type SetupState } from "@/app/setup/actions";
import { GitHubMark } from "@/components/github-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const fields = [
  {
    name: "token",
    label: "Setup token",
    description: "Printed in the dashboard logs at startup.",
    type: "password",
    autoComplete: "off",
    required: true,
  },
  {
    name: "url",
    label: "Public address",
    description: "Where GitHub and your users reach CroCode. Use HTTPS in production.",
    type: "url",
    autoComplete: "url",
    required: true,
  },
  {
    name: "name",
    label: "App name",
    description: "Must be unique on GitHub. You can rename the app later.",
    type: "text",
    autoComplete: "off",
    required: true,
  },
  {
    name: "owner",
    label: "Organization (optional)",
    description: "Leave empty to create the app on your personal account.",
    type: "text",
    autoComplete: "off",
    required: false,
  },
] as const;

export function SetupForm({
  defaults,
}: {
  defaults: { token: string; url: string; name: string; owner: string };
}) {
  const [state, action, pending] = useActionState<SetupState, FormData>(
    prepareManifest,
    { status: "idle" },
  );
  const form = useRef<HTMLFormElement>(null);
  const github = useRef<HTMLFormElement>(null);
  // GitHub only accepts the manifest as a form POST from the browser.
  useEffect(() => {
    if (state.status === "ready") github.current?.submit();
    if (state.status === "error" && state.field) {
      const input = form.current?.elements.namedItem(state.field);
      if (input instanceof HTMLInputElement) input.focus();
    }
  }, [state]);

  return (
    <>
      <form ref={form} action={action} aria-busy={pending} className="mt-8 grid gap-5">
        {fields.map((field) => (
          <div key={field.name} className="grid gap-1.5">
            <label htmlFor={field.name} className="text-sm font-medium">
              {field.label}
            </label>
            <Input
              id={field.name}
              name={field.name}
              type={field.type}
              autoComplete={field.autoComplete}
              required={field.required}
              defaultValue={defaults[field.name]}
              aria-invalid={(state.status === "error" && state.field === field.name) || undefined}
              aria-describedby={`${field.name}-description${state.status === "error" && state.field === field.name ? " setup-error" : ""}`}
              spellCheck={false}
            />
            <p
              id={`${field.name}-description`}
              className="text-xs text-muted-foreground"
            >
              {field.description}
            </p>
          </div>
        ))}
        <p id="setup-error" role="alert" className="min-h-5 text-sm text-destructive-foreground">
          {state.status === "error" ? state.message : null}
        </p>
        <Button size="lg" type="submit" loading={pending}>
          <GitHubMark className="size-4" />
          Create the GitHub App
        </Button>
      </form>
      {state.status === "ready" && (
        <form ref={github} action={state.action} method="post" className="mt-4 text-center">
          <input type="hidden" name="manifest" value={state.manifest} />
          <p role="status" className="text-sm text-muted-foreground">
            Opening GitHub…{" "}
            <button type="submit" className="underline underline-offset-4">
              Continue manually
            </button>
          </p>
        </form>
      )}
    </>
  );
}
