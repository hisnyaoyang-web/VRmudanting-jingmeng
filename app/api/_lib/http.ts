export type ApiErrorCode =
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "CONFLICT"
  | "NOT_ELIGIBLE"
  | "RATE_LIMITED"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

export function apiJson<T>(data: T, status = 200, headers?: HeadersInit) {
  return Response.json(
    { ok: status < 400, data: status < 400 ? data : undefined, error: status >= 400 ? data : undefined },
    {
      status,
      headers: {
        "cache-control": "no-store",
        "x-api-version": "2026-07-25",
        ...headers,
      },
    },
  );
}

export function apiError(code: ApiErrorCode, message: string, status: number, details?: unknown) {
  return apiJson({ code, message, ...(details === undefined ? {} : { details }) }, status);
}

export async function readJson<T>(request: Request, maxBytes = 32_768): Promise<T> {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > maxBytes) throw new Error("PAYLOAD_TOO_LARGE");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error("PAYLOAD_TOO_LARGE");
  return JSON.parse(text) as T;
}
