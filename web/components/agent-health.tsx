import { TimeAgo } from "@/components/time-ago";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCount, formatSeconds } from "@/lib/format";
import type { AgentHealth, AgentUsage, Agents } from "@/lib/types";

/** Enabled agents first, then agents that only appear in review history. */
export function agentRows(agents: Agents | null, usage: AgentUsage[]) {
  const names = [
    ...(agents?.agents ?? []),
    ...usage.map((u) => u.name).filter((n) => !agents?.agents.includes(n)),
  ];
  return names.map((name) => ({
    name,
    enabled: agents?.agents.includes(name) ?? null,
    health: agents?.health?.[name] ?? null,
    usage: usage.find((u) => u.name === name) ?? null,
  }));
}

function Harness({
  enabled,
  health,
}: {
  enabled: boolean | null;
  health: AgentHealth | null;
}) {
  if (enabled === false) return <Badge variant="secondary">Not enabled</Badge>;
  if (!health)
    return (
      <Badge variant="outline">{enabled === null ? "Unknown" : "Not checked"}</Badge>
    );
  return (
    <div className="flex flex-col items-start gap-1">
      <Badge variant={health.available ? "success" : "error"}>
        {health.available ? "Available" : "Unavailable"}
      </Badge>
      <span className="text-xs text-muted-foreground">
        Checked <TimeAgo value={health.checked_at} />
      </span>
    </div>
  );
}

export function AgentHealthTable({
  agents,
  usage,
  days,
}: {
  agents: Agents | null;
  usage: AgentUsage[];
  days: number;
}) {
  const rows = agentRows(agents, usage);
  if (rows.length === 0)
    return (
      <p className="p-4 text-sm text-muted-foreground">
        No agents are enabled on this server.
      </p>
    );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Agent</TableHead>
          <TableHead>Harness</TableHead>
          <TableHead>Reviews, {days} days</TableHead>
          <TableHead>Median agent time</TableHead>
          <TableHead>Tokens</TableHead>
          <TableHead>Models</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ name, enabled, health, usage }) => (
          <TableRow key={name}>
            <TableCell className="font-mono text-xs">
              {name}
              {agents?.default === name && (
                <span className="ms-2 font-sans text-muted-foreground">
                  default
                </span>
              )}
            </TableCell>
            <TableCell>
              <Harness enabled={enabled} health={health} />
            </TableCell>
            <TableCell className="tabular-nums">
              {usage ? (
                <>
                  {usage.reviews}
                  <span className="block text-xs text-muted-foreground">
                    {usage.succeeded} succeeded · {usage.failed} failed
                  </span>
                </>
              ) : (
                "0"
              )}
            </TableCell>
            <TableCell className="font-mono text-xs tabular-nums">
              {formatSeconds(usage?.median_agent_secs ?? null) ?? "–"}
            </TableCell>
            <TableCell className="text-xs tabular-nums">
              {usage && usage.usage_reviews > 0 ? (
                <>
                  <span className="font-mono">
                    {formatCount(usage.input_tokens)} in ·{" "}
                    {formatCount(usage.output_tokens)} out
                  </span>
                  <span className="block text-muted-foreground">
                    {formatCount(usage.cached_input_tokens)} cached · from{" "}
                    {usage.usage_reviews} of {usage.reviews}{" "}
                    {usage.reviews === 1 ? "review" : "reviews"}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">Not reported</span>
              )}
            </TableCell>
            <TableCell className="max-w-56 whitespace-normal break-words font-mono text-xs">
              {usage?.models.length ? usage.models.join(", ") : "–"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
