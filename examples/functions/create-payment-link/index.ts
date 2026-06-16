import { createClient } from "@supabase/supabase-js"

const SQUARE_ENV = process.env.SQUARE_ENVIRONMENT || "production"
const SQUARE_API = SQUARE_ENV === "sandbox"
  ? "https://connect.squareupsandbox.com"
  : "https://connect.squareup.com"
const SQUARE_APP_ID = process.env.SQUARE_APP_ID
const SQUARE_APP_SECRET = process.env.SQUARE_APP_SECRET
const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!

async function refreshSquareToken(adminClient: any, userId: string, refreshToken: string) {
  if (!SQUARE_APP_ID || !SQUARE_APP_SECRET) {
    console.error("Cannot refresh Square token: SQUARE_APP_ID/SECRET not configured")
    return null
  }
  const res = await fetch(`${SQUARE_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Square-Version": "2025-01-23" },
    body: JSON.stringify({
      client_id: SQUARE_APP_ID,
      client_secret: SQUARE_APP_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  })
  const data: any = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) {
    console.error("Square token refresh failed", { status: res.status, body: data })
    return null
  }
  await adminClient.from("profiles").update({
    square_access_token: data.access_token,
    square_refresh_token: data.refresh_token || refreshToken,
    square_connected_at: new Date().toISOString(),
  }).eq("id", userId)
  return data.access_token as string
}

export async function handler(req: any) {
  const body = req.body || {}
  const { invoice_id, amount_cents, description, recipient_name, recipient_email, is_deposit, approval_token } = body

  if (!invoice_id || !amount_cents) {
    return { error: "Missing invoice_id or amount_cents" }
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  let userId: string | null = null

  const authHeader = req.headers?.authorization || req.headers?.Authorization || ""
  if (authHeader) {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user } } = await supabase.auth.getUser()
    if (user) userId = user.id
  }

  if (!userId && approval_token) {
    const { data: qt } = await adminClient.from("quotes").select("user_id").eq("approval_token", approval_token).single()
    if (qt) userId = qt.user_id
  }

  if (!userId && invoice_id) {
    const { data: inv } = await adminClient.from("invoices").select("quote_id").eq("id", invoice_id).single()
    if (inv?.quote_id) {
      const { data: qt } = await adminClient.from("quotes").select("user_id").eq("id", inv.quote_id).single()
      if (qt) userId = qt.user_id
    }
    if (!userId) {
      const { data: profiles } = await adminClient.from("profiles").select("id").limit(1)
      if (profiles?.[0]) userId = profiles[0].id
    }
  }

  if (!userId) return { error: "Unauthorized — could not resolve owner" }
  if (amount_cents <= 0) return { error: "Invalid amount" }

  const { data: profile } = await adminClient
    .from("profiles")
    .select("square_access_token, square_refresh_token, square_location_id")
    .eq("id", userId)
    .single()

  if (!profile?.square_access_token) return { error: "Square not connected" }

  const { data: invoiceRow } = await adminClient
    .from("invoices")
    .select("scope_of_work, description")
    .eq("id", invoice_id)
    .single()

  const { data: liRows } = await adminClient
    .from("invoice_line_items")
    .select("description, category, quantity, unit_price_cents, sort_order")
    .eq("invoice_id", invoice_id)
    .order("sort_order")

  const invoiceLineItems = (liRows || []).map((li: any) => ({
    name: (li.description || li.category || "Item").slice(0, 512),
    quantity: String(li.quantity || 1),
    base_price_money: { amount: Math.round(li.unit_price_cents), currency: "USD" },
  }))
  const lineItemsTotal = (liRows || []).reduce(
    (s: number, li: any) => s + Math.round(Number(li.quantity || 0) * Number(li.unit_price_cents || 0)),
    0,
  )

  const scope = (invoiceRow?.scope_of_work || "").trim()
  const baseTitle = (description || invoiceRow?.description || "Invoice Payment").toString()

  const requestBody: Record<string, unknown> = {
    idempotency_key: crypto.randomUUID(),
    checkout_options: { allow_tipping: false, ask_for_shipping_address: false },
    pre_populated_data: recipient_email ? { buyer_email: recipient_email } : undefined,
  }

  const canItemizeInvoice = !is_deposit && invoiceLineItems.length > 0 && lineItemsTotal === amount_cents

  if (canItemizeInvoice) {
    const orderLineItems = scope
      ? [
          { name: `Scope of Work: ${scope}`.slice(0, 512), quantity: "1", base_price_money: { amount: 0, currency: "USD" } },
          ...invoiceLineItems,
        ]
      : invoiceLineItems

    requestBody.order = {
      location_id: profile.square_location_id,
      reference_id: String(invoice_id).slice(0, 40),
      line_items: orderLineItems,
    }
  } else {
    const itemsSummary = invoiceLineItems.map((li: any) => li.name).filter(Boolean).join(" + ")
    const recipient = (recipient_name || "").toString().trim()
    const titleParts = [
      "Deposit",
      itemsSummary || (invoiceRow?.description || "").toString().trim() || null,
      recipient || null,
    ].filter(Boolean) as string[]
    const quickName = titleParts.join(" — ").slice(0, 240)

    requestBody.quick_pay = {
      name: quickName || baseTitle.slice(0, 240),
      price_money: { amount: amount_cents, currency: "USD" },
      location_id: profile.square_location_id,
    }
  }

  const callSquare = (token: string) => fetch(`${SQUARE_API}/v2/online-checkout/payment-links`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Square-Version": "2025-01-23",
    },
    body: JSON.stringify(requestBody),
  })

  let squareRes = await callSquare(profile.square_access_token)
  let squareText = await squareRes.text()

  if (squareRes.status === 401 && profile.square_refresh_token) {
    const newToken = await refreshSquareToken(adminClient, userId, profile.square_refresh_token)
    if (newToken) {
      squareRes = await callSquare(newToken)
      squareText = await squareRes.text()
    } else {
      return { error: "Square authorization expired — please reconnect Square in Settings", status: 401 }
    }
  }

  let squareData: any
  try { squareData = JSON.parse(squareText) } catch {
    console.error("Square payment-link non-JSON response", { status: squareRes.status, body: squareText.slice(0, 2000) })
    return { error: "Invalid Square response", status: squareRes.status }
  }

  if (!squareRes.ok || !squareData.payment_link) {
    const errors = Array.isArray(squareData.errors) ? squareData.errors : []
    console.error("Square payment-link create failed", { status: squareRes.status, errors })
    const summary = errors.map((e: any) => [e.category, e.code, e.field, e.detail].filter(Boolean).join(" / ")).join("; ") || "Failed to create payment link"
    return { error: summary, errors, status: squareRes.status }
  }

  const paymentUrl = squareData.payment_link.url
  const orderId = squareData.payment_link.order_id

  const updateData: Record<string, string> = {}
  if (is_deposit) {
    updateData.square_deposit_payment_url = paymentUrl
    updateData.square_deposit_order_id = orderId
  } else {
    updateData.square_payment_url = paymentUrl
    updateData.square_order_id = orderId
  }
  await adminClient.from("invoices").update(updateData).eq("id", invoice_id)

  return { url: paymentUrl, order_id: orderId }
}
