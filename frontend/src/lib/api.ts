export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export function errorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail
      .map(
        (item: { loc?: unknown[]; msg?: string }) =>
          `${item.loc?.filter((x) => x !== "body").join(".") || "Request"}: ${item.msg || "Invalid value"}`,
      )
      .join("; ");
  return fallback;
}
export async function api<T = void>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError(
      "Unable to reach Kazi. Check your connection and try again.",
      0,
    );
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    if (
      response.status === 401 &&
      ![
        "/auth/login",
        "/auth/register",
        "/auth/forgot-password",
        "/auth/reset-password",
      ].includes(path) &&
      typeof window !== "undefined"
    )
      window.location.assign("/login");
    throw new ApiError(
      errorMessage(
        payload,
        response.status >= 500
          ? "The Kazi API is unavailable. For local development, run npm run dev:backend from the project root in another terminal, keep it open, then try again."
          : `Request failed (${response.status}).`,
      ),
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export const json = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
export const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
