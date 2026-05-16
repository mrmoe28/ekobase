import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { signProjectJwt } from "@local/jwt";

const apiUrl = process.env.API_URL ?? "http://127.0.0.1:54321";
const anonKey = await signProjectJwt({
  sub: "00000000-0000-0000-0000-000000000000",
  role: "anon",
});

describe("local storage compatibility", () => {
  it("creates a bucket and lists buckets", async () => {
    const supabase = createClient(apiUrl, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const email = `storage-${crypto.randomUUID()}@example.test`;
    const password = "password123456";
    const signUp = await supabase.auth.signUp({ email, password });
    expect(signUp.error).toBeNull();
    expect(signUp.data.user?.id).toBeTruthy();

    const userId = signUp.data.user?.id!;
    const bucketName = `test-bucket-${userId.slice(0, 8)}`;

    const { data: bucket, error: createError } = await supabase.storage.createBucket(
      bucketName,
      {
        public: false,
      },
    );

    expect(createError).toBeNull();
    expect(bucket).toBeTruthy();

    const { data: buckets, error: listError } = await supabase.storage.listBuckets();
    expect(listError).toBeNull();
    expect(buckets).toBeTruthy();
    expect(buckets!.length).toBeGreaterThan(0);
  });

  it("uploads and downloads a file", async () => {
    const supabase = createClient(apiUrl, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const email = `storage-file-${crypto.randomUUID()}@example.test`;
    const password = "password123456";
    const signUp = await supabase.auth.signUp({ email, password });
    expect(signUp.error).toBeNull();
    expect(signUp.data.user?.id).toBeTruthy();

    const userId = signUp.data.user?.id!;
    const bucketName = `test-bucket-${userId.slice(0, 8)}`;

    await supabase.storage.createBucket(bucketName, { public: false });

    const fileName = "test.txt";
    const fileContent = "Hello, world!";
    const file = new File([fileContent], fileName, { type: "text/plain" });

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(fileName, file);

    expect(uploadError).toBeNull();
    expect(uploadData).toBeTruthy();

    const { data: downloadData, error: downloadError } = await supabase.storage
      .from(bucketName)
      .download(fileName);

    expect(downloadError).toBeNull();
    expect(downloadData).toBeTruthy();

    const downloadedText = await downloadData!.text();
    expect(downloadedText).toBe(fileContent);
  });

  it("lists files in a bucket", async () => {
    const supabase = createClient(apiUrl, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const email = `storage-list-${crypto.randomUUID()}@example.test`;
    const password = "password123456";
    const signUp = await supabase.auth.signUp({ email, password });
    expect(signUp.error).toBeNull();
    expect(signUp.data.user?.id).toBeTruthy();

    const userId = signUp.data.user?.id!;
    const bucketName = `test-bucket-${userId.slice(0, 8)}`;

    await supabase.storage.createBucket(bucketName, { public: false });

    const file1 = new File(["content1"], "file1.txt", { type: "text/plain" });
    const file2 = new File(["content2"], "file2.txt", { type: "text/plain" });

    await supabase.storage.from(bucketName).upload("file1.txt", file1);
    await supabase.storage.from(bucketName).upload("file2.txt", file2);

    const { data: files, error: listError } = await supabase.storage
      .from(bucketName)
      .list();

    expect(listError).toBeNull();
    expect(files).toBeTruthy();
    expect(files!.length).toBeGreaterThanOrEqual(2);
  });

  it("deletes a file", async () => {
    const supabase = createClient(apiUrl, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const email = `storage-delete-${crypto.randomUUID()}@example.test`;
    const password = "password123456";
    const signUp = await supabase.auth.signUp({ email, password });
    expect(signUp.error).toBeNull();
    expect(signUp.data.user?.id).toBeTruthy();

    const userId = signUp.data.user?.id!;
    const bucketName = `test-bucket-${userId.slice(0, 8)}`;

    await supabase.storage.createBucket(bucketName, { public: false });

    const fileName = "to-delete.txt";
    const file = new File(["delete me"], fileName, { type: "text/plain" });

    await supabase.storage.from(bucketName).upload(fileName, file);

    const { error: deleteError } = await supabase.storage
      .from(bucketName)
      .remove([fileName]);

    expect(deleteError).toBeNull();

    const { data: downloadData, error: downloadError } = await supabase.storage
      .from(bucketName)
      .download(fileName);

    expect(downloadError).not.toBeNull();
    expect(downloadData).toBeNull();
  });

  it("deletes a bucket", async () => {
    const supabase = createClient(apiUrl, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const email = `storage-bucket-del-${crypto.randomUUID()}@example.test`;
    const password = "password123456";
    const signUp = await supabase.auth.signUp({ email, password });
    expect(signUp.error).toBeNull();
    expect(signUp.data.user?.id).toBeTruthy();

    const userId = signUp.data.user?.id!;
    const bucketName = `test-bucket-${userId.slice(0, 8)}`;

    await supabase.storage.createBucket(bucketName, { public: false });

    const { error: deleteError } = await supabase.storage.deleteBucket(bucketName);

    expect(deleteError).toBeNull();

    const { data: buckets, error: listError } = await supabase.storage.listBuckets();
    expect(listError).toBeNull();
    expect(buckets).toBeTruthy();
    expect(buckets!.find((b) => b.name === bucketName)).toBeUndefined();
  });
});