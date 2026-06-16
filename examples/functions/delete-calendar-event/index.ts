type FnRequest = {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  query: unknown;
};

const base64url = (buf: Uint8Array) => Buffer.from(buf).toString("base64url");
import { createClient } from "@supabase/supabase-js";

const ALLOWED_ORIGINS = (process.env["ALLOWED_ORIGINS"] || "https://ops.lock28.com,http://localhost:5174,http://localhost:5173,http://192.168.1.128:5174").split(",");

function corsHeaders(req: Request) {
  const origin = (req.headers["origin"] as string | undefined) || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

async function getUserAccessToken(refreshToken: string): Promise<string | null> {
  try {
    const clientId = process.env["GOOGLE_CLIENT_ID"]
    const clientSecret = process.env["GOOGLE_CLIENT_SECRET"]
    if (!clientId || !clientSecret) return null
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    })
    const data = await res.json()
    return data.access_token || null
  } catch {
    return null
  }
}

async function getAccessToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })))
  const payload = base64url(new TextEncoder().encode(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/calendar.events",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })))
  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "")
  const keyData = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey("pkcs8", keyData, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"])
  const input = `${header}.${payload}`
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input))
  const jwt = `${input}.${base64url(new Uint8Array(sig))}`
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`Google auth failed: ${JSON.stringify(data)}`)
  return data.access_token
}

export async function handler(req: FnRequest) {
  if (req.method === "OPTIONS") {
    return { statusCode: 204, body: "",  headers: corsHeaders(req)  };
  }

  // ── JWT Auth ──
  const authHeader = (req.headers["Authorization"] as string | undefined) || "";
  const supabaseAuth = createClient(
    process.env["SUPABASE_URL"] || "",
    process.env["SUPABASE_ANON_KEY"] || "",
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  }

  try {
    const { scheduled_date, form_title } = (req.body as Record<string, unknown>)
    if (!scheduled_date) throw new Error("scheduled_date is required")

    const supabaseAdmin = createClient(
      process.env["SUPABASE_URL"]!,
      process.env["SUPABASE_SERVICE_ROLE_KEY"]!
    )

    // Get calendar ID and refresh token
    const { data: profile } = await supabaseAdmin
      .from("profiles").select("google_calendar_id, google_refresh_token")
      .not("google_calendar_id", "is", null)
      .limit(1).single()

    if (!profile?.google_calendar_id) {
      return new Response(JSON.stringify({ skipped: true, reason: "no_calendar_id" }), {
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      })
    }

    // Get access token
    let token: string | null = null
    if (profile.google_refresh_token) {
      token = await getUserAccessToken(profile.google_refresh_token)
    }
    if (!token) {
      const saKey = process.env["GOOGLE_SERVICE_ACCOUNT_KEY"]
      if (!saKey) throw new Error("No auth method available")
      token = await getAccessToken(JSON.parse(saKey))
    }

    const calendarId = encodeURIComponent(profile.google_calendar_id)

    // Search for events on the scheduled date that match the form title
    const timeMin = `${scheduled_date}T00:00:00Z`
    const timeMax = `${scheduled_date}T23:59:59Z`
    const searchRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const searchData = await searchRes.json()
    const events = searchData.items || []

    // Find and delete matching events (match by form title in summary)
    let deleted = 0
    for (const event of events) {
      const summary = event.summary || ""
      if (form_title && summary.includes(form_title)) {
        await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${event.id}`,
          { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
        )
        deleted++
      }
    }

    return new Response(JSON.stringify({ success: true, deleted }), {
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    })
  } catch (e) {
    console.error("delete-calendar-event error:", e)
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    })
  }
}