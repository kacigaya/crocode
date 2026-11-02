"use client";

import { useFormStatus } from "react-dom";
import { saveSettings } from "@/app/(dashboard)/installations/[id]/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_AGENT, type Agents, type Installation } from "@/lib/types";

export function SettingsForm({
  installation,
  agents,
}: {
  installation: Installation;
  agents: Agents;
}) {
  const action = saveSettings.bind(null, String(installation.id));
  const disabled = !installation.can_admin;
  // "default" stores null, so the installation follows the server default.
  const items = [
    { value: DEFAULT_AGENT, label: `Server default (${agents.default})` },
    ...agents.agents.map((value) => ({ label: value, value })),
  ];
  const saved = installation.settings.agent ?? DEFAULT_AGENT;
  const unavailable = saved !== DEFAULT_AGENT && !agents.agents.includes(saved);
  if (unavailable)
    items.push({ value: saved, label: `${saved} (unavailable)` });
  return (
    <form action={action} className="rounded-xl border bg-card">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Review settings</h2>
      </div>
      <div className="p-4">
        {!installation.can_admin && (
          <p id="read-only" className="mb-4 text-sm text-muted-foreground">
            Read only. An account owner or organization admin can change these
            settings.
          </p>
        )}
        <fieldset
          disabled={disabled}
          aria-describedby={!installation.can_admin ? "read-only" : undefined}
          className="grid gap-5"
        >
          <legend className="sr-only">Review settings</legend>
          <div className="flex items-center justify-between gap-4">
            <div>
              <label htmlFor="enabled" className="text-sm font-medium">
                Enable reviews
              </label>
              <p
                id="enabled-hint"
                className="mt-0.5 text-xs text-muted-foreground"
              >
                Review new pull requests and updates.
              </p>
            </div>
            <Switch
              id="enabled"
              name="enabled"
              value="on"
              defaultChecked={installation.settings.enabled}
              disabled={disabled}
              aria-describedby="enabled-hint"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="agent" className="block text-sm font-medium">
              Agent
            </label>
            <Select
              name="agent"
              items={items}
              defaultValue={saved}
              disabled={disabled}
              required
            >
              <SelectTrigger id="agent">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {items.map((item) => (
                  <SelectItem
                    key={item.value}
                    value={item.value}
                    disabled={
                      item.value !== DEFAULT_AGENT &&
                      !agents.agents.includes(item.value)
                    }
                  >
                    {item.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            {unavailable && (
              <p className="text-sm text-warning-foreground">
                The saved agent is unavailable. Select an available agent before
                saving.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <label htmlFor="model" className="block text-sm font-medium">
              Model
            </label>
            <Input
              id="model"
              name="model"
              defaultValue={installation.settings.model ?? ""}
              placeholder="Agent default"
              aria-describedby="model-hint"
            />
            <p id="model-hint" className="text-xs text-muted-foreground">
              Leave empty to use the agent default.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <SaveButton disabled={disabled || agents.agents.length === 0} />
            {agents.agents.length === 0 && (
              <p className="text-sm">No agents are available on this server.</p>
            )}
          </div>
        </fieldset>
      </div>
    </form>
  );
}

function SaveButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={disabled || pending} loading={pending}>
      Save settings
    </Button>
  );
}
