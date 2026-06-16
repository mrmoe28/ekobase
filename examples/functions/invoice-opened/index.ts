type FnRequest = {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  query: unknown;
};

import { createClient } from "@supabase/supabase-js";

// 1x1 transparent PNG pixel
const PIXEL = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02,
  0x00, 0x01, 0xe5, 0x27, 0xde, 0xfc, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
  0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])

export async function handler(req: FnRequest) {
  const url = new URL("http://localhost" + (req.headers["x-forwarded-uri"] as string || "/"))
  const invoiceId = url.searchParams.get("id")

  if (!invoiceId) {
    return new Response(PIXEL, {
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
    })
  }

  const supabaseUrl = process.env["SUPABASE_URL"]!
  const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"]!
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Only update to VIEWED if currently SENT (don't downgrade higher statuses)
  const { data: inv } = await supabase
    .from("invoices")
    .select("status")
    .eq("id", invoiceId)
    .single()

  if (inv && inv.status === "SENT") {
    await supabase
      .from("invoices")
      .update({ status: "VIEWED", viewed_at: new Date().toISOString() })
      .eq("id", invoiceId)
  }

  return new Response(PIXEL, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache",
    },
  })
})
