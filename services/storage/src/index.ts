import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { readdir, readFile, stat, unlink, rm } from "node:fs/promises";
import { join } from "node:path";
import Fastify from "fastify";
import { Pool } from "pg";
import { jwtVerify } from "jose";
import { DEFAULT_JWT_SECRET } from "@local/jwt";

const port = Number(process.env.STORAGE_PORT ?? 54324);
const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/app";
const storageDir = process.env.STORAGE_DIR ?? "/tmp/supabase-storage";

const pgClient = new Pool({ connectionString: databaseUrl });

type AuthClaims = {
  sub: string;
  role: "anon" | "authenticated" | "service_role";
  email?: string;
  project_id?: string;
};

type Bucket = {
  id: string;
  name: string;
  public: boolean;
  owner_id: string;
  project_id: string;
  private_user_scoped: boolean;
  created_at: Date;
  updated_at: Date;
};

type FileMetadata = {
  id: string;
  bucket_id: string;
  name: string;
  path: string;
  size: number;
  content_type: string;
  owner_id: string;
  project_id: string;
  created_at: Date;
  updated_at: Date;
};

function isUserScopedPathAllowed(path: string, userSub: string): boolean {
  const firstSegment = path.split("/")[0] ?? "";
  return firstSegment === userSub;
}

function effectiveProjectId(claims: AuthClaims): string | null {
  // Anon/service keys put project_id in `sub`; user JWTs put it in `project_id`.
  if (claims.project_id) return claims.project_id;
  if (claims.role !== "authenticated") return claims.sub;
  return null;
}

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
      project_id: payload.project_id as string | undefined,
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

function ensureStorageDir() {
  if (!existsSync(storageDir)) {
    mkdirSync(storageDir, { recursive: true });
  }
}

// Filesystem paths are keyed by bucket id (UUID), not name, so two projects
// can both have a bucket called "avatars" without colliding on disk.
function getBucketDir(bucketId: string): string {
  return join(storageDir, bucketId);
}

function getFilePath(bucketId: string, fileName: string): string {
  return join(getBucketDir(bucketId), fileName);
}

// One-shot startup migration: rename legacy directories that were keyed by
// bucket name. Skips anything already in id form. Safe to run on every boot.
async function migrateLegacyBucketDirs() {
  if (!existsSync(storageDir)) return;
  const entries = await readdir(storageDir, { withFileTypes: true });
  const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (uuidLike.test(entry.name)) continue;

    const result = await pgClient.query<{ id: string }>(
      "select id from storage.buckets where name = $1 limit 1",
      [entry.name],
    );
    const bucket = result.rows[0];
    if (!bucket) continue;

    const oldPath = join(storageDir, entry.name);
    const newPath = join(storageDir, bucket.id);
    if (existsSync(newPath)) {
      app.log.warn(
        { oldPath, newPath },
        "legacy bucket dir migration skipped: target already exists",
      );
      continue;
    }
    renameSync(oldPath, newPath);
    app.log.info({ from: entry.name, to: bucket.id }, "migrated legacy bucket dir");
  }
}

async function createBucket(
  name: string,
  publicAccess: boolean,
  ownerId: string,
  projectId: string,
  privateUserScoped: boolean,
): Promise<Bucket> {
  const id = randomUUID();
  const bucketPath = getBucketDir(id);

  if (!existsSync(bucketPath)) {
    mkdirSync(bucketPath, { recursive: true });
  }

  const result = await pgClient.query<Bucket>(
    `insert into storage.buckets (id, name, public, owner_id, project_id, private_user_scoped)
     values ($1, $2, $3, $4, $5, $6)
     returning *`,
    [id, name, publicAccess, ownerId, projectId, privateUserScoped],
  );

  return result.rows[0];
}

async function getBucket(name: string, projectId: string): Promise<Bucket | null> {
  const result = await pgClient.query<Bucket>(
    "select * from storage.buckets where name = $1 and project_id = $2",
    [name, projectId],
  );
  return result.rows[0] || null;
}

async function listBuckets(userId: string, projectId: string, role: AuthClaims["role"]): Promise<Bucket[]> {
  // service_role sees every bucket in the project; authenticated users see
  // public buckets, their own buckets, and (for user-scoped buckets) any they
  // can read into.
  if (role === "service_role") {
    const result = await pgClient.query<Bucket>(
      "select * from storage.buckets where project_id = $1 order by created_at desc",
      [projectId],
    );
    return result.rows;
  }
  const result = await pgClient.query<Bucket>(
    `select * from storage.buckets
     where project_id = $1
       and (owner_id = $2 or public = true or private_user_scoped = true)
     order by created_at desc`,
    [projectId, userId],
  );
  return result.rows;
}

async function deleteBucket(name: string, projectId: string, userId: string, role: AuthClaims["role"]): Promise<boolean> {
  const bucket = await getBucket(name, projectId);
  if (!bucket) return false;
  if (role !== "service_role" && bucket.owner_id !== userId) return false;

  await pgClient.query("delete from storage.files where bucket_id = $1", [bucket.id]);
  await pgClient.query("delete from storage.buckets where id = $1", [bucket.id]);

  const bucketPath = getBucketDir(bucket.id);
  if (existsSync(bucketPath)) {
    await rm(bucketPath, { recursive: true, force: true });
  }

  return true;
}

async function uploadFile(
  bucket: Bucket,
  fileName: string,
  contentType: string,
  data: Buffer,
  ownerId: string,
): Promise<FileMetadata> {
  const filePath = getFilePath(bucket.id, fileName);
  const dir = join(filePath, "..");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  await new Promise<void>((resolve, reject) => {
    const writeStream = createWriteStream(filePath);
    writeStream.write(data);
    writeStream.end();
    writeStream.on("finish", resolve);
    writeStream.on("error", reject);
  });

  const fileStats = statSync(filePath);
  const fileId = randomUUID();

  const result = await pgClient.query<FileMetadata>(
    `insert into storage.files (id, bucket_id, name, path, size, content_type, owner_id, project_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (bucket_id, name) do update
       set size = excluded.size,
           content_type = excluded.content_type,
           path = excluded.path,
           updated_at = now()
     returning *`,
    [fileId, bucket.id, fileName, filePath, fileStats.size, contentType, ownerId, bucket.project_id],
  );

  return result.rows[0];
}

async function downloadFile(bucket: Bucket, fileName: string): Promise<Buffer | null> {
  const filePath = getFilePath(bucket.id, fileName);
  if (!existsSync(filePath)) return null;
  return await readFile(filePath);
}

async function deleteFile(bucket: Bucket, fileName: string, userId: string, role: AuthClaims["role"]): Promise<boolean> {
  const ownerFilter = role === "service_role" ? "" : "and owner_id = $3";
  const params = role === "service_role" ? [bucket.id, fileName] : [bucket.id, fileName, userId];

  const result = await pgClient.query<FileMetadata>(
    `delete from storage.files
     where bucket_id = $1 and name = $2 ${ownerFilter}
     returning *`,
    params,
  );

  if (result.rows.length === 0) return false;

  const filePath = getFilePath(bucket.id, fileName);
  if (existsSync(filePath)) {
    await unlink(filePath);
  }
  return true;
}

async function listFiles(bucket: Bucket, userId: string, role: AuthClaims["role"]): Promise<FileMetadata[]> {
  if (role === "service_role" || bucket.public) {
    const result = await pgClient.query<FileMetadata>(
      "select * from storage.files where bucket_id = $1 order by created_at desc",
      [bucket.id],
    );
    return result.rows;
  }
  const result = await pgClient.query<FileMetadata>(
    `select * from storage.files
     where bucket_id = $1 and owner_id = $2
     order by created_at desc`,
    [bucket.id, userId],
  );
  return result.rows;
}

app.get("/health", async () => ({ ok: true }));

app.addHook("onRequest", async (request, reply) => {
  if (request.url === "/health") return;

  const claims = await getClaimsFromAuth(request.headers.authorization);
  if (!claims) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
  const projectId = effectiveProjectId(claims);
  if (!projectId) {
    return reply.code(400).send({ error: "Token has no project_id" });
  }
  request.user = claims;
  request.projectId = projectId;
});

app.addContentTypeParser("multipart/form-data", { parseAs: "string" }, (request, body, done) => {
  done(null, body);
});

app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
  try {
    done(null, JSON.parse(body));
  } catch (error) {
    done(error as Error);
  }
});

app.get("/bucket", async (request, reply) => {
  const user = request.user as AuthClaims;
  const projectId = request.projectId as string;
  const buckets = await listBuckets(user.sub, projectId, user.role);
  return reply.send(buckets);
});

app.post<{ Body: { name: string; public: boolean; private_user_scoped?: boolean } }>("/bucket", async (request, reply) => {
  const user = request.user as AuthClaims;
  const projectId = request.projectId as string;
  const { name, public: publicAccess, private_user_scoped } = request.body;

  if (!name) {
    return reply.code(400).send({ error: "Bucket name is required" });
  }
  if (publicAccess && private_user_scoped) {
    return reply.code(400).send({ error: "Cannot combine public with private_user_scoped" });
  }

  try {
    const bucket = await createBucket(name, publicAccess || false, user.sub, projectId, private_user_scoped || false);
    return reply.code(201).send(bucket);
  } catch (error: unknown) {
    const msg = (error as { message?: string })?.message ?? "";
    if (msg.includes("buckets_project_name_uniq") || msg.includes("duplicate key")) {
      return reply.code(409).send({ error: "Bucket name already exists in this project" });
    }
    request.log.error({ err: error }, "create bucket failed");
    return reply.code(500).send({ error: "Failed to create bucket" });
  }
});

app.delete<{ Params: { bucketName: string } }>("/bucket/:bucketName", async (request, reply) => {
  const user = request.user as AuthClaims;
  const projectId = request.projectId as string;
  const { bucketName } = request.params;

  const success = await deleteBucket(bucketName, projectId, user.sub, user.role);
  if (!success) {
    return reply.code(404).send({ error: "Bucket not found or access denied" });
  }
  return reply.code(200).send({ message: "Bucket deleted successfully" });
});

app.get<{ Params: { bucketName: string } }>(
  "/object/:bucketName/*",
  async (request, reply) => {
    const user = request.user as AuthClaims;
    const projectId = request.projectId as string;
    const { bucketName } = request.params;
    const fileName = (request.params["*"] as string) || "";

    const bucket = await getBucket(bucketName, projectId);
    if (!bucket) return reply.code(404).send({ error: "Bucket not found" });

    if (user.role !== "service_role") {
      if (bucket.private_user_scoped) {
        if (!isUserScopedPathAllowed(fileName, user.sub)) {
          return reply.code(403).send({ error: "Access denied" });
        }
      } else if (!bucket.public && bucket.owner_id !== user.sub) {
        return reply.code(403).send({ error: "Access denied" });
      }
    }

    const fileData = await downloadFile(bucket, fileName);
    if (!fileData) return reply.code(404).send({ error: "File not found" });

    const fileResult = await pgClient.query<FileMetadata>(
      "select content_type from storage.files where bucket_id = $1 and name = $2",
      [bucket.id, fileName],
    );

    const contentType = fileResult.rows[0]?.content_type || "application/octet-stream";
    reply.header("Content-Type", contentType);
    reply.header("Content-Length", fileData.length);
    return reply.send(fileData);
  },
);

app.post<{ Params: { bucketName: string } }>(
  "/object/:bucketName/*",
  async (request, reply) => {
    const user = request.user as AuthClaims;
    const projectId = request.projectId as string;
    const { bucketName } = request.params;
    const fileName = (request.params["*"] as string) || "";
    const contentType = request.headers["content-type"] || "application/octet-stream";

    const bucket = await getBucket(bucketName, projectId);
    if (!bucket) return reply.code(404).send({ error: "Bucket not found" });

    if (user.role !== "service_role") {
      if (bucket.private_user_scoped) {
        if (!isUserScopedPathAllowed(fileName, user.sub)) {
          return reply.code(403).send({ error: "Access denied" });
        }
      } else if (bucket.owner_id !== user.sub) {
        return reply.code(403).send({ error: "Access denied" });
      }
    }

    let data: Buffer | undefined;

    if (contentType.startsWith("multipart/form-data")) {
      const body = request.body as string;
      const boundary = contentType.split("boundary=")[1];
      const parts = body.split(`--${boundary}`);
      for (const part of parts) {
        if (part.includes("filename=")) {
          const contentStart = part.indexOf("\r\n\r\n") + 4;
          const contentEnd = part.lastIndexOf("\r\n");
          data = Buffer.from(part.slice(contentStart, contentEnd));
          break;
        }
      }
      if (!data) return reply.code(400).send({ error: "No file data provided" });
    } else {
      data = request.body as Buffer;
      if (!data || data.length === 0) {
        return reply.code(400).send({ error: "No file data provided" });
      }
    }

    try {
      const fileMetadata = await uploadFile(bucket, fileName, contentType, data, user.sub);
      return reply.code(201).send(fileMetadata);
    } catch (error) {
      request.log.error({ err: error }, "upload failed");
      return reply.code(500).send({ error: "Failed to upload file" });
    }
  },
);

app.delete<{ Params: { bucketName: string } }>(
  "/object/:bucketName/*",
  async (request, reply) => {
    const user = request.user as AuthClaims;
    const projectId = request.projectId as string;
    const { bucketName } = request.params;
    const fileName = (request.params["*"] as string) || "";

    const bucket = await getBucket(bucketName, projectId);
    if (!bucket) return reply.code(404).send({ error: "Bucket not found" });

    const success = await deleteFile(bucket, fileName, user.sub, user.role);
    if (!success) {
      return reply.code(404).send({ error: "File not found or access denied" });
    }
    return reply.code(204).send();
  },
);

app.delete<{ Params: { bucketName: string } }>(
  "/object/:bucketName",
  async (request, reply) => {
    const user = request.user as AuthClaims;
    const projectId = request.projectId as string;
    const { bucketName } = request.params;
    const body = request.body as { prefixes?: string[] };

    const bucket = await getBucket(bucketName, projectId);
    if (!bucket) return reply.code(404).send({ error: "Bucket not found" });

    if (body?.prefixes && body.prefixes.length > 0) {
      const fileName = body.prefixes[0];
      const success = await deleteFile(bucket, fileName, user.sub, user.role);
      if (!success) return reply.code(404).send({ error: "File not found or access denied" });
      return reply.code(200).send({});
    }
    return reply.code(200).send({});
  },
);

app.get<{ Params: { bucketName: string } }>(
  "/object/:bucketName",
  async (request, reply) => {
    const user = request.user as AuthClaims;
    const projectId = request.projectId as string;
    const { bucketName } = request.params;
    const bucket = await getBucket(bucketName, projectId);
    if (!bucket) return reply.code(404).send({ error: "Bucket not found" });
    const files = await listFiles(bucket, user.sub, user.role);
    return reply.send(files);
  },
);

app.post<{ Params: { bucketName: string } }>(
  "/object/list/:bucketName",
  async (request, reply) => {
    const user = request.user as AuthClaims;
    const projectId = request.projectId as string;
    const { bucketName } = request.params;
    const bucket = await getBucket(bucketName, projectId);
    if (!bucket) return reply.code(404).send({ error: "Bucket not found" });
    const files = await listFiles(bucket, user.sub, user.role);
    return reply.send(files);
  },
);

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthClaims;
    projectId?: string;
  }
}

async function main() {
  ensureStorageDir();
  await migrateLegacyBucketDirs().catch((err) => {
    app.log.error({ err }, "legacy bucket dir migration failed; continuing");
  });

  await app.listen({ host: "0.0.0.0", port });
  console.log(`Storage service listening on port ${port}`);
}

main().catch((error) => {
  console.error("Failed to start storage server:", error);
  process.exit(1);
});
