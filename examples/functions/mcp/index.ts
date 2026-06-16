import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "https://ops.lock28.com,http://localhost:5174,http://localhost:5173,http://192.168.1.128:5174").split(",");

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, mcp-session-id",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

// ── Tool definitions ────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "list_jobs",
    description: "List solar jobs and work orders. Optionally filter by status or type.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description:
            "Filter by status: PENDING | SCHEDULED | IN_PROGRESS | AWAITING_PARTS | AWAITING_PERMIT | COMPLETE | ON_HOLD",
        },
        type: { type: "string", description: "Filter by job type (e.g. 'Client', 'Install')" },
        limit: { type: "number", description: "Max results to return (default 20, max 100)" },
      },
    },
  },
  {
    name: "get_job",
    description: "Get full details for a specific job by its UUID.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Job UUID" },
      },
    },
  },
  {
    name: "create_client",
    description: "Create a new client or lead in the CRM.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name:         { type: "string", description: "Client full name (required)" },
        email:        { type: "string", description: "Email address" },
        phone:        { type: "string", description: "Phone number" },
        address:      { type: "string", description: "Street address" },
        company_name: { type: "string", description: "Company / business name" },
        notes:        { type: "string", description: "Additional notes" },
      },
    },
  },
  {
    name: "update_job",
    description: "Update a job's status, notes, address, or scheduled date.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id:             { type: "string", description: "Job UUID" },
        status:         { type: "string", description: "New status value" },
        notes:          { type: "string", description: "Updated notes" },
        address:        { type: "string", description: "Updated address" },
        scheduled_date: { type: "string", description: "ISO 8601 date (e.g. 2026-05-01)" },
      },
    },
  },
  {
    name: "list_invoices",
    description: "List invoices. Optionally filter by job or status.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Filter by job UUID" },
        status: {
          type: "string",
          description: "Filter by status: DRAFT | SENT | PAID | PARTIALLY_PAID",
        },
        limit: { type: "number", description: "Max results (default 20)" },
      },
    },
  },
  {
    name: "list_clients",
    description: "List CRM contacts/clients with optional search.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Search by name, email, or phone" },
        limit:  { type: "number", description: "Max results (default 20)" },
      },
    },
  },
  {
    name: "get_stats",
    description:
      "Get dashboard statistics: job counts by status, total and paid invoice revenue.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "navigate",
    description:
      "Get a deep-link URL to open a specific page or record in EKO Solar Ops. Returns the URL to give the user.",
    inputSchema: {
      type: "object",
      required: ["tab"],
      properties: {
        tab: {
          type: "string",
          description:
            "Page to navigate to: home | jobs | calendar | invoices | forms | crm | map | permits | documents | equipment | settings",
        },
        id: { type: "string", description: "Optional record UUID to open on that page" },
      },
    },
  },
]

// ── Helpers ─────────────────────────────────────────────────────────────────
async function hashKey(key: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

function jsonRpc(req: Request, id: unknown, result: unknown) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  })
}

function jsonRpcErr(req: Request, id: unknown, code: number, message: string, status = 200) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  })
}

function text(data: unknown) {
  return [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }]
}

// ── Main handler ─────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) })
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders(req) })

  // ── Auth ──────────────────────────────────────────────────────────────────
  const rawKey = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim()
  if (!rawKey) return jsonRpcErr(req, null, -32001, "Missing Authorization header", 401)

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  )

  const keyHash = await hashKey(rawKey)
  const { data: keyRow } = await admin
    .from("api_keys")
    .select("id, revoked_at")
    .eq("key_hash", keyHash)
    .maybeSingle()

  if (!keyRow || keyRow.revoked_at) {
    return jsonRpcErr(req, null, -32001, "Invalid or revoked API key", 401)
  }

  // Ops is single-tenant at the MCP layer — no per-user scoping.
  // Future multi-tenancy should scope by company_id (already on jobs) after
  // api_keys gains a company_id column. See docs/MCP_MULTITENANCY.md.
  admin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyRow.id)

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: { id?: unknown; method?: string; params?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return jsonRpcErr(req, null, -32700, "Parse error", 400)
  }

  const { id, method, params = {} } = body

  try {
    // ── initialize ──────────────────────────────────────────────────────────
    if (method === "initialize") {
      return jsonRpc(req, id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "eko-solar-ops", version: "1.0.0" },
      })
    }

    // ── tools/list ──────────────────────────────────────────────────────────
    if (method === "tools/list") {
      return jsonRpc(req, id, { tools: TOOLS })
    }

    // ── tools/call ──────────────────────────────────────────────────────────
    if (method === "tools/call") {
      const toolName = params.name as string
      const args = (params.arguments ?? {}) as Record<string, unknown>

      // list_jobs
      if (toolName === "list_jobs") {
        let q = admin
          .from("jobs")
          .select("id, client, email, phone, address, status, type, source, created_at, updated_at, notes")
          .order("updated_at", { ascending: false })
          .limit(Math.min(Number(args.limit ?? 20), 100))
        if (args.status) q = q.eq("status", args.status)
        if (args.type)   q = q.eq("type", args.type)
        const { data, error } = await q
        if (error) return jsonRpcErr(req, id, -32000, error.message)
        return jsonRpc(req, id, { content: text(data) })
      }

      // get_job
      if (toolName === "get_job") {
        const { data, error } = await admin.from("jobs").select("*").eq("id", args.id).maybeSingle()
        if (error) return jsonRpcErr(req, id, -32000, error.message)
        if (!data)  return jsonRpcErr(req, id, -32000, "Job not found")
        return jsonRpc(req, id, { content: text(data) })
      }

      // create_client
      if (toolName === "create_client") {
        const { data, error } = await admin.from("jobs").insert({
          client:       args.name,
          email:        args.email        ?? null,
          phone:        args.phone        ?? null,
          address:      args.address      ?? null,
          company_name: args.company_name ?? null,
          notes:        args.notes        ?? "",
          type:         "Client",
          status:       "PENDING",
          source:       "crm",
        }).select().single()
        if (error) return jsonRpcErr(req, id, -32000, error.message)
        return jsonRpc(req, id, { content: text(data) })
      }

      // update_job
      if (toolName === "update_job") {
        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
        if (args.status         !== undefined) updates.status         = args.status
        if (args.notes          !== undefined) updates.notes          = args.notes
        if (args.address        !== undefined) updates.address        = args.address
        if (args.scheduled_date !== undefined) updates.scheduled_date = args.scheduled_date
        const { data, error } = await admin.from("jobs").update(updates).eq("id", args.id).select().single()
        if (error) return jsonRpcErr(req, id, -32000, error.message)
        return jsonRpc(req, id, { content: text(data) })
      }

      // list_invoices
      if (toolName === "list_invoices") {
        let q = admin
          .from("invoices")
          .select("id, job_id, status, amount_cents, created_at")
          .order("created_at", { ascending: false })
          .limit(Math.min(Number(args.limit ?? 20), 100))
        if (args.job_id) q = q.eq("job_id", args.job_id)
        if (args.status) q = q.eq("status", args.status)
        const { data, error } = await q
        if (error) return jsonRpcErr(req, id, -32000, error.message)
        return jsonRpc(req, id, { content: text(data) })
      }

      // list_clients
      if (toolName === "list_clients") {
        let q = admin
          .from("jobs")
          .select("id, client, email, phone, address, company_name, status, created_at")
          .order("updated_at", { ascending: false })
          .limit(Math.min(Number(args.limit ?? 20), 100))
        if (args.search) {
          q = q.or(`client.ilike.%${args.search}%,email.ilike.%${args.search}%,phone.ilike.%${args.search}%`)
        }
        const { data, error } = await q
        if (error) return jsonRpcErr(req, id, -32000, error.message)
        return jsonRpc(req, id, { content: text(data) })
      }

      // get_stats
      if (toolName === "get_stats") {
        const [jobsRes, invoicesRes] = await Promise.all([
          admin.from("jobs").select("status"),
          admin.from("invoices").select("status, amount_cents"),
        ])
        if (jobsRes.error)     return jsonRpcErr(req, id, -32000, `jobs query failed: ${jobsRes.error.message}`)
        if (invoicesRes.error) return jsonRpcErr(req, id, -32000, `invoices query failed: ${invoicesRes.error.message}`)
        const byStatus: Record<string, number> = {}
        for (const j of jobsRes.data ?? []) byStatus[j.status] = (byStatus[j.status] ?? 0) + 1
        let totalCents = 0, paidCents = 0
        for (const inv of invoicesRes.data ?? []) {
          totalCents += inv.amount_cents ?? 0
          if (inv.status === "PAID") paidCents += inv.amount_cents ?? 0
        }
        return jsonRpc(req, id, {
          content: text({
            jobs_by_status:       byStatus,
            total_jobs:           (jobsRes.data ?? []).length,
            total_revenue_cents:  totalCents,
            paid_revenue_cents:   paidCents,
          }),
        })
      }

      // navigate
      if (toolName === "navigate") {
        const appUrl = Deno.env.get("APP_URL") ?? "https://ops.lock28.com"
        let url = `${appUrl}?tab=${args.tab}`
        if (args.id) url += `&id=${args.id}`
        return jsonRpc(req, id, {
          content: text(
            `Navigate to: ${url}\n\nOpen this link to view the "${args.tab}" page` +
            (args.id ? ` for record ${args.id}` : "") +
            " in EKO Solar Ops.",
          ),
        })
      }

      return jsonRpcErr(req, id, -32601, `Unknown tool: ${toolName}`)
    }

    // Ignore MCP notifications (no response required)
    if (typeof method === "string" && method.startsWith("notifications/")) {
      return new Response(null, { status: 204, headers: corsHeaders(req) })
    }

    return jsonRpcErr(req, id, -32601, `Method not found: ${method}`)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal server error"
    return jsonRpcErr(req, id, -32000, msg, 500)
  }
})
