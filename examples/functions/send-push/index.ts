import { createRequire } from "node:module"
import { execSync } from "node:child_process"
import { createClient } from "@supabase/supabase-js"

const require = createRequire(import.meta.url)

let webpush: any
try {
  webpush = require("/tmp/web-push-install/node_modules/web-push")
} catch {
  execSync("npm install --prefix /tmp/web-push-install web-push@3.6.7", { stdio: "pipe" })
  webpush = require("/tmp/web-push-install/node_modules/web-push")
}

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY
const VAPID_CONTACT = process.env.VAPID_CONTACT || "mailto:admin@example.com"

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_CONTACT, VAPID_PUBLIC, VAPID_PRIVATE)
}

type PushPayload = {
  title: string
  body?: string
  url?: string
  icon?: string
  badge?: string
  tag?: string
}

export async function handler(req: any) {
  if (req.method === "OPTIONS") {
    return { statusCode: 200, body: "ok" }
  }
  if (req.method !== "POST") {
    return { statusCode: 405, body: "Method not allowed" }
  }

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return { error: "VAPID keys not configured" }
  }

  const body = req.body || {}
  const userId = body.user_id
  const payload = body.payload as PushPayload | undefined

  if (!userId || !payload?.title) {
    return { error: "user_id and payload.title required" }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: subs, error } = await supabase
    .from("web_push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId)

  if (error) {
    return { error: error.message }
  }
  if (!subs?.length) {
    return { sent: 0, pruned: 0 }
  }

  const message = JSON.stringify(payload)
  let sent = 0
  const pruneIds: string[] = []

  await Promise.all(subs.map(async (s: any) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        message,
      )
      sent++
    } catch (err: unknown) {
      const status = (err as { statusCode?: number })?.statusCode
      if (status === 404 || status === 410) pruneIds.push(s.id)
      else console.error("web-push send failed", status, err)
    }
  }))

  if (pruneIds.length) {
    await supabase.from("web_push_subscriptions").delete().in("id", pruneIds)
  }

  return { sent, pruned: pruneIds.length, total: subs.length }
}
