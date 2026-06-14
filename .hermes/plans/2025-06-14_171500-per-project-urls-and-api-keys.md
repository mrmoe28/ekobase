# Per-Project URLs and API Keys — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Give every project its own URL namespace and the ability to create revocable API keys so external apps can connect securely.

**Architecture:** Add path-prefixed project routing (`/p/{projectId}/...`) to the gateway, a new `admin.api_keys` table with hashed storage, and an API-keys UI tab. Existing routes remain backward-compatible.

**Tech Stack:** TypeScript / Fastify / PostgreSQL / Next.js / Tailwind

---

## Current State

- Gateway is monolithic on port 54321. All projects share `http://gateway:54321`.
- Project identification today: JWT `project_id` claim, or `apikey` header/query containing a JWT whose `sub` is the projectId.
- Admin service has `/projects/:projectId/keys` that generates anon/service_role JWTs on demand — not stored, not revocable.
- No `admin.api_keys` table. No per-project URL concept in admin UI.
- Gateway proxies `/rest/v1`, `/auth/v1`, `/storage/v1`, `/functions/v1`, `/realtime/v1`, `/admin/v1` to backend services.

---

## Proposed Design

### 1. Per-Project URLs (Path-Prefix Routing)

**New gateway routes:**
- `GET|POST|PATCH|DELETE /p/{projectId}/rest/v1/*` → PostgREST (with `accept-profile: proj_{projectId}`)
- `POST /p/{projectId}/auth/v1/*` → Auth handlers (scope signup/token to project)
- `/p/{projectId}/storage/v1/*` → Storage
- `/p/{projectId}/functions/v1/*` → Functions
- `/p/{projectId}/realtime/v1/*` → Realtime
- `/p/{projectId}/admin/v1/*` → Admin service (with `x-project-id` header)

**How it works:**
- Gateway extracts `projectId` from the path prefix.
- For `/rest/v1`, inject `accept-profile` / `content-profile` = `proj_{sanitizedProjectId}`.
- For `/auth/v1`, the auth handlers read `projectId` from the path and use it instead of parsing JWT.
- For `/admin/v1`, inject `x-project-id` header so admin endpoints know the context.

**Backward compatibility:** Existing top-level routes (`/rest/v1`, `/auth/v1`, etc.) continue working exactly as they do now (JWT-based project detection). Nothing breaks.

**Benefits:**
- External SDKs can set one base URL per project: `https://gateway.example.com/p/{projectId}`.
- No DNS / wildcard certificate changes needed.
- Works identically in local dev, Docker, and Coolify deployments.

### 2. Project-Specific API Keys

**New table:**
```sql
create table admin.api_keys (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references admin.projects(id) on delete cascade,
  name text not null,
  key_hash text not null unique,   -- SHA-256 of raw key
  scopes text[] not null default '{read,write}',
  last_used_at timestamptz,
  revoked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

**Key design:**
- Raw key format: `eko_{projectId}_{randomBase58(24)}` (example: `eko_550e8400-e29b-41d4-a716-446655440000_a3fK9mPqR5sT8vWxYzAbCdEfGh`)
- Store only `SHA-256(raw_key)` in DB. Return raw key **only once** at creation time.
- Gateway accepts API key via `x-api-key` header or `apikey` query parameter.
- When gateway sees an API key, hash it, look up in `admin.api_keys`, reject if revoked / not found.
- If valid, gateway behaves as if a JWT with `role: "service_role"`, `project_id: projectId` was presented.
- Admin UI shows masked keys (`eko_550e...****a3fK`) and allows revoke / rotate.

**Scopes:**
- `read`  → GET / HEAD on `/rest/v1`, `/storage/v1`
- `write` → POST / PATCH / PUT / DELETE on `/rest/v1`, `/storage/v1`
- `admin` → Full access including `/admin/v1`, user management
- Rejected requests return `403` with `{ error: "scope denied: write required" }`

**Admin API endpoints:**
- `GET /projects/:projectId/api-keys` — list keys (masked, no hashes)
- `POST /projects/:projectId/api-keys` — create key (returns raw key once)
- `PATCH /projects/:projectId/api-keys/:keyId` — rename or revoke
- `DELETE /projects/:projectId/api-keys/:keyId` — hard delete

---

## Implementation Tasks

### Task 1: Database migration — `admin.api_keys` table

**Objective:** Create the new table for storing API keys.

**Files:**
- Create: `infra/postgres/migrations/007-api-keys.sql`

**Step 1: Write migration**

```sql
-- 007-api-keys.sql
-- Project-scoped API keys for external app connections.

begin;

create table if not exists admin.api_keys (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references admin.projects(id) on delete cascade,
  name text not null,
  key_hash text not null unique,
  scopes text[] not null default '{read,write}',
  last_used_at timestamptz,
  revoked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists api_keys_project_id_idx on admin.api_keys (project_id);

-- Prevent duplicate active names within a project (optional uniqueness, commented by default)
-- create unique index if not exists api_keys_project_name_uniq on admin.api_keys (project_id, name) where revoked = false;

grant usage on schema admin to service_role;
grant select, insert, update, delete on admin.api_keys to service_role;

commit;
```

**Step 2: Verify**
Run: `cat infra/postgres/migrations/007-api-keys.sql`
Expected: File created with the above content.

**Step 3: Commit**
```bash
git add infra/postgres/migrations/007-api-keys.sql
git commit -m "feat(db): add admin.api_keys migration"
```

---

### Task 2: Gateway — add per-project path prefix routes

**Objective:** Make gateway accept `/p/{projectId}/...` and forward with project context.

**Files:**
- Modify: `apps/gateway/src/index.ts`

**Step 1: Add helper to extract projectId from path**

Insert after `getProjectIdFromRequest` (around line 118):

```typescript
function getProjectIdFromPath(url: string): string | null {
  const match = url.match(/^\/p\/([a-f0-9-]{36})\//);
  return match ? match[1] : null;
}
```

**Step 2: Add path-prefix proxy registrations**

After the existing proxy registrations (after line 426, before `app.listen`), add:

```typescript
// ─── Per-Project Path Prefix Proxies ───────────────────────────────────────────

await app.register(async (child) => {
  child.addHook("onRequest", async (request, reply) => {
    const projectId = getProjectIdFromPath(request.url);
    if (!projectId) {
      return reply.code(400).send({ error: "Missing project ID in path" });
    }
    // Attach projectId to request for downstream use
    (request as any).projectId = projectId;
  });

  // REST → PostgREST with schema injection
  await child.register(proxy, {
    upstream: postgrestUrl,
    prefix: "/p/:projectId/rest/v1",
    rewritePrefix: "",
    replyOptions: {
      rewriteRequestHeaders: (req, headers) => {
        const projectId = (req as any).params?.projectId as string | undefined;
        if (!projectId) return headers;
        const schema = "proj_" + projectId.replace(/-/g, "").slice(0, 16);
        return { ...headers, "accept-profile": schema, "content-profile": schema };
      },
    },
  });

  // Auth — register inline handlers scoped to path projectId
  // (We'll handle auth in Task 3)

  // Storage
  await child.register(proxy, {
    upstream: storageUrl,
    prefix: "/p/:projectId/storage/v1",
    rewritePrefix: "",
  });

  // Functions
  await child.register(proxy, {
    upstream: functionsUrl,
    prefix: "/p/:projectId/functions/v1",
    rewritePrefix: "",
  });

  // Realtime
  await child.register(proxy, {
    upstream: realtimeUrl,
    prefix: "/p/:projectId/realtime/v1",
    websocket: true,
    rewritePrefix: "",
  });

  // Admin (inject x-project-id header)
  await child.register(proxy, {
    upstream: adminUrl,
    prefix: "/p/:projectId/admin/v1",
    rewritePrefix: "",
    replyOptions: {
      rewriteRequestHeaders: (req, headers) => {
        const projectId = (req as any).params?.projectId as string | undefined;
        if (projectId) {
          return { ...headers, "x-project-id": projectId };
        }
        return headers;
      },
    },
  });
});
```

**Note:** The auth `/p/:projectId/auth/v1` handlers need special treatment (Task 3).

**Step 3: Test build**
Run: `cd apps/gateway && npx tsc --noEmit`
Expected: No type errors.

**Step 4: Commit**
```bash
git add apps/gateway/src/index.ts
git commit -m "feat(gateway): add per-project /p/{projectId} path prefix routes"
```

---

### Task 3: Gateway — scoped auth handlers under `/p/{projectId}/auth/v1`

**Objective:** Allow signup and token exchange scoped to a project via URL path.

**Files:**
- Modify: `apps/gateway/src/index.ts`

**Step 1: Extract shared auth logic into reusable functions**

The existing auth block (lines 176-375) is registered once under `/auth/v1`. We need to also register it under `/p/:projectId/auth/v1`, but with `projectId` pulled from the path instead of the `apikey` header.

Refactor: wrap the auth route definitions in a factory function `registerAuthRoutes(app, getProjectId)`:

```typescript
async function registerAuthRoutes(
  instance: typeof app,
  getProjectId: (request: FastifyRequest) => Promise<string | null>
) {
  // Move the existing auth.post("/signup", ...) etc. here,
  // replacing `await getProjectIdFromRequest(request as never)` with `await getProjectId(request)`
}
```

Then register it twice:
```typescript
// Existing top-level auth
await app.register(async (auth) => {
  await registerAuthRoutes(auth, getProjectIdFromRequest);
}, { prefix: "/auth/v1" });

// Per-project auth
await app.register(async (auth) => {
  await registerAuthRoutes(auth, async (req) => {
    const pid = getProjectIdFromPath(req.url);
    if (pid) return pid;
    return getProjectIdFromRequest(req as never);
  });
}, { prefix: "/p/:projectId/auth/v1" });
```

**Step 2: Test build**
Run: `cd apps/gateway && npx tsc --noEmit`
Expected: No type errors.

**Step 3: Commit**
```bash
git add apps/gateway/src/index.ts
git commit -m "feat(gateway): project-scoped auth routes under /p/{projectId}/auth/v1"
```

---

### Task 4: Gateway — validate custom API keys (`x-api-key` header)

**Objective:** Accept project API keys and treat them like service_role scoped to the project.

**Files:**
- Modify: `apps/gateway/src/index.ts`

**Step 1: Add API key validation helper**

Insert after `getProjectIdFromRequest`:

```typescript
type ApiKeyClaims = {
  projectId: string;
  keyId: string;
  scopes: string[];
};

async function validateApiKey(request: FastifyRequest): Promise<ApiKeyClaims | null> {
  const rawKey =
    (request.headers["x-api-key"] as string | undefined) ||
    ((request.query as Record<string, string>)?.apikey);
  if (!rawKey || !rawKey.startsWith("eko_")) return null;

  const hash = createHash("sha256").update(rawKey).digest("hex");
  const result = await pool.query<{
    id: string;
    project_id: string;
    scopes: string[];
    revoked: boolean;
  }>(
    `select id, project_id, scopes, revoked
     from admin.api_keys
     where key_hash = $1`,
    [hash],
  );

  const row = result.rows[0];
  if (!row || row.revoked) return null;

  // Update last_used_at (fire-and-forget)
  pool.query("update admin.api_keys set last_used_at = now() where id = $1", [row.id]).catch(() => {});

  return { projectId: row.project_id, keyId: row.id, scopes: row.scopes };
}
```

**Step 2: Inject API key claims into request context for downstream proxies**

Add a hook at the top of the gateway (after CORS, before auth routes):

```typescript
app.addHook("onRequest", async (request, reply) => {
  const apiKeyClaims = await validateApiKey(request);
  if (apiKeyClaims) {
    (request as any).apiKey = apiKeyClaims;
    // Optionally inject a synthetic Authorization header for downstream services
    const syntheticToken = await signProjectJwt({
      sub: apiKeyClaims.keyId,
      role: "service_role",
      project_id: apiKeyClaims.projectId,
    });
    request.headers.authorization = `Bearer ${syntheticToken}`;
  }
});
```

**Step 3: Enforce scopes on `/rest/v1` and `/storage/v1`**

In the rewriteRequestHeaders for `/rest/v1` proxies, check scopes:

```typescript
// Inside the existing /rest/v1 proxy registration AND the new /p/:projectId/rest/v1
replyOptions: {
  rewriteRequestHeaders: (req, headers) => {
    const method = (req as any).method || "GET";
    const apiKey = (req as any).apiKey as ApiKeyClaims | undefined;
    if (apiKey) {
      const writeOps = ["POST", "PATCH", "PUT", "DELETE"];
      if (writeOps.includes(method) && !apiKey.scopes.includes("write")) {
        // Fastify proxy doesn't let us reject here easily; better handled in a pre-handler hook.
        // We'll add a route-level hook instead.
      }
    }
    // ...existing schema logic...
  },
}
```

Instead, add scope checks as Fastify `preHandler` hooks on the proxy plugin registrations. For simplicity in this plan, add the hook to the `/rest/v1` and `/storage/v1` registrations:

```typescript
await app.register(async (rest) => {
  rest.addHook("preHandler", async (request, reply) => {
    const apiKey = (request as any).apiKey as ApiKeyClaims | undefined;
    if (!apiKey) return;
    const writeOps = ["POST", "PATCH", "PUT", "DELETE"];
    if (writeOps.includes(request.method) && !apiKey.scopes.includes("write")) {
      return reply.code(403).send({ error: "API key scope denied: write required" });
    }
    if (["GET", "HEAD"].includes(request.method) && !apiKey.scopes.includes("read")) {
      return reply.code(403).send({ error: "API key scope denied: read required" });
    }
  });
  await rest.register(proxy, {
    upstream: postgrestUrl,
    prefix: "/rest/v1",
    // ...
  });
});
```

**Step 3: Test build**
Run: `cd apps/gateway && npx tsc --noEmit`
Expected: No type errors.

**Step 4: Commit**
```bash
git add apps/gateway/src/index.ts
git commit -m "feat(gateway): validate custom API keys with scoped access"
```

---

### Task 5: Admin Service — API key CRUD endpoints

**Objective:** Add endpoints to create, list, update, and delete API keys.

**Files:**
- Modify: `services/admin/src/index.ts`

**Step 1: Add key generation helper**

Insert near top (after imports):

```typescript
function generateApiKey(projectId: string): string {
  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; // base58
  let rand = "";
  for (let i = 0; i < 24; i++) {
    rand += chars[Math.floor(Math.random() * chars.length)];
  }
  return `eko_${projectId}_${rand}`;
}
```

**Step 2: Add endpoints after `/projects/:projectId/keys` (around line 438)**

```typescript
app.get<{ Params: { projectId: string } }>(
  "/projects/:projectId/api-keys",
  async (request, reply) => {
    const { projectId } = request.params;
    const result = await pgClient.query<{
      id: string;
      name: string;
      scopes: string[];
      last_used_at: Date | null;
      revoked: boolean;
      created_at: Date;
    }>(
      `select id, name, scopes, last_used_at, revoked, created_at
       from admin.api_keys
       where project_id = $1
       order by created_at desc`,
      [projectId],
    );
    return reply.send(result.rows.map(r => ({
      ...r,
      key_preview: `eko_${projectId.slice(0,6)}...****${r.id.slice(-6)}`,
    })));
  },
);

app.post<{
  Params: { projectId: string };
  Body: { name: string; scopes?: string[] };
}>(
  "/projects/:projectId/api-keys",
  async (request, reply) => {
    const { projectId } = request.params;
    const { name, scopes } = request.body ?? {};
    if (!name?.trim()) {
      return reply.code(400).send({ error: "Key name is required" });
    }
    const rawKey = generateApiKey(projectId);
    const keyHash = createHash("sha256").update(rawKey).digest("hex");
    const validScopes = (scopes ?? ["read", "write"]).filter((s: string) =>
      ["read", "write", "admin"].includes(s)
    );

    try {
      const result = await pgClient.query<{
        id: string;
        name: string;
        scopes: string[];
        created_at: Date;
      }>(
        `insert into admin.api_keys (project_id, name, key_hash, scopes)
         values ($1, $2, $3, $4)
         returning id, name, scopes, created_at`,
        [projectId, name.trim(), keyHash, validScopes],
      );
      return reply.code(201).send({
        ...result.rows[0],
        api_key: rawKey, // shown ONLY once
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        return reply.code(409).send({ error: "Key hash collision — retry" });
      }
      return reply.code(500).send({ error: "Failed to create API key" });
    }
  },
);

app.patch<{
  Params: { projectId: string; keyId: string };
  Body: { name?: string; revoked?: boolean; scopes?: string[] };
}>(
  "/projects/:projectId/api-keys/:keyId",
  async (request, reply) => {
    const { projectId, keyId } = request.params;
    const { name, revoked, scopes } = request.body ?? {};
    const result = await pgClient.query(
      `update admin.api_keys set
         name = coalesce($1, name),
         revoked = coalesce($2, revoked),
         scopes = coalesce($3, scopes),
         updated_at = now()
       where id = $4 and project_id = $5
       returning id`,
      [name ?? null, revoked ?? null, scopes ?? null, keyId, projectId],
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: "API key not found" });
    }
    return reply.send({ ok: true });
  },
);

app.delete<{
  Params: { projectId: string; keyId: string };
}>(
  "/projects/:projectId/api-keys/:keyId",
  async (request, reply) => {
    const { projectId, keyId } = request.params;
    const result = await pgClient.query(
      "delete from admin.api_keys where id = $1 and project_id = $2 returning id",
      [keyId, projectId],
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: "API key not found" });
    }
    return reply.code(204).send();
  },
);
```

**Step 3: Test build**
Run: `cd services/admin && npx tsc --noEmit`
Expected: No type errors.

**Step 4: Commit**
```bash
git add services/admin/src/index.ts
git commit -m "feat(admin): API key CRUD endpoints"
```

---

### Task 6: Admin UI — show per-project URL and API keys tab

**Objective:** In the project detail page, display the project's base URL and add an API Keys management tab.

**Files:**
- Modify: `apps/admin-ui/src/app/dashboard/projects/[id]/page.tsx` (or layout)
- Create: `apps/admin-ui/src/app/dashboard/projects/[id]/api-keys/page.tsx`

**Step 1: Update project detail page to show project URL**

Find the project settings/overview page (`apps/admin-ui/src/app/dashboard/projects/[id]/page.tsx`). Add a "Project URL" card:

```tsx
const projectUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/p/${project.id}`;
// Show in a copyable input field
```

**Step 2: Create API Keys page**

Create `apps/admin-ui/src/app/dashboard/projects/[id]/api-keys/page.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

export default function ApiKeysPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const [keys, setKeys] = useState<any[]>([]);
  const [newName, setNewName] = useState("");
  const [newScopes, setNewScopes] = useState<string[]>(["read", "write"]);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  async function load() {
    const res = await fetch(`/admin/v1/projects/${projectId}/api-keys`, {
      headers: { authorization: localStorage.getItem("token") || "" },
    });
    if (res.ok) setKeys(await res.json());
  }

  useEffect(() => { load(); }, [projectId]);

  async function create() {
    const res = await fetch(`/admin/v1/projects/${projectId}/api-keys`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: localStorage.getItem("token") || "",
      },
      body: JSON.stringify({ name: newName, scopes: newScopes }),
    });
    if (res.ok) {
      const data = await res.json();
      setCreatedKey(data.api_key);
      setNewName("");
      load();
    }
  }

  async function revoke(keyId: string) {
    await fetch(`/admin/v1/projects/${projectId}/api-keys/${keyId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: localStorage.getItem("token") || "",
      },
      body: JSON.stringify({ revoked: true }),
    });
    load();
  }

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-bold">API Keys</h1>

      {createdKey && (
        <div className="rounded border border-green-500 bg-green-50 p-4">
          <p className="font-semibold text-green-800">API key created — copy it now, it will not be shown again:</p>
          <code className="mt-2 block break-all rounded bg-white p-2 text-sm">{createdKey}</code>
          <button onClick={() => setCreatedKey(null)} className="mt-2 text-sm underline">Dismiss</button>
        </div>
      )}

      <div className="flex gap-2">
        <input
          className="rounded border px-3 py-2"
          placeholder="Key name (e.g. Production SDK)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <select
          multiple
          className="rounded border px-3 py-2"
          value={newScopes}
          onChange={(e) => setNewScopes(Array.from(e.target.selectedOptions, o => o.value))}
        >
          <option value="read">read</option>
          <option value="write">write</option>
          <option value="admin">admin</option>
        </select>
        <button onClick={create} className="rounded bg-blue-600 px-4 py-2 text-white">Create</button>
      </div>

      <table className="w-full text-left">
        <thead>
          <tr className="border-b">
            <th className="py-2">Name</th>
            <th>Scopes</th>
            <th>Preview</th>
            <th>Last Used</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k.id} className="border-b">
              <td className="py-2">{k.name}</td>
              <td>{k.scopes.join(", ")}</td>
              <td><code className="text-sm">{k.key_preview}</code></td>
              <td>{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "Never"}</td>
              <td>{k.revoked ? <span className="text-red-600">Revoked</span> : <span className="text-green-600">Active</span>}</td>
              <td>
                {!k.revoked && (
                  <button onClick={() => revoke(k.id)} className="text-red-600 underline">Revoke</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

**Step 3: Add navigation link in project layout**

Find the project detail layout (likely `apps/admin-ui/src/app/dashboard/projects/[id]/layout.tsx` or a sidebar component). Add a nav item:

```tsx
{ label: "API Keys", href: `/dashboard/projects/${id}/api-keys` }
```

**Step 4: Commit**
```bash
git add apps/admin-ui/src/app/dashboard/projects/[id]/api-keys/page.tsx
git add apps/admin-ui/src/app/dashboard/projects/[id]/layout.tsx  # or whatever nav file
git commit -m "feat(admin-ui): API keys management tab"
```

---

### Task 7: Integration tests

**Objective:** Verify the new routes and API key flow end-to-end.

**Files:**
- Create: `tests/api-keys.test.ts`

**Step 1: Write test**

```typescript
import { describe, it, expect, beforeAll } from "vitest";

const GATEWAY = process.env.GATEWAY_URL || "http://localhost:54321";
const ADMIN = process.env.ADMIN_URL || "http://localhost:54325";

describe("per-project URLs and API keys", () => {
  let projectId: string;
  let token: string;

  beforeAll(async () => {
    // Create a test project via admin
    const res = await fetch(`${ADMIN}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "API Key Test Project" }),
    });
    const project = await res.json();
    projectId = project.id;

    // Get service role key for admin calls
    const keysRes = await fetch(`${ADMIN}/projects/${projectId}/keys`);
    const keys = await keysRes.json();
    token = keys.service_role_key;
  });

  it("creates an API key", async () => {
    const res = await fetch(`${ADMIN}/projects/${projectId}/api-keys`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: "Test Key", scopes: ["read"] }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.api_key).toMatch(/^eko_/);
  });

  it("rejects write via read-only API key", async () => {
    // create key
    const createRes = await fetch(`${ADMIN}/projects/${projectId}/api-keys`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: "ReadOnly", scopes: ["read"] }),
    });
    const { api_key } = await createRes.json();

    // attempt write through gateway per-project route
    const writeRes = await fetch(`${GATEWAY}/p/${projectId}/rest/v1/test_table`, {
      method: "POST",
      headers: { "x-api-key": api_key, "content-type": "application/json" },
      body: JSON.stringify({ name: "x" }),
    });
    expect(writeRes.status).toBe(403);
  });

  it("allows read via per-project URL with API key", async () => {
    const res = await fetch(`${GATEWAY}/p/${projectId}/rest/v1/test_table`, {
      headers: { "x-api-key": api_key },
    });
    expect(res.status).toBe(200);
  });
});
```

**Step 2: Run tests**
Run: `pnpm test tests/api-keys.test.ts`
Expected: All tests pass (requires services to be running).

**Step 3: Commit**
```bash
git add tests/api-keys.test.ts
git commit -m "test: per-project URLs and API key scope validation"
```

---

## Verification Steps (Post-Implementation)

1. **Database:** Run `007-api-keys.sql` against Postgres. Confirm table exists.
2. **Gateway:** Start gateway. Confirm:
   - `GET /p/{projectId}/rest/v1/tables` returns data scoped to project schema.
   - `POST /p/{projectId}/auth/v1/signup` creates user scoped to that project.
   - `x-api-key: eko_...` on `/rest/v1` routes works and enforces scopes.
3. **Admin Service:** Create, list, revoke keys via `/admin/v1/projects/{id}/api-keys`.
4. **Admin UI:** Navigate to project → API Keys tab. Create a key. See it once. Revoke it. Confirm gateway rejects revoked key with 401.
5. **Backward compatibility:** Existing top-level routes (`/rest/v1`, `/auth/v1`) continue working unchanged.

---

## Risks, Tradeoffs, and Open Questions

- **API key format:** Using `eko_{projectId}_{random}` makes the projectId visible in the key. Acceptable tradeoff for simplicity; can be opaque later.
- **Hash collisions:** SHA-256 of 36-char random string has negligible collision risk. On 1-in-a-billion chance, the endpoint returns 409 and client retries.
- **Scope enforcement:** The hook only covers `/rest/v1`. If future routes need scope checks, expand the pattern.
- **Realtime:** WebSocket connections through `/p/{projectId}/realtime/v1` will work but scope enforcement on websockets is harder. Scope enforcement on websockets is out of scope for this plan.
- **Admin proxy:** `/p/{projectId}/admin/v1` injects `x-project-id`. Admin endpoints that need project awareness should be updated to read that header.

---

## Summary

| What | Before | After |
|------|--------|-------|
| Project URL | `http://gateway:54321` (shared) | `http://gateway:54321/p/{projectId}` (isolated) |
| External app auth | Anon / service_role JWT (not stored) | Custom `eko_...` API keys (stored, revocable, scoped) |
| Scope control | None | `read`, `write`, `admin` per key |
| Admin UI | No API key management | Dedicated "API Keys" tab per project |

Plan saved. Ready to execute.
