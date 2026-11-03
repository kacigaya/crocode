import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { TimeAgo } from "@/components/time-ago";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Review } from "@/lib/types";

/** Review runs, newest first. Each row opens its review. */
export function ReviewsTable({ reviews }: { reviews: Review[] }) {
  return (
    <Table aria-label="Reviews">
      <TableCaption className="sr-only">
        Reviews, newest first. Times are in UTC.
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead className="ps-4">Pull request</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden text-right sm:table-cell">Findings</TableHead>
          <TableHead className="hidden pe-4 sm:table-cell">Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {reviews.map((review) => (
          <TableRow key={review.id} className="cursor-pointer">
            <TableCell className="max-w-48 py-3 ps-4 sm:max-w-md">
              <Link
                href={`/reviews/${review.id}`}
                className="block truncate rounded-sm font-medium leading-5 after:absolute after:inset-0"
              >
                {review.pr_title}
              </Link>
              <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                {review.repo_full_name}#{review.pr_number} ·{" "}
                {review.head_sha.slice(0, 7)}
                <span className="sm:hidden">
                  {" · "}
                  <TimeAgo value={review.created_at} />
                </span>
              </p>
            </TableCell>
            <TableCell className="py-3">
              <StatusBadge value={review.status} />
            </TableCell>
            <TableCell className="hidden py-3 text-right tabular-nums sm:table-cell">
              {review.finding_count}
            </TableCell>
            <TableCell className="hidden py-3 pe-4 text-xs text-muted-foreground sm:table-cell">
              <TimeAgo value={review.created_at} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
