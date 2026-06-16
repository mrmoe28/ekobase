type FnRequest = {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  query: unknown;
};

import { createClient } from "@supabase/supabase-js";

const ALLOWED_ORIGINS = (process.env["ALLOWED_ORIGINS"] || "https://ops.lock28.com,http://localhost:5174,http://localhost:5173,http://192.168.1.128:5174").split(",");

function corsHeaders(req: Request) {
  const origin = (req.headers["origin"] as string | undefined) || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env["GOOGLE_CLIENT_ID"]!,
      client_secret: process.env["GOOGLE_CLIENT_SECRET"]!,
    }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`)
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
    const { user_id, access_token } = (req.body as Record<string, unknown>)
    if (!user_id) throw new Error("user_id is required")

    if (user_id && user_id !== user.id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      process.env["SUPABASE_URL"]!,
      process.env["SUPABASE_SERVICE_ROLE_KEY"]!
    )

    // Use provided access token or refresh from stored token
    let token = access_token
    if (!token) {
      const { data: profile } = await supabaseAdmin
        .from("profiles").select("google_refresh_token")
        .eq("id", user_id).single()
      if (!profile?.google_refresh_token) {
        throw new Error("No Google refresh token found. Please sign in with Google.")
      }
      token = await refreshAccessToken(profile.google_refresh_token)
    }

    // Fetch the user's calendar list
    const res = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await res.json()
    if (data.error) throw new Error(`Calendar API error: ${data.error.message}`)

    // Find the primary calendar
    const primary = data.items?.find((c: any) => c.primary) || data.items?.[0]
    if (!primary) throw new Error("No calendars found")

    const calendarId = primary.id
    const calendarName = primary.summary || primary.id

    // Save to profile
    await supabaseAdmin
      .from("profiles")
      .update({ google_calendar_id: calendarId })
      .eq("id", user_id)

    return new Response(JSON.stringify({ calendar_id: calendarId, calendar_name: calendarName }), {
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    })
  } catch (e) {
    console.error("detect-calendar error:", e)
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    })
  }
}