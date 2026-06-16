type FnRequest = {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  query: unknown;
};

import { createClient } from "@supabase/supabase-js";
// TODO: install nodemailer in functions-runner
// import nodemailer from "nodemailer"

const ALLOWED_ORIGINS = (process.env["ALLOWED_ORIGINS"] || "https://ops.lock28.com,http://localhost:5174,http://localhost:5173,http://192.168.1.128:5174").split(",");

function corsHeaders(req: Request) {
  const origin = (req.headers["origin"] as string | undefined) || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

async function sendEmailViaSendGrid(params: {
  to: string
  subject: string
  html: string
  fromName: string
}) {
  const apiKey = process.env["SENDGRID_API_KEY"]
  const fromEmail = process.env["FROM_EMAIL"] || process.env["GMAIL_USER"]
  if (!apiKey) throw new Error("SENDGRID_API_KEY is not configured")
  if (!fromEmail) throw new Error("FROM_EMAIL is not configured")

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: params.to }] }],
      from: { email: fromEmail, name: params.fromName },
      subject: params.subject,
      content: [{ type: "text/html", value: params.html }],
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`SendGrid API error (${res.status}): ${body}`)
  }
}

async function sendEmailViaGmailSmtp(params: {
  to: string
  subject: string
  html: string
  fromName: string
}) {
  // Nodemailer not available in this runtime; skip Gmail SMTP fallback
  throw new Error("Gmail SMTP fallback requires nodemailer (not installed)")
}

async function sendNotificationEmail(params: {
  to: string
  subject: string
  html: string
  fromName: string
}) {
  try {
    await sendEmailViaSendGrid(params)
    return { provider: "sendgrid" }
  } catch (sendGridError) {
    console.error("SendGrid send failed, falling back to Gmail SMTP:", sendGridError)
  }

  await sendEmailViaGmailSmtp(params)
  return { provider: "gmail-smtp" }
}

async function sendTelegramNotification(body: string) {
  const token = process.env["TELEGRAM_BOT_TOKEN"]
  const chatId = process.env["TELEGRAM_CHAT_ID"]
  if (!token || !chatId) {
    console.log("[Telegram] skipped — TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing")
    return { sent: false, skipped: "missing_telegram_config" }
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: body, parse_mode: "HTML" }),
  })
  if (!res.ok) {
    const text = await res.text()
    console.error("[Telegram] API error", res.status, text)
    return { sent: false, skipped: "telegram_api_error" }
  }
  console.log("[Telegram] notification sent")
  return { sent: true }
}

async function sendOwnerSms(params: {
  supabaseAdmin: ReturnType<typeof createClient>
  userId: string
  body: string
}) {
  const { data: settings } = await params.supabaseAdmin
    .from("sms_settings")
    .select("notify_phone, notify_on_form_submitted")
    .eq("user_id", params.userId)
    .maybeSingle()

  const notifyPhone = settings?.notify_phone || process.env["OWNER_NOTIFY_PHONE"]
  if (!notifyPhone || settings?.notify_on_form_submitted === false) {
    return { sent: false, skipped: "disabled_or_no_phone" }
  }

  const sid = process.env["TWILIO_ACCOUNT_SID"]
  const token = process.env["TWILIO_AUTH_TOKEN"]
  const messagingServiceSid = process.env["TWILIO_MESSAGING_SERVICE_SID"]
  const from = process.env["TWILIO_FROM_NUMBER"] || process.env["TWILIO_PHONE_NUMBER"]
  if (!sid || !token || (!from && !messagingServiceSid)) {
    console.error("Twilio SMS config missing")
    return { sent: false, skipped: "missing_twilio_config" }
  }

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${sid}:${token}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      ...(messagingServiceSid ? { MessagingServiceSid: messagingServiceSid } : { From: from! }),
      To: notifyPhone,
      Body: params.body.slice(0, 480),
    }),
  })

  if (!res.ok) {
    console.error("Twilio form SMS error", res.status, await res.text())
    return { sent: false, skipped: "twilio_error" }
  }

  return { sent: true }
}

function findField(data: Record<string, any>, ...patterns: string[]) {
  for (const p of patterns) {
    const re = new RegExp(p, "i")
    const key = Object.keys(data || {}).find(k => re.test(k) && data[k] && !k.startsWith("_"))
    if (key) return String(data[key])
  }
  return ""
}

export async function handler(req: FnRequest) {
  if (req.method === "OPTIONS") {
    return { statusCode: 204, body: "",  headers: corsHeaders(req)  };
  }

  try {
    // Auth check
    const authHeader = (req.headers["Authorization"] as string | undefined) || "";
    const supabaseAuth = createClient(
      process.env["SUPABASE_URL"] || "",
      process.env["SUPABASE_ANON_KEY"] || "",
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await supabaseAuth.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const { form_id, submission_data, scheduled_date, deposit_info, image_urls } = (req.body as Record<string, unknown>)

    const supabaseAdmin = createClient(
      process.env["SUPABASE_URL"]!,
      process.env["SUPABASE_SERVICE_ROLE_KEY"]!
    )

    // Get form title and owner
    const { data: form } = await supabaseAdmin
      .from("forms").select("title, user_id")
      .eq("id", form_id).single()
    if (!form) throw new Error("Form not found")

    // Get owner email from profiles (company_email), fallback to auth email
    const { data: profile } = await supabaseAdmin
      .from("profiles").select("company_email, full_name")
      .eq("id", form.user_id).single()

    let ownerEmail = profile?.company_email
    if (!ownerEmail) {
      const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(form.user_id)
      ownerEmail = user?.email
    }
    if (!ownerEmail) throw new Error("No owner email found")

    // Build email HTML
    const dataRows = Object.entries(submission_data || {})
      .filter(([k]) => !k.startsWith("_"))
      .map(([k, v]) => {
        const value = v || "N/A"
        return '<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600;color:#555;width:35%">' + k + '</td><td style="padding:8px 12px;border-bottom:1px solid #eee;color:#222">' + value + '</td></tr>'
      }).join("")

    let dateHtml = ""
    if (scheduled_date) {
      dateHtml = '<div style="background:#eff6ff;border:1px solid #93c5fd;border-radius:8px;padding:12px 16px;margin:16px 0"><strong style="color:#1e40af">Booking Date: ' + scheduled_date + '</strong></div>'
    }

    let depositHtml = ""
    if (deposit_info && deposit_info.status === "paid" && deposit_info.amount) {
      const svc = deposit_info.service || "N/A"
      depositHtml = '<div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:12px 16px;margin:16px 0"><strong style="color:#065f46">Deposit Paid: ' + deposit_info.amount + '</strong><div style="color:#047857;font-size:13px;margin-top:4px">Service: ' + svc + '</div></div>'
    }

    let imagesHtml = ""
    if (image_urls && image_urls.length > 0) {
      imagesHtml = '<div style="margin-top:16px"><strong style="color:#555;font-size:13px;display:block;margin-bottom:8px">Uploaded Photos (' + image_urls.length + ')</strong>' +
        image_urls.map((url: string) => '<img src="' + url + '" style="max-width:100%;border-radius:8px;margin-bottom:8px;border:1px solid #e5e7eb" />').join("") +
        '</div>'
    }

    const html = '<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto"><div style="background:#f59e0b;padding:16px 24px;border-radius:8px 8px 0 0"><h2 style="margin:0;color:#fff;font-size:18px">New Form Submission</h2><p style="margin:4px 0 0;color:#fef3c7;font-size:13px">' + form.title + '</p></div><div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:20px 24px">' + dateHtml + depositHtml + '<table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:12px">' + dataRows + '</table>' + imagesHtml + '<p style="color:#9ca3af;font-size:11px;margin-top:20px;text-align:center">Sent from EKO Solar Pros form system</p></div></div>'

    const subject = "New Booking" + (scheduled_date ? " - " + scheduled_date : "") + " | " + form.title

    const emailResult = await sendNotificationEmail({
      to: ownerEmail,
      subject,
      html,
      fromName: "EKO Solar Pros",
    })
    console.log("form-submission-notify email sent via", emailResult.provider)

    try {
      const clientName = findField(submission_data, "name", "client", "customer", "contact") || "New client"
      const address = findField(submission_data, "address", "location", "site")
      const phone = findField(submission_data, "phone", "tel", "mobile", "cell")
      const depositText = deposit_info?.status === "paid" && deposit_info?.amount
        ? ` Deposit paid: ${deposit_info.amount}.`
        : ""
      const scheduleText = scheduled_date ? ` Scheduled: ${scheduled_date}.` : ""
      const addressText = address ? ` ${address}.` : ""
      const phoneText = phone ? ` Phone: ${phone}.` : ""
      const smsBody = `New form submission: ${clientName} - ${form.title}.${addressText}${phoneText}${scheduleText}${depositText}`
      await sendOwnerSms({ supabaseAdmin, userId: form.user_id, body: smsBody })

      // Telegram notification with emoji formatting
      const tgBody = (
        `📝 <b>New Form Submission</b>\n\n` +
        `📋 Form: ${form.title}\n` +
        `👤 Client: ${clientName}\n` +
        (phone ? `📞 Phone: ${phone}\n` : "") +
        (address ? `📍 Address: ${address}\n` : "") +
        (scheduled_date ? `📅 Scheduled: ${scheduled_date}\n` : "") +
        (deposit_info?.status === "paid" && deposit_info?.amount ? `💰 Deposit: ${deposit_info.amount}\n` : "")
      )
      await sendTelegramNotification(tgBody)
    } catch (smsErr) {
      console.error("form submission SMS/Telegram failed:", smsErr)
    }

    // Create Google Calendar event if a booking date exists
    if (scheduled_date) {
      const supabaseUrl = process.env["SUPABASE_URL"]!
      const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"]!
      const clientName = findField(submission_data, "name", "client", "customer", "contact") || "New Client"
      const address = findField(submission_data, "address", "location", "site")
      const calRes = await fetch(supabaseUrl + "/functions/v1/create-calendar-event", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + serviceKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: form.user_id,
          summary: `${form.title} — ${clientName}`,
          description: `Form: ${form.title}\nClient: ${clientName}\nSubmitted: ${new Date().toISOString().slice(0, 10)}` +
            (deposit_info?.status === "paid" ? `\nDeposit: ${deposit_info.amount}` : ""),
          date: scheduled_date,
          location: address,
        }),
      })
      const calData = await calRes.json()
      if (calData.error) console.error("calendar-event error:", calData.error)
      else if (calData.skipped) console.log("calendar-event skipped:", calData.reason)
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    })
  } catch (e) {
    console.error("form-submission-notify error:", e)
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    })
  }
}