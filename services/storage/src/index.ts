import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from "node:fs";
import { readdir, readFile, stat, unlink } from "node:fs/promises";
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
};

type Bucket = {
  id: string;
  name: string;
  public: boolean;
  owner_id: string;
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

function ensureStorageDir() {
  if (!existsSync(storageDir)) {
    mkdirSync(storageDir, { recursive: true });
  }
}

function getBucketPath(bucketName: string): string {
  return join(storageDir, bucketName);
}

function getFilePath(bucketName: string, fileName: string): string {
  return join(getBucketPath(bucketName), fileName);
}

async function createBucket(
  name: string,
  publicAccess: boolean,
  ownerId: string,
): Promise<Bucket> {
  const id = randomUUID();
  const bucketPath = getBucketPath(name);
  
  if (!existsSync(bucketPath)) {
    mkdirSync(bucketPath, { recursive: true });
  }

  const result = await pgClient.query<Bucket>(
    `insert into storage.buckets (id, name, public, owner_id)
     values ($1, $2, $3, $4)
     returning *`,
    [id, name, publicAccess, ownerId],
  );

  return result.rows[0];
}

async function getBucket(name: string): Promise<Bucket | null> {
  const result = await pgClient.query<Bucket>(
    "select * from storage.buckets where name = $1",
    [name],
  );
  return result.rows[0] || null;
}

async function listBuckets(userId: string): Promise<Bucket[]> {
  const result = await pgClient.query<Bucket>(
    `select * from storage.buckets 
     where owner_id = $1 or public = true`,
    [userId],
  );
  return result.rows;
}

async function deleteBucket(name: string, userId: string): Promise<boolean> {
  const bucket = await getBucket(name);
  if (!bucket || bucket.owner_id !== userId) {
    return false;
  }

  await pgClient.query("delete from storage.files where bucket_id = $1", [bucket.id]);
  await pgClient.query("delete from storage.buckets where id = $1", [bucket.id]);

  const bucketPath = getBucketPath(name);
  if (existsSync(bucketPath)) {
    const files = await readdir(bucketPath);
    for (const file of files) {
      await unlink(join(bucketPath, file));
    }
  }

  return true;
}

async function uploadFile(
  bucketName: string,
  fileName: string,
  contentType: string,
  data: Buffer,
  ownerId: string,
): Promise<FileMetadata> {
  const bucket = await getBucket(bucketName);
  if (!bucket) {
    throw new Error("Bucket not found");
  }

  const filePath = getFilePath(bucketName, fileName);
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

  const fileStats = await stat(filePath);
  const fileId = randomUUID();

  const result = await pgClient.query<FileMetadata>(
    `insert into storage.files (id, bucket_id, name, path, size, content_type, owner_id)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning *`,
    [fileId, bucket.id, fileName, filePath, fileStats.size, contentType, ownerId],
  );

  return result.rows[0];
}

async function downloadFile(bucketName: string, fileName: string): Promise<Buffer | null> {
  const filePath = getFilePath(bucketName, fileName);
  
  if (!existsSync(filePath)) {
    return null;
  }

  return await readFile(filePath);
}

async function deleteFile(bucketName: string, fileName: string, userId: string): Promise<boolean> {
  const bucket = await getBucket(bucketName);
  if (!bucket) {
    return false;
  }

  const result = await pgClient.query<FileMetadata>(
    `delete from storage.files 
     where bucket_id = $1 and name = $2 and owner_id = $3
     returning *`,
    [bucket.id, fileName, userId],
  );

  if (result.rows.length === 0) {
    return false;
  }

  const filePath = getFilePath(bucketName, fileName);
  if (existsSync(filePath)) {
    await unlink(filePath);
  }

  return true;
}

async function listFiles(bucketName: string, userId: string): Promise<FileMetadata[]> {
  const bucket = await getBucket(bucketName);
  if (!bucket) {
    return [];
  }

  const result = await pgClient.query<FileMetadata>(
    `select * from storage.files 
     where bucket_id = $1 and (owner_id = $2 or $3 = true)
     order by created_at desc`,
    [bucket.id, userId, bucket.public],
  );

  return result.rows;
}

app.get("/health", async () => ({ ok: true }));

app.addHook("onRequest", async (request, reply) => {
  if (request.url === "/health") {
    return;
  }
  
  const claims = await getClaimsFromAuth(request.headers.authorization);
  if (!claims) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
  request.user = claims;
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
  const buckets = await listBuckets(user.sub);
  return reply.send(buckets);
});

app.post<{ Body: { name: string; public: boolean } }>("/bucket", async (request, reply) => {
  const user = request.user as AuthClaims;
  const { name, public: publicAccess } = request.body;

  if (!name) {
    return reply.code(400).send({ error: "Bucket name is required" });
  }

  try {
    const bucket = await createBucket(name, publicAccess || false, user.sub);
    return reply.code(201).send(bucket);
  } catch (error) {
    return reply.code(500).send({ error: "Failed to create bucket" });
  }
});

app.delete<{ Params: { bucketName: string } }>("/bucket/:bucketName", async (request, reply) => {
  const user = request.user as AuthClaims;
  const { bucketName } = request.params;

  const success = await deleteBucket(bucketName, user.sub);
  if (!success) {
    return reply.code(404).send({ error: "Bucket not found or access denied" });
  }

  return reply.code(200).send({ message: "Bucket deleted successfully" });
});

app.get<{ Params: { bucketName: string } }>(
  "/object/:bucketName/*",
  async (request, reply) => {
    const user = request.user as AuthClaims;
    const { bucketName } = request.params;
    const fileName = (request.params["*"] as string) || "";

    const bucket = await getBucket(bucketName);
    if (!bucket) {
      return reply.code(404).send({ error: "Bucket not found" });
    }

    if (!bucket.public && bucket.owner_id !== user.sub) {
      return reply.code(403).send({ error: "Access denied" });
    }

    const fileData = await downloadFile(bucketName, fileName);
    if (!fileData) {
      return reply.code(404).send({ error: "File not found" });
    }

    const fileResult = await pgClient.query<FileMetadata>(
      `select content_type from storage.files 
       where bucket_id = $1 and name = $2`,
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
    const { bucketName } = request.params;
    const fileName = (request.params["*"] as string) || "";
    const contentType = request.headers["content-type"] || "application/octet-stream";

    const bucket = await getBucket(bucketName);
    if (!bucket) {
      return reply.code(404).send({ error: "Bucket not found" });
    }

    if (bucket.owner_id !== user.sub) {
      return reply.code(403).send({ error: "Access denied" });
    }

    let data: Buffer;
    
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
      
      if (!data) {
        return reply.code(400).send({ error: "No file data provided" });
      }
    } else {
      data = request.body as Buffer;
      if (!data || data.length === 0) {
        return reply.code(400).send({ error: "No file data provided" });
      }
    }

    try {
      const fileMetadata = await uploadFile(bucketName, fileName, "text/plain", data, user.sub);
      return reply.code(201).send(fileMetadata);
    } catch (error) {
      return reply.code(500).send({ error: "Failed to upload file" });
    }
  },
);

app.delete<{ Params: { bucketName: string } }>(
  "/object/:bucketName/*",
  async (request, reply) => {
    const user = request.user as AuthClaims;
    const { bucketName } = request.params;
    const fileName = (request.params["*"] as string) || "";

    const success = await deleteFile(bucketName, fileName, user.sub);
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
    const { bucketName } = request.params;
    const body = request.body as { prefixes?: string[] };

    if (body?.prefixes && body.prefixes.length > 0) {
      const fileName = body.prefixes[0];
      const success = await deleteFile(bucketName, fileName, user.sub);
      if (!success) {
        return reply.code(404).send({ error: "File not found or access denied" });
      }
      return reply.code(200).send({});
    }

    return reply.code(200).send({});
  },
);

app.get<{ Params: { bucketName: string } }>(
  "/object/:bucketName",
  async (request, reply) => {
    const user = request.user as AuthClaims;
    const { bucketName } = request.params;

    const files = await listFiles(bucketName, user.sub);
    return reply.send(files);
  },
);

app.post<{ Params: { bucketName: string } }>(
  "/object/list/:bucketName",
  async (request, reply) => {
    const user = request.user as AuthClaims;
    const { bucketName } = request.params;

    const files = await listFiles(bucketName, user.sub);
    return reply.send(files);
  },
);

async function main() {
  ensureStorageDir();

  await app.listen({ host: "0.0.0.0", port });
  console.log(`Storage service listening on port ${port}`);
}

main().catch((error) => {
  console.error("Failed to start storage server:", error);
  process.exit(1);
});