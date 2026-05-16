import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { Client } from "pg";
import { jwtVerify } from "jose";
import { DEFAULT_JWT_SECRET } from "@local/jwt";

const port = Number(process.env.ADMIN_PORT ?? 54325);
const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/app";

const pgClient = new Client({ connectionString: databaseUrl });

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

async function main() {
  await pgClient.connect();
  console.log(`PostgreSQL connected for admin`);

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

  await app.listen({ host: "0.0.0.0", port });
  console.log(`Admin service listening on port ${port}`);
}

main().catch((error) => {
  console.error("Failed to start admin server:", error);
  process.exit(1);
});