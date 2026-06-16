import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "https://ops.lock28.com,http://localhost:5174,http://localhost:5173,http://192.168.1.128:5174").split(",");

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

const CACHE_MAX_AGE_DAYS = 30

// ── Resolve county from address via Google Maps Geocoding ──

async function resolveCounty(
  address: string,
  apiKey: string
): Promise<{ county: string; countyDisplay: string }> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`
  const res = await fetch(url)
  const data = await res.json()

  if (data.status !== "OK" || !data.results?.length) {
    throw new Error(`Geocoding failed: ${data.status} — ${data.error_message || "no results"}`)
  }

  for (const result of data.results) {
    for (const component of result.address_components || []) {
      if (component.types?.includes("administrative_area_level_2")) {
        const display = component.long_name
        const county = display.toLowerCase().replace(/\s+/g, "-")
        return { county, countyDisplay: display }
      }
    }
  }

  throw new Error("Could not resolve county from address — no administrative_area_level_2 found")
}

// ── Check permit_offices cache ──

async function checkCache(
  supabase: ReturnType<typeof createClient>,
  county: string,
  force: boolean
): Promise<Record<string, unknown> | null> {
  if (force) return null

  const { data, error } = await supabase
    .from("permit_offices")
    .select("*")
    .eq("county", county)
    .single()

  if (error || !data) return null

  const scrapedAt = new Date(data.scraped_at)
  const age = Date.now() - scrapedAt.getTime()
  const maxAge = CACHE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000

  if (age > maxAge) return null

  return data
}

// ── Multi-query Serper search targeting .gov sites ──

async function searchSerper(
  county: string,
  apiKey: string
): Promise<string[]> {
  const queries = [
    `site:.gov ${county} building permit office contact hours`,
    `site:.gov ${county} solar permit requirements fees documents`,
    `${county} county permit portal online application solar`,
  ]

  const allUrls: string[] = []
  const seen = new Set<string>()

  for (const query of queries) {
    try {
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: {
          "X-API-KEY": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ q: query, num: 5 }),
      })

      const data = await res.json()
      for (const r of data.organic || []) {
        if (!seen.has(r.link)) {
          seen.add(r.link)
          allUrls.push(r.link)
        }
      }
    } catch {
      // Continue with other queries if one fails
    }
  }

  if (allUrls.length === 0) {
    throw new Error("Serper returned no results across all queries")
  }

  // Prioritize .gov URLs, then take top 7
  const govUrls = allUrls.filter((u) => u.includes(".gov"))
  const otherUrls = allUrls.filter((u) => !u.includes(".gov"))
  return [...govUrls, ...otherUrls].slice(0, 7)
}

// ── Fetch URL via Jina Reader for clean markdown ──

async function fetchPageMarkdown(url: string, maxChars = 20000): Promise<string> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)

    // Jina Reader converts any URL to clean markdown, handles JS-rendered pages
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        Accept: "text/markdown",
        "X-Return-Format": "markdown",
      },
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      // Fallback to direct fetch with HTML stripping
      return await fetchPageTextFallback(url, maxChars)
    }

    const text = await res.text()
    return text.slice(0, maxChars)
  } catch {
    // Fallback on timeout or network error
    return await fetchPageTextFallback(url, maxChars)
  }
}

async function fetchPageTextFallback(url: string, maxChars = 20000): Promise<string> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; EkoSolarOps/1.0)",
        Accept: "text/html",
      },
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) return ""

    const html = await res.text()
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .replace(/<header[\s\S]*?<\/header>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#\d+;/g, "")
      .replace(/\s+/g, " ")
      .trim()

    return text.slice(0, maxChars)
  } catch {
    return ""
  }
}

// ── Extract permit office info via Claude API ──

async function extractWithClaude(
  combinedText: string,
  county: string,
  anthropicKey: string
): Promise<Record<string, unknown>> {
  const systemPrompt = `You are a data extraction assistant. Extract structured permit office information for ${county} from the provided web page text. Return ONLY valid JSON with no markdown formatting, no code fences, and no explanation.`

  const userPrompt = `Extract the following fields from the text below for the ${county} building/solar permit office. If a field is not found, use null. For arrays, use empty arrays if not found.

Required JSON structure:
{
  "office_name": "string or null",
  "address": "string or null",
  "phone": "string or null",
  "email": "string or null",
  "office_hours": "string or null",
  "permit_types": [{"name": "string", "fee": "string or null", "description": "string or null"}],
  "submission_instructions": "string or null",
  "portal_url": "string or null",
  "required_documents": [{"name": "string", "url": "string or null"}],
  "processing_time": "string or null",
  "fees_raw": "string or null"
}

Web page text:
${combinedText}`

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      messages: [
        { role: "user", content: userPrompt },
      ],
      system: systemPrompt,
    }),
  })

  const data = await res.json()

  if (data.error) {
    throw new Error(`Claude API error: ${data.error.message || JSON.stringify(data.error)}`)
  }

  const content = data.content?.[0]?.text
  if (!content) {
    throw new Error("Claude returned no content")
  }

  // Parse JSON from response — handle possible code fences
  const jsonStr = content.replace(/```json?\s*/g, "").replace(/```/g, "").trim()
  return JSON.parse(jsonStr)
}

// ── Upsert into permit_offices table ──

async function upsertPermitOffice(
  supabase: ReturnType<typeof createClient>,
  county: string,
  countyDisplay: string,
  extracted: Record<string, unknown>,
  sourceUrl: string
) {
  const row = {
    county,
    county_display: countyDisplay,
    office_name: extracted.office_name ?? null,
    address: extracted.address ?? null,
    phone: extracted.phone ?? null,
    email: extracted.email ?? null,
    office_hours: extracted.office_hours ?? null,
    permit_types: extracted.permit_types ?? [],
    submission_instructions: extracted.submission_instructions ?? null,
    portal_url: extracted.portal_url ?? null,
    required_documents: extracted.required_documents ?? [],
    processing_time: extracted.processing_time ?? null,
    fees_raw: extracted.fees_raw ?? null,
    source_url: sourceUrl,
    scraped_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from("permit_offices")
    .upsert(row, { onConflict: "county" })

  if (error) {
    throw new Error(`Supabase upsert error: ${error.message}`)
  }

  return row
}

// ── Main handler ──

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) })
  }

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_ANON_KEY") || "",
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await supabaseAuth.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const { address, force } = await req.json()
    if (!address || typeof address !== "string") {
      return new Response(
        JSON.stringify({ found: false, error: "address is required" }),
        { status: 400, headers: { ...corsHeaders(req), "Content-Type": "application/json" } }
      )
    }

    // Env vars
    const googleMapsKey = Deno.env.get("GOOGLE_MAPS_API_KEY")
    const serperKey = Deno.env.get("SERPER_API_KEY")
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

    if (!googleMapsKey) throw new Error("GOOGLE_MAPS_API_KEY not configured")
    if (!serperKey) throw new Error("SERPER_API_KEY not configured")
    if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not configured")

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Step 1: Resolve county from address
    const { county, countyDisplay } = await resolveCounty(address, googleMapsKey)

    // Step 2: Check cache
    const cached = await checkCache(supabase, county, !!force)
    if (cached) {
      return new Response(
        JSON.stringify({ found: true, cached: true, data: cached }),
        { headers: { ...corsHeaders(req), "Content-Type": "application/json" } }
      )
    }

    // Step 3: Search for permit office info
    const urls = await searchSerper(countyDisplay, serperKey)

    // Step 4: Fetch pages via Jina Reader (parallel, with fallback)
    const pageTexts = await Promise.all(urls.map((url) => fetchPageMarkdown(url)))
    const combinedText = pageTexts
      .filter((t) => t.length > 100)
      .map((t, i) => `--- Source ${i + 1} (${urls[i]}) ---\n${t}`)
      .join("\n\n")

    if (combinedText.length < 200) {
      return new Response(
        JSON.stringify({ found: false, error: "Could not retrieve enough content from search results" }),
        { headers: { ...corsHeaders(req), "Content-Type": "application/json" } }
      )
    }

    // Step 5: Extract structured data via Claude
    const extracted = await extractWithClaude(combinedText, countyDisplay, anthropicKey)

    // Step 6: Upsert into database
    const sourceUrl = urls[0] || ""
    const row = await upsertPermitOffice(supabase, county, countyDisplay, extracted, sourceUrl)

    // Step 7: Return result
    return new Response(
      JSON.stringify({ found: true, cached: false, data: row }),
      { headers: { ...corsHeaders(req), "Content-Type": "application/json" } }
    )
  } catch (e) {
    console.error("permit-office-lookup error:", e)
    return new Response(
      JSON.stringify({ found: false, error: String(e) }),
      { headers: { ...corsHeaders(req), "Content-Type": "application/json" } }
    )
  }
})
