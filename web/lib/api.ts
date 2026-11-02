import "server-only";
import { notFound, redirect } from "next/navigation";
import { apiRequest, ApiError } from "./api-client";
import { requireAccessToken } from "./auth";
import { getEnv } from "./env";

export async function api<T>(
  path: string,
  options?: { method?: "GET" | "PATCH"; body?: unknown },
): Promise<T> {
  const token = await requireAccessToken();
  try {
    return await apiRequest<T>(getEnv().apiUrl, token, path, options);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      redirect("/?auth=expired");
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}

/**
 * For data that a page can show without, such as live GitHub data. Returns
 * null on any API error, including 404. An expired session still redirects.
 */
export async function optionalApi<T>(path: string): Promise<T | null> {
  const token = await requireAccessToken();
  try {
    return await apiRequest<T>(getEnv().apiUrl, token, path);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      redirect("/?auth=expired");
    if (error instanceof ApiError) return null;
    throw error;
  }
}
