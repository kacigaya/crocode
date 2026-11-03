"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { validReviewId } from "@/lib/format";
import type { Review } from "@/lib/types";

async function control(id: string, command: "retry" | "cancel"): Promise<never> {
  if (!validReviewId(id)) notFound();
  const target = `/reviews/${id}`;
  try {
    await api<Review>(`/api/v1/reviews/${id}/${command}`, { method: "POST" });
  } catch (error) {
    if (error instanceof ApiError)
      redirect(
        `${target}?error=${error.status === 403 ? "forbidden" : error.status === 409 ? "conflict" : "api"}`,
      );
    throw error;
  }
  revalidatePath(target);
  redirect(`${target}?done=${command}`);
}

export async function retryReview(id: string): Promise<never> {
  return control(id, "retry");
}

export async function cancelReview(id: string): Promise<never> {
  return control(id, "cancel");
}
