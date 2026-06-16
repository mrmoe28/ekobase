import { createClient } from "@supabase/supabase-js";
import nodemailer from "npm:nodemailer"

type FnRequest = {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  query: unknown;
};

const ALLOWED_ORIGINS = (process.env["ALLOWED_ORIGINS"] || "https://ops.lock28.com,http://localhost:5174,http://localhost:5173,http://192.168.1.128:5174").split(",")

function corsHeaders(req: Request) {
  const origin = (req.headers["origin"] as string | undefined) || ""
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  }
}

async function sendEmailViaSendGrid(params: { to: string; subject: string; html: string; fromName: string }) {
  const apiKey = process.env["SENDGRID_API_KEY"]
  const fromEmail = process.env["FROM_EMAIL"] || process.env["GMAIL_USER"]
  if (!apiKey) throw new Error("SENDGRID_API_KEY is not configured")
  if (!fromEmail) throw new Error("FROM_EMAIL is not configured")
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: params.to }] }],
      from: { email: fromEmail, name: params.fromName },
      subject: params.subject,
      content: [{ type: "text/html", value: params.html }],
    }),
  })
  if (!res.ok) throw new Error(`SendGrid ${res.status}: ${await res.text()}`)
}

async function sendEmailViaGmailSmtp(params: { to: string; subject: string; html: string; fromName: string }) {
  const user = process.env["GMAIL_USER"]
  const pass = process.env["GMAIL_APP_PASSWORD"]
  if (!user || !pass) throw new Error("GMAIL_USER or GMAIL_APP_PASSWORD missing")
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass },
  })
  await transporter.sendMail({
    from: `"${params.fromName}" <${user}>`,
    to: params.to,
    subject: params.subject,
    html: params.html,
  })
}

async function sendNotificationEmail(params: { to: string; subject: string; html: string; fromName: string }) {
  try {
    await sendEmailViaSendGrid(params)
    return "sendgrid"
  } catch (e) {
    console.error("SendGrid failed, falling back to Gmail:", e)
  }
  await sendEmailViaGmailSmtp(params)
  return "gmail-smtp"
}

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.startsWith("+")) return trimmed.replace(/[^\d+]/g, "")
  const digits = trimmed.replace(/\D/g, "")
  if (digits.length === 10) return "+1" + digits
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits
  if (digits.length >= 8) return "+" + digits
  return null
}

async function twilioSend(to: string, body: string) {
  const sid = process.env["TWILIO_ACCOUNT_SID"]
  const token = process.env["TWILIO_AUTH_TOKEN"]
  const messagingServiceSid = process.env["TWILIO_MESSAGING_SERVICE_SID"]
  const from = process.env["TWILIO_FROM_NUMBER"] || process.env["TWILIO_PHONE_NUMBER"]
  if (!sid || !token || (!from && !messagingServiceSid)) {
    console.error("Twilio env missing")
    return
  }
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(`${sid}:${token}`), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ...(messagingServiceSid ? { MessagingServiceSid: messagingServiceSid } : { From: from! }),
      To: to,
      Body: body.slice(0, 480),
    }),
  })
  if (!res.ok) {
    console.error("Twilio error", res.status, await res.text())
  }
}

async function sendOwnerSms(supabaseAdmin: ReturnType<typeof createClient>, userId: string, body: string) {
  const { data: settings } = await supabaseAdmin
    .from("sms_settings")
    .select("notify_phone, notify_on_form_submitted")
    .eq("user_id", userId)
    .maybeSingle()
  const phone = normalizePhone((settings as any)?.notify_phone || process.env["OWNER_NOTIFY_PHONE"])
  if (!phone || (settings as any)?.notify_on_form_submitted === false) return
  await twilioSend(phone, body)
}

async function sendClientSms(rawPhone: string | null | undefined, body: string) {
  const phone = normalizePhone(rawPhone)
  if (!phone) return
  await twilioSend(phone, body)
}

// Statuses that warrant an outbound SMS to the client. Internal moves like
// REVIEWED stay email-only so clients aren't pinged for every status tweak.
const SMS_NOTIFY_STATUSES = new Set(["APPROVED", "DECLINED", "CONVERTED"])

const STATUS_LABEL: Record<string, string> = {
  PENDING: "received",
  REVIEWED: "under review",
  APPROVED: "approved",
  DECLINED: "declined",
  CONVERTED: "scheduled",
}

const STATUS_HEADER_COLOR: Record<string, string> = {
  APPROVED: "#10b981",
  CONVERTED: "#0ea5e9",
  DECLINED: "#ef4444",
  REVIEWED: "#3b82f6",
  PENDING: "#f59e0b",
}

export async function handler(req: FnRequest) {
  if (req.method === "OPTIONS") return { statusCode: 204, body: "",  headers: corsHeaders(req)  };

  try {
    const authHeader = (req.headers["Authorization"] as string | undefined) || ""
    const supabaseAuth = createClient(
      process.env["SUPABASE_URL"] || "",
      process.env["SUPABASE_ANON_KEY"] || "",
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user } } = await supabaseAuth.auth.getUser()
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      })
    }

    const { request_id, action } = (req.body as Record<string, unknown>)
    if (!request_id || !action) throw new Error("request_id and action required")

    const supabaseAdmin = createClient(
      process.env["SUPABASE_URL"]!,
      process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
    )

    const { data: r, error: reqErr } = await supabaseAdmin
      .from("client_requests").select("*").eq("id", request_id).single()
    if (reqErr || !r) throw new Error(`Request not found: ${reqErr?.message}`)

    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("id, name, contact_email, contact_phone, user_id")
      .eq("id", r.company_id).single()
    if (!company) throw new Error("Company not found")

    const { data: clientUser } = await supabaseAdmin
      .from("client_users").select("linked_email").eq("id", r.client_user_id).maybeSingle()

    const typeLabel = r.type === "JOB" ? "Service Request" : "Reschedule Request"

    if (action === "created") {
      // Look up admin owner email
      let ownerEmail: string | undefined
      const { data: profile } = await supabaseAdmin
        .from("profiles").select("company_email").eq("id", company.user_id).maybeSingle()
      ownerEmail = (profile as any)?.company_email
      if (!ownerEmail) {
        const { data } = await supabaseAdmin.auth.admin.getUserById(company.user_id)
        ownerEmail = data?.user?.email
      }
      if (!ownerEmail) throw new Error("No admin email found")

      const dateLine = r.requested_date
        ? `<p style="margin:8px 0;color:#475569"><strong>Proposed date:</strong> ${r.requested_date}</p>` : ""
      const addressLine = r.address
        ? `<p style="margin:8px 0;color:#475569"><strong>Address:</strong> ${r.address}</p>` : ""
      const descLine = r.description
        ? `<div style="margin-top:12px;padding:12px;background:#f8fafc;border-radius:6px;color:#334155">${r.description}</div>` : ""

      const html = `
        <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto">
          <div style="background:#10b981;padding:16px 24px;border-radius:8px 8px 0 0">
            <h2 style="margin:0;color:#fff;font-size:18px">New ${typeLabel}</h2>
            <p style="margin:4px 0 0;color:#d1fae5;font-size:13px">${company.name}</p>
          </div>
          <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:20px 24px">
            <h3 style="margin:0 0 12px;color:#0f172a;font-size:16px">${r.title}</h3>
            ${dateLine}${addressLine}${descLine}
            <p style="color:#94a3b8;font-size:11px;margin-top:24px;text-align:center">
              Submitted by ${clientUser?.linked_email || "client"} via the EKO Solar Pros portal
            </p>
          </div>
        </div>`

      await sendNotificationEmail({
        to: ownerEmail,
        subject: `New ${typeLabel} from ${company.name} — ${r.title}`,
        html,
        fromName: "EKO Solar Pros Portal",
      })

      try {
        const sms = `New ${typeLabel.toLowerCase()} from ${company.name}: ${r.title}` +
          (r.requested_date ? ` (proposed ${r.requested_date})` : "")
        await sendOwnerSms(supabaseAdmin, company.user_id, sms)
      } catch (e) {
        console.error("owner SMS failed:", e)
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      })
    }

    if (action === "status_changed") {
      const to = clientUser?.linked_email || company.contact_email
      if (!to) {
        return new Response(JSON.stringify({ success: true, skipped: "no_client_email" }), {
          headers: { ...corsHeaders(req), "Content-Type": "application/json" },
        })
      }
      const label = STATUS_LABEL[r.status] || r.status.toLowerCase()
      const color = STATUS_HEADER_COLOR[r.status] || "#475569"
      const replyLine = r.admin_notes
        ? `<div style="margin-top:12px;padding:12px;background:#f8fafc;border-left:3px solid ${color};color:#334155"><strong>Reply:</strong><br/>${r.admin_notes}</div>` : ""
      const portalUrl = (process.env["PORTAL_URL"] || "https://ops.lock28.com") + "/portal"

      const html = `
        <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto">
          <div style="background:${color};padding:16px 24px;border-radius:8px 8px 0 0">
            <h2 style="margin:0;color:#fff;font-size:18px">Your request was ${label}</h2>
          </div>
          <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:20px 24px">
            <h3 style="margin:0 0 8px;color:#0f172a;font-size:16px">${r.title}</h3>
            <p style="margin:0;color:#64748b;font-size:13px">${typeLabel}${r.requested_date ? ` · ${r.requested_date}` : ""}</p>
            ${replyLine}
            <p style="margin-top:20px">
              <a href="${portalUrl}" style="display:inline-block;background:#0f172a;color:#fff;padding:10px 18px;border-radius:6px;font-weight:600;font-size:13px;text-decoration:none">View in portal</a>
            </p>
          </div>
        </div>`

      await sendNotificationEmail({
        to,
        subject: `Your request was ${label} — ${r.title}`,
        html,
        fromName: "EKO Solar Pros",
      })

      if (SMS_NOTIFY_STATUSES.has(r.status)) {
        try {
          const dateText = r.requested_date ? ` on ${r.requested_date}` : ""
          const smsBody = r.status === "CONVERTED"
            ? `EKO Solar Pros: Your ${typeLabel.toLowerCase()} "${r.title}" has been scheduled${dateText}. We'll be in touch with details.`
            : r.status === "APPROVED"
              ? `EKO Solar Pros: Your ${typeLabel.toLowerCase()} "${r.title}" was approved${dateText}. Reply or check the portal for details.`
              : `EKO Solar Pros: Your ${typeLabel.toLowerCase()} "${r.title}" was declined. Reply or check the portal for details.`
          await sendClientSms(company.contact_phone, smsBody)
        } catch (e) {
          console.error("client SMS failed:", e)
        }
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      })
    }

    throw new Error(`Unknown action: ${action}`)
  } catch (e) {
    console.error("client-request-notify error:", e)
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    })
  }
}