import { randomUUID, createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import Fastify from "fastify";
import pg from "pg";
import { jwtVerify } from "jose";
import { DEFAULT_JWT_SECRET } from "@local/jwt";
import Dockerode from "dockerode";

const functionsDir = process.env.FUNCTIONS_DIR ?? "/data/functions";

const port = Number(process.env.ADMIN_PORT ?? 54325);
const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/app";
const postgrestDbRole = process.env.POSTGREST_DB_ROLE ?? "authenticator";
const storageUrl = process.env.STORAGE_URL ?? "http://localhost:54324";

const pgClient = new pg.Pool({ connectionString: databaseUrl });
const docker = new Dockerode({ socketPath: "/var/run/docker.sock" });

type AuthClaims = {
  sub: string;
  role: "anon" | "authenticated" | "service_role";
  email?: string;
};

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthClaims;
  }
}

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
  supabase_ref: string | null;
  schema_name: string | null;
  created_at: Date;
  updated_at: Date;
};

type EdgeFunction = {
  id: string;
  project_id: string;
  name: string;
  slug: string;
  status: "draft" | "deployed" | "failed" | "disabled";
  entrypoint: string;
  verify_jwt: boolean;
  created_at: Date;
  updated_at: Date;
  latest_version: number | null;
  last_deployed_at: Date | null;
};

type EdgeFunctionDeployment = {
  id: string;
  function_id: string;
  version: number;
  source: string | null;
  status: "created" | "deployed" | "failed";
  created_at: Date;
};

const app = Fastify({ logger: true, bodyLimit: 50 * 1024 * 1024 });

// Accept any binary content type as raw Buffer for storage upload proxying.
app.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => {
  done(null, body);
});

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

app.get<{ Params: { userId: string }; Querystring: { project_id?: string } }>(
  "/users/:userId/impersonate",
  async (request, reply) => {
    const { userId } = request.params;
    const projectId = request.query.project_id;
    const user = request.user as AuthClaims;

    const result = await pgClient.query<User>(
      "select id, email, created_at, updated_at from auth.users where id = $1",
      [userId],
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: "User not found" });
    }

    const targetUser = result.rows[0];

    if (projectId) {
      const member = await pgClient.query(
        "select 1 from admin.project_members where project_id = $1 and user_id = $2",
        [projectId, userId],
      );
      if (member.rows.length === 0) {
        return reply.code(403).send({ error: "User is not a member of this project" });
      }
    }

    const impersonationToken = await signProjectJwt({
      sub: targetUser.id,
      role: "authenticated",
      email: targetUser.email,
      project_id: projectId,
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

async function refreshPostgrestSchemas(): Promise<void> {
  if (!postgrestDbRole) {
    return;
  }

  const result = await pgClient.query<{ schema_name: string }>(
    "select schema_name from admin.projects where schema_name is not null order by created_at asc",
  );
  const schemas = ["public", ...result.rows.map(row => row.schema_name)];
  const schemaList = schemas.join(",");

  try {
    await pgClient.query(
      `alter role ${pg.escapeIdentifier(postgrestDbRole)} set pgrst.db_schemas = ${pg.escapeLiteral(schemaList)}`,
    );
    await pgClient.query("notify pgrst, 'reload config'");
  } catch (error) {
    app.log.warn({ error }, "failed to refresh PostgREST schema config");
  }
}

async function provisionProjectSchema(projectId: string): Promise<string> {
  const schemaName = `proj_${projectId.replace(/-/g, "").slice(0, 16)}`;
  await pgClient.query(`create schema if not exists "${schemaName}"`);
  try {
    await pgClient.query(`grant usage on schema "${schemaName}" to authenticator, anon, authenticated, service_role`);
    await pgClient.query(`grant select, insert, update, delete on all tables in schema "${schemaName}" to anon, authenticated, service_role`);
    await pgClient.query(`alter default privileges in schema "${schemaName}" grant select, insert, update, delete on tables to anon, authenticated, service_role`);
  } catch { /* ignore */ }
  await pgClient.query(
    `update admin.projects set schema_name = $1 where id = $2`,
    [schemaName, projectId],
  );
  await refreshPostgrestSchemas();
  return schemaName;
}

app.post<{ Body: { name: string; description?: string; owner_id?: string; region?: string; supabase_ref?: string } }>(
  "/projects",
  async (request, reply) => {
    const { name, description, owner_id, region, supabase_ref } = request.body;
    if (!name?.trim()) {
      return reply.code(400).send({ error: "Project name is required" });
    }
    try {
      const result = await pgClient.query<Project>(
        `insert into admin.projects (name, description, owner_id, region, supabase_ref)
         values ($1, $2, $3, $4, $5)
         returning *`,
        [name.trim(), description?.trim() || null, owner_id || null, region || "us-east-1", supabase_ref || null],
      );
      const project = result.rows[0];
      await provisionProjectSchema(project.id);
      return reply.code(201).send({ ...project, schema_name: `proj_${project.id.replace(/-/g, "").slice(0, 16)}` });
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

// ─── API Keys ─────────────────────────────────────────────────────────────────

function generateApiKey(projectId: string): string {
  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; // base58
  let rand = "";
  for (let i = 0; i < 24; i++) {
    rand += chars[Math.floor(Math.random() * chars.length)];
  }
  return `eko_${projectId}_${rand}`;
}

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

// ─── Edge Functions ──────────────────────────────────────────────────────────

app.get<{ Params: { projectId: string } }>(
  "/projects/:projectId/functions",
  async (request, reply) => {
    const { projectId } = request.params;
    if (!(await projectExists(projectId))) {
      return reply.code(404).send({ error: "Project not found" });
    }

    const result = await pgClient.query<EdgeFunction>(
      `select
         f.*,
         d.version as latest_version,
         d.created_at as last_deployed_at
       from admin.edge_functions f
       left join lateral (
         select version, created_at
         from admin.edge_function_deployments
         where function_id = f.id
         order by version desc
         limit 1
       ) d on true
       where f.project_id = $1
       order by f.updated_at desc`,
      [projectId],
    );

    return reply.send(result.rows);
  },
);

app.post<{
  Params: { projectId: string };
  Body: { name?: string; slug?: string; entrypoint?: string; verify_jwt?: boolean };
}>(
  "/projects/:projectId/functions",
  async (request, reply) => {
    const { projectId } = request.params;
    const { name, slug, entrypoint, verify_jwt } = request.body ?? {};

    if (!(await projectExists(projectId))) {
      return reply.code(404).send({ error: "Project not found" });
    }
    if (!name?.trim()) {
      return reply.code(400).send({ error: "Function name is required" });
    }

    const normalizedSlug = (slug?.trim() || toFunctionSlug(name)).toLowerCase();
    if (!isValidFunctionSlug(normalizedSlug)) {
      return reply.code(400).send({ error: "Function slug must use lowercase letters, numbers, dashes, or underscores" });
    }

    try {
      const result = await pgClient.query<EdgeFunction>(
        `insert into admin.edge_functions (project_id, name, slug, entrypoint, verify_jwt)
         values ($1, $2, $3, $4, $5)
         returning *, null::int as latest_version, null::timestamptz as last_deployed_at`,
        [
          projectId,
          name.trim(),
          normalizedSlug,
          entrypoint?.trim() || "index.ts",
          verify_jwt ?? true,
        ],
      );
      return reply.code(201).send(result.rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        return reply.code(409).send({ error: "Function slug already exists in this project" });
      }
      request.log.error(error);
      return reply.code(500).send({ error: "Failed to create function" });
    }
  },
);

app.get<{ Params: { projectId: string; functionId: string } }>(
  "/projects/:projectId/functions/:functionId",
  async (request, reply) => {
    const { projectId, functionId } = request.params;
    const result = await pgClient.query<EdgeFunction>(
      `select
         f.*,
         d.version as latest_version,
         d.created_at as last_deployed_at
       from admin.edge_functions f
       left join lateral (
         select version, created_at
         from admin.edge_function_deployments
         where function_id = f.id
         order by version desc
         limit 1
       ) d on true
       where f.project_id = $1 and f.id = $2`,
      [projectId, functionId],
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: "Function not found" });
    }
    return reply.send(result.rows[0]);
  },
);

app.patch<{
  Params: { projectId: string; functionId: string };
  Body: { name?: string; slug?: string; entrypoint?: string; verify_jwt?: boolean; status?: EdgeFunction["status"] };
}>(
  "/projects/:projectId/functions/:functionId",
  async (request, reply) => {
    const { projectId, functionId } = request.params;
    const { name, slug, entrypoint, verify_jwt, status } = request.body ?? {};

    if (slug !== undefined && !isValidFunctionSlug(slug.trim().toLowerCase())) {
      return reply.code(400).send({ error: "Function slug must use lowercase letters, numbers, dashes, or underscores" });
    }
    if (status !== undefined && !["draft", "deployed", "failed", "disabled"].includes(status)) {
      return reply.code(400).send({ error: "Invalid function status" });
    }

    try {
      const result = await pgClient.query<EdgeFunction>(
        `update admin.edge_functions set
           name       = coalesce($1, name),
           slug       = coalesce($2, slug),
           entrypoint = coalesce($3, entrypoint),
           verify_jwt = coalesce($4::boolean, verify_jwt),
           status     = coalesce($5, status),
           updated_at = now()
         where project_id = $6 and id = $7
         returning *, null::int as latest_version, null::timestamptz as last_deployed_at`,
        [
          name?.trim() || null,
          slug?.trim().toLowerCase() || null,
          entrypoint?.trim() || null,
          verify_jwt ?? null,
          status ?? null,
          projectId,
          functionId,
        ],
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: "Function not found" });
      }
      return reply.send(result.rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        return reply.code(409).send({ error: "Function slug already exists in this project" });
      }
      request.log.error(error);
      return reply.code(500).send({ error: "Failed to update function" });
    }
  },
);

app.delete<{ Params: { projectId: string; functionId: string } }>(
  "/projects/:projectId/functions/:functionId",
  async (request, reply) => {
    const { projectId, functionId } = request.params;
    const result = await pgClient.query(
      "delete from admin.edge_functions where project_id = $1 and id = $2 returning id",
      [projectId, functionId],
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: "Function not found" });
    }
    return reply.code(204).send();
  },
);

app.get<{ Params: { projectId: string; functionId: string } }>(
  "/projects/:projectId/functions/:functionId/deployments",
  async (request, reply) => {
    const { projectId, functionId } = request.params;
    const result = await pgClient.query<EdgeFunctionDeployment>(
      `select d.*
       from admin.edge_function_deployments d
       join admin.edge_functions f on f.id = d.function_id
       where f.project_id = $1 and f.id = $2
       order by d.version desc`,
      [projectId, functionId],
    );
    return reply.send(result.rows);
  },
);

app.post<{
  Params: { projectId: string; functionId: string };
  Body: { source?: string; status?: EdgeFunctionDeployment["status"] };
}>(
  "/projects/:projectId/functions/:functionId/deployments",
  async (request, reply) => {
    const { projectId, functionId } = request.params;
    const { source, status } = request.body ?? {};
    const deploymentStatus = status ?? "created";

    if (!["created", "deployed", "failed"].includes(deploymentStatus)) {
      return reply.code(400).send({ error: "Invalid deployment status" });
    }

    try {
      const result = await pgClient.query<EdgeFunctionDeployment>(
        `with next_version as (
           select coalesce(max(d.version), 0) + 1 as version
           from admin.edge_function_deployments d
           join admin.edge_functions f on f.id = d.function_id
           where f.project_id = $1 and f.id = $2
         )
         insert into admin.edge_function_deployments (function_id, version, source, status)
         select $2, version, $3, $4 from next_version
         where exists (
           select 1 from admin.edge_functions where project_id = $1 and id = $2
         )
         returning *`,
        [projectId, functionId, source ?? null, deploymentStatus],
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: "Function not found" });
      }

      if (deploymentStatus === "deployed") {
        if (!source) {
          return reply.code(400).send({ error: "source is required for deployed status" });
        }
        const fnRow = await pgClient.query<{ slug: string }>(
          "select slug from admin.edge_functions where id = $1",
          [functionId],
        );
        const slug = fnRow.rows[0]?.slug;
        if (!slug) {
          return reply.code(404).send({ error: "Function not found" });
        }
        const fnDir = path.join(functionsDir, projectId, slug);
        await mkdir(fnDir, { recursive: true });
        await writeFile(path.join(fnDir, "index.ts"), source, "utf8");
        await pgClient.query(
          "update admin.edge_functions set status = 'deployed', updated_at = now() where id = $1",
          [functionId],
        );
      }

      return reply.code(201).send(result.rows[0]);
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "Failed to create deployment" });
    }
  },
);

// ─── Project-scoped Secrets ───────────────────────────────────────────────────

app.get<{ Params: { projectId: string } }>(
  "/projects/:projectId/secrets",
  async (request, reply) => {
    const { projectId } = request.params;
    if (!(await projectExists(projectId))) {
      return reply.code(404).send({ error: "Project not found" });
    }
    const result = await pgClient.query(
      "SELECT name, value, updated_at FROM admin.project_secrets WHERE project_id = $1 ORDER BY name",
      [projectId],
    );
    const rows = result.rows.map((r) => ({
      name: r.name,
      digest: createHash("sha256").update(r.value).digest("hex").slice(0, 16),
      updated_at: r.updated_at,
    }));
    return reply.send(rows);
  },
);

app.post<{ Params: { projectId: string }; Body: { secrets: { name: string; value: string }[] } }>(
  "/projects/:projectId/secrets",
  async (request, reply) => {
    const { projectId } = request.params;
    if (!(await projectExists(projectId))) {
      return reply.code(404).send({ error: "Project not found" });
    }
    const { secrets } = request.body;
    if (!Array.isArray(secrets) || secrets.length === 0)
      return reply.code(400).send({ error: "secrets array is required" });
    for (const s of secrets) {
      if (!s.name || !s.name.trim())
        return reply.code(400).send({ error: "Each secret must have a name" });
    }
    for (const s of secrets) {
      await pgClient.query(
        `INSERT INTO admin.project_secrets (project_id, name, value, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (project_id, name) DO UPDATE SET value = $3, updated_at = now()`,
        [projectId, s.name.trim(), s.value],
      );
    }
    return reply.code(204).send();
  },
);

app.delete<{ Params: { projectId: string; name: string } }>(
  "/projects/:projectId/secrets/:name",
  async (request, reply) => {
    const { projectId, name } = request.params;
    if (!(await projectExists(projectId))) {
      return reply.code(404).send({ error: "Project not found" });
    }
    await pgClient.query("DELETE FROM admin.project_secrets WHERE project_id = $1 AND name = $2", [
      projectId,
      name,
    ]);
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

// ─── Storage ─────────────────────────────────────────────────────────────────
//
// Bucket CRUD is served directly from the admin DB connection (no proxy hop).
// File operations (list/upload/download/delete) proxy to the storage service
// using a freshly-minted service-role JWT scoped to the project, so the storage
// service stays the single owner of disk I/O.

type StorageBucket = {
  id: string;
  name: string;
  public: boolean;
  owner_id: string;
  project_id: string;
  private_user_scoped: boolean;
  created_at: string;
  updated_at: string;
  file_count: number;
};

type StorageFile = {
  id: string;
  bucket_id: string;
  name: string;
  size: number;
  content_type: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
};

async function projectServiceRoleToken(projectId: string): Promise<string> {
  return signProjectJwt({
    sub: projectId,
    role: "service_role",
    project_id: projectId,
    expiresInSeconds: 60 * 5,
  });
}

app.get<{ Params: { projectId: string } }>(
  "/projects/:projectId/buckets",
  async (request, reply) => {
    const { projectId } = request.params;
    if (!(await projectExists(projectId))) {
      return reply.code(404).send({ error: "Project not found" });
    }
    const result = await pgClient.query<StorageBucket>(
      `select b.id, b.name, b.public, b.owner_id, b.project_id, b.private_user_scoped,
              b.created_at, b.updated_at,
              coalesce((select count(*)::int from storage.files f where f.bucket_id = b.id), 0) as file_count
       from storage.buckets b
       where b.project_id = $1
       order by b.created_at desc`,
      [projectId],
    );
    return reply.send(result.rows);
  },
);

app.post<{
  Params: { projectId: string };
  Body: { name: string; public?: boolean; private_user_scoped?: boolean };
}>(
  "/projects/:projectId/buckets",
  async (request, reply) => {
    const { projectId } = request.params;
    const { name, public: publicAccess, private_user_scoped } = request.body;
    const user = request.user;
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    if (!name || !/^[a-z0-9][a-z0-9._-]{0,62}$/.test(name)) {
      return reply.code(400).send({
        error: "Bucket name must be 1-63 chars: lowercase letters, digits, '.', '_', '-'",
      });
    }
    if (publicAccess && private_user_scoped) {
      return reply.code(400).send({ error: "Cannot combine public with private_user_scoped" });
    }
    if (!(await projectExists(projectId))) {
      return reply.code(404).send({ error: "Project not found" });
    }

    const id = randomUUID();
    try {
      const result = await pgClient.query<StorageBucket>(
        `insert into storage.buckets (id, name, public, owner_id, project_id, private_user_scoped)
         values ($1, $2, $3, $4, $5, $6)
         returning id, name, public, owner_id, project_id, private_user_scoped, created_at, updated_at,
                   0::int as file_count`,
        [id, name, !!publicAccess, user.sub, projectId, !!private_user_scoped],
      );
      // Ask the storage service to create the on-disk directory by proxying
      // through with a service-role token. Easier than mounting the volume here.
      const token = await projectServiceRoleToken(projectId);
      await fetch(`${storageUrl}/health`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
      return reply.code(201).send(result.rows[0]);
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === "23505") {
        return reply.code(409).send({ error: "Bucket name already exists in this project" });
      }
      request.log.error({ err: error }, "create bucket failed");
      return reply.code(500).send({ error: "Failed to create bucket" });
    }
  },
);

app.delete<{ Params: { projectId: string; bucketName: string } }>(
  "/projects/:projectId/buckets/:bucketName",
  async (request, reply) => {
    const { projectId, bucketName } = request.params;
    const token = await projectServiceRoleToken(projectId);
    const res = await fetch(`${storageUrl}/bucket/${encodeURIComponent(bucketName)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 404) return reply.code(404).send({ error: "Bucket not found" });
    if (!res.ok) {
      const body = await res.text();
      request.log.error({ status: res.status, body }, "delete bucket failed");
      return reply.code(502).send({ error: "Storage service error" });
    }
    return reply.code(204).send();
  },
);

app.get<{ Params: { projectId: string; bucketName: string } }>(
  "/projects/:projectId/buckets/:bucketName/files",
  async (request, reply) => {
    const { projectId, bucketName } = request.params;
    const token = await projectServiceRoleToken(projectId);
    const res = await fetch(`${storageUrl}/object/${encodeURIComponent(bucketName)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 404) return reply.code(404).send({ error: "Bucket not found" });
    if (!res.ok) {
      return reply.code(502).send({ error: "Storage service error" });
    }
    const files = (await res.json()) as StorageFile[];
    return reply.send(files);
  },
);

app.get<{ Params: { projectId: string; bucketName: string; "*": string } }>(
  "/projects/:projectId/buckets/:bucketName/files/*",
  async (request, reply) => {
    const { projectId, bucketName } = request.params;
    const fileName = (request.params as Record<string, string>)["*"] ?? "";
    if (!fileName) return reply.code(400).send({ error: "File name required" });
    const token = await projectServiceRoleToken(projectId);
    const res = await fetch(
      `${storageUrl}/object/${encodeURIComponent(bucketName)}/${fileName.split("/").map(encodeURIComponent).join("/")}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (res.status === 404) return reply.code(404).send({ error: "File not found" });
    if (!res.ok) return reply.code(502).send({ error: "Storage service error" });
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    const buffer = Buffer.from(await res.arrayBuffer());
    reply.header("Content-Type", contentType);
    reply.header("Content-Length", buffer.length);
    return reply.send(buffer);
  },
);

app.post<{ Params: { projectId: string; bucketName: string; "*": string } }>(
  "/projects/:projectId/buckets/:bucketName/files/*",
  async (request, reply) => {
    const { projectId, bucketName } = request.params;
    const fileName = (request.params as Record<string, string>)["*"] ?? "";
    if (!fileName) return reply.code(400).send({ error: "File name required" });
    const token = await projectServiceRoleToken(projectId);
    const contentType = (request.headers["content-type"] as string) ?? "application/octet-stream";
    const body = request.body as Buffer | string;
    const res = await fetch(
      `${storageUrl}/object/${encodeURIComponent(bucketName)}/${fileName.split("/").map(encodeURIComponent).join("/")}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": contentType,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        body: body as any,
      },
    );
    if (res.status === 404) return reply.code(404).send({ error: "Bucket not found" });
    if (!res.ok) {
      const text = await res.text();
      request.log.error({ status: res.status, text }, "upload failed");
      return reply.code(502).send({ error: "Storage service error" });
    }
    const data = await res.json();
    return reply.code(201).send(data);
  },
);

app.delete<{ Params: { projectId: string; bucketName: string; "*": string } }>(
  "/projects/:projectId/buckets/:bucketName/files/*",
  async (request, reply) => {
    const { projectId, bucketName } = request.params;
    const fileName = (request.params as Record<string, string>)["*"] ?? "";
    if (!fileName) return reply.code(400).send({ error: "File name required" });
    const token = await projectServiceRoleToken(projectId);
    const res = await fetch(
      `${storageUrl}/object/${encodeURIComponent(bucketName)}/${fileName.split("/").map(encodeURIComponent).join("/")}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
    );
    if (res.status === 404) return reply.code(404).send({ error: "File not found" });
    if (!res.ok) return reply.code(502).send({ error: "Storage service error" });
    return reply.code(204).send();
  },
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

function isValidFunctionSlug(s: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,62}$/.test(s);
}

function toFunctionSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

async function projectExists(projectId: string): Promise<boolean> {
  const result = await pgClient.query("select 1 from admin.projects where id = $1", [projectId]);
  return result.rows.length > 0;
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
  project_id?: string;
  secret?: string;
  expiresInSeconds?: number;
}) {
  const { SignJWT } = await import("jose");
  const now = Math.floor(Date.now() / 1000);
  const secret = new TextEncoder().encode(options.secret ?? DEFAULT_JWT_SECRET);

  return new SignJWT({
    role: options.role ?? "authenticated",
    email: options.email,
    ...(options.project_id ? { project_id: options.project_id } : {}),
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
      private_user_scoped boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await pgClient.query(`alter table storage.buckets add column if not exists private_user_scoped boolean not null default false`);
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

  // admin tables — must be created before per-project isolation columns reference them
  await pgClient.query(`
    create table if not exists admin.projects (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      description text,
      owner_id uuid references auth.users(id) on delete set null,
      region text not null default 'us-east-1',
      supabase_ref text unique,
      schema_name text unique,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  // add new columns to existing projects table if upgrading
  await pgClient.query(`alter table admin.projects add column if not exists supabase_ref text unique`);
  await pgClient.query(`alter table admin.projects add column if not exists schema_name text unique`);

  // edge function metadata
  await pgClient.query(`
    create table if not exists admin.edge_functions (
      id uuid primary key default gen_random_uuid(),
      project_id uuid not null references admin.projects(id) on delete cascade,
      name text not null,
      slug text not null,
      status text not null default 'draft'
        check (status in ('draft', 'deployed', 'failed', 'disabled')),
      entrypoint text not null default 'index.ts',
      verify_jwt boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (project_id, slug)
    )
  `);
  await pgClient.query(`
    create table if not exists admin.edge_function_deployments (
      id uuid primary key default gen_random_uuid(),
      function_id uuid not null references admin.edge_functions(id) on delete cascade,
      version integer not null,
      source text,
      status text not null default 'created'
        check (status in ('created', 'deployed', 'failed')),
      created_at timestamptz not null default now(),
      unique (function_id, version)
    )
  `);

  // project-scoped secrets
  await pgClient.query(`
    create table if not exists admin.project_secrets (
      project_id uuid not null references admin.projects(id) on delete cascade,
      name text not null,
      value text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (project_id, name)
    )
  `);

  // per-project isolation columns
  await pgClient.query(`alter table auth.users add column if not exists project_id uuid references admin.projects(id) on delete set null`);
  await pgClient.query(`alter table storage.buckets add column if not exists project_id uuid references admin.projects(id) on delete set null`);
  await pgClient.query(`alter table storage.files add column if not exists project_id uuid references admin.projects(id) on delete set null`);
  await pgClient.query(`alter table auth.refresh_tokens add column if not exists project_id uuid references admin.projects(id) on delete set null`);

  await pgClient.query(`
    create table if not exists admin.project_members (
      project_id uuid not null references admin.projects(id) on delete cascade,
      user_id uuid not null references auth.users(id) on delete cascade,
      created_at timestamptz not null default now(),
      primary key (project_id, user_id)
    )
  `);

  await pgClient.query(`
    create table if not exists admin.migrations (
      id uuid primary key default gen_random_uuid(),
      project_id uuid references admin.projects(id) on delete cascade,
      name text not null,
      sql text not null,
      status text not null default 'pending' check (status in ('pending','applied','failed','rolled_back')),
      applied_at timestamptz,
      error text,
      created_at timestamptz default now()
    )
  `);
}

// ─── Health: containers ───────────────────────────────────────────────────────
app.get("/health/containers", async (_request, reply) => {
  try {
    const containers = await docker.listContainers({ all: true });
    const infra = containers.filter(c => c.Names.some(n => n.replace(/^\//, "").startsWith("infra-")));
    const results = await Promise.all(infra.map(async (c) => {
      const name = c.Names[0].replace(/^\//, "");
      let cpu_percent = 0, memory_mb = 0, memory_limit_mb = 0, uptime_seconds = 0;
      if (c.State === "running") {
        try {
          const container = docker.getContainer(c.Id);
          const [stats, info] = await Promise.all([
            new Promise<any>((res, rej) => container.stats({ stream: false }, (err: any, d: any) => err ? rej(err) : res(d))),
            container.inspect(),
          ]);
          const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
          const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
          const numCPUs = stats.cpu_stats.online_cpus || 1;
          cpu_percent = systemDelta > 0 ? (cpuDelta / systemDelta) * numCPUs * 100 : 0;
          memory_mb = stats.memory_stats.usage / 1024 / 1024;
          memory_limit_mb = stats.memory_stats.limit / 1024 / 1024;
          const started = new Date(info.State.StartedAt).getTime();
          uptime_seconds = Math.floor((Date.now() - started) / 1000);
        } catch { /* stats unavailable */ }
      }
      return { name, id: c.Id.slice(0, 12), status: c.Status, state: c.State, uptime_seconds, cpu_percent: Math.round(cpu_percent * 10) / 10, memory_mb: Math.round(memory_mb), memory_limit_mb: Math.round(memory_limit_mb) };
    }));
    return reply.send(results);
  } catch (err) {
    return reply.code(500).send({ error: String(err) });
  }
});

// ─── Health: database stats ───────────────────────────────────────────────────
app.get("/health/database", async (_request, reply) => {
  try {
    const [sizeRes, schemasRes, connRes] = await Promise.all([
      pgClient.query<{ total_size: string; total_bytes: string }>("select pg_size_pretty(pg_database_size(current_database())) as total_size, pg_database_size(current_database())::text as total_bytes"),
      pgClient.query<{ schema: string; size: string; size_bytes: string }>("select n.nspname as schema, pg_size_pretty(sum(pg_total_relation_size(c.oid))::bigint) as size, sum(pg_total_relation_size(c.oid))::text as size_bytes from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname like 'proj_%' group by n.nspname order by sum(pg_total_relation_size(c.oid)) desc"),
      pgClient.query<{ active_connections: string; total_connections: string }>("select (select count(*)::text from pg_stat_activity where state = 'active') as active_connections, count(*)::text as total_connections from pg_stat_activity"),
    ]);
    return reply.send({ total_size: sizeRes.rows[0].total_size, total_bytes: sizeRes.rows[0].total_bytes, schemas: schemasRes.rows, active_connections: connRes.rows[0].active_connections, total_connections: connRes.rows[0].total_connections });
  } catch (err) {
    return reply.code(500).send({ error: String(err) });
  }
});

// ─── Health: sync PostgREST schemas ──────────────────────────────────────────
app.post("/health/sync-schemas", async (_request, reply) => {
  try {
    await refreshPostgrestSchemas();
    const res = await pgClient.query<{ schema_name: string }>("select schema_name from admin.projects where schema_name is not null");
    return reply.send({ synced: res.rows.map(r => r.schema_name), total: res.rows.length });
  } catch (err) {
    return reply.code(500).send({ error: String(err) });
  }
});

// ─── Logs: SSE stream ─────────────────────────────────────────────────────────
app.get<{ Querystring: { container?: string; tail?: string } }>(
  "/logs/stream",
  async (request, reply) => {
    const containerName = request.query.container ?? "infra-gateway-1";
    const tail = request.query.tail ?? "100";
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    try {
      const containers = await docker.listContainers({ all: false });
      const match = containers.find(c => c.Names.some(n => n.replace(/^\//, "") === containerName));
      if (!match) { reply.raw.end(`data: Container '${containerName}' not found\n\n`); return; }
      const container = docker.getContainer(match.Id);
      const stream = await new Promise<NodeJS.ReadableStream>((res, rej) =>
        container.logs({ follow: true, stdout: true, stderr: true, tail: Number(tail) }, (err: any, s: any) => err ? rej(err) : res(s))
      );
      request.raw.on("close", () => (stream as any).destroy?.());
      stream.on("data", (chunk: Buffer) => {
        const text = chunk.slice(8).toString("utf8");
        for (const line of text.split("\n")) {
          if (line) reply.raw.write(`data: ${line}\n\n`);
        }
      });
      stream.on("end", () => reply.raw.end());
      stream.on("error", () => reply.raw.end());
    } catch (err) {
      reply.raw.write(`data: Error: ${String(err)}\n\n`);
      reply.raw.end();
    }
  }
);

// ─── Table editor: insert row ─────────────────────────────────────────────────
app.post<{ Params: { schema: string; table: string }; Body: { data: Record<string, unknown> } }>(
  "/schema/:schema/:table/rows",
  async (request, reply) => {
    const { schema, table } = request.params;
    if (!schema.startsWith("proj_") && schema !== "public") return reply.code(400).send({ error: "Invalid schema" });
    const { data } = request.body;
    if (!data || typeof data !== "object") return reply.code(400).send({ error: "data object required" });
    const keys = Object.keys(data);
    if (keys.length === 0) return reply.code(400).send({ error: "data must have at least one field" });
    const cols = keys.map(k => pg.escapeIdentifier(k)).join(", ");
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
    const values = keys.map(k => data[k]);
    try {
      const res = await pgClient.query(`insert into ${pg.escapeIdentifier(schema)}.${pg.escapeIdentifier(table)} (${cols}) values (${placeholders}) returning *`, values);
      return reply.code(201).send(res.rows[0] ?? {});
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  }
);

// ─── RLS policies ─────────────────────────────────────────────────────────────
app.get<{ Params: { schema: string; table: string } }>(
  "/schema/:schema/:table/policies",
  async (request, reply) => {
    const { schema, table } = request.params;
    if (!schema.startsWith("proj_") && schema !== "public") return reply.code(400).send({ error: "Invalid schema" });
    try {
      const res = await pgClient.query(
        "select policyname, permissive, roles, cmd, qual, with_check from pg_policies where schemaname = $1 and tablename = $2 order by policyname",
        [schema, table]
      );
      return reply.send(res.rows);
    } catch (err: any) {
      return reply.code(500).send({ error: err.message });
    }
  }
);

app.post<{ Params: { schema: string; table: string }; Body: { name: string; command: string; permissive?: boolean; roles?: string[]; using?: string; with_check?: string } }>(
  "/schema/:schema/:table/policies",
  async (request, reply) => {
    const { schema, table } = request.params;
    if (!schema.startsWith("proj_") && schema !== "public") return reply.code(400).send({ error: "Invalid schema" });
    const { name, command, permissive = true, roles = ["authenticated"], using, with_check } = request.body;
    const rolesStr = roles.map(r => pg.escapeIdentifier(r)).join(", ");
    const permStr = permissive ? "PERMISSIVE" : "RESTRICTIVE";
    let sql = `CREATE POLICY ${pg.escapeIdentifier(name)} ON ${pg.escapeIdentifier(schema)}.${pg.escapeIdentifier(table)} AS ${permStr} FOR ${command} TO ${rolesStr}`;
    if (using) sql += ` USING (${using})`;
    if (with_check) sql += ` WITH CHECK (${with_check})`;
    try {
      await pgClient.query(sql);
      return reply.code(201).send({ name, command, permissive, roles, using, with_check });
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  }
);

app.delete<{ Params: { schema: string; table: string; policyName: string } }>(
  "/schema/:schema/:table/policies/:policyName",
  async (request, reply) => {
    const { schema, table, policyName } = request.params;
    if (!schema.startsWith("proj_") && schema !== "public") return reply.code(400).send({ error: "Invalid schema" });
    try {
      await pgClient.query(`DROP POLICY IF EXISTS ${pg.escapeIdentifier(policyName)} ON ${pg.escapeIdentifier(schema)}.${pg.escapeIdentifier(table)}`);
      return reply.code(204).send();
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  }
);

// ─── Migrations ───────────────────────────────────────────────────────────────
app.get<{ Params: { projectId: string } }>(
  "/projects/:projectId/migrations",
  async (request, reply) => {
    const { projectId } = request.params;
    const res = await pgClient.query("select * from admin.migrations where project_id = $1 order by created_at asc", [projectId]);
    return reply.send(res.rows);
  }
);

app.post<{ Params: { projectId: string }; Body: { name: string; sql: string } }>(
  "/projects/:projectId/migrations",
  async (request, reply) => {
    const { projectId } = request.params;
    const { name, sql } = request.body;
    if (!name || !sql) return reply.code(400).send({ error: "name and sql required" });
    const res = await pgClient.query(
      "insert into admin.migrations (project_id, name, sql) values ($1, $2, $3) returning *",
      [projectId, name, sql]
    );
    return reply.code(201).send(res.rows[0]);
  }
);

app.post<{ Params: { projectId: string; migrationId: string } }>(
  "/projects/:projectId/migrations/:migrationId/apply",
  async (request, reply) => {
    const { migrationId } = request.params;
    const migRes = await pgClient.query("select * from admin.migrations where id = $1", [migrationId]);
    const migration = migRes.rows[0];
    if (!migration) return reply.code(404).send({ error: "Migration not found" });
    if (migration.status === "applied") return reply.code(400).send({ error: "Already applied" });
    try {
      await pgClient.query(migration.sql);
      const updated = await pgClient.query(
        "update admin.migrations set status = 'applied', applied_at = now(), error = null where id = $1 returning *",
        [migrationId]
      );
      return reply.send(updated.rows[0]);
    } catch (err: any) {
      await pgClient.query("update admin.migrations set status = 'failed', error = $1 where id = $2", [err.message, migrationId]);
      return reply.code(400).send({ error: err.message });
    }
  }
);

app.post<{ Params: { projectId: string; migrationId: string } }>(
  "/projects/:projectId/migrations/:migrationId/rollback",
  async (request, reply) => {
    const { migrationId } = request.params;
    const res = await pgClient.query(
      "update admin.migrations set status = 'rolled_back' where id = $1 returning *",
      [migrationId]
    );
    if (!res.rows[0]) return reply.code(404).send({ error: "Migration not found" });
    return reply.send(res.rows[0]);
  }
);

app.delete<{ Params: { projectId: string; migrationId: string } }>(
  "/projects/:projectId/migrations/:migrationId",
  async (request, reply) => {
    const { migrationId } = request.params;
    const check = await pgClient.query("select status from admin.migrations where id = $1", [migrationId]);
    if (!check.rows[0]) return reply.code(404).send({ error: "Migration not found" });
    if (check.rows[0].status !== "pending") return reply.code(400).send({ error: "Only pending migrations can be deleted" });
    await pgClient.query("delete from admin.migrations where id = $1", [migrationId]);
    return reply.code(204).send();
  }
);

// ─── User invite tokens ───────────────────────────────────────────────────────
app.post<{ Params: { userId: string } }>(
  "/users/:userId/invite-token",
  async (request, reply) => {
    const { userId } = request.params;
    const token = randomBytes(32).toString("base64url");
    await pgClient.query(
      "insert into auth.password_reset_tokens (token, user_id) values ($1, $2)",
      [token, userId]
    );
    const res = await pgClient.query<{ expires_at: Date }>(
      "select expires_at from auth.password_reset_tokens where token = $1",
      [token]
    );
    return reply.code(201).send({ token, expires_at: res.rows[0]?.expires_at });
  }
);

app.get<{ Params: { userId: string } }>(
  "/users/:userId/reset-tokens",
  async (request, reply) => {
    const { userId } = request.params;
    const res = await pgClient.query(
      "select token, expires_at from auth.password_reset_tokens where user_id = $1 and expires_at > now() order by expires_at asc",
      [userId]
    );
    return reply.send(res.rows);
  }
);

app.delete<{ Params: { userId: string; token: string } }>(
  "/users/:userId/reset-tokens/:token",
  async (request, reply) => {
    const { userId, token } = request.params;
    await pgClient.query(
      "delete from auth.password_reset_tokens where token = $1 and user_id = $2",
      [token, userId]
    );
    return reply.code(204).send();
  }
);

async function main() {
  console.log(`Initializing database schema...`);
  await initSchema();
  await refreshPostgrestSchemas();
  console.log(`Schema ready. Starting admin service on port ${port}`);
  await app.listen({ host: "0.0.0.0", port });
  console.log(`Admin service listening on port ${port}`);
}

main().catch((error) => {
  console.error("Failed to start admin server:", error);
  process.exit(1);
});
