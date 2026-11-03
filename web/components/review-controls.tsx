"use client";

import { RotateCcw, Square } from "lucide-react";
import { useFormStatus } from "react-dom";
import {
  cancelReview,
  retryReview,
} from "@/app/(dashboard)/reviews/[id]/actions";
import { Button } from "@/components/ui/button";

/** Admin controls. The API checks access and state again. */
export function ReviewControls({
  id,
  retry,
  cancel,
}: {
  id: string;
  retry: boolean;
  cancel: boolean;
}) {
  return (
    <>
      {cancel && (
        <form action={cancelReview.bind(null, id)}>
          <Submit icon={<Square aria-hidden="true" />}>Cancel review</Submit>
        </form>
      )}
      {retry && (
        <form action={retryReview.bind(null, id)}>
          <Submit icon={<RotateCcw aria-hidden="true" />}>Retry review</Submit>
        </form>
      )}
    </>
  );
}

function Submit({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending} loading={pending}>
      {icon}
      {children}
    </Button>
  );
}
