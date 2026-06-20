type FnRequest = {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  query: unknown;
};

import { createClient } from "@supabase/supabase-js";

const ALLOWED_ORIGINS = (process.env["ALLOWED_ORIGINS"] || "https://ops.lock28.com,http://localhost:5174,http://localhost:5173,http://192.168.1.128:5174").split(",");

function corsHeaders(req: FnRequest) {
  const origin = (req.headers["origin"] as string | undefined) || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

const CACHE_MAX_AGE_DAYS = 30

// ── Resolve county from address via Nominatim (OpenStreetMap) ──

async function resolveCounty(
  address: string
): Promise<{ county: string; countyDisplay: string }> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&q=${encodeURIComponent(address)}`
  const res = await fetch(url, {
    headers: { "User-Agent": "EkoSolarOps/1.0 (ekosolarize@gmail.com)" }
  })
  const data = await res.json() as Array<Record<string, unknown>>

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("Geocoding failed: no results from Nominatim")
  }

  const first = data[0]
  const addr = (first.address as Record<string, string>) || {}

  let display = addr.county || addr.administrative_area_level_2 || addr.state_district || ""
  if (!display) {
    throw new Error("Could not resolve county from address — no county field in Nominatim response")
  }
  // Ensure display ends with " County" for US counties
  if (!display.toLowerCase().includes("county")) {
    display = display + " County"
  }

  const county = display.toLowerCase().replace(/\s+/g, "-")
  return { county, countyDisplay: display }
}

// ── Check permit_offices cache ──

async function checkCache(
  supabase: any,
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
    `site:.gov ${county} electrical permit office contact hours solar`,
    `site:.gov ${county} solar electrical permit requirements fees documents`,
    `${county} county electrical permit portal online application solar`,
    `${county} county building electrical solar permit office`,
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

  const userPrompt = `Extract the following fields from the text below for the ${county} electrical/solar permit office. Focus only on electrical and solar permitting information. If a field is not found, use null. For arrays, use empty arrays if not found.

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

// ── Fallback: Extract structured data using regex (no AI) ──

function cleanHtmlText(text: string): string {
  return text
    .replace(/Skip to main content/gi, "")
    .replace(/Enable accessibility for low vision/gi, "")
    .replace(/Open the accessibility menu/gi, "")
    .replace(/Before sharing sensitive[^\n]*/gi, "")
    .replace(/\[Image[^\]]*\]/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/https?:\/\/[^\s]+userway\.org\/[^\s]+/gi, "")
    .replace(/\b\d{5,10}\b/g, "")  // strip long numbers (IDs, not phone)
    .replace(/\s+/g, " ")
    .trim()
}

function extractWithRegex(combinedText: string, countyDisplay: string, urls: string[]): Record<string, unknown> {
  const text = cleanHtmlText(combinedText)

  // Phone: US formats — require non-digit boundary and common separators
  const phoneMatch = text.match(/(?:\+?1[-.\s])?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}(?!\d)/)
  const phone = phoneMatch ? phoneMatch[0].replace(/\s+/g, " ") : null

  // Email
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
  const email = emailMatch ? emailMatch[0] : null

  // Address: look for numbered street lines (e.g., "123 Main St", "4567 Oak Ave, Suite 200")
  const streetMatch = text.match(/\d+\s+[A-Za-z]+(?:\s+[A-Za-z]+)*\s+(?:St|Ave|Rd|Blvd|Dr|Ln|Way|Ct|Pl|Hwy|Route)\b[^,\n]{0,60}(?:,\s*[A-Za-z\s]+)?/i)
  const address = streetMatch ? streetMatch[0].trim() : null

  // Hours: look for day/time patterns, skip accessibility text
  const hoursPatterns = [
    /(?:mon|tues|wednes|thurs|fri|satur|sun)day[^\n]{0,5}\d{1,2}:\d{2}\s*[ap]\.?m\.?\s*-\s*\d{1,2}:\d{2}\s*[ap]\.?m\.?/i,
    /(?:mon|tues|wednes|thurs|fri|satur|sun)day[^\n]{0,5}\d{1,2}\s*[ap]\.?m\.?\s*-\s*\d{1,2}\s*[ap]\.?m\.?/i,
    /(?:hours?|office\s+hours)[^\n]{0,20}\d{1,2}:\d{2}\s*[ap]\.?m\.?[^\n]{0,30}/i,
    /\d{1,2}:\d{2}\s*[ap]\.?m\.?\s*[–\-to]\s*\d{1,2}:\d{2}\s*[ap]\.?m\.?/i,
  ]
  let officeHours: string | null = null
  for (const pat of hoursPatterns) {
    const m = text.match(pat)
    if (m && !/accessibility|menu|skip|about us|##/i.test(m[0])) {
      officeHours = m[0].trim()
      break
    }
  }

  // Office name: from the first H1 or near permit keywords
  const titleMatch = text.match(/#\s*([^\n|]{3,80})/)
  let officeName = titleMatch ? titleMatch[1].replace(/\|.*$/, "").trim() : null
  if (!officeName && countyDisplay) {
    officeName = `${countyDisplay} Permits Office`
  }

  // Portal URL: prefer first .gov URL containing "permit" or "building"
  let portalUrl = null
  for (const url of urls) {
    if (/permit|building|inspection|plan|zoning/i.test(url)) {
      portalUrl = url
      break
    }
  }
  if (!portalUrl && urls.length > 0) portalUrl = urls[0]

  // Required documents: list all unique URLs as sources
  const requiredDocuments = urls.map((u, i) => ({
    name: `Source ${i + 1}`,
    url: u,
  }))

  // Submission instructions: build from found fields
  let instructions = "AI extraction unavailable — structured data extracted automatically.\n\n"
  if (phone) instructions += `Phone: ${phone}\n`
  if (email) instructions += `Email: ${email}\n`
  if (address) instructions += `Address: ${address}\n`
  if (officeHours) instructions += `Hours: ${officeHours}\n`
  instructions += `\nSources: ${urls.join(", ")}`

  return {
    office_name: officeName,
    address,
    phone,
    email,
    office_hours: officeHours,
    permit_types: [],
    submission_instructions: instructions,
    portal_url: portalUrl,
    required_documents: requiredDocuments,
    processing_time: null,
    fees_raw: text.slice(0, 3000),
  }
}

// ── Upsert into permit_offices table ──

async function upsertPermitOffice(
  supabase: any,
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

  // Manual upsert: check if row exists, then update or insert
  const { data: existing } = await supabase
    .from("permit_offices")
    .select("id")
    .eq("county", county)
    .limit(1)

  if (existing && existing.length > 0) {
    const { error } = await supabase
      .from("permit_offices")
      .update(row)
      .eq("county", county)
    if (error) throw new Error(`Supabase update error: ${error.message}`)
  } else {
    const { error } = await supabase
      .from("permit_offices")
      .insert(row)
    if (error) throw new Error(`Supabase insert error: ${error.message}`)
  }

  return row
}

// ── Main handler ──

export async function handler(req: FnRequest) {
  if (req.method === "OPTIONS") {
    return { statusCode: 204, body: "",  headers: corsHeaders(req)  };
  }

  try {
    // Auth check
    // Auth check (headers are lowercased by Fastify)
    const rawAuth = req.headers["authorization"] ?? req.headers["Authorization"];
    const authHeader = Array.isArray(rawAuth) ? rawAuth[0] : (rawAuth || "");
    // Use internal gateway URL to avoid Cloudflare loopback timeouts
    const supabaseInternalUrl = process.env["SUPABASE_INTERNAL_URL"] || process.env["EKOBASE_URL"] || process.env["SUPABASE_URL"] || "";
    const supabaseAuth = createClient(
      supabaseInternalUrl,
      process.env["SUPABASE_ANON_KEY"] || "",
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await supabaseAuth.auth.getUser();
    if (!user) {
      return {
        statusCode: 401,
        body: { error: "Unauthorized" },
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      };
    }

    const { address, force } = (req.body as Record<string, unknown>)
    if (!address || typeof address !== "string") {
      return {
        statusCode: 400,
        body: { found: false, error: "address is required" },
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      };
    }

    // Env vars
    const serperKey = process.env["SERPER_API_KEY"]
    const anthropicKey = process.env["ANTHROPIC_API_KEY"]
    const supabaseUrl = process.env["SUPABASE_URL"] || ""
    const supabaseServiceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"] || ""

    if (!serperKey) throw new Error("SERPER_API_KEY not configured")
    if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not configured")
    if (!supabaseUrl) throw new Error("SUPABASE_URL not configured")
    if (!supabaseServiceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY not configured")

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Step 1: Resolve county from address
    const { county, countyDisplay } = await resolveCounty(address)

    // Step 2: Check cache
    const cached = await checkCache(supabase, county, !!force)
    if (cached) {
      return {
        statusCode: 200,
        body: { found: true, cached: true, data: cached },
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      };
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
      return {
        statusCode: 200,
        body: { found: false, error: "Could not retrieve enough content from search results" },
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      };
    }

    // Step 5: Extract structured data — fallback when Claude is unavailable
    let extracted: Record<string, unknown>
    try {
      extracted = await extractWithClaude(combinedText, countyDisplay, anthropicKey)
    } catch (aiErr) {
      console.warn("Claude extraction failed, using regex fallback:", aiErr)
      extracted = extractWithRegex(combinedText, countyDisplay, urls)
    }

    // Step 6: Upsert into database
    const sourceUrl = urls[0] || ""
    const row = await upsertPermitOffice(supabase, county, countyDisplay, extracted, sourceUrl)

    // Step 7: Return result
    return {
      statusCode: 200,
      body: { found: true, cached: false, data: row },
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    };
  } catch (e) {
    console.error("permit-office-lookup error:", e)
    return {
      statusCode: 500,
      body: { found: false, error: String(e) },
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    };
  }
}