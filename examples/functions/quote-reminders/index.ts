// Daily-run edge function that emails quote recipients an expiration reminder
// (via the existing send-email edge function, which uses the user's Google
// account) and logs an in-app notification for the owner. Scheduled via pg_cron.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const PUBLIC_SITE = Deno.env.get("PUBLIC_SITE_URL") || "https://ops.lock28.com"

function daysUntil(dateStr: string): number {
  const ms = new Date(dateStr + "T23:59:59Z").getTime() - Date.now()
  return Math.ceil(ms / (1000 * 60 * 60 * 24))
}

serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })

  const { data: quotes, error } = await supabase
    .from("quotes")
    .select("id, user_id, recipient_name, recipient_email, valid_until, approval_token, status, reminder_windows, reminders_sent, total_cents")
    .in("status", ["SENT", "VIEWED"])
    .not("valid_until", "is", null)
    .not("recipient_email", "is", null)

  if (error) {
    console.error("query failed:", error)
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 })
  }

  let sent = 0
  const skipped: { id: string; reason: string }[] = []

  for (const q of quotes || []) {
    const validUntil = q.valid_until as string
    if (!validUntil) continue
    const days = daysUntil(validUntil)
    const windows: number[] = q.reminder_windows || [3, 1]
    const already: number[] = q.reminders_sent || []
    const hit = windows.find(w => w === days && !already.includes(w))
    if (hit == null) continue

    // Owner's company name for the "From" header
    const { data: prof } = await supabase
      .from("profiles")
      .select("company_name")
      .eq("id", q.user_id)
      .single()
    const fromName = prof?.company_name || "Eko Solar"

    const subject = `Reminder: your quote expires in ${hit} day${hit === 1 ? "" : "s"}`
    const link = `${PUBLIC_SITE}/approve/${q.approval_token}`
    const html = `
      <div style="font-family:Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
        <h2 style="color:#18181b;margin:0 0 12px;">Your quote expires soon</h2>
        <p style="color:#3f3f46;line-height:1.5;">Hi ${q.recipient_name || "there"},</p>
        <p style="color:#3f3f46;line-height:1.5;">
          Just a friendly reminder — your quote from ${fromName} expires on
          <strong>${validUntil}</strong> (in ${hit} day${hit === 1 ? "" : "s"}).
        </p>
        <p style="margin:24px 0;text-align:center;">
          <a href="${link}"
             style="background:#f59e0b;color:#000;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;">
            Review Quote
          </a>
        </p>
        <p style="color:#71717a;font-size:12px;">If you have questions, just reply to this email.</p>
      </div>
    `.trim()

    // Invoke the existing send-email edge function (Gmail-backed)
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: q.recipient_email,
        subject,
        html,
        from_name: fromName,
      }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      console.error(`send-email failed for quote ${q.id}: ${res.status} ${text}`)
      skipped.push({ id: q.id as string, reason: `send-email ${res.status}` })
      continue
    }

    await supabase
      .from("quotes")
      .update({ reminders_sent: [...already, hit] })
      .eq("id", q.id)

    await supabase.from("notifications").insert({
      user_id: q.user_id,
      kind: "quote_reminder_sent",
      title: `Reminder sent to ${q.recipient_name || "customer"}`,
      body: `Quote expires in ${hit} day${hit === 1 ? "" : "s"}. Email sent to ${q.recipient_email}.`,
      link_url: `/quotes`,
    })

    sent++
  }

  return new Response(
    JSON.stringify({ ok: true, sent, candidates: quotes?.length || 0, skipped }),
    { headers: { "Content-Type": "application/json" } }
  )
})
