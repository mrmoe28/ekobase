import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const WEBHOOK_KEY = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY

export async function handler(req: any) {
  if (req.method !== "POST") {
    return { statusCode: 405, body: "Method not allowed" }
  }

  try {
    // Prefer rawBody if the runner exposes it; fall back to re-serialization.
    // Square sends compact JSON so JSON.stringify round-trips correctly in practice.
    const rawBody: string = req.rawBody ?? (typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}))
    const signature = req.headers?.["x-square-hmacsha256-signature"] as string | undefined

    if (!WEBHOOK_KEY) {
      console.error("SQUARE_WEBHOOK_SIGNATURE_KEY is not configured")
      return { statusCode: 500, body: JSON.stringify({ error: "Webhook signature key not configured" }) }
    }
    if (!signature) {
      console.error("Missing webhook signature header")
      return { statusCode: 401, body: "Missing signature" }
    }

    const notificationUrl = `${SUPABASE_URL}/functions/v1/square-payment-webhook`
    const payload = notificationUrl + rawBody
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(WEBHOOK_KEY),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    )
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))
    const computed = btoa(String.fromCharCode(...new Uint8Array(sig)))
    if (computed !== signature) {
      console.error("Webhook signature mismatch", { computed, signature, rawBodyPreview: rawBody.slice(0, 200) })
      return { statusCode: 401, body: "Invalid signature" }
    }

    const event = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {})
    const eventType = event.type
    const data = event.data?.object

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // Handle subscription events
    if (eventType === "subscription.updated" && data?.subscription) {
      const sub = data.subscription
      const squareStatus = sub.status

      let ourStatus = "active"
      if (squareStatus === "CANCELED" || squareStatus === "DEACTIVATED") ourStatus = "canceled"
      else if (squareStatus === "PAUSED") ourStatus = "past_due"
      else if (squareStatus === "PENDING") ourStatus = "pending"

      await supabase.from("subscriptions").update({
        status: ourStatus,
        updated_at: new Date().toISOString(),
      }).eq("square_subscription_id", sub.id)

      const { data: localSub } = await supabase
        .from("subscriptions").select("user_id")
        .eq("square_subscription_id", sub.id).single()
      if (localSub) {
        await supabase.from("subscription_events").insert({
          user_id: localSub.user_id,
          event_type: `webhook.${eventType}`,
          details: { square_status: squareStatus, subscription_id: sub.id },
        })
      }
    }

    // Handle invoice payment (successful recurring charge)
    if (eventType === "invoice.payment_made" && data?.payment) {
      const subscriptionId = data.invoice?.subscription_id
      if (subscriptionId) {
        const { data: localSub } = await supabase
          .from("subscriptions").select("*")
          .eq("square_subscription_id", subscriptionId).single()

        if (localSub) {
          const newEnd = new Date(localSub.current_period_end)
          newEnd.setMonth(newEnd.getMonth() + 1)

          await supabase.from("subscriptions").update({
            status: "active",
            current_period_start: localSub.current_period_end,
            current_period_end: newEnd.toISOString(),
            updated_at: new Date().toISOString(),
          }).eq("square_subscription_id", subscriptionId)

          await supabase.from("subscription_events").insert({
            user_id: localSub.user_id,
            event_type: "webhook.invoice.payment_made",
            details: { new_period_end: newEnd.toISOString() },
          })
        }
      }
    }

    // Handle failed payment
    if (eventType === "invoice.payment_failed") {
      const subscriptionId = data?.invoice?.subscription_id
      if (subscriptionId) {
        await supabase.from("subscriptions").update({
          status: "past_due",
          updated_at: new Date().toISOString(),
        }).eq("square_subscription_id", subscriptionId)

        const { data: localSub } = await supabase
          .from("subscriptions").select("user_id")
          .eq("square_subscription_id", subscriptionId).single()
        if (localSub) {
          await supabase.from("subscription_events").insert({
            user_id: localSub.user_id,
            event_type: "webhook.invoice.payment_failed",
            details: { subscription_id: subscriptionId },
          })
        }
      }
    }

    // Capture every payment.created / payment.updated to payment_attempts
    if ((eventType === "payment.updated" || eventType === "payment.created") && data?.payment) {
      await recordPaymentAttempt(supabase, data.payment).catch(err =>
        console.error("recordPaymentAttempt failed:", err),
      )
    }

    // Handle payment link completion (one-time invoice payments)
    if (eventType === "payment.updated" && data?.payment && data.payment.status === "COMPLETED") {
      const payment = data.payment
      const orderId = payment.order_id
      const amountCents = payment.amount_money?.amount || 0

      if (orderId && amountCents > 0) {
        const { data: invoice } = await supabase
          .from("invoices")
          .select("*")
          .or(`square_order_id.eq.${orderId},square_deposit_order_id.eq.${orderId}`)
          .single()

        if (invoice) {
          const { data: existing } = await supabase.from("payments").select("id").eq("note", `Square payment ${payment.id}`).limit(1)
          if (!existing || existing.length === 0) {
            const newPaid = (invoice.paid_amount_cents || 0) + amountCents
            const isFullyPaid = newPaid >= (invoice.amount_cents || 0)
            const isDeposit = invoice.deposit_cents > 0 && amountCents <= invoice.deposit_cents

            const updates: Record<string, any> = {
              paid_amount_cents: newPaid,
              status: isFullyPaid ? "PAID" : "PARTIALLY_PAID",
              updated_at: new Date().toISOString(),
            }
            if (isFullyPaid) updates.paid_at = new Date().toISOString()
            if (isDeposit) updates.deposit_paid = true

            await supabase.from("invoices").update(updates).eq("id", invoice.id)

            const { data: insertedPayment } = await supabase.from("payments").insert({
              invoice_id: invoice.id,
              amount_cents: amountCents,
              method: "square",
              note: `Square payment ${payment.id}`,
              is_deposit: isDeposit,
            }).select("id").single()

            await sendPaymentSms(supabase, {
              invoice,
              amountCents,
              newPaid,
              isDeposit,
              isFullyPaid,
            }).catch(err => console.error("payment SMS failed:", err))

            try {
              const { data: job } = invoice.job_id
                ? await supabase.from("jobs").select("client, type").eq("id", invoice.job_id).single()
                : { data: null }

              const jobLabel = job ? `${job.client} — ${job.type}` : (invoice.description?.slice(0, 60) || "Invoice")
              const amount = (amountCents / 100).toFixed(2)
              const remaining = ((invoice.amount_cents - newPaid) / 100).toFixed(2)

              const { data: profiles } = await supabase.from("profiles").select("company_email, company_name").limit(1)
              const ownerEmail = profiles?.[0]?.company_email

              if (ownerEmail) {
                const notifyHtml = `
                  <div style="font-family:-apple-system,sans-serif;max-width:500px;margin:0 auto;">
                    <div style="background:#10b981;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
                      <h2 style="margin:0;font-size:18px;">Payment Received!</h2>
                    </div>
                    <div style="background:white;border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 12px 12px;">
                      <p style="color:#374151;font-size:14px;margin:0 0 16px;"><strong>$${amount}</strong> received${isDeposit ? " (deposit)" : ""} for:</p>
                      <p style="color:#6b7280;font-size:13px;margin:0 0 16px;">${jobLabel}</p>
                      <table style="width:100%;font-size:13px;color:#374151;">
                        <tr><td style="padding:6px 0;color:#9ca3af;">Paid now</td><td style="text-align:right;font-weight:600;color:#10b981;">$${amount}${isDeposit ? " (deposit)" : ""}</td></tr>
                        <tr><td style="padding:6px 0;color:#9ca3af;">Invoice total</td><td style="text-align:right;font-weight:600;">$${(invoice.amount_cents / 100).toFixed(2)}</td></tr>
                        <tr><td style="padding:6px 0;color:#9ca3af;">Total paid</td><td style="text-align:right;font-weight:600;">$${(newPaid / 100).toFixed(2)}</td></tr>
                        <tr><td style="padding:6px 0;color:#9ca3af;">Balance remaining</td><td style="text-align:right;font-weight:600;color:${isFullyPaid ? "#10b981" : "#ef4444"};">$${remaining}</td></tr>
                        ${invoice.recipient_name ? `<tr><td style="padding:6px 0;color:#9ca3af;">Client</td><td style="text-align:right;">${invoice.recipient_name}</td></tr>` : ""}
                      </table>
                      ${isDeposit ? '<p style="text-align:center;color:#10b981;font-weight:600;margin:16px 0 0;">DEPOSIT PAID IN FULL</p>' : isFullyPaid ? '<p style="text-align:center;color:#10b981;font-weight:600;margin:16px 0 0;">PAID IN FULL</p>' : ""}
                    </div>
                  </div>`

                await supabase.functions.invoke("send-email", {
                  body: {
                    to: ownerEmail,
                    subject: `Payment received: $${amount}${isDeposit ? " deposit" : ""} — ${jobLabel}`,
                    html: notifyHtml,
                    from_name: "Eko Solar Ops",
                  },
                })
              }

              if (invoice.recipient_email) {
                const companyName = (profiles?.[0] as any)?.company_name || "EKO SOLAR LLC"
                const receiptDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
                const receiptHtml = `
                  <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;background:#fafafa;">
                    <div style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);padding:28px 32px;border-radius:12px 12px 0 0;">
                      <h1 style="color:white;font-size:18px;margin:0;font-weight:600;">${companyName}</h1>
                      <p style="color:rgba(255,255,255,0.5);font-size:11px;margin:8px 0 0;text-transform:uppercase;letter-spacing:2px;">Payment Receipt</p>
                    </div>
                    <div style="background:white;border:1px solid #e5e7eb;border-top:none;padding:32px;border-radius:0 0 12px 12px;">
                      <div style="text-align:center;margin-bottom:24px;">
                        <div style="display:inline-block;background:#ecfdf5;border-radius:50%;padding:12px;margin-bottom:12px;">
                          <span style="color:#10b981;font-size:24px;">&#10003;</span>
                        </div>
                        <h2 style="color:#1a1a2e;font-size:16px;margin:0 0 4px;">Payment Confirmed</h2>
                        <p style="color:#9ca3af;font-size:12px;margin:0;">${receiptDate}</p>
                      </div>
                      <div style="background:#f9fafb;border:1px solid #f0f0f5;border-radius:8px;padding:20px;margin-bottom:20px;">
                        <table style="width:100%;font-size:13px;border-collapse:collapse;">
                          <tr><td style="padding:8px 0;color:#6b7280;">Description</td><td style="padding:8px 0;text-align:right;color:#1a1a2e;font-weight:600;">${(invoice.description || "Invoice").slice(0, 80)}</td></tr>
                          <tr><td style="padding:8px 0;color:#6b7280;">Amount Paid</td><td style="padding:8px 0;text-align:right;color:#10b981;font-weight:700;font-size:16px;">$${amount}</td></tr>
                          ${isDeposit ? '<tr><td style="padding:8px 0;color:#6b7280;">Payment Type</td><td style="padding:8px 0;text-align:right;color:#6b7280;">Deposit</td></tr>' : ""}
                          <tr><td style="padding:8px 0;color:#6b7280;">Method</td><td style="padding:8px 0;text-align:right;color:#6b7280;">Card (Square)</td></tr>
                          <tr style="border-top:1px solid #e5e7eb;"><td style="padding:12px 0 8px;color:#6b7280;">Invoice Total</td><td style="padding:12px 0 8px;text-align:right;font-weight:600;color:#1a1a2e;">$${(invoice.amount_cents / 100).toFixed(2)}</td></tr>
                          <tr><td style="padding:8px 0;color:#6b7280;">Total Paid</td><td style="padding:8px 0;text-align:right;font-weight:600;color:#1a1a2e;">$${(newPaid / 100).toFixed(2)}</td></tr>
                          <tr><td style="padding:8px 0;color:#6b7280;">Balance Remaining</td><td style="padding:8px 0;text-align:right;font-weight:700;color:${isFullyPaid ? "#10b981" : "#ef4444"};">$${remaining}</td></tr>
                        </table>
                      </div>
                      ${isDeposit ? '<div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:12px;text-align:center;margin-bottom:20px;"><p style="color:#059669;font-weight:700;margin:0;font-size:14px;">DEPOSIT PAID IN FULL</p></div>' : isFullyPaid ? '<div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:12px;text-align:center;margin-bottom:20px;"><p style="color:#059669;font-weight:700;margin:0;font-size:14px;">PAID IN FULL</p></div>' : ""}
                      <div style="text-align:center;margin:20px 0;">
                        <a href="${SUPABASE_URL}/functions/v1/receipt-pdf?id=${insertedPayment?.id || ""}" style="display:inline-block;background:#1a1a2e;color:white;font-weight:600;font-size:13px;padding:12px 28px;border-radius:10px;text-decoration:none;">Download Receipt PDF</a>
                      </div>
                      <p style="color:#9ca3af;font-size:11px;text-align:center;margin:12px 0 0;">This is your official payment receipt.</p>
                      <p style="color:#d1d5db;font-size:10px;text-align:center;margin:8px 0 0;">Questions? Contact ${ownerEmail || "us"}</p>
                    </div>
                  </div>`

                await supabase.functions.invoke("send-email", {
                  body: {
                    to: invoice.recipient_email,
                    subject: `Payment Receipt — $${amount} — ${companyName}`,
                    html: receiptHtml,
                    from_name: companyName,
                  },
                })
              }
            } catch (emailErr) {
              console.error("Payment notification email failed:", emailErr)
            }

            try {
              const { data: ownerProfiles } = await supabase.from("profiles").select("id").limit(1)
              const ownerId = ownerProfiles?.[0]?.id
              if (ownerId) {
                const dollars = (amountCents / 100).toFixed(2)
                const clientLabel = invoice.recipient_name || invoice.description?.slice(0, 40) || "Customer"
                await supabase.functions.invoke("send-push", {
                  body: {
                    user_id: ownerId,
                    payload: {
                      title: isDeposit
                        ? `Deposit received: $${dollars}`
                        : isFullyPaid
                          ? `Paid in full: $${dollars}`
                          : `Payment received: $${dollars}`,
                      body: `${clientLabel} paid via Square`,
                      url: `/app?invoice=${invoice.id}`,
                      icon: "/square-icon.svg",
                      badge: "/square-badge.svg",
                      tag: `square-payment-${invoice.id}`,
                    },
                  },
                })
              }
            } catch (pushErr) {
              console.error("Web push dispatch failed:", pushErr)
            }
          }
        }
      }
    }

    return { received: true }
  } catch (e) {
    console.error("Webhook error:", e)
    return { received: true, error: String(e) }
  }
}

async function recordPaymentAttempt(supabase: ReturnType<typeof createClient>, payment: any) {
  const orderId = payment?.order_id
  if (!orderId) return

  const { data: invByFull } = await supabase
    .from("invoices")
    .select("id, job_id, quote_id")
    .eq("square_order_id", orderId)
    .maybeSingle()

  let invoice = invByFull
  let isDeposit = false
  if (!invoice) {
    const { data: invByDep } = await supabase
      .from("invoices")
      .select("id, job_id, quote_id")
      .eq("square_deposit_order_id", orderId)
      .maybeSingle()
    invoice = invByDep
    isDeposit = !!invByDep
  }
  if (!invoice) return

  let userId: string | null = null
  if (invoice.quote_id) {
    const { data: q } = await supabase.from("quotes").select("user_id").eq("id", invoice.quote_id).maybeSingle()
    userId = (q?.user_id as string | undefined) ?? null
  }
  if (!userId) {
    const { data: profiles } = await supabase.from("profiles").select("id").limit(1)
    userId = (profiles?.[0]?.id as string | undefined) ?? null
  }

  const card = payment?.card_details?.card || {}
  const cardDetails = payment?.card_details || {}
  const status = String(payment?.status || "").toUpperCase()
  const failureReason =
    cardDetails?.errors?.[0]?.code ||
    cardDetails?.errors?.[0]?.detail ||
    (status === "FAILED" ? "DECLINED" : null)

  if (status === "FAILED" || (cardDetails?.errors && cardDetails.errors.length)) {
    console.error("Square payment FAILED", {
      payment_id: payment.id,
      order_id: orderId,
      invoice_id: invoice.id,
      status,
      card_status: cardDetails.status,
      cvv_status: cardDetails.cvv_status,
      avs_status: cardDetails.avs_status,
      errors: cardDetails.errors,
      card_brand: card.card_brand,
      last4: card.last_4,
    })
  }

  const { error: upsertErr } = await supabase
    .from("payment_attempts")
    .upsert({
      invoice_id: invoice.id,
      user_id: userId,
      square_payment_id: payment.id,
      square_order_id: orderId,
      amount_cents: payment?.amount_money?.amount ?? null,
      status,
      card_brand: card.card_brand || null,
      card_last4: card.last_4 || null,
      cvv_status: cardDetails.cvv_status || null,
      avs_status: cardDetails.avs_status || null,
      failure_reason: failureReason,
      is_deposit: isDeposit,
      raw_event: payment,
      updated_at: new Date().toISOString(),
    }, { onConflict: "square_payment_id" })
  if (upsertErr) console.error("payment_attempts upsert error", upsertErr)

  if (status === "FAILED" && userId) {
    try {
      const { data: settings } = await supabase
        .from("sms_settings")
        .select("notify_phone")
        .eq("user_id", userId)
        .maybeSingle()
      const notifyPhone = settings?.notify_phone || process.env.OWNER_NOTIFY_PHONE
      if (notifyPhone) {
        const sid = process.env.TWILIO_ACCOUNT_SID
        const token = process.env.TWILIO_AUTH_TOKEN
        const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID
        const from = process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER
        if (sid && token && (from || messagingServiceSid)) {
          const dollars = ((payment?.amount_money?.amount || 0) / 100).toFixed(2)
          const tail = card.last_4 ? ` (${card.card_brand || "card"} ${card.last_4})` : ""
          const reason = failureReason ? ` — ${failureReason}` : ""
          const kind = isDeposit ? "deposit" : "invoice"
          const body = `Payment FAILED: $${dollars} on ${kind}${tail}${reason}.`
          const r = await fetch(
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
                Body: body,
              }),
            },
          )
          if (!r.ok) console.error("twilio sms error", r.status, await r.text())
        }
      }
    } catch (e) {
      console.error("sms alert failed", e)
    }
  }
}

async function sendPaymentSms(
  supabase: ReturnType<typeof createClient>,
  params: {
    invoice: any
    amountCents: number
    newPaid: number
    isDeposit: boolean
    isFullyPaid: boolean
  },
) {
  const userId = await resolveInvoiceUserId(supabase, params.invoice)
  if (!userId) return

  const { data: settings } = await supabase
    .from("sms_settings")
    .select("notify_phone, notify_on_paid")
    .eq("user_id", userId)
    .maybeSingle()

  const notifyPhone = settings?.notify_phone || process.env.OWNER_NOTIFY_PHONE
  if (!notifyPhone || settings?.notify_on_paid === false) return

  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID
  const from = process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER
  if (!sid || !token || (!from && !messagingServiceSid)) {
    console.error("Twilio SMS config missing")
    return
  }

  const client = params.invoice.recipient_name || "Customer"
  const amount = `$${(params.amountCents / 100).toFixed(2)}`
  const total = `$${((params.invoice.amount_cents || 0) / 100).toFixed(2)}`
  const paid = `$${(params.newPaid / 100).toFixed(2)}`
  const description = params.invoice.description ? ` - ${String(params.invoice.description).slice(0, 80)}` : ""
  const body = params.isDeposit
    ? `Deposit paid: ${client} paid ${amount}${description}. Total paid: ${paid}.`
    : params.isFullyPaid
      ? `Balance paid: ${client} paid invoice ${total} in full${description}.`
      : `Payment received: ${client} paid ${amount}${description}. Total paid: ${paid}.`

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${sid}:${token}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      ...(messagingServiceSid ? { MessagingServiceSid: messagingServiceSid } : { From: from! }),
      To: notifyPhone,
      Body: body.slice(0, 480),
    }),
  })

  if (!res.ok) {
    console.error("Twilio payment SMS error", res.status, await res.text())
  }
}

async function resolveInvoiceUserId(supabase: ReturnType<typeof createClient>, invoice: any) {
  if (invoice.quote_id) {
    const { data } = await supabase.from("quotes").select("user_id").eq("id", invoice.quote_id).maybeSingle()
    if (data?.user_id) return data.user_id as string
  }

  if (invoice.job_id) {
    const { data } = await supabase.from("jobs").select("user_id").eq("id", invoice.job_id).maybeSingle()
    if (data?.user_id) return data.user_id as string
  }

  const { data: profiles } = await supabase.from("profiles").select("id").limit(1)
  return (profiles?.[0]?.id as string | undefined) ?? null
}
