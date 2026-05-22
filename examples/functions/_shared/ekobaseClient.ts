import { createClient } from "@supabase/supabase-js";
import { bearerToken, type HandlerRequest } from "./http.ts";

const EKOBASE_URL = process.env.EKOBASE_URL;
const EKOBASE_ANON_KEY = process.env.EKOBASE_ANON_KEY;
const EKOBASE_SERVICE_ROLE_KEY = process.env.EKOBASE_SERVICE_ROLE_KEY;

export function userClient(req: HandlerRequest) {
  if (!EKOBASE_URL || !EKOBASE_ANON_KEY) {
    throw new Error("EKOBASE_URL and EKOBASE_ANON_KEY are required");
  }

  const token = bearerToken(req.headers);
  return createClient(EKOBASE_URL, EKOBASE_ANON_KEY, {
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  });
}

export function serviceClient() {
  if (!EKOBASE_URL || !EKOBASE_SERVICE_ROLE_KEY) {
    throw new Error("EKOBASE_URL and EKOBASE_SERVICE_ROLE_KEY are required");
  }
  return createClient(EKOBASE_URL, EKOBASE_SERVICE_ROLE_KEY);
}

export async function requireUser(req: HandlerRequest) {
  const token = bearerToken(req.headers);
  if (!token) return { client: null, user: null, error: "Missing bearer token" };

  const client = userClient(req);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) {
    return { client: null, user: null, error: "Invalid bearer token" };
  }

  return { client, user: data.user, error: null };
}
