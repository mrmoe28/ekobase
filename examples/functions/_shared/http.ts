export type HandlerRequest = {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  query: unknown;
};

export type HandlerResponse = {
  statusCode: number;
  headers?: Record<string, string>;
  body: unknown;
};

export function json(statusCode: number, body: unknown): HandlerResponse {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body,
  };
}

export function badRequest(message: string): HandlerResponse {
  return json(400, { error: message });
}

export function unauthorized(message = "Authentication required"): HandlerResponse {
  return json(401, { error: message });
}

export function forbidden(message = "Forbidden"): HandlerResponse {
  return json(403, { error: message });
}

export function notFound(message = "Not found"): HandlerResponse {
  return json(404, { error: message });
}

export function serverError(message = "Internal server error", details?: string): HandlerResponse {
  return json(500, details ? { error: message, details } : { error: message });
}

export function bearerToken(headers: HandlerRequest["headers"]): string | null {
  const raw = headers.authorization ?? headers.Authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !value.toLowerCase().startsWith("bearer ")) return null;
  return value.slice("bearer ".length).trim();
}

export function requireObjectBody(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

export function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function dateOnly(value: unknown): string | null {
  const text = stringValue(value);
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return text;
}
