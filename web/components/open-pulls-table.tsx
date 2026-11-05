import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { Avatar } from "@/components/brand";
import { StatusBadge } from "@/components/status-badge";
import { TimeAgo } from "@/components/time-ago";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { accountAvatar } from "@/lib/avatar";
import type { OpenPull } from "@/lib/types";

/** Open pull requests with the state of their newest CroCode review. */
export function OpenPullsTable({
  pulls,
  webUrl,
}: {
  pulls: OpenPull[];
  webUrl: string;
}) {
  return (
    <Table aria-label="Open pull requests">
      <TableHeader>
        <TableRow>
          <TableHead className="ps-4 sm:ps-5">Pull request</TableHead>
          <TableHead>CroCode review</TableHead>
          <TableHead className="hidden pe-4 sm:pe-5 sm:table-cell">Updated</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {pulls.map((pull) => (
          <TableRow key={`${pull.repo_full_name}#${pull.number}`}>
            <TableCell className="max-w-72 py-3 ps-4 sm:ps-5 whitespace-normal sm:max-w-md">
              <a
                href={`${webUrl}/${pull.repo_full_name}/pull/${pull.number}`}
                className="group inline-flex max-w-full items-center gap-1.5 rounded-sm font-medium leading-5 hover:underline"
              >
                <span className="truncate">{pull.title}</span>
                <ExternalLink
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
                <span className="sr-only">(opens GitHub)</span>
              </a>
              <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                {pull.author && (
                  <span className="contents" title={pull.author}>
                    <Avatar
                      name={pull.author}
                      image={pull.author_id ? accountAvatar(pull.author_id) : null}
                    />
                  </span>
                )}
                <span className="truncate font-mono">
                  {pull.repo_full_name}#{pull.number}
                  {pull.author && ` · ${pull.author}`}
                </span>
                {pull.draft && <Badge variant="outline">Draft</Badge>}
              </div>
            </TableCell>
            <TableCell className="py-3">
              {pull.review ? (
                <Link
                  href={`/reviews/${pull.review.id}`}
                  className="inline-flex items-center gap-2 rounded-sm hover:underline"
                >
                  <StatusBadge value={pull.review.status} />
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {pull.review.finding_count}{" "}
                    {pull.review.finding_count === 1 ? "finding" : "findings"}
                  </span>
                  <span className="sr-only">, open review</span>
                </Link>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Not reviewed
                </span>
              )}
            </TableCell>
            <TableCell className="hidden py-3 pe-4 sm:pe-5 text-xs text-muted-foreground sm:table-cell">
              <TimeAgo value={pull.updated_at} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
