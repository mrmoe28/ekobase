import { createClient } from "@supabase/supabase-js";

type FnRequest = {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  query: unknown;
};

export async function handler(req: FnRequest) {
  // Webhooks are POST only, no CORS needed (Square servers call this)
  if (req.method !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  try {
    const rawBody = (typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}))
    const signature = (req.headers["x-square-hmacsha256-signature"] as string | undefined)
    const WEBHOOK_KEY = process.env["SQUARE_WEBHOOK_SIGNATURE_KEY"]

    // Verify webhook signature (mandatory)
    if (!WEBHOOK_KEY) {
      console.error("SQUARE_WEBHOOK_SIGNATURE_KEY is not configured")
      return new Response(JSON.stringify({ error: "Webhook signature key not configured" }), {
        status: 500, headers: { "Content-Type": "application/json" },
      })
    }
    if (!signature) {
      console.error("Missing webhook signature header")
      return { statusCode: 401, body: "Missing signature" };
    }
    // Square signs `notification_url + body` with the EXACT public URL
    // registered in the Square dashboard. Hardcode the slug here — do NOT
    // derive from (req.headers["x-forwarded-uri"] as string || "/") (Supabase edge runtime exposes an internal path).
    const notificationUrl = `${process.env["SUPABASE_URL"]}/functions/v1/square-subscription-webhook`
    const payload = notificationUrl + rawBody
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(WEBHOOK_KEY),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    )
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))
    const computed = btoa(String.fromCharCode(...new Uint8Array(sig)))
    if (computed !== signature) {
      console.error("Webhook signature mismatch")
      return { statusCode: 401, body: "Invalid signature" };
    }

    const event = JSON.parse(rawBody)
    const eventType = event.type
    const data = event.data?.object

    const supabase = createClient(
      process.env["SUPABASE_URL"]!,
      process.env["SUPABASE_SERVICE_ROLE_KEY"]!
    )

    // Handle subscription events
    if (eventType === "subscription.updated" && data?.subscription) {
      const sub = data.subscription
      const squareStatus = sub.status // ACTIVE, CANCELED, DEACTIVATED, PAUSED, PENDING

      // Map Square status to our status
      let ourStatus = "active"
      if (squareStatus === "CANCELED" || squareStatus === "DEACTIVATED") ourStatus = "canceled"
      else if (squareStatus === "PAUSED") ourStatus = "past_due"
      else if (squareStatus === "PENDING") ourStatus = "pending"

      await supabase.from("subscriptions").update({
        status: ourStatus,
        updated_at: new Date().toISOString(),
      }).eq("square_subscription_id", sub.id)

      // Log event
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
        // Extend the billing period by 1 month
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

    // Capture every payment.created / payment.updated to payment_attempts so
    // declines and pending charges show up in the invoice page (not just COMPLETED).
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
        // Find invoice by square_order_id (full balance) or square_deposit_order_id (deposit)
        const { data: invoice } = await supabase
          .from("invoices")
          .select("*")
          .or(`square_order_id.eq.${orderId},square_deposit_order_id.eq.${orderId}`)
          .single()

        if (invoice) {
          // Dedup: skip if this Square payment was already recorded
          const { data: existing } = await supabase.from("payments").select("id").eq("note", `Square payment ${payment.id}`).limit(1)
          if (existing && existing.length > 0) {
            // Already processed — skip
          } else {
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

          // Record the payment
          const { data: insertedPayment } = await supabase.from("payments").insert({
            invoice_id: invoice.id,
            amount_cents: amountCents,
            method: "square",
            note: `Square payment ${payment.id}`,
            is_deposit: isDeposit,
          }).select("id").single()

          // Send email notification to the invoice sender
          try {
            // Get the invoice owner's email from the job
            const { data: job } = invoice.job_id
              ? await supabase.from("jobs").select("client, type").eq("id", invoice.job_id).single()
              : { data: null }

            const jobLabel = job ? `${job.client} — ${job.type}` : (invoice.description?.slice(0, 60) || "Invoice")
            const amount = (amountCents / 100).toFixed(2)
            const remaining = ((invoice.amount_cents - newPaid) / 100).toFixed(2)

            // Find owner email from profiles (get first profile with square connected)
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
            // Send receipt email to the CLIENT
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
                      <a href="${process.env["SUPABASE_URL"]}/functions/v1/receipt-pdf?id=${insertedPayment?.id || ""}" style="display:inline-block;background:#1a1a2e;color:white;font-weight:600;font-size:13px;padding:12px 28px;border-radius:10px;text-decoration:none;">Download Receipt PDF</a>
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
          } // end dedup else
        }
      }
    }

    // Always return 200 to acknowledge receipt
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  } catch (e) {
    console.error("Webhook error:", e)
    // Still return 200 to prevent Square retries on our errors
    return new Response(JSON.stringify({ received: true, error: String(e) }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }
})

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

  // Resolve user_id for payment_attempts. Quotes carry user_id; jobs do not
  // (they use company_id, which doesn't map cleanly to auth.users). Fall back
  // to the first profile for job-linked invoices in this single-tenant app.
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
      raw_event: { type: status, payment_id: payment.id, order_id: orderId },
      updated_at: new Date().toISOString(),
    }, { onConflict: "square_payment_id" })
  if (upsertErr) console.error("payment_attempts upsert error", upsertErr)

  // Owner SMS on FAILED
  if (status === "FAILED" && userId) {
    try {
      const { data: settings } = await supabase
        .from("sms_settings")
        .select("notify_phone")
        .eq("user_id", userId)
        .maybeSingle()
      if (settings?.notify_phone) {
        const sid = process.env["TWILIO_ACCOUNT_SID"]
        const token = process.env["TWILIO_AUTH_TOKEN"]
        const from = process.env["TWILIO_FROM_NUMBER"]
        if (sid && token && from) {
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
              body: new URLSearchParams({ From: from, To: settings.notify_phone, Body: body }),
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
