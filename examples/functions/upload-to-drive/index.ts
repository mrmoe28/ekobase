import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { encode as base64url } from "https://deno.land/std@0.168.0/encoding/base64url.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "https://ops.lock28.com,http://localhost:5174,http://localhost:5173,http://192.168.1.128:5174").split(",");

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

// ── Google Auth: service account JWT → access token ──

async function getAccessToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })))
  const payload = base64url(new TextEncoder().encode(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/drive.file",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })))

  // Import RSA private key
  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "")
  const keyData = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey("pkcs8", keyData, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"])

  // Sign JWT
  const input = `${header}.${payload}`
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input))
  const jwt = `${input}.${base64url(new Uint8Array(sig))}`

  // Exchange for access token
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`Google auth failed: ${JSON.stringify(data)}`)
  return data.access_token
}

// ── Find or create a subfolder inside the root folder ──

async function findOrCreateFolder(token: string, name: string, parentId: string): Promise<string> {
  // Search for existing folder
  const q = `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const searchData = await searchRes.json()
  if (searchData.files?.length > 0) return searchData.files[0].id

  // Create folder
  const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
  })
  const folder = await createRes.json()
  return folder.id
}

// ── Upload file to Drive ──

async function uploadFile(token: string, file: File, filename: string, folderId: string) {
  const metadata = JSON.stringify({ name: filename, parents: [folderId] })
  const bytes = new Uint8Array(await file.arrayBuffer())

  const boundary = "----EdgeFunctionBoundary"
  const body = new TextEncoder().encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${file.type || "application/octet-stream"}\r\n\r\n`
  )
  const ending = new TextEncoder().encode(`\r\n--${boundary}--`)

  // Combine parts
  const combined = new Uint8Array(body.length + bytes.length + ending.length)
  combined.set(body, 0)
  combined.set(bytes, body.length)
  combined.set(ending, body.length + bytes.length)

  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body: combined,
  })

  const data = await res.json()
  if (data.error) throw new Error(data.error.message)
  return { drive_file_id: data.id, web_view_link: data.webViewLink }
}

// ── Main handler ──

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) })
  }

  // ── Auth: verify the caller is a logged-in Supabase user ──
  const authHeader = req.headers.get("Authorization") || "";
  const supabaseAuth = createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_ANON_KEY") || "",
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  }

  try {
    const formData = await req.formData()
    const file = formData.get("file") as File
    if (!file) throw new Error("No file provided")

    const subfolder = (formData.get("subfolder") as string) || "Uploads"
    const filename = (formData.get("filename") as string) || file.name

    const saKey = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY")
    if (!saKey) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY not configured")
    const sa = JSON.parse(saKey)

    const rootFolderId = Deno.env.get("GOOGLE_DRIVE_FOLDER_ID") || "root"

    const token = await getAccessToken(sa)
    const folderId = await findOrCreateFolder(token, subfolder, rootFolderId)
    const result = await uploadFile(token, file, filename, folderId)

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    })
  } catch (e) {
    console.error("upload-to-drive error:", e)
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    })
  }
})
