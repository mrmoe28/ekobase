import { createClient } from "@supabase/supabase-js";

const ALLOWED_ORIGINS = (process.env["ALLOWED_ORIGINS"] || "https://ops.lock28.com,http://localhost:5174,http://localhost:5173,http://192.168.1.128:5174").split(",")
const SQUARE_ENV = process.env["SQUARE_ENVIRONMENT"] || "production"
const SQUARE_API = SQUARE_ENV === "sandbox"
  ? "https://connect.squareupsandbox.com"
  : "https://connect.squareup.com"
const SQUARE_VERSION = "2025-01-23"

function corsHeaders(req: Request) {
  const origin = (req.headers["origin"] as string | undefined) || ""
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  }
}

type SquareProfile = {
  id: string
  square_access_token: string | null
  square_location_id: string | null
}

async function resolveSquareProfile(admin: ReturnType<typeof createClient>, jobId?: string | null) {
  if (jobId) {
    const { data: job } = await admin
      .from("jobs")
      .select("company_id")
      .eq("id", jobId)
      .maybeSingle()

    if (job?.company_id) {
      const { data: company } = await admin
        .from("companies")
        .select("user_id")
        .eq("id", job.company_id)
        .maybeSingle()

      if (company?.user_id) {
        const { data: profile } = await admin
          .from("profiles")
          .select("id, square_access_token, square_location_id")
          .eq("id", company.user_id)
          .maybeSingle()

        if (profile?.square_access_token) return profile as SquareProfile
      }
    }
  }

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, square_access_token, square_location_id")
    .not("square_access_token", "is", null)
    .limit(1)

  return (profiles?.[0] as SquareProfile | undefined) ?? null
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return { statusCode: 204, body: "",  headers: corsHeaders(req)  };
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    })
  }

  try {
    const { source_id, amount_cents, job_id, client_name, email } = (req.body as Record<string, unknown>)

    if (!source_id) throw new Error("source_id is required")
    if (!amount_cents || Number(amount_cents) <= 0) throw new Error("amount_cents must be positive")

    const admin = createClient(
      process.env["SUPABASE_URL"]!,
      process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
    )

    const profile = await resolveSquareProfile(admin, typeof job_id === "string" ? job_id : null)
    if (!profile?.square_access_token) throw new Error("Square not connected")
    if (!profile.square_location_id) throw new Error("Square location is missing")

    const customerRes = await fetch(`${SQUARE_API}/v2/customers`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${profile.square_access_token}`,
        "Content-Type": "application/json",
        "Square-Version": SQUARE_VERSION,
      },
      body: JSON.stringify({
        idempotency_key: `quote-deposit-customer-${job_id || crypto.randomUUID()}`,
        given_name: typeof client_name === "string" ? client_name.split(" ")[0] : undefined,
        family_name: typeof client_name === "string" ? client_name.split(" ").slice(1).join(" ") : undefined,
        email_address: typeof email === "string" ? email : undefined,
      }),
    })
    const customerData = await customerRes.json().catch(() => ({}))
    if (!customerRes.ok || !customerData.customer?.id) {
      throw new Error(`Customer creation failed: ${JSON.stringify(customerData.errors ?? customerData)}`)
    }

    const paymentRes = await fetch(`${SQUARE_API}/v2/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${profile.square_access_token}`,
        "Content-Type": "application/json",
        "Square-Version": SQUARE_VERSION,
      },
      body: JSON.stringify({
        idempotency_key: `quote-deposit-payment-${job_id || crypto.randomUUID()}-${amount_cents}`,
        source_id,
        customer_id: customerData.customer.id,
        location_id: profile.square_location_id,
        amount_money: {
          amount: Math.round(Number(amount_cents)),
          currency: "USD",
        },
        autocomplete: true,
        note: typeof job_id === "string" ? `Quote request deposit for job ${job_id}` : "Quote request deposit",
      }),
    })

    const paymentData = await paymentRes.json().catch(() => ({}))
    if (!paymentRes.ok || !paymentData.payment?.id) {
      throw new Error(`Payment failed: ${JSON.stringify(paymentData.errors ?? paymentData)}`)
    }

    return new Response(JSON.stringify({
      success: true,
      payment_id: paymentData.payment.id,
      status: paymentData.payment.status,
      amount_cents: paymentData.payment.amount_money?.amount ?? Math.round(Number(amount_cents)),
    }), {
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    })
  } catch (error) {
    console.error("quote-deposit error:", error)
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    })
  }
})
