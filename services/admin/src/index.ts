import { randomUUID, createHash } from "node:crypto";
import Fastify from "fastify";
import pg from "pg";
import { jwtVerify } from "jose";
import { DEFAULT_JWT_SECRET } from "@local/jwt";

const port = Number(process.env.ADMIN_PORT ?? 54325);
const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/app";

const pgClient = new pg.Pool({ connectionString: databaseUrl });

type AuthClaims = {
  sub: string;
  role: "anon" | "authenticated" | "service_role";
  email?: string;
};

type User = {
  id: string;
  email: string;
  encrypted_password: string;
  created_at: Date;
  updated_at: Date;
};

type Tenant = {
  id: string;
  name: string;
  owner_id: string;
  created_at: Date;
  updated_at: Date;
};

type Project = {
  id: string;
  name: string;
  description: string | null;
  owner_id: string | null;
  region: string;
  created_at: Date;
  updated_at: Date;
};

const app = Fastify({ logger: true });

async function verifyJwt(token: string): Promise<AuthClaims | null> {
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(DEFAULT_JWT_SECRET),
    );
    return {
      sub: String(payload.sub),
      role: (payload.role as "anon" | "authenticated" | "service_role") || "anon",
      email: payload.email as string | undefined,
    };
  } catch {
    return null;
  }
}

async function getClaimsFromAuth(authorization: string | undefined): Promise<AuthClaims | null> {
  if (!authorization) return null;
  
  const token = authorization.replace("Bearer ", "");
  return verifyJwt(token);
}

app.get("/health", async () => ({ ok: true }));

app.addHook("onRequest", async (request, reply) => {
  if (request.url === "/health") {
    return;
  }
  
  const claims = await getClaimsFromAuth(request.headers.authorization);
  if (!claims) {
    return reply.code(401).send({ error: "Invalid or missing token" });
  }
  request.user = claims;
});

app.get("/users", async (request, reply) => {
  const result = await pgClient.query<User>(
    "select id, email, created_at, updated_at from auth.users order by created_at desc",
  );
  return reply.send(result.rows);
});

app.get<{ Params: { userId: string } }>(
  "/users/:userId",
  async (request, reply) => {
    const { userId } = request.params;
    const result = await pgClient.query<User>(
      "select id, email, created_at, updated_at from auth.users where id = $1",
      [userId],
    );
    
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: "User not found" });
    }
    
    return reply.send(result.rows[0]);
  },
);

app.post<{ Body: { email: string; password: string } }>(
  "/users",
  async (request, reply) => {
    const { email, password } = request.body;
    
    if (!email || !password) {
      return reply.code(400).send({ error: "Email and password are required" });
    }

    const id = randomUUID();
    const encryptedPassword = await hashPassword(password);

    try {
      const result = await pgClient.query<User>(
        "insert into auth.users (id, email, encrypted_password) values ($1, $2, $3) returning id, email, created_at, updated_at",
        [id, email, encryptedPassword],
      );
      return reply.code(201).send(result.rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        return reply.code(409).send({ error: "User already exists" });
      }
      return reply.code(500).send({ error: "Failed to create user" });
    }
  },
);

app.delete<{ Params: { userId: string } }>(
  "/users/:userId",
  async (request, reply) => {
    const { userId } = request.params;
    
    const result = await pgClient.query(
      "delete from auth.users where id = $1 returning id",
      [userId],
    );
    
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: "User not found" });
    }
    
    return reply.code(204).send();
  },
);

app.get("/tenants", async (request, reply) => {
  const result = await pgClient.query<Tenant>(
    "select * from admin.tenants order by created_at desc",
  );
  return reply.send(result.rows);
});

app.post<{ Body: { name: string; ownerId: string } }>(
  "/tenants",
  async (request, reply) => {
    const { name, ownerId } = request.body;
    
    if (!name || !ownerId) {
      return reply.code(400).send({ error: "Name and owner ID are required" });
    }

    const id = randomUUID();

    try {
      const result = await pgClient.query<Tenant>(
        "insert into admin.tenants (id, name, owner_id) values ($1, $2, $3) returning *",
        [id, name, ownerId],
      );
      return reply.code(201).send(result.rows[0]);
    } catch (error) {
      return reply.code(500).send({ error: "Failed to create tenant" });
    }
  },
);

app.delete<{ Params: { tenantId: string } }>(
  "/tenants/:tenantId",
  async (request, reply) => {
    const { tenantId } = request.params;
    
    const result = await pgClient.query(
      "delete from admin.tenants where id = $1 returning id",
      [tenantId],
    );
    
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: "Tenant not found" });
    }
    
    return reply.code(204).send();
  },
);

app.get<{ Params: { userId: string } }>(
  "/users/:userId/impersonate",
  async (request, reply) => {
    const { userId } = request.params;
    const user = request.user as AuthClaims;
    
    const result = await pgClient.query<User>(
      "select id, email, created_at, updated_at from auth.users where id = $1",
      [userId],
    );
    
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: "User not found" });
    }
    
    const targetUser = result.rows[0];
    
    const impersonationToken = await signProjectJwt({
      sub: targetUser.id,
      role: "authenticated",
      email: targetUser.email,
      secret: DEFAULT_JWT_SECRET,
      expiresInSeconds: 3600,
    });
    
    return reply.send({
      access_token: impersonationToken,
      token_type: "bearer",
      expires_in: 3600,
      user: {
        id: targetUser.id,
        email: targetUser.email,
        aud: "authenticated",
        role: "authenticated",
        created_at: targetUser.created_at.toISOString(),
      },
    });
  },
);

app.get("/projects", async (request, reply) => {
  const result = await pgClient.query<Project>(
    `select p.*, u.email as owner_email
     from admin.projects p
     left join auth.users u on u.id = p.owner_id
     order by p.created_at desc`,
  );
  return reply.send(result.rows);
});

app.post<{ Body: { name: string; description?: string; owner_id?: string; region?: string } }>(
  "/projects",
  async (request, reply) => {
    const { name, description, owner_id, region } = request.body;
    if (!name?.trim()) {
      return reply.code(400).send({ error: "Project name is required" });
    }
    try {
      const result = await pgClient.query<Project>(
        `insert into admin.projects (name, description, owner_id, region)
         values ($1, $2, $3, $4)
         returning *`,
        [name.trim(), description?.trim() || null, owner_id || null, region || "us-east-1"],
      );
      return reply.code(201).send(result.rows[0]);
    } catch {
      return reply.code(500).send({ error: "Failed to create project" });
    }
  },
);

app.delete<{ Params: { projectId: string } }>(
  "/projects/:projectId",
  async (request, reply) => {
    const { projectId } = request.params;
    const result = await pgClient.query(
      "delete from admin.projects where id = $1 returning id",
      [projectId],
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: "Project not found" });
    }
    return reply.code(204).send();
  },
);

app.get<{ Params: { projectId: string } }>(
  "/projects/:projectId",
  async (request, reply) => {
    const { projectId } = request.params;
    const result = await pgClient.query<Project>(
      `select p.*, u.email as owner_email
       from admin.projects p
       left join auth.users u on u.id = p.owner_id
       where p.id = $1`,
      [projectId],
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: "Project not found" });
    }
    return reply.send(result.rows[0]);
  },
);

app.patch<{ Params: { projectId: string }; Body: { name?: string; description?: string | null; owner_id?: string | null; region?: string } }>(
  "/projects/:projectId",
  async (request, reply) => {
    const { projectId } = request.params;
    const { name, description, owner_id, region } = request.body;
    const result = await pgClient.query<Project>(
      `update admin.projects set
         name        = coalesce($1, name),
         description = case when $2::boolean then $3 else description end,
         owner_id    = case when $4::boolean then $5::uuid else owner_id end,
         region      = coalesce($6, region),
         updated_at  = now()
       where id = $7
       returning *`,
      [
        name ?? null,
        description !== undefined, description ?? null,
        owner_id !== undefined,    owner_id ?? null,
        region ?? null,
        projectId,
      ],
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: "Project not found" });
    }
    return reply.send(result.rows[0]);
  },
);

app.get<{ Params: { projectId: string } }>(
  "/projects/:projectId/keys",
  async (request, reply) => {
    const { projectId } = request.params;
    const ttl = 100 * 365 * 24 * 60 * 60;
    const [anonKey, serviceRoleKey] = await Promise.all([
      signProjectJwt({ sub: projectId, role: "anon", expiresInSeconds: ttl }),
      signProjectJwt({ sub: projectId, role: "service_role", expiresInSeconds: ttl }),
    ]);
    return reply.send({ anon_key: anonKey, service_role_key: serviceRoleKey });
  },
);

app.get<{ Params: { projectId: string } }>(
  "/projects/:projectId/members",
  async (request, reply) => {
    const { projectId } = request.params;
    const result = await pgClient.query<User>(
      `select u.id, u.email, u.created_at, u.updated_at
       from admin.project_members pm
       join auth.users u on u.id = pm.user_id
       where pm.project_id = $1
       order by pm.created_at asc`,
      [projectId],
    );
    return reply.send(result.rows);
  },
);

app.post<{ Params: { projectId: string }; Body: { user_id: string } }>(
  "/projects/:projectId/members",
  async (request, reply) => {
    const { projectId } = request.params;
    const { user_id } = request.body;
    if (!user_id) return reply.code(400).send({ error: "user_id is required" });
    try {
      await pgClient.query(
        "insert into admin.project_members (project_id, user_id) values ($1, $2)",
        [projectId, user_id],
      );
      const result = await pgClient.query<User>(
        "select id, email, created_at, updated_at from auth.users where id = $1",
        [user_id],
      );
      return reply.code(201).send(result.rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        return reply.code(409).send({ error: "User is already a member" });
      }
      return reply.code(500).send({ error: "Failed to add member" });
    }
  },
);

app.delete<{ Params: { projectId: string; userId: string } }>(
  "/projects/:projectId/members/:userId",
  async (request, reply) => {
    const { projectId, userId } = request.params;
    const result = await pgClient.query(
      "delete from admin.project_members where project_id = $1 and user_id = $2 returning user_id",
      [projectId, userId],
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: "Member not found" });
    }
    return reply.code(204).send();
  },
);

// ─── SQL execution ────────────────────────────────────────────────────────────

app.post<{ Body: { query?: string } }>(
  "/sql",
  async (request, reply) => {
    const { query } = request.body;
    if (!query?.trim()) {
      return reply.code(400).send({ error: "Query is required" });
    }
    try {
      const result = await pgClient.query(query);
      return reply.send({
        rows: result.rows,
        fields: result.fields?.map(f => ({ name: f.name, dataTypeID: f.dataTypeID })) ?? [],
        rowCount: result.rowCount,
        command: result.command,
      });
    } catch (err: unknown) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  }
);

// ─── Schema browser ───────────────────────────────────────────────────────────

type ColumnInfo = {
  schema: string;
  table: string;
  column: string;
  type: string;
  nullable: boolean;
  default: string | null;
  position: number;
  is_pk: boolean;
};

app.get("/schema/tables", async (_request, reply) => {
  const result = await pgClient.query<ColumnInfo>(`
    SELECT
      c.table_schema AS schema,
      c.table_name AS "table",
      c.column_name AS "column",
      c.data_type AS type,
      (c.is_nullable = 'YES') AS nullable,
      c.column_default AS "default",
      c.ordinal_position AS position,
      EXISTS (
        SELECT 1
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
          AND tc.table_name = kcu.table_name
        WHERE kcu.table_schema = c.table_schema
          AND kcu.table_name = c.table_name
          AND kcu.column_name = c.column_name
          AND tc.constraint_type = 'PRIMARY KEY'
      ) AS is_pk
    FROM information_schema.columns c
    WHERE c.table_schema NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
    ORDER BY c.table_schema, c.table_name, c.ordinal_position
  `);

  const schemas: Record<string, Record<string, ColumnInfo[]>> = {};
  for (const row of result.rows) {
    schemas[row.schema] ??= {};
    schemas[row.schema][row.table] ??= [];
    schemas[row.schema][row.table].push(row);
  }
  return reply.send(schemas);
});

function isValidIdentifier(s: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s);
}

app.get<{
  Params: { schema: string; table: string };
  Querystring: { limit?: string; offset?: string };
}>(
  "/schema/:schema/:table/rows",
  async (request, reply) => {
    const { schema, table } = request.params;
    const limit = Math.min(parseInt(request.query.limit ?? "50"), 500);
    const offset = Math.max(parseInt(request.query.offset ?? "0"), 0);

    if (!isValidIdentifier(schema) || !isValidIdentifier(table)) {
      return reply.code(400).send({ error: "Invalid schema or table name" });
    }
    try {
      const [rows, count] = await Promise.all([
        pgClient.query(`SELECT * FROM "${schema}"."${table}" LIMIT $1 OFFSET $2`, [limit, offset]),
        pgClient.query<{ total: number }>(`SELECT count(*)::int AS total FROM "${schema}"."${table}"`),
      ]);
      return reply.send({
        rows: rows.rows,
        total: count.rows[0].total,
        fields: rows.fields?.map(f => ({ name: f.name, dataTypeID: f.dataTypeID })) ?? [],
      });
    } catch (err: unknown) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  }
);

app.delete<{
  Params: { schema: string; table: string };
  Body: { pk: Record<string, unknown> };
}>(
  "/schema/:schema/:table/rows",
  async (request, reply) => {
    const { schema, table } = request.params;
    const { pk } = request.body ?? {};
    if (!isValidIdentifier(schema) || !isValidIdentifier(table)) {
      return reply.code(400).send({ error: "Invalid schema or table name" });
    }
    if (!pk || Object.keys(pk).length === 0) {
      return reply.code(400).send({ error: "pk is required" });
    }
    const entries = Object.entries(pk);
    const where = entries.map(([col], i) => `"${col}" = $${i + 1}`).join(" AND ");
    const values = entries.map(([, v]) => v);
    try {
      const result = await pgClient.query(
        `DELETE FROM "${schema}"."${table}" WHERE ${where} RETURNING *`,
        values
      );
      if (result.rows.length === 0) return reply.code(404).send({ error: "Row not found" });
      return reply.code(204).send();
    } catch (err: unknown) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  }
);

app.patch<{
  Params: { schema: string; table: string };
  Body: { pk: Record<string, unknown>; data: Record<string, unknown> };
}>(
  "/schema/:schema/:table/rows",
  async (request, reply) => {
    const { schema, table } = request.params;
    const { pk, data } = request.body ?? {};
    if (!isValidIdentifier(schema) || !isValidIdentifier(table)) {
      return reply.code(400).send({ error: "Invalid schema or table name" });
    }
    if (!pk || !data || Object.keys(pk).length === 0 || Object.keys(data).length === 0) {
      return reply.code(400).send({ error: "pk and data are required" });
    }
    const dataEntries = Object.entries(data);
    const pkEntries = Object.entries(pk);
    const set = dataEntries.map(([col], i) => `"${col}" = $${i + 1}`).join(", ");
    const where = pkEntries.map(([col], i) => `"${col}" = $${dataEntries.length + i + 1}`).join(" AND ");
    const values = [...dataEntries.map(([, v]) => v), ...pkEntries.map(([, v]) => v)];
    try {
      const result = await pgClient.query(
        `UPDATE "${schema}"."${table}" SET ${set} WHERE ${where} RETURNING *`,
        values
      );
      if (result.rows.length === 0) return reply.code(404).send({ error: "Row not found" });
      return reply.send(result.rows[0]);
    } catch (err: unknown) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  }
);

// Function secrets
app.get("/secrets", async (request, reply) => {
  const claims = await getClaimsFromAuth(request.headers.authorization);
  if (!claims) return reply.code(401).send({ error: "Unauthorized" });
  const result = await pgClient.query(
    "SELECT name, value, updated_at FROM admin.function_secrets ORDER BY name"
  );
  const rows = result.rows.map((r) => ({
    name: r.name,
    digest: createHash("sha256").update(r.value).digest("hex").slice(0, 16),
    updated_at: r.updated_at,
  }));
  return reply.send(rows);
});

app.post<{ Body: { secrets: { name: string; value: string }[] } }>(
  "/secrets",
  async (request, reply) => {
    const claims = await getClaimsFromAuth(request.headers.authorization);
    if (!claims) return reply.code(401).send({ error: "Unauthorized" });
    const { secrets } = request.body;
    if (!Array.isArray(secrets) || secrets.length === 0)
      return reply.code(400).send({ error: "secrets array is required" });
    for (const s of secrets) {
      if (!s.name || !s.name.trim())
        return reply.code(400).send({ error: "Each secret must have a name" });
    }
    for (const s of secrets) {
      await pgClient.query(
        `INSERT INTO admin.function_secrets (name, value, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (name) DO UPDATE SET value = $2, updated_at = now()`,
        [s.name.trim(), s.value]
      );
    }
    return reply.code(204).send();
  }
);

app.delete<{ Params: { name: string } }>(
  "/secrets/:name",
  async (request, reply) => {
    const claims = await getClaimsFromAuth(request.headers.authorization);
    if (!claims) return reply.code(401).send({ error: "Unauthorized" });
    await pgClient.query("DELETE FROM admin.function_secrets WHERE name = $1", [
      request.params.name,
    ]);
    return reply.code(204).send();
  }
);

app.get("/stats", async (request, reply) => {
  const userCount = await pgClient.query("select count(*) as count from auth.users");
  const bucketCount = await pgClient.query("select count(*) as count from storage.buckets");
  const fileCount = await pgClient.query("select count(*) as count from storage.files");
  const projectCount = await pgClient.query("select count(*) as count from admin.projects");

  return reply.send({
    users: parseInt(userCount.rows[0].count),
    buckets: parseInt(bucketCount.rows[0].count),
    files: parseInt(fileCount.rows[0].count),
    projects: parseInt(projectCount.rows[0].count),
  });
});

async function hashPassword(password: string): Promise<string> {
  const { scrypt, randomBytes } = await import("node:crypto");
  const { promisify } = await import("node:util");
  
  const salt = randomBytes(16).toString("hex");
  const scryptAsync = promisify(scrypt);
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;

  return `scrypt:${salt}:${derivedKey.toString("hex")}`;
}

async function signProjectJwt(options: {
  sub: string;
  role?: "anon" | "authenticated" | "service_role";
  email?: string;
  secret?: string;
  expiresInSeconds?: number;
}) {
  const { SignJWT } = await import("jose");
  const now = Math.floor(Date.now() / 1000);
  const secret = new TextEncoder().encode(options.secret ?? DEFAULT_JWT_SECRET);

  return new SignJWT({
    role: options.role ?? "authenticated",
    email: options.email,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(options.sub)
    .setIssuedAt(now)
    .setExpirationTime(now + (options.expiresInSeconds ?? 60 * 60))
    .sign(secret);
}

async function initSchema() {
  // Roles (ignore if already exist)
  for (const sql of [
    `do $$ begin create role anon nologin; exception when duplicate_object then null; end $$`,
    `do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$`,
    `do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$`,
    `do $$ begin create role authenticator noinherit login password 'authenticator'; exception when duplicate_object then null; end $$`,
  ]) {
    try { await pgClient.query(sql); } catch { /* ignore */ }
  }
  try { await pgClient.query(`grant anon, authenticated, service_role to authenticator`); } catch { /* ignore */ }

  // Schemas
  await pgClient.query(`create schema if not exists auth`);
  await pgClient.query(`create schema if not exists admin`);
  await pgClient.query(`create schema if not exists storage`);

  // auth tables
  await pgClient.query(`
    create table if not exists auth.users (
      id uuid primary key,
      email text not null unique,
      encrypted_password text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await pgClient.query(`
    create table if not exists auth.refresh_tokens (
      token text primary key,
      user_id uuid not null references auth.users(id) on delete cascade,
      created_at timestamptz not null default now()
    )
  `);
  await pgClient.query(`
    create table if not exists auth.password_reset_tokens (
      token text primary key,
      user_id uuid not null references auth.users(id) on delete cascade,
      expires_at timestamptz not null default now() + interval '1 hour'
    )
  `);

  // storage tables
  await pgClient.query(`
    create table if not exists storage.buckets (
      id text primary key,
      name text not null unique,
      public boolean not null default false,
      owner_id uuid references auth.users(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await pgClient.query(`
    create table if not exists storage.files (
      id uuid primary key default gen_random_uuid(),
      bucket_id text not null references storage.buckets(id) on delete cascade,
      name text not null,
      path text not null,
      size bigint not null default 0,
      content_type text,
      owner_id uuid references auth.users(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (bucket_id, name)
    )
  `);

  // public tables
  await pgClient.query(`
    create table if not exists public.todos (
      id bigint generated always as identity primary key,
      user_id uuid not null,
      title text not null,
      inserted_at timestamptz not null default now()
    )
  `);
  await pgClient.query(`alter table public.todos enable row level security`);
  try {
    await pgClient.query(`
      create policy "Users can read their todos" on public.todos
        for select to authenticated
        using (user_id = ((current_setting('request.jwt.claims', true))::json ->> 'sub')::uuid)
    `);
  } catch { /* policy already exists */ }
  try {
    await pgClient.query(`
      create policy "Users can insert their todos" on public.todos
        for insert to authenticated
        with check (user_id = ((current_setting('request.jwt.claims', true))::json ->> 'sub')::uuid)
    `);
  } catch { /* policy already exists */ }

  // Grants
  try { await pgClient.query(`grant usage on schema public to anon, authenticated`); } catch { /* ignore */ }
  try { await pgClient.query(`grant select, insert on public.todos to authenticated`); } catch { /* ignore */ }
  try { await pgClient.query(`grant usage on schema auth to authenticator`); } catch { /* ignore */ }
  try { await pgClient.query(`grant all on all tables in schema auth to authenticator`); } catch { /* ignore */ }
  try { await pgClient.query(`grant usage on schema storage to authenticator`); } catch { /* ignore */ }
  try { await pgClient.query(`grant all on all tables in schema storage to authenticator`); } catch { /* ignore */ }

  // function secrets table
  await pgClient.query(`
    create table if not exists admin.function_secrets (
      name text primary key,
      value text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);

  // admin tables
  await pgClient.query(`
    create table if not exists admin.projects (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      description text,
      owner_id uuid references auth.users(id) on delete set null,
      region text not null default 'us-east-1',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await pgClient.query(`
    create table if not exists admin.project_members (
      project_id uuid not null references admin.projects(id) on delete cascade,
      user_id uuid not null references auth.users(id) on delete cascade,
      created_at timestamptz not null default now(),
      primary key (project_id, user_id)
    )
  `);
}

async function main() {
  console.log(`Initializing database schema...`);
  await initSchema();
  console.log(`Schema ready. Starting admin service on port ${port}`);
  await app.listen({ host: "0.0.0.0", port });
  console.log(`Admin service listening on port ${port}`);
}

main().catch((error) => {
  console.error("Failed to start admin server:", error);
  process.exit(1);
});