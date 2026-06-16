import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "https://ops.lock28.com,http://localhost:5174,http://localhost:5173,http://192.168.1.128:5174").split(",");

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) })

  try {
    const SQUARE_ENV = Deno.env.get("SQUARE_ENVIRONMENT") || "sandbox"
    const baseUrl = SQUARE_ENV === "production"
      ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com"

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )

    // Auth: get user from JWT
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) throw new Error("Missing authorization")
    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""))
    if (authErr || !user) throw new Error("Unauthorized")

    // Check for existing active subscription
    const { data: existing } = await supabase
      .from("subscriptions").select("status")
      .eq("user_id", user.id).single()
    if (existing && (existing.status === "active" || existing.status === "founder")) {
      return new Response(JSON.stringify({ error: "Already subscribed" }), {
        status: 400, headers: { ...corsHeaders(req), "Content-Type": "application/json" }
      })
    }

    const { source_id } = await req.json()
    if (!source_id) throw new Error("source_id is required (card token from Square SDK)")

    // Get platform Square token (from profiles of the platform owner, or from secrets)
    // We use the platform's Square credentials to collect subscription payments
    const { data: platform } = await supabase
      .from("profiles").select("square_access_token, square_location_id")
      .eq("company_email", "ekosolarize@gmail.com").single()

    const SQUARE_TOKEN = platform?.square_access_token || Deno.env.get("SQUARE_ACCESS_TOKEN")
    const LOCATION_ID = platform?.square_location_id || Deno.env.get("SQUARE_LOCATION_ID")
    const PLAN_VARIATION_ID = Deno.env.get("SQUARE_PLAN_VARIATION_ID")

    if (!SQUARE_TOKEN) throw new Error("Platform Square not configured")
    if (!PLAN_VARIATION_ID) throw new Error("Subscription plan not configured")

    const sqHeaders = {
      "Authorization": `Bearer ${SQUARE_TOKEN}`,
      "Content-Type": "application/json",
      "Square-Version": "2024-01-18",
    }

    // Get user profile for customer details
    const { data: profile } = await supabase
      .from("profiles").select("full_name, company_name, company_email, company_phone")
      .eq("id", user.id).single()

    const customerEmail = profile?.company_email || user.email
    const customerName = profile?.full_name || profile?.company_name || user.email

    // 1. Create Square Customer
    const custRes = await fetch(`${baseUrl}/v2/customers`, {
      method: "POST", headers: sqHeaders,
      body: JSON.stringify({
        idempotency_key: `cust-${user.id}`,
        email_address: customerEmail,
        given_name: customerName.split(" ")[0] || customerName,
        family_name: customerName.split(" ").slice(1).join(" ") || "",
        company_name: profile?.company_name || "",
        phone_number: profile?.company_phone || undefined,
      })
    })
    const custData = await custRes.json()
    if (custData.errors) throw new Error(`Customer creation failed: ${JSON.stringify(custData.errors)}`)
    const customerId = custData.customer.id

    // 2. Create Card on File
    const cardRes = await fetch(`${baseUrl}/v2/cards`, {
      method: "POST", headers: sqHeaders,
      body: JSON.stringify({
        idempotency_key: `card-${user.id}-${Date.now()}`,
        source_id,
        card: { customer_id: customerId },
      })
    })
    const cardData = await cardRes.json()
    if (cardData.errors) throw new Error(`Card storage failed: ${JSON.stringify(cardData.errors)}`)
    const cardId = cardData.card.id

    // 3. Create Subscription
    const now = new Date()
    const subRes = await fetch(`${baseUrl}/v2/subscriptions`, {
      method: "POST", headers: sqHeaders,
      body: JSON.stringify({
        idempotency_key: `sub-${user.id}-${Date.now()}`,
        location_id: LOCATION_ID,
        plan_variation_id: PLAN_VARIATION_ID,
        customer_id: customerId,
        card_id: cardId,
        start_date: now.toISOString().split("T")[0],
        timezone: "America/New_York",
      })
    })
    const subData = await subRes.json()
    if (subData.errors) throw new Error(`Subscription creation failed: ${JSON.stringify(subData.errors)}`)

    const subscription = subData.subscription
    const periodEnd = new Date(now)
    periodEnd.setMonth(periodEnd.getMonth() + 1)

    // 4. Save to database
    await supabase.from("subscriptions").upsert({
      user_id: user.id,
      square_subscription_id: subscription.id,
      square_customer_id: customerId,
      square_card_id: cardId,
      plan: "pro",
      status: "active",
      price_cents: 19900,
      current_period_start: now.toISOString(),
      current_period_end: periodEnd.toISOString(),
      updated_at: now.toISOString(),
    })

    // 5. Log event
    await supabase.from("subscription_events").insert({
      user_id: user.id,
      event_type: "subscription.created",
      details: { square_subscription_id: subscription.id, customer_id: customerId },
    })

    // 6. Send admin notification email
    try {
      const GMAIL_USER = Deno.env.get("GMAIL_USER")
      const GMAIL_APP_PASSWORD = Deno.env.get("GMAIL_APP_PASSWORD")
      if (GMAIL_USER && GMAIL_APP_PASSWORD) {
        const emailBody = [
          `From: EKO Solar Ops <${GMAIL_USER}>`,
          `To: ekosolarize@gmail.com`,
          `Subject: New Subscriber: ${customerName}`,
          `Content-Type: text/html; charset=utf-8`,
          ``,
          `<h2>New EKO Solar Ops Subscriber</h2>`,
          `<p><strong>Name:</strong> ${customerName}</p>`,
          `<p><strong>Email:</strong> ${customerEmail}</p>`,
          `<p><strong>Company:</strong> ${profile?.company_name || "N/A"}</p>`,
          `<p><strong>Plan:</strong> Pro ($199/month)</p>`,
          `<p><strong>Date:</strong> ${now.toLocaleDateString()}</p>`,
          `<p><strong>Square Subscription ID:</strong> ${subscription.id}</p>`,
        ].join("\r\n")

        const encoded = btoa(emailBody)
          .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

        // Simple SMTP via fetch to Gmail API or fallback
        // Using Supabase Edge Function invoke pattern
        const notifyUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-notification`
        await fetch(notifyUrl, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            to: "ekosolarize@gmail.com",
            subject: `New Subscriber: ${customerName} (${customerEmail})`,
            html: `<h2>New EKO Solar Ops Subscriber</h2><p><strong>Name:</strong> ${customerName}</p><p><strong>Email:</strong> ${customerEmail}</p><p><strong>Company:</strong> ${profile?.company_name || "N/A"}</p><p><strong>Plan:</strong> Pro ($199/month)</p><p><strong>Date:</strong> ${now.toLocaleDateString()}</p>`,
          })
        }).catch(() => {}) // Don't fail subscription on email failure
      }
    } catch {}

    return new Response(JSON.stringify({
      success: true,
      subscription_id: subscription.id,
      status: "active",
      current_period_end: periodEnd.toISOString(),
    }), {
      headers: { ...corsHeaders(req), "Content-Type": "application/json" }
    })
  } catch (e) {
    console.error("create-subscription error:", e)
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders(req), "Content-Type": "application/json" }
    })
  }
})
