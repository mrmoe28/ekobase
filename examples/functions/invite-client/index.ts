type FnRequest = {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  query: unknown;
};

import { createClient } from "@supabase/supabase-js";

const ALLOWED_ORIGINS = (process.env["ALLOWED_ORIGINS"] || "https://ops.lock28.com,http://localhost:5174,http://localhost:5173,http://192.168.1.128:5174").split(",")

function corsHeaders(req: Request) {
  const origin = (req.headers["origin"] as string | undefined) || ""
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  }
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
    const { data: { user: caller } } = await supabaseAuth.auth.getUser()
    if (!caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      })
    }

    const { company_id, email: emailOverride } = (req.body as Record<string, unknown>)
    if (!company_id) throw new Error("company_id required")

    const supabaseAdmin = createClient(
      process.env["SUPABASE_URL"]!,
      process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
    )

    // Verify caller owns the company
    const { data: company, error: coErr } = await supabaseAdmin
      .from("companies")
      .select("id, name, contact_email, user_id")
      .eq("id", company_id)
      .single()
    if (coErr || !company) throw new Error("Company not found")
    if (company.user_id !== caller.id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      })
    }

    const targetEmail = (emailOverride || company.contact_email || "").trim().toLowerCase()
    if (!targetEmail) throw new Error("No email provided and company has no contact_email")

    const portalUrl = (process.env["PORTAL_URL"] || "https://ops.lock28.com") + "/portal"

    // Send the invite. Supabase emails the user a magic link that lands
    // them on portalUrl after they set their password.
    const { data: inviteData, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      targetEmail,
      {
        redirectTo: portalUrl,
        data: { invited_by_company_id: company.id, invited_by_company_name: company.name },
      },
    )

    // If the user already exists, send a password reset email so they can
    // set/recover their password and reach the portal. (admin.generateLink
    // returns a link but does NOT email it — resetPasswordForEmail does.)
    if (inviteErr) {
      const msg = String(inviteErr.message || "").toLowerCase()
      const alreadyExists = msg.includes("already") || msg.includes("registered") || msg.includes("exists")
      if (!alreadyExists) throw inviteErr

      const { error: resetErr } = await supabaseAdmin.auth.resetPasswordForEmail(targetEmail, {
        redirectTo: portalUrl,
      })
      if (resetErr) throw resetErr
    }

    // Pre-link client_users → company. The autolink trigger also handles this
    // on first login, but doing it now ensures the link exists immediately.
    const { data: existingUserByEmail } = await supabaseAdmin
      .from("client_users")
      .select("id")
      .eq("linked_email", targetEmail)
      .maybeSingle()

    if (existingUserByEmail?.id) {
      await supabaseAdmin
        .from("client_users")
        .update({ company_id: company.id })
        .eq("id", existingUserByEmail.id)
    } else if (inviteData?.user?.id) {
      await supabaseAdmin
        .from("client_users")
        .upsert({
          id: inviteData.user.id,
          linked_email: targetEmail,
          company_id: company.id,
        }, { onConflict: "id" })
    }

    return new Response(JSON.stringify({
      success: true,
      email: targetEmail,
      already_existed: !!inviteErr,
    }), {
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    })
  } catch (e) {
    console.error("invite-client error:", e)
    return new Response(JSON.stringify({ error: String(e instanceof Error ? e.message : e) }), {
      status: 500,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    })
  }
}