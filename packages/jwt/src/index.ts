import { SignJWT } from "jose";

export const DEFAULT_JWT_SECRET =
  process.env.JWT_SECRET ?? "local-dev-jwt-secret-change-me-at-least-32-chars";

export async function signProjectJwt(options: {
  sub: string;
  role?: "anon" | "authenticated" | "service_role";
  email?: string;
  secret?: string;
  expiresInSeconds?: number;
}) {
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
