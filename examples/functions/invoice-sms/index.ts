import { createClient } from "@supabase/supabase-js";

type FnRequest = {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  query: unknown;
};

/**
 * Supabase Database Webhook handler.
 * Configure two webhooks in Supabase Dashboard → Database → Webhooks:
 *   1. Table: invoices, Events: UPDATE, URL: /functions/v1/invoice-sms
 *   2. Table: quotes,   Events: UPDATE, URL: /functions/v1/invoice-sms
 *
 * Sends SMS to the owner via Twilio when invoice/quote status transitions to
 * VIEWED / PAID / PARTIALLY_PAID (invoices) or APPROVED (quotes).
 *
 * Env secrets required on the function:
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_FROM_NUMBER or TWILIO_PHONE_NUMBER (E.164, e.g. +15551234567)
 */

type WebhookPayload = {
  type: "INSERT" | "UPDATE" | "DELETE"
  table: string
  schema: string
  record: Record<string, unknown> | null
  old_record: Record<string, unknown> | null
}

export async function handler(req: FnRequest) {
  if (req.method !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  let body: WebhookPayload
  try {
    body = (req.body as Record<string, unknown>)
  } catch {
    return json({ ok: false, reason: "bad_json" }, 200)
  }

  if (body.type !== "UPDATE" || !body.record || !body.old_record) {
    return json({ ok: true, skipped: "not_update" })
  }

  const nextStatus = String(body.record.status ?? "")
  const prevStatus = String(body.old_record.status ?? "")
  if (nextStatus === prevStatus) {
    return json({ ok: true, skipped: "no_status_change" })
  }

  const sb = createClient(
    process.env["SUPABASE_URL"]!,
    process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  const userId = await resolveUserId(sb, body.table, body.record)
  if (!userId) {
    return json({ ok: true, skipped: "no_user_id" })
  }

  const { data: settings } = await sb
    .from("sms_settings")
    .select("notify_phone, notify_on_viewed, notify_on_accepted, notify_on_paid")
    .eq("user_id", userId)
    .maybeSingle()

  const notifyPhone = settings?.notify_phone || process.env["OWNER_NOTIFY_PHONE"]
  if (!notifyPhone) {
    return json({ ok: true, skipped: "no_phone" })
  }

  const msg = buildMessage(body.table, nextStatus, body.record, settings)
  if (!msg) {
    return json({ ok: true, skipped: "event_disabled_or_unsupported" })
  }

  const sid = process.env["TWILIO_ACCOUNT_SID"]
  const token = process.env["TWILIO_AUTH_TOKEN"]
  const messagingServiceSid = process.env["TWILIO_MESSAGING_SERVICE_SID"]
  const from = process.env["TWILIO_FROM_NUMBER"] || process.env["TWILIO_PHONE_NUMBER"]
  if (!sid || !token || (!from && !messagingServiceSid)) {
    console.error("Twilio env missing")
    return { statusCode: 500, body: "Twilio config missing" };
  }

  const twilioRes = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${sid}:${token}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        ...(messagingServiceSid ? { MessagingServiceSid: messagingServiceSid } : { From: from! }),
        To: notifyPhone,
        Body: msg,
      }),
    },
  )

  if (!twilioRes.ok) {
    const err = await twilioRes.text()
    console.error("Twilio error", twilioRes.status, err)
    return new Response(err, { status: 500 })
  }

  return json({ ok: true, sent: true })
})

async function resolveUserId(
  sb: ReturnType<typeof createClient>,
  table: string,
  record: Record<string, unknown>,
): Promise<string | null> {
  if (table === "quotes") {
    return typeof record.user_id === "string" ? record.user_id : null
  }
  if (table === "invoices") {
    const jobId = record.job_id
    if (typeof jobId !== "string") return null
    const { data: job } = await sb.from("jobs").select("company_id").eq("id", jobId).maybeSingle()
    const companyId = job?.company_id as string | undefined
    if (!companyId) return null
    const { data: company } = await sb.from("companies").select("user_id").eq("id", companyId).maybeSingle()
    return (company?.user_id as string | undefined) ?? null
  }
  return null
}

type Settings = {
  notify_phone: string | null
  notify_on_viewed: boolean
  notify_on_accepted: boolean
  notify_on_paid: boolean
}

function buildMessage(
  table: string,
  status: string,
  record: Record<string, unknown>,
  settings: Settings,
): string | null {
  const name = (record.recipient_name as string) || "Customer"
  const amountCents = Number(record.amount_cents ?? 0)
  const paidCents = Number(record.paid_amount_cents ?? 0)
  const amount = amountCents > 0 ? `$${(amountCents / 100).toFixed(2)}` : ""
  const paid = paidCents > 0 ? `$${(paidCents / 100).toFixed(2)}` : ""

  if (table === "quotes") {
    if (status === "APPROVED" && settings.notify_on_accepted) {
      return `${name} accepted your quote${amount ? ` (${amount})` : ""}.`
    }
    return null
  }

  if (table === "invoices") {
    if (status === "VIEWED" && settings.notify_on_viewed) {
      return `${name} just opened invoice${amount ? ` ${amount}` : ""}.`
    }
    if (status === "PAID" && settings.notify_on_paid) {
      return `${name} paid invoice${amount ? ` ${amount}` : ""} in full.`
    }
    if (status === "PARTIALLY_PAID" && settings.notify_on_paid) {
      return `${name} made a partial payment${paid ? ` of ${paid}` : ""}.`
    }
  }

  return null
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}
