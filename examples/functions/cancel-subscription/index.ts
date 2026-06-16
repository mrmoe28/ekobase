import { createClient } from "@supabase/supabase-js";

const ALLOWED_ORIGINS = (process.env["ALLOWED_ORIGINS"] || "https://ops.lock28.com,http://localhost:5174,http://localhost:5173,http://192.168.1.128:5174").split(",");

function corsHeaders(req: Request) {
  const origin = (req.headers["origin"] as string | undefined) || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return { statusCode: 204, body: "",  headers: corsHeaders(req)  };

  try {
    const SQUARE_ENV = process.env["SQUARE_ENVIRONMENT"] || "sandbox"
    const baseUrl = SQUARE_ENV === "production"
      ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com"

    const supabase = createClient(
      process.env["SUPABASE_URL"]!,
      process.env["SUPABASE_SERVICE_ROLE_KEY"]!
    )

    // Auth
    const authHeader = (req.headers["Authorization"] as string | undefined)
    if (!authHeader) throw new Error("Missing authorization")
    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""))
    if (authErr || !user) throw new Error("Unauthorized")

    // Get subscription
    const { data: sub } = await supabase
      .from("subscriptions").select("*")
      .eq("user_id", user.id).single()
    if (!sub) throw new Error("No subscription found")
    if (sub.status === "founder") throw new Error("Founder accounts cannot be canceled")
    if (sub.canceled_at) throw new Error("Already canceled")

    // Get platform Square token
    const { data: platform } = await supabase
      .from("profiles").select("square_access_token")
      .eq("company_email", "ekosolarize@gmail.com").single()
    const SQUARE_TOKEN = platform?.square_access_token || process.env["SQUARE_ACCESS_TOKEN"]
    if (!SQUARE_TOKEN) throw new Error("Platform Square not configured")

    // Cancel in Square (cancels at end of current billing period)
    if (sub.square_subscription_id) {
      const cancelRes = await fetch(`${baseUrl}/v2/subscriptions/${sub.square_subscription_id}/cancel`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${SQUARE_TOKEN}`,
          "Content-Type": "application/json",
          "Square-Version": "2024-01-18",
        },
      })
      const cancelData = await cancelRes.json()
      if (cancelData.errors) {
        console.error("Square cancel error:", JSON.stringify(cancelData.errors))
      }
    }

    // Update DB: mark canceled but keep status active until period ends
    const now = new Date().toISOString()
    await supabase.from("subscriptions").update({
      canceled_at: now,
      updated_at: now,
    }).eq("user_id", user.id)

    // Log event
    await supabase.from("subscription_events").insert({
      user_id: user.id,
      event_type: "subscription.canceled",
      details: { canceled_at: now, access_until: sub.current_period_end },
    })

    return new Response(JSON.stringify({
      success: true,
      message: "Subscription canceled. You have access until " + new Date(sub.current_period_end).toLocaleDateString(),
      access_until: sub.current_period_end,
    }), {
      headers: { ...corsHeaders(req), "Content-Type": "application/json" }
    })
  } catch (e) {
    console.error("cancel-subscription error:", e)
    return { statusCode: 500, body: JSON.stringify({ error: String(e) }), headers: {  ...corsHeaders(req), "Content-Type": "application/json"  } };
  }
})
