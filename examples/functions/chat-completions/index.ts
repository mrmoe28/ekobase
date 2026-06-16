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

export async function handler(req: FnRequest) {
  if (req.method === "OPTIONS") {
    return { statusCode: 204, body: "",  headers: corsHeaders(req)  };
  }

  try {
    // Authenticate the user via Supabase JWT
    const authHeader = (req.headers["Authorization"] as string | undefined)
    if (!authHeader) throw new Error("Missing authorization header")

    const supabaseAdmin = createClient(
      process.env["SUPABASE_URL"]!,
      process.env["SUPABASE_SERVICE_ROLE_KEY"]!
    )

    const token = authHeader.replace("Bearer ", "")
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !user) throw new Error("Unauthorized")

    // ── Rate limiting: 100 requests per hour per user ──
    const RATE_LIMIT = 100
    const WINDOW_MS = 60 * 60 * 1000 // 1 hour

    const { data: rl } = await supabaseAdmin
      .from("chat_rate_limits").select("request_count, window_start")
      .eq("user_id", user.id).single()

    const now = new Date()
    if (rl) {
      const windowStart = new Date(rl.window_start)
      const elapsed = now.getTime() - windowStart.getTime()
      if (elapsed < WINDOW_MS && rl.request_count >= RATE_LIMIT) {
        const retryAfter = Math.ceil((WINDOW_MS - elapsed) / 1000)
        return new Response(JSON.stringify({ error: `Rate limit exceeded. Try again in ${Math.ceil(retryAfter / 60)} minutes.` }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(retryAfter) },
        })
      }
      if (elapsed >= WINDOW_MS) {
        // Reset window
        await supabaseAdmin.from("chat_rate_limits").update({ request_count: 1, window_start: now.toISOString() }).eq("user_id", user.id)
      } else {
        await supabaseAdmin.from("chat_rate_limits").update({ request_count: rl.request_count + 1 }).eq("user_id", user.id)
      }
    } else {
      await supabaseAdmin.from("chat_rate_limits").insert({ user_id: user.id, request_count: 1, window_start: now.toISOString() })
    }

    const apiKey = process.env["XAI_API_KEY"]
    if (!apiKey) throw new Error("XAI_API_KEY not configured")

    const { messages, tools, temperature = 0.7, max_tokens = 1000 } = (req.body as Record<string, unknown>)
    if (!messages) throw new Error("messages is required")

    const llmRes = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "grok-4-fast-non-reasoning",
        messages,
        tools: tools || undefined,
        temperature,
        max_tokens,
      }),
    })

    const result = await llmRes.json()

    if (!llmRes.ok || result.error) {
      const msg = result?.error?.message || JSON.stringify(result).slice(0, 300)
      throw new Error(`xAI ${llmRes.status} (${result?.error?.code || result?.error?.type || "error"}): ${msg}`)
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    })
  } catch (e) {
    console.error("chat-completions error:", e)
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    })
  }
}