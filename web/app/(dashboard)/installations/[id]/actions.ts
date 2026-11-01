"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { validInstallationId } from "@/lib/format";
import type { Agents, Installation } from "@/lib/types";

export async function saveSettings(id: string, form: FormData): Promise<never> {
  if (!validInstallationId(id)) notFound();
  const target = `/installations/${id}`;
  function failure(code: string): never {
    redirect(`${target}?error=${code}`);
  }
  try {
    const installation = await api<Installation>(`/api/v1/installations/${id}`);
    if (!installation.can_admin) failure("forbidden");
    const agents = await api<Agents>("/api/v1/agents");
    const agent = form.get("agent");
    const model = form.get("model");
    if (typeof agent !== "string" || !agents.agents.includes(agent))
      failure("agent");
    if (typeof model !== "string") failure("model");
    await api<Installation>(`/api/v1/installations/${id}/settings`, {
      method: "PATCH",
      body: {
        enabled: form.get("enabled") === "on",
        agent,
        model: model.trim() || null,
      },
    });
    revalidatePath(target);
    redirect(`${target}?saved=1`);
  } catch (error) {
    if (error instanceof ApiError)
      failure(
        error.status === 403
          ? "forbidden"
          : error.status === 422
            ? "validation"
            : "api",
      );
    throw error;
  }
}
