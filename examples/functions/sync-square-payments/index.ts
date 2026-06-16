import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SQUARE_ENVIRONMENT = Deno.env.get("SQUARE_ENVIRONMENT") || "production";
const SQUARE_API = SQUARE_ENVIRONMENT === "sandbox"
  ? "https://connect.squareupsandbox.com"
  : "https://connect.squareup.com";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "https://ops.lock28.com,http://localhost:5174,http://localhost:5173,http://192.168.1.128:5174").split(",");

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

async function squareGet(path: string, token: string) {
  const res = await fetch(`${SQUARE_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Square-Version": "2025-01-23",
    },
  });
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* keep null */ }
  return { ok: res.ok, status: res.status, data, text };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }

  try {
    const { invoice_id } = await req.json();
    if (!invoice_id) {
      return new Response(JSON.stringify({ error: "Missing invoice_id" }), {
        status: 400, headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
    );

    const { data: invoice, error: invErr } = await adminClient
      .from("invoices")
      .select("id, quote_id, square_order_id, square_deposit_order_id")
      .eq("id", invoice_id)
      .single();
    if (invErr || !invoice) {
      return new Response(JSON.stringify({ error: "Invoice not found" }), {
        status: 404, headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const orderIds = [
      { id: invoice.square_order_id, isDeposit: false },
      { id: invoice.square_deposit_order_id, isDeposit: true },
    ].filter(o => !!o.id) as { id: string; isDeposit: boolean }[];

    if (orderIds.length === 0) {
      return new Response(JSON.stringify({ synced: 0, attempts: [] }), {
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      });
    }

    let userId: string | null = null;
    if (invoice.quote_id) {
      const { data: q } = await adminClient.from("quotes").select("user_id").eq("id", invoice.quote_id).maybeSingle();
      userId = (q?.user_id as string | undefined) ?? null;
    }
    if (!userId) {
      const { data: profiles } = await adminClient.from("profiles").select("id").limit(1);
      userId = (profiles?.[0]?.id as string | undefined) ?? null;
    }
    if (!userId) {
      return new Response(JSON.stringify({ error: "No owner profile" }), {
        status: 400, headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await adminClient
      .from("profiles")
      .select("square_access_token")
      .eq("id", userId)
      .single();
    if (!profile?.square_access_token) {
      return new Response(JSON.stringify({ error: "Square not connected" }), {
        status: 400, headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      });
    }
    const token = profile.square_access_token;

    let synced = 0;
    const attempts: any[] = [];

    for (const { id: orderId, isDeposit } of orderIds) {
      const order = await squareGet(`/v2/orders/${orderId}`, token);
      if (!order.ok || !order.data?.order) {
        console.error("Square order fetch failed", { orderId, status: order.status, body: order.text.slice(0, 500) });
        continue;
      }

      const tenders: any[] = order.data.order.tenders || [];
      const paymentIds = tenders.map(t => t.payment_id).filter(Boolean);

      for (const pid of paymentIds) {
        const pmt = await squareGet(`/v2/payments/${pid}`, token);
        if (!pmt.ok || !pmt.data?.payment) {
          console.error("Square payment fetch failed", { pid, status: pmt.status, body: pmt.text.slice(0, 500) });
          continue;
        }
        const payment = pmt.data.payment;
        const card = payment?.card_details?.card || {};
        const cardDetails = payment?.card_details || {};
        const status = String(payment?.status || "").toUpperCase();
        const failureReason =
          cardDetails?.errors?.[0]?.code ||
          cardDetails?.errors?.[0]?.detail ||
          (status === "FAILED" ? "DECLINED" : null);

        const { error: upsertErr } = await adminClient
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
          }, { onConflict: "square_payment_id" });
        if (upsertErr) {
          console.error("payment_attempts upsert error", upsertErr);
          continue;
        }
        synced++;
        attempts.push({
          payment_id: payment.id,
          status,
          amount_cents: payment?.amount_money?.amount ?? null,
          card_brand: card.card_brand || null,
          card_last4: card.last_4 || null,
          failure_reason: failureReason,
          is_deposit: isDeposit,
        });
      }
    }

    return new Response(JSON.stringify({ synced, attempts }), {
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("sync-square-payments error", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
