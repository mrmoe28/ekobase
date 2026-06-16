import { createClient } from "@supabase/supabase-js";

type IncomingLead = {
  sourceRecordId: string
  companyName: string
  website: string | null
  phone: string | null
  email: string | null
  address: string | null
  city: string
  state: string
  industry: string
  leadScore: number
  leadStatus: string
  pitchAngle: string
  servicesDetected: string[]
  painPoints: string[]
  notes: string | null
  metadata: Record<string, unknown>
}

type Payload = {
  ownerEmail?: string
  source: "leadboss"
  leads: IncomingLead[]
}

function corsHeaders(req: Request) {
  const origin = (req.headers["origin"] as string | undefined) || "*"
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-leadboss-signature",
  }
}

async function hmacHex(secret: string, body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))
  return Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

function normalizeDomain(website: string | null) {
  if (!website) return null
  try {
    return new URL(website).hostname.replace(/^www\./, "").toLowerCase()
  } catch {
    return website.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase()
  }
}

function normalizePhone(phone: string | null) {
  if (!phone) return null
  const digits = phone.replace(/\D+/g, "")
  return digits.length > 0 ? digits : null
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return { statusCode: 204, body: "",  headers: corsHeaders(req)  };
  }

  try {
    const secret = process.env["LEADBOSS_SHARED_SECRET"]
    if (!secret) throw new Error("LEADBOSS_SHARED_SECRET not configured")

    const signature = (req.headers["X-LeadBoss-Signature"] as string | undefined) || ""
    const rawBody = (typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}))
    const expected = await hmacHex(secret, rawBody)
    if (signature !== expected) {
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 401,
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      })
    }

    const payload = JSON.parse(rawBody) as Payload
    if (!Array.isArray(payload.leads) || payload.leads.length === 0) {
      return new Response(JSON.stringify({ error: "leads array is required" }), {
        status: 422,
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      })
    }

    const admin = createClient(
      process.env["SUPABASE_URL"] || "",
      process.env["SUPABASE_SERVICE_ROLE_KEY"] || "",
    )

    let ownerUserId = process.env["LEADBOSS_DEFAULT_OWNER_USER_ID"] || null

    if (payload.ownerEmail) {
      const usersRes = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      const match = usersRes.data.users.find((user) => user.email?.toLowerCase() === payload.ownerEmail?.toLowerCase())
      if (match) {
        ownerUserId = match.id
      }
    }

    if (!ownerUserId) {
      throw new Error("No CRM owner user could be resolved for LeadBoss import")
    }

    const results: Array<{ sourceRecordId: string; crmLeadId: string; action: "created" | "updated" }> = []

    for (const lead of payload.leads) {
      const websiteDomain = normalizeDomain(lead.website)
      const phoneNormalized = normalizePhone(lead.phone)

      let existingLead: { id: string } | null = null

      const bySource = await admin
        .from("leads")
        .select("id")
        .eq("user_id", ownerUserId)
        .eq("source_app", "leadboss")
        .eq("source_record_id", lead.sourceRecordId)
        .maybeSingle()

      if (bySource.error) throw bySource.error
      existingLead = bySource.data

      if (!existingLead && websiteDomain) {
        const byDomain = await admin
          .from("leads")
          .select("id")
          .eq("user_id", ownerUserId)
          .eq("website_domain", websiteDomain)
          .maybeSingle()

        if (byDomain.error) throw byDomain.error
        existingLead = byDomain.data
      }

      if (!existingLead && phoneNormalized) {
        const byPhone = await admin
          .from("leads")
          .select("id")
          .eq("user_id", ownerUserId)
          .eq("phone_normalized", phoneNormalized)
          .maybeSingle()

        if (byPhone.error) throw byPhone.error
        existingLead = byPhone.data
      }

      if (!existingLead) {
        const byName = await admin
          .from("leads")
          .select("id")
          .eq("user_id", ownerUserId)
          .ilike("company_name", lead.companyName)
          .ilike("city", lead.city)
          .ilike("state", lead.state)
          .maybeSingle()

        if (byName.error) throw byName.error
        existingLead = byName.data
      }

      const row = {
        user_id: ownerUserId,
        source_app: "leadboss",
        source_record_id: lead.sourceRecordId,
        company_name: lead.companyName,
        website: lead.website,
        website_domain: websiteDomain,
        phone: lead.phone,
        phone_normalized: phoneNormalized,
        email: lead.email,
        address: lead.address,
        city: lead.city,
        state: lead.state,
        industry: lead.industry,
        lead_score: lead.leadScore,
        lead_status: lead.leadStatus,
        pitch_angle: lead.pitchAngle,
        services_detected: lead.servicesDetected ?? [],
        pain_points: lead.painPoints ?? [],
        notes: lead.notes,
        source_payload: lead.metadata ?? {},
      }

      if (existingLead?.id) {
        const { error } = await admin
          .from("leads")
          .update(row)
          .eq("id", existingLead.id)
          .eq("user_id", ownerUserId)

        if (error) throw error
        results.push({ sourceRecordId: lead.sourceRecordId, crmLeadId: existingLead.id, action: "updated" })
      } else {
        const { data, error } = await admin
          .from("leads")
          .insert(row)
          .select("id")
          .single()

        if (error) throw error
        results.push({ sourceRecordId: lead.sourceRecordId, crmLeadId: data.id, action: "created" })
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    })
  } catch (error) {
    console.error("leadboss-import error:", error)
    return new Response(JSON.stringify({ error: String(error instanceof Error ? error.message : error) }), {
      status: 500,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    })
  }
})
