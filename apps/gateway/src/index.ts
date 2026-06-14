import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import cors from "@fastify/cors";
import proxy from "@fastify/http-proxy";
import Fastify from "fastify";
import { jwtVerify } from "jose";
import pg from "pg";
import { DEFAULT_JWT_SECRET, signProjectJwt } from "@local/jwt";

const port = Number(process.env.GATEWAY_PORT ?? 54321);
const postgrestUrl = process.env.POSTGREST_URL ?? "http://localhost:3100";
const functionsUrl = process.env.FUNCTIONS_URL ?? "http://localhost:54322";
const realtimeUrl = process.env.REALTIME_URL ?? "http://localhost:54323";
const storageUrl = process.env.STORAGE_URL ?? "http://localhost:54324";
const adminUrl = process.env.ADMIN_URL ?? "http://localhost:54325";
const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:***@localhost:5432/app";

const scrypt = promisify(scryptCallback);
const pool = new pg.Pool({ connectionString: databaseUrl });

const app = Fastify({ logger: true });

await app.register(cors, { origin: true, credentials: true });

type AuthUser = {
  id: string;
  email: string;
  encrypted_password: string;
  created_at: Date;
  project_id: string | null;
};

type AuthBody = {
  email?: string;
  password?: string;
  refresh_token?: string;
};

type ApiKeyClaims = {
  projectId: string;
  keyId: string;
  scopes: string[];
};

function toAuthUser(user: Pick<AuthUser, "id" | "email" | "created_at">) {
  return {
    id: user.id,
    aud: "authenticated",
    role: "authenticated",
    email: user.email,
    email_confirmed_at: user.created_at.toISOString(),
    phone: "",
    confirmed_at: user.created_at.toISOString(),
    last_sign_in_at: new Date().toISOString(),
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [],
    created_at: user.created_at.toISOString(),
    updated_at: user.created_at.toISOString(),
  };
}

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;

  return `scrypt:${salt}:${derivedKey.toString("hex")}`;
}

async function verifyPassword(password: string, storedHash: string) {
  const [algorithm, salt, hash] = storedHash.split(":");

  if (algorithm !== "scrypt" || !salt || !hash) {
    return false;
  }

  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  const storedKey = Buffer.from(hash, "hex");

  return storedKey.length === derivedKey.length && timingSafeEqual(storedKey, derivedKey);
}

async function createSession(user: Pick<AuthUser, "id" | "email" | "created_at" | "project_id">) {
  const refreshToken = randomBytes(32).toString("base64url");
  const accessToken = await signProjectJwt({
    sub: user.id,
    role: "authenticated",
    email: user.email,
    project_id: user.project_id ?? undefined,
  });

  await pool.query(
    "insert into auth.refresh_tokens (token, user_id, project_id) values ($1, $2, $3)",
    [refreshToken, user.id, user.project_id ?? null],
  );

  return {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: refreshToken,
    user: toAuthUser(user),
  };
}

async function getProjectIdFromRequest(request: { headers: Record<string, string | string[] | undefined>; query: unknown }): Promise<string | null> {
  const apikey = (request.headers["apikey"] as string | undefined) ||
                 ((request.query as Record<string, string>)?.apikey);
  if (!apikey) return null;
  try {
    const { payload } = await jwtVerify(apikey, new TextEncoder().encode(DEFAULT_JWT_SECRET));
    if ((payload.role === "anon" || payload.role === "service_role") && typeof payload.sub === "string") {
      return payload.sub;
    }
  } catch { /* invalid key */ }
  return null;
}

function getProjectIdFromPath(url: string): string | null {
  const match = url.match(/^\/p\/([a-f0-9-]{36})\//);
  return match ? match[1] : null;
}

async function validateApiKey(request: { headers: Record<string, string | string[] | undefined>; query: unknown }): Promise<ApiKeyClaims | null> {
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
  }
  >(
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

function getCredentials(body: AuthBody | undefined) {
  const email = body?.email?.trim().toLowerCase();
  const password = body?.password;

  if (!email || !password) {
    return null;
  }

  return { email, password };
}

function getBearerToken(authorization: string | undefined) {
  const [scheme, token] = authorization?.split(" ") ?? [];

  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

async function getClaimsFromJwt(authorization: string | undefined) {
  const token = getBearerToken(authorization);

  if (!token) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(DEFAULT_JWT_SECRET),
    );

    return payload;
  } catch {
    return null;
  }
}

async function getAuthenticatedUserIdFromJwt(authorization: string | undefined) {
  const payload = await getClaimsFromJwt(authorization);

  if (
    !payload ||
    payload.role !== "authenticated" ||
    typeof payload.sub !== "string"
  ) {
    return null;
  }

  return payload.sub;
}

app.get("/health", async () => ({ ok: true }));

// ─── Global hook: validate x-api-key and inject synthetic JWT ────────────────
app.addHook("onRequest", async (request, _reply) => {
  const apiKeyClaims = await validateApiKey(request);
  if (apiKeyClaims) {
    (request as any).apiKey = apiKeyClaims;
    const syntheticToken = await signProjectJwt({
      sub: apiKeyClaims.keyId,
      role: "service_role",
      project_id: apiKeyClaims.projectId,
    });
    request.headers.authorization = `Bearer ${syntheticToken}`;
  }
});

// ─── Auth route factory ───────────────────────────────────────────────────────
async function registerAuthRoutes(
  instance: any,
  getProjectId: (req: any) => Promise<string | null>
) {
  instance.removeContentTypeParser("application/json");
  instance.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_request: any, body: any, done: any) => {
      if (!body) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(body as string));
      } catch (error) {
        done(error as Error);
      }
    },
  );

  instance.post("/signup", async (request: any, reply: any) => {
    const projectId = await getProjectId(request);
    const credentials = getCredentials(request.body as AuthBody | undefined);

    if (!credentials) {
      return reply.code(400).send({ msg: "Email and password are required" });
    }

    const id = randomUUID();
    const encryptedPassword = await hashPassword(credentials.password);

    try {
      const result = await pool.query<AuthUser>(
        "insert into auth.users (id, email, encrypted_password, project_id) values ($1, $2, $3, $4) returning id, email, encrypted_password, created_at, project_id",
        [id, credentials.email, encryptedPassword, projectId],
      );

      return reply.send(await createSession(result.rows[0]));
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        return reply.code(422).send({ msg: "User already registered" });
      }

      request.log.error(error);
      return reply.code(500).send({ msg: "Could not create user" });
    }
  });

  instance.post("/token", async (request: any, reply: any) => {
    const grantType = (request.query as { grant_type?: string }).grant_type;
    const projectId = await getProjectId(request);

    if (grantType === "refresh_token") {
      const body = request.body as AuthBody | undefined;

      if (!body?.refresh_token) {
        return reply.code(400).send({ msg: "Refresh token is required" });
      }

      const result = await pool.query<AuthUser>(
        `select u.id, u.email, u.encrypted_password, u.created_at, u.project_id
         from auth.refresh_tokens rt
         join auth.users u on u.id = rt.user_id
         where rt.token = $1`,
        [body.refresh_token],
      );
      const user = result.rows[0];

      if (!user) {
        return reply.code(400).send({ msg: "Invalid refresh token" });
      }

      await pool.query("delete from auth.refresh_tokens where token = $1", [
        body.refresh_token,
      ]);

      return reply.send(await createSession(user));
    }

    if (grantType !== "password") {
      return reply.code(400).send({ msg: "Unsupported grant type" });
    }

    const credentials = getCredentials(request.body as AuthBody | undefined);

    if (!credentials) {
      return reply.code(400).send({ msg: "Email and password are required" });
    }

    const result = await pool.query<AuthUser>(
      `select id, email, encrypted_password, created_at, project_id from auth.users
       where email = $1 and (project_id = $2 or project_id is null or $2 is null)`,
      [credentials.email, projectId],
    );
    const user = result.rows[0];

    if (!user || !(await verifyPassword(credentials.password, user.encrypted_password))) {
      return reply.code(400).send({ msg: "Invalid login credentials" });
    }

    return reply.send(await createSession(user));
  });

  instance.get("/user", async (request: any, reply: any) => {
    const userId = await getAuthenticatedUserIdFromJwt(
      request.headers.authorization,
    );

    if (!userId) {
      return reply.code(401).send({ msg: "Invalid JWT" });
    }

    const result = await pool.query<AuthUser>(
      "select id, email, encrypted_password, created_at, project_id from auth.users where id = $1",
      [userId],
    );
    const user = result.rows[0];

    if (!user) {
      return reply.code(401).send({ msg: "User not found" });
    }

    return reply.send(toAuthUser(user));
  });

  instance.post("/logout", async (request: any, reply: any) => {
    const userId = await getAuthenticatedUserIdFromJwt(
      request.headers.authorization,
    );

    if (!userId) {
      return reply.code(401).send({ msg: "Invalid JWT" });
    }

    await pool.query("delete from auth.refresh_tokens where user_id = $1", [
      userId,
    ]);

    return reply.send({});
  });

  instance.post("/recover", async (request: any, reply: any) => {
    const body = request.body as { email?: string } | undefined;
    const email = body?.email?.trim().toLowerCase();

    if (!email) {
      return reply.code(400).send({ msg: "Email is required" });
    }

    const result = await pool.query<AuthUser>(
      "select id from auth.users where email = $1",
      [email],
    );
    const user = result.rows[0];

    if (!user) {
      // Don't reveal whether the email exists
      return reply.send({ msg: "If that email is registered, a reset token has been generated." });
    }

    const token = randomBytes(32).toString("base64url");
    await pool.query(
      "insert into auth.password_reset_tokens (token, user_id) values ($1, $2)",
      [token, user.id],
    );

    return reply.send({ reset_token: token, msg: "If that email is registered, a reset token has been generated." });
  });

  instance.post("/reset", async (request: any, reply: any) => {
    const body = request.body as { token?: string; password?: string } | undefined;

    if (!body?.token || !body?.password) {
      return reply.code(400).send({ msg: "Token and password are required" });
    }

    const result = await pool.query<{ user_id: string; expires_at: Date }>(
      "select user_id, expires_at from auth.password_reset_tokens where token = $1",
      [body.token],
    );
    const row = result.rows[0];

    if (!row) {
      return reply.code(400).send({ msg: "Invalid or expired reset token" });
    }

    if (new Date() > row.expires_at) {
      await pool.query("delete from auth.password_reset_tokens where token = $1", [body.token]);
      return reply.code(400).send({ msg: "Reset token has expired" });
    }

    const encryptedPassword = await hashPassword(body.password);
    await pool.query(
      "update auth.users set encrypted_password = $1 where id = $2",
      [encryptedPassword, row.user_id],
    );
    await pool.query("delete from auth.password_reset_tokens where token = $1", [body.token]);

    return reply.send({ msg: "Password updated successfully" });
  });
}

// ─── Existing top-level auth ──────────────────────────────────────────────────
await app.register(async (auth) => {
  await registerAuthRoutes(auth, getProjectIdFromRequest);
}, { prefix: "/auth/v1" });

// ─── Per-project auth ─────────────────────────────────────────────────────────
await app.register(async (auth) => {
  await registerAuthRoutes(auth, async (req) => {
    const pid = getProjectIdFromPath(req.url);
    if (pid) return pid;
    return getProjectIdFromRequest(req as never);
  });
}, { prefix: "/p/:projectId/auth/v1" });

// ─── Scope enforcement helper ─────────────────────────────────────────────────
function addScopePreHandler(instance: any) {
  instance.addHook("preHandler", async (request: any, reply: any) => {
    const apiKey = request.apiKey as ApiKeyClaims | undefined;
    if (!apiKey) return;
    const writeOps = ["POST", "PATCH", "PUT", "DELETE"];
    if (writeOps.includes(request.method) && !apiKey.scopes.includes("write")) {
      return reply.code(403).send({ error: "API key scope denied: write required" });
    }
    if (["GET", "HEAD"].includes(request.method) && !apiKey.scopes.includes("read")) {
      return reply.code(403).send({ error: "API key scope denied: read required" });
    }
  });
}

// ─── REST proxies with schema injection ───────────────────────────────────────

// Top-level REST
await app.register(async (rest) => {
  addScopePreHandler(rest);
  await rest.register(proxy, {
    upstream: postgrestUrl,
    prefix: "/rest/v1",
    rewritePrefix: "",
    replyOptions: {
      rewriteRequestHeaders: (_req, headers) => {
        const auth = (headers["authorization"] as string | undefined) ?? "";
        if (auth.startsWith("Bearer ")) {
          try {
            const payload = JSON.parse(
              Buffer.from(auth.slice(7).split(".")[1], "base64url").toString()
            );
            const projectId: string | undefined = payload.project_id ?? payload.sub;
            if (projectId) {
              const schema = "proj_" + projectId.replace(/-/g, "").slice(0, 16);
              return { ...headers, "accept-profile": schema, "content-profile": schema };
            }
          } catch {}
        }
        return headers;
      },
    },
  });
});

// Per-project REST
await app.register(async (rest) => {
  rest.addHook("onRequest", async (request, reply) => {
    const projectId = getProjectIdFromPath(request.url);
    if (!projectId) {
      return reply.code(400).send({ error: "Missing project ID in path" });
    }
    (request as any).projectId = projectId;
  });
  addScopePreHandler(rest);
  await rest.register(proxy, {
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
});

// ─── Functions ────────────────────────────────────────────────────────────────
await app.register(proxy, {
  upstream: functionsUrl,
  prefix: "/functions/v1",
  rewritePrefix: "",
});

await app.register(async (child) => {
  await (child as any).register(proxy, {
    upstream: functionsUrl,
    prefix: "/p/:projectId/functions/v1",
    rewritePrefix: "",
  });
});

// ─── Realtime ─────────────────────────────────────────────────────────────────
await app.register(proxy, {
  upstream: realtimeUrl,
  prefix: "/realtime/v1",
  websocket: true,
  rewritePrefix: "",
});

await app.register(async (child) => {
  await child.register(proxy, {
    upstream: realtimeUrl,
    prefix: "/p/:projectId/realtime/v1",
    websocket: true,
    rewritePrefix: "",
  });
});

// ─── Storage ──────────────────────────────────────────────────────────────────
await app.register(async (storage) => {
  addScopePreHandler(storage);
  await storage.register(proxy, {
    upstream: storageUrl,
    prefix: "/storage/v1",
    rewritePrefix: "",
  });
});

await app.register(async (storage) => {
  storage.addHook("onRequest", async (request, reply) => {
    const projectId = getProjectIdFromPath(request.url);
    if (!projectId) {
      return reply.code(400).send({ error: "Missing project ID in path" });
    }
    (request as any).projectId = projectId;
  });
  addScopePreHandler(storage);
  await storage.register(proxy, {
    upstream: storageUrl,
    prefix: "/p/:projectId/storage/v1",
    rewritePrefix: "",
  });
});

// ─── Admin ────────────────────────────────────────────────────────────────────
await app.register(proxy, {
  upstream: adminUrl,
  prefix: "/admin/v1",
  rewritePrefix: "",
});

await app.register(async (admin) => {
  admin.addHook("onRequest", async (request, reply) => {
    const projectId = getProjectIdFromPath(request.url);
    if (!projectId) {
      return reply.code(400).send({ error: "Missing project ID in path" });
    }
    (request as any).projectId = projectId;
  });
  await admin.register(proxy, {
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

await app.listen({ host: "0.0.0.0", port });
