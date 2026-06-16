import { createClient } from "@supabase/supabase-js"

const SQUARE_APP_ID = process.env.SQUARE_APP_ID!
const SQUARE_APP_SECRET = process.env.SQUARE_APP_SECRET!
const SQUARE_ENV = process.env.SQUARE_ENVIRONMENT || "production"
const APP_URL = process.env.APP_URL || "https://ops.lock28.com"
const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const DATA_SUPABASE_URL = process.env.DATA_SUPABASE_URL || SUPABASE_URL
const DATA_SUPABASE_SERVICE_ROLE_KEY = process.env.DATA_SUPABASE_SERVICE_ROLE_KEY || SUPABASE_SERVICE_ROLE_KEY

const BASE_URL = SQUARE_ENV === "production"
  ? "https://connect.squareup.com"
  : "https://connect.squareupsandbox.com"

const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/square-oauth?action=callback`

const SCOPES = [
  "MERCHANT_PROFILE_READ",
  "PAYMENTS_WRITE", "PAYMENTS_READ",
  "INVOICES_WRITE", "INVOICES_READ",
  "ORDERS_WRITE", "ORDERS_READ",
  "SUBSCRIPTIONS_WRITE", "SUBSCRIPTIONS_READ",
  "ITEMS_WRITE", "ITEMS_READ",
  "CUSTOMERS_WRITE", "CUSTOMERS_READ",
].join("+")

export async function handler(req: any) {
  const query = req.query || {}
  const action = query.action

  if (action === "authorize") {
    const userId = query.user_id
    if (!userId) return { error: "user_id required" }
    const authUrl = `${BASE_URL}/oauth2/authorize?client_id=${SQUARE_APP_ID}&scope=${SCOPES}&session=false&state=${userId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
    return { url: authUrl }
  }

  if (action === "callback") {
    const code = query.code
    const userId = query.state
    const error = query.error

    if (error || !code || !userId) {
      console.error("Square OAuth denied:", { error, code: !!code, userId: !!userId })
      const html = `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${APP_URL}?square=error"></head><body>Square connection failed. Redirecting...</body></html>`
      return { statusCode: 302, headers: { Location: `${APP_URL}?square=error` }, body: html }
    }

    const tokenRes = await fetch(`${BASE_URL}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Square-Version": "2024-01-18" },
      body: JSON.stringify({
        client_id: SQUARE_APP_ID,
        client_secret: SQUARE_APP_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
      }),
    })

    const tokenData = await tokenRes.json() as any

    if (!tokenData.access_token) {
      console.error("Token exchange failed:", JSON.stringify(tokenData))
      return { statusCode: 302, headers: { Location: `${APP_URL}?square=error` }, body: "" }
    }

    const supabase = createClient(DATA_SUPABASE_URL, DATA_SUPABASE_SERVICE_ROLE_KEY)

    await supabase.from("profiles").update({
      square_access_token: tokenData.access_token,
      square_refresh_token: tokenData.refresh_token,
      square_merchant_id: tokenData.merchant_id,
      square_connected_at: new Date().toISOString(),
    }).eq("id", userId)

    try {
      const locRes = await fetch(`${BASE_URL}/v2/locations`, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      })
      const locData = await locRes.json() as any
      const mainLoc = locData.locations?.find((l: any) => l.status === "ACTIVE") || locData.locations?.[0]
      if (mainLoc) {
        await supabase.from("profiles").update({ square_location_id: mainLoc.id }).eq("id", userId)
      }
    } catch (e) {
      console.error("Failed to fetch Square locations:", e)
    }

    return { statusCode: 302, headers: { Location: `${APP_URL}?square=connected` }, body: "" }
  }

  return { error: `Unknown action: ${action}` }
}
