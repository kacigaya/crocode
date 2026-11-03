"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { saveSettings } from "@/app/(dashboard)/installations/[id]/actions";
import {
  Autocomplete,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
} from "@/components/ui/autocomplete";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { formatTime } from "@/lib/format";
import { DEFAULT_AGENT, type Agents, type Installation } from "@/lib/types";

type ModelItem = { value: string; label: string; name: string };

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

  const [agent, setAgent] = useState(saved);
  const [model, setModel] = useState(installation.settings.model ?? "");
  const digest = installation.digest;
  const [digestOn, setDigestOn] = useState(digest.enabled);
  const effective = agent === DEFAULT_AGENT ? agents.default : agent;
  const models: ModelItem[] = (agents.models[effective] ?? []).map((m) => ({
    value: m.id,
    label: m.id,
    name: m.name,
  }));

  function changeAgent(next: string) {
    setAgent(next);
    const nextAgent = next === DEFAULT_AGENT ? agents.default : next;
    // A model name belongs to one agent CLI. Keep it only when the new agent lists it.
    if (!(agents.models[nextAgent] ?? []).some((m) => m.id === model.trim()))
      setModel("");
  }

  return (
    <Card render={<form action={action} />}>
      <CardHeader className="border-b">
        <CardTitle render={<h2 />} className="text-base">
          Review settings
        </CardTitle>
        <CardDescription>
          {disabled
            ? "Read only. An account owner or organization admin can change these settings."
            : "These settings apply to every repository in this installation."}
        </CardDescription>
      </CardHeader>
      <CardPanel>
        <fieldset disabled={disabled} className="grid gap-6">
          <legend className="sr-only">Review settings</legend>
          <div className="flex items-start justify-between gap-4">
            <div>
              <label htmlFor="enabled" className="text-sm font-medium">
                Enable reviews
              </label>
              <p
                id="enabled-hint"
                className="mt-0.5 text-xs text-muted-foreground"
              >
                Review new pull requests and each new push to them.
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
          <div className="grid gap-2">
            <label htmlFor="agent" className="text-sm font-medium">
              Agent
            </label>
            <Select
              name="agent"
              items={items}
              value={agent}
              onValueChange={(value) => value !== null && changeAgent(value)}
              disabled={disabled}
              required
            >
              <SelectTrigger id="agent" aria-describedby="agent-hint">
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
            <p id="agent-hint" className="text-xs text-muted-foreground">
              The agent CLI that reviews pull requests. The server default
              follows the CroCode server configuration.
            </p>
            {unavailable && agent === saved && (
              <p className="text-sm text-warning-foreground">
                The saved agent is unavailable. Select an available agent before
                saving.
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <label htmlFor="model" className="text-sm font-medium">
              Model
            </label>
            <Autocomplete
              items={models}
              value={model}
              onValueChange={setModel}
              openOnInputClick
              disabled={disabled}
            >
              <AutocompleteInput
                id="model"
                name="model"
                placeholder={`${effective} default`}
                aria-describedby="model-hint"
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                showTrigger={models.length > 0}
                showClear={model !== ""}
              />
              <AutocompletePopup>
                <AutocompleteEmpty>
                  No detected model matches. CroCode uses the name you typed.
                </AutocompleteEmpty>
                <AutocompleteList>
                  {(item: ModelItem) => (
                    <AutocompleteItem key={item.value} value={item}>
                      <span className="font-mono">{item.value}</span>
                      {item.name !== item.value && (
                        <span className="ms-auto ps-3 text-xs text-muted-foreground">
                          {item.name}
                        </span>
                      )}
                    </AutocompleteItem>
                  )}
                </AutocompleteList>
              </AutocompletePopup>
            </Autocomplete>
            <p id="model-hint" className="text-xs text-muted-foreground">
              {models.length > 0
                ? `${models.length} ${models.length === 1 ? "model" : "models"} detected for ${effective}. You can also type another model name. Leave empty to use the agent default.`
                : `No models detected for ${effective} yet. The worker checks at start and every 6 hours. Type a model name, or leave empty to use the agent default.`}
            </p>
          </div>
        </fieldset>
        <fieldset
          disabled={disabled}
          aria-describedby="digest-hint"
          className="mt-6 grid gap-4 border-t pt-6"
        >
          <legend className="sr-only">Weekly security digest</legend>
          <div className="flex items-start justify-between gap-4">
            <div>
              <label htmlFor="digest" className="text-sm font-medium">
                Weekly security digest
              </label>
              <p
                id="digest-hint"
                className="mt-0.5 text-xs text-muted-foreground"
              >
                Every 7 days, CroCode posts new Dependabot alerts, fixed
                alerts, and open alerts past their deadline to a chat webhook.
                The message leaves GitHub. It names repositories, packages,
                and advisories.
              </p>
            </div>
            <Switch
              id="digest"
              name="digest"
              value="on"
              checked={digestOn}
              onCheckedChange={setDigestOn}
              disabled={disabled}
              aria-describedby="digest-hint"
            />
          </div>
          {digest.enabled && (
            <p role="status" className="text-sm">
              Sends to{" "}
              <span className="font-mono text-xs">{digest.webhook_host}</span>.{" "}
              {digest.sent_at
                ? `Last sent ${formatTime(digest.sent_at)}.`
                : "Not sent yet. The first digest goes out within about 10 minutes."}
              {digest.error && (
                <span className="mt-1 block text-destructive-foreground">
                  Last attempt failed: {digest.error}. CroCode tries again
                  every hour.
                </span>
              )}
            </p>
          )}
          {digestOn && (
            <div className="grid gap-2">
              <label htmlFor="digest_webhook_url" className="text-sm font-medium">
                {digest.enabled ? "New webhook URL" : "Webhook URL"}
              </label>
              <Input
                id="digest_webhook_url"
                name="digest_webhook_url"
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                required={!digest.enabled}
                placeholder="https://hooks.slack.com/services/…"
                aria-describedby="digest-url-hint"
                className="font-mono"
              />
              <p id="digest-url-hint" className="text-xs text-muted-foreground">
                {digest.enabled
                  ? "Leave empty to keep the current URL. "
                  : ""}
                Use an HTTPS Slack or Mattermost incoming webhook, or a
                Discord webhook URL that ends in /slack. CroCode stores the URL
                as a secret and never shows it again.
              </p>
            </div>
          )}
        </fieldset>
      </CardPanel>
      <CardFooter className="gap-3 border-t">
        <SaveButton disabled={disabled || agents.agents.length === 0} />
        {agents.agents.length === 0 && (
          <p className="text-sm">No agents are available on this server.</p>
        )}
      </CardFooter>
    </Card>
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
