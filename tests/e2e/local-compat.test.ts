import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { signProjectJwt } from "@local/jwt";

const apiUrl = process.env.API_URL ?? "http://127.0.0.1:54321";
const anonKey = await signProjectJwt({
  sub: "00000000-0000-0000-0000-000000000000",
  role: "anon",
});

describe("local Supabase compatibility slice", () => {
  it("signs up, signs in, and queries RLS-protected rows through supabase-js", async () => {
    const supabase = createClient(apiUrl, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const email = `local-${crypto.randomUUID()}@example.test`;
    const password = "password123456";

    const signUp = await supabase.auth.signUp({ email, password });
    expect(signUp.error).toBeNull();
    expect(signUp.data.user?.email).toBe(email);

    const signIn = await supabase.auth.signInWithPassword({ email, password });
    expect(signIn.error).toBeNull();
    expect(signIn.data.session?.access_token).toBeTruthy();

    const userId = signIn.data.user?.id;
    expect(userId).toBeTruthy();

    const currentUser = await supabase.auth.getUser();
    expect(currentUser.error).toBeNull();
    expect(currentUser.data.user?.id).toBe(userId);

    const inserted = await supabase.from("todos").insert({
      user_id: userId,
      title: "Created after email login",
    });
    expect(inserted.error).toBeNull();

    const { data, error } = await supabase.from("todos").select("title");

    expect(error).toBeNull();
    expect(data).toEqual([{ title: "Created after email login" }]);
  });

  it("invokes a local Node function after email/password sign-in", async () => {
    const supabase = createClient(apiUrl, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const email = `fn-${crypto.randomUUID()}@example.test`;
    const password = "password123456";
    const signUp = await supabase.auth.signUp({ email, password });
    expect(signUp.error).toBeNull();

    const { data, error } = await supabase.functions.invoke("hello");

    expect(error).toBeNull();
    expect(data).toEqual({ message: "hello from local functions" });
  });

  it("refreshes an email/password session through supabase-js", async () => {
    const supabase = createClient(apiUrl, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const email = `refresh-${crypto.randomUUID()}@example.test`;
    const password = "password123456";

    const signUp = await supabase.auth.signUp({ email, password });
    expect(signUp.error).toBeNull();
    expect(signUp.data.session?.refresh_token).toBeTruthy();

    const refreshed = await supabase.auth.refreshSession({
      refresh_token: signUp.data.session!.refresh_token,
    });

    expect(refreshed.error).toBeNull();
    expect(refreshed.data.session?.access_token).toBeTruthy();
    expect(refreshed.data.session?.refresh_token).toBeTruthy();
    expect(refreshed.data.session?.refresh_token).not.toBe(
      signUp.data.session!.refresh_token,
    );
    expect(refreshed.data.user?.email).toBe(email);
  });

  it("signs out and revokes refresh tokens through supabase-js", async () => {
    const supabase = createClient(apiUrl, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const email = `logout-${crypto.randomUUID()}@example.test`;
    const password = "password123456";

    const signUp = await supabase.auth.signUp({ email, password });
    expect(signUp.error).toBeNull();
    expect(signUp.data.session?.refresh_token).toBeTruthy();

    const refreshToken = signUp.data.session!.refresh_token;
    const accessToken = signUp.data.session!.access_token;
    const signedOut = await supabase.auth.signOut();

    expect(signedOut.error).toBeNull();

    const refreshResponse = await fetch(
      `${apiUrl}/auth/v1/token?grant_type=refresh_token`,
      {
        method: "POST",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      },
    );

    const refreshBody = await refreshResponse.json();

    expect(refreshResponse.status).toBe(400);
    expect(refreshBody.msg).toBe("Invalid refresh token");

    const currentUser = await supabase.auth.getUser();

    expect(currentUser.error).not.toBeNull();
    expect(currentUser.data.user).toBeNull();
  });

  it("rejects logout with only the anon key", async () => {
    const response = await fetch(`${apiUrl}/auth/v1/logout?scope=global`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "content-type": "application/json",
      },
    });

    expect(response.status).toBe(401);
  });
});
