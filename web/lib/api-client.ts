export class ApiError extends Error {
  constructor(public readonly status: number) {
    super(
      status === 401
        ? "Your session has expired. Sign in again."
        : status === 403
          ? "You do not have access to this resource."
          : status === 404
            ? "This resource was not found."
            : status === 409
              ? "The review changed state. Reload the page and try again."
              : status === 422
                ? "The API did not accept these settings. Check the agent, model, and webhook URL."
                : status === 0
                ? "Cannot connect to the CroCode API. Try again."
                : "The CroCode API could not complete this request. Try again.",
    );
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(
  baseUrl: string,
  token: string,
  path: string,
  options: { method?: "GET" | "PATCH" | "POST"; body?: unknown } = {},
  fetcher: typeof fetch = fetch,
): Promise<T> {
  if (
    !path.startsWith("/api/v1/") ||
    path.includes("..") ||
    path.includes("\\") ||
    path.includes("#")
  )
    throw new Error("Invalid API path");
  let response: Response;
  try {
    response = await fetcher(`${baseUrl.replace(/\/$/, "")}${path}`, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(options.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ApiError(0);
  }
  if (!response.ok) throw new ApiError(response.status);
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError(502);
  }
}
