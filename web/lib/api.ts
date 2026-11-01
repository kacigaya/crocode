import "server-only";
import { notFound, redirect } from "next/navigation";
import { apiRequest, ApiError } from "./api-client";
import { requireSession } from "./auth";
import { getEnv } from "./env";

export async function api<T>(path: string, options?: { method?: 'GET' | 'PATCH'; body?: unknown }): Promise<T> {
  const session = await requireSession();
  try { return await apiRequest<T>(getEnv().apiUrl, session.token, path, options); }
  catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/api/auth/login');
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}
