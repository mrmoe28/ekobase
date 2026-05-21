const DEFAULT_URL = "https://supabase.ekodevops.com";

function baseUrl(): string {
  return (process.env.EKOBASE_URL ?? DEFAULT_URL).replace(/\/$/, "");
}

function token(): string {
  const t = process.env.EKOBASE_ADMIN_TOKEN;
  if (!t) {
    throw new Error(
      "EKOBASE_ADMIN_TOKEN is not set. See apps/mcp/README.md for how to mint one.",
    );
  }
  return t;
}

export type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
};

export async function request<T = unknown>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, query } = opts;
  const jwt = token();

  const url = new URL(`${baseUrl()}/admin/v1${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url, {
    method,
    headers: {
      "Authorization": `Bearer ${jwt}`,
      "apikey": jwt,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(
      `EkoBase ${method} ${path} → ${res.status}: ${text || res.statusText}`,
    );
  }

  if (!text) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}
