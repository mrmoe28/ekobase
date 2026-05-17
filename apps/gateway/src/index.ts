import {
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
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/app";

const scrypt = promisify(scryptCallback);
const pool = new pg.Pool({ connectionString: databaseUrl });

const app = Fastify({ logger: true });

await app.register(cors, { origin: true, credentials: true });

type AuthUser = {
  id: string;
  email: string;
  encrypted_password: string;
  created_at: Date;
};

type AuthBody = {
  email?: string;
  password?: string;
  refresh_token?: string;
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

async function createSession(user: Pick<AuthUser, "id" | "email" | "created_at">) {
  const refreshToken = randomBytes(32).toString("base64url");
  const accessToken = await signProjectJwt({
    sub: user.id,
    role: "authenticated",
    email: user.email,
  });

  await pool.query(
    "insert into auth.refresh_tokens (token, user_id) values ($1, $2)",
    [refreshToken, user.id],
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

await app.register(async (auth) => {
  auth.removeContentTypeParser("application/json");
  auth.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_request, body, done) => {
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

auth.post("/signup", async (request, reply) => {
  const credentials = getCredentials(request.body as AuthBody | undefined);

  if (!credentials) {
    return reply.code(400).send({ msg: "Email and password are required" });
  }

  const id = randomUUID();
  const encryptedPassword = await hashPassword(credentials.password);

  try {
    const result = await pool.query<AuthUser>(
      "insert into auth.users (id, email, encrypted_password) values ($1, $2, $3) returning id, email, encrypted_password, created_at",
      [id, credentials.email, encryptedPassword],
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

auth.post("/token", async (request, reply) => {
  const grantType = (request.query as { grant_type?: string }).grant_type;

  if (grantType === "refresh_token") {
    const body = request.body as AuthBody | undefined;

    if (!body?.refresh_token) {
      return reply.code(400).send({ msg: "Refresh token is required" });
    }

    const result = await pool.query<AuthUser>(
      `select u.id, u.email, u.encrypted_password, u.created_at
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
    "select id, email, encrypted_password, created_at from auth.users where email = $1",
    [credentials.email],
  );
  const user = result.rows[0];

  if (!user || !(await verifyPassword(credentials.password, user.encrypted_password))) {
    return reply.code(400).send({ msg: "Invalid login credentials" });
  }

  return reply.send(await createSession(user));
});

auth.get("/user", async (request, reply) => {
  const userId = await getAuthenticatedUserIdFromJwt(
    request.headers.authorization,
  );

  if (!userId) {
    return reply.code(401).send({ msg: "Invalid JWT" });
  }

  const result = await pool.query<AuthUser>(
    "select id, email, encrypted_password, created_at from auth.users where id = $1",
    [userId],
  );
  const user = result.rows[0];

  if (!user) {
    return reply.code(401).send({ msg: "User not found" });
  }

  return reply.send(toAuthUser(user));
});

auth.post("/logout", async (request, reply) => {
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

auth.post("/recover", async (request, reply) => {
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

auth.post("/reset", async (request, reply) => {
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
}, { prefix: "/auth/v1" });

await app.register(proxy, {
  upstream: postgrestUrl,
  prefix: "/rest/v1",
  rewritePrefix: "",
});

await app.register(proxy, {
  upstream: functionsUrl,
  prefix: "/functions/v1",
  rewritePrefix: "",
});

await app.register(proxy, {
  upstream: realtimeUrl,
  prefix: "/realtime/v1",
  websocket: true,
  rewritePrefix: "",
});

await app.register(proxy, {
  upstream: storageUrl,
  prefix: "/storage/v1",
  rewritePrefix: "",
});

await app.register(proxy, {
  upstream: adminUrl,
  prefix: "/admin/v1",
  rewritePrefix: "",
});

await app.listen({ host: "0.0.0.0", port });
