// Equipment scraper edge function.
// Crawls dealer/vendor sites for inverter, battery, optimizer and micro-inverter products
// from EG4, Fortress Power, SolarEdge, Enphase, Tesla, Generac, Sol-Ark, Schneider, Outback.
// Up to 10 listing pages per site. Inserts/updates rows in `equipment` and flags new ones.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

type Category = "inverter" | "battery" | "optimizer" | "microinverter";

interface ScrapeTarget {
  vendor: string;          // human-readable dealer name
  baseUrl: string;         // origin
  pages: string[];         // listing URLs to crawl (1..10)
  productLink: RegExp;     // matches anchor hrefs that lead to a product page
  category: Category;
  brandHints: string[];    // brand names we will accept; product must mention one
}

const BRANDS = [
  "EG4", "Fortress Power", "Fortress", "SolarEdge", "Solar Edge",
  "Enphase", "Tesla", "Generac", "Sol-Ark", "SolArk",
  "Schneider", "Outback", "Victron", "MidNite", "Pika", "Magnum",
];

// Listing pages we crawl.  Each entry adds up to 10 pages.
function buildTargets(): ScrapeTarget[] {
  const t: ScrapeTarget[] = [];

  // EG4 Electronics — manufacturer site, WooCommerce, lighter bot protection.
  const eg4 = (cat: Category, path: string): ScrapeTarget => ({
    vendor: "EG4 Electronics",
    baseUrl: "https://eg4electronics.com",
    pages: Array.from({ length: 10 }, (_, i) =>
      `https://eg4electronics.com/${path}/page/${i + 1}/`),
    productLink: /href="(https:\/\/eg4electronics\.com\/product\/[^"?#]+\/)"/g,
    category: cat,
    brandHints: ["EG4"],
  });
  t.push(eg4("inverter", "shop/inverters"));
  t.push(eg4("battery",  "shop/batteries"));

  // Renogy — open product catalog, JSON-LD on product pages.
  const renogy = (cat: Category, slug: string): ScrapeTarget => ({
    vendor: "Renogy",
    baseUrl: "https://www.renogy.com",
    pages: Array.from({ length: 10 }, (_, i) =>
      `https://www.renogy.com/${slug}/?page=${i + 1}`),
    productLink: /href="(\/[a-z0-9-]+\/)"/g,
    category: cat,
    brandHints: BRANDS.concat(["Renogy"]),
  });
  t.push(renogy("inverter", "inverters"));
  t.push(renogy("battery",  "batteries"));

  // Northern Arizona Wind & Sun — open Magento storefront, no bot wall.
  const nazSolar = (cat: Category, slug: string): ScrapeTarget => ({
    vendor: "Northern Arizona Wind & Sun",
    baseUrl: "https://www.solar-electric.com",
    pages: Array.from({ length: 10 }, (_, i) =>
      `https://www.solar-electric.com/${slug}.html?p=${i + 1}`),
    productLink: /href="(https:\/\/www\.solar-electric\.com\/[a-z0-9-]+\.html)"/g,
    category: cat,
    brandHints: BRANDS,
  });
  t.push(nazSolar("inverter",      "inverters"));
  t.push(nazSolar("battery",       "deep-cycle-solar-batteries"));
  t.push(nazSolar("microinverter", "micro-inverters"));
  t.push(nazSolar("optimizer",     "power-optimizers"));

  // Wholesale Solar — long-running open storefront.
  const wholesale = (cat: Category, slug: string): ScrapeTarget => ({
    vendor: "Wholesale Solar",
    baseUrl: "https://www.wholesalesolar.com",
    pages: Array.from({ length: 10 }, (_, i) =>
      `https://www.wholesalesolar.com/solar-${slug}?page=${i + 1}`),
    productLink: /href="(\/[0-9]{4,}\/[a-z0-9-]+)"/g,
    category: cat,
    brandHints: BRANDS,
  });
  t.push(wholesale("inverter",      "inverters"));
  t.push(wholesale("battery",       "batteries"));
  t.push(wholesale("microinverter", "microinverters"));

  return t;
}

interface ParsedProduct {
  url: string;
  title: string;
  brand: string;
  model: string;
  imageUrl: string | null;
  priceCents: number | null;
  watts: number;
  specs: Record<string, unknown>;
}

function decodeHtml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g,           (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}

// Pull a generic spec table out of the product page.  Looks for common patterns:
//   <th>Label</th><td>Value</td>  /  <dt>Label</dt><dd>Value</dd>
//   "label : value" lines inside a feature/spec list.
// Returns up to 30 entries.
function extractSpecs(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const stripTags = (s: string) => decodeHtml(s.replace(/<[^>]+>/g, " "));

  const thtdRe = /<tr[^>]*>\s*<t[hd][^>]*>([^<][\s\S]{0,80}?)<\/t[hd]>\s*<td[^>]*>([\s\S]{0,300}?)<\/td>\s*<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = thtdRe.exec(html)) && Object.keys(out).length < 30) {
    const k = stripTags(m[1]).slice(0, 60);
    const v = stripTags(m[2]).slice(0, 200);
    if (k && v && k.length < 60 && !/^\s*$/.test(v)) out[k] = v;
  }

  const dtddRe = /<dt[^>]*>([\s\S]{0,80}?)<\/dt>\s*<dd[^>]*>([\s\S]{0,300}?)<\/dd>/gi;
  while ((m = dtddRe.exec(html)) && Object.keys(out).length < 30) {
    const k = stripTags(m[1]).slice(0, 60);
    const v = stripTags(m[2]).slice(0, 200);
    if (k && v) out[k] = v;
  }

  // JSON-LD product specs (additionalProperty array).
  const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  while ((m = ldRe.exec(html)) && Object.keys(out).length < 30) {
    try {
      const json = JSON.parse(m[1].trim());
      const arr = Array.isArray(json) ? json : [json];
      for (const node of arr) {
        const props = node?.additionalProperty;
        if (Array.isArray(props)) {
          for (const p of props) {
            if (p?.name && p?.value && Object.keys(out).length < 30) {
              out[String(p.name).slice(0, 60)] = String(p.value).slice(0, 200);
            }
          }
        }
        if (node?.description && !out.Description) out.Description = String(node.description).slice(0, 400);
      }
    } catch { /* ignore malformed JSON-LD */ }
  }

  return out;
}

function extractDescription(html: string): string | null {
  const meta = extract(html, /<meta name="description" content="([^"]+)"/i)
            || extract(html, /<meta property="og:description" content="([^"]+)"/i);
  return meta ? meta.slice(0, 600) : null;
}

function extractDatasheet(html: string): string | null {
  const m = html.match(/href="([^"]+\.pdf)"[^>]*>[^<]*(datasheet|spec sheet|specifications)/i);
  return m ? m[1] : null;
}

function pickBrand(text: string): string | null {
  const lower = text.toLowerCase();
  for (const b of BRANDS) if (lower.includes(b.toLowerCase())) {
    if (b === "Solar Edge") return "SolarEdge";
    if (b === "SolArk")     return "Sol-Ark";
    if (b === "Fortress")   return "Fortress Power";
    return b;
  }
  return null;
}

function extract(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? decodeHtml(m[1]) : null;
}

function parseProduct(html: string, url: string, vendor: string): ParsedProduct | null {
  const title =
    extract(html, /<meta property="og:title" content="([^"]+)"/i) ||
    extract(html, /<title>([^<]+)<\/title>/i);
  if (!title) return null;
  const brand = pickBrand(title) || pickBrand(html.slice(0, 8000));
  if (!brand) return null;

  const imageUrl = extract(html, /<meta property="og:image" content="([^"]+)"/i);
  const priceText =
    extract(html, /<meta property="product:price:amount" content="([^"]+)"/i) ||
    extract(html, /"price"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/i);
  const priceCents = priceText ? Math.round(parseFloat(priceText) * 100) : null;

  const wattsMatch = title.match(/(\d{3,5})\s*w(?:att)?\b/i) ||
                     html.slice(0, 4000).match(/(\d{3,5})\s*w(?:att)?\b/i);
  const watts = wattsMatch ? parseInt(wattsMatch[1], 10) : 0;

  const kwhMatch = title.match(/([\d.]+)\s*kwh/i);
  const voltMatch = title.match(/(\d{2,3})\s*v\b/i);

  const cleanTitle = title.replace(/\s*[|–-].*$/, "").trim();
  const model = cleanTitle.replace(new RegExp(brand, "i"), "").replace(/^[\s\-–|]+/, "").trim();

  const specs = extractSpecs(html);
  const description = extractDescription(html);
  const datasheet = extractDatasheet(html);

  return {
    url,
    title: cleanTitle,
    brand,
    model: model || cleanTitle,
    imageUrl,
    priceCents,
    watts,
    specs: {
      vendor,
      kwh: kwhMatch ? parseFloat(kwhMatch[1]) : undefined,
      voltage: voltMatch ? parseInt(voltMatch[1], 10) : undefined,
      raw_title: cleanTitle,
      description: description || undefined,
      datasheet_url: datasheet || undefined,
      ...specs,
    },
  };
}

async function safeFetch(url: string, timeoutMs = 20000): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
      },
    });
    clearTimeout(t);
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

function absoluteUrl(href: string, base: string): string {
  try { return new URL(href, base).toString(); } catch { return href; }
}

async function crawlTarget(target: ScrapeTarget): Promise<{
  products: Array<ParsedProduct & { category: Category; vendor: string }>;
  pagesHit: number;
  errors: string[];
}> {
  const products: Array<ParsedProduct & { category: Category; vendor: string }> = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  let pagesHit = 0;

  for (const pageUrl of target.pages) {
    const html = await safeFetch(pageUrl);
    if (!html) { errors.push(`fetch failed: ${pageUrl}`); continue; }
    pagesHit++;

    const links = new Set<string>();
    let m: RegExpExecArray | null;
    const re = new RegExp(target.productLink.source, "g");
    while ((m = re.exec(html)) !== null) {
      links.add(absoluteUrl(m[1], target.baseUrl));
    }

    for (const link of links) {
      if (seen.has(link)) continue;
      seen.add(link);
      if (products.length >= 200) break;
      const productHtml = await safeFetch(link);
      if (!productHtml) continue;
      const parsed = parseProduct(productHtml, link, target.vendor);
      if (!parsed) continue;
      products.push({ ...parsed, category: target.category, vendor: target.vendor });
    }

    if (products.length >= 200) break;
  }

  return { products, pagesHit, errors };
}

Deno.serve(async (_req: Request) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
  );

  const { data: run } = await supabase
    .from("equipment_scrape_runs")
    .insert({ status: "running" })
    .select("id")
    .single();

  const targets = buildTargets();
  let inserted = 0, updated = 0, pagesHit = 0;
  const errors: string[] = [];

  // Reset previous "new arrival" flags so the next batch is the fresh set.
  await supabase.from("equipment").update({ is_new_arrival: false }).eq("is_new_arrival", true);

  // Preload vendor name -> id map, plus lazy-create any missing vendor on demand
  // (we only want a vendor card to appear once real products are scraped for it).
  const { data: vendorRows } = await supabase.from("vendors").select("id,name");
  const vendorMap = new Map<string, string>((vendorRows ?? []).map(v => [v.name, v.id]));

  const VENDOR_CONTACT: Record<string, { phone: string; email: string; website: string; notes: string }> = {
    "Northern Arizona Wind & Sun": { phone: "(800) 383-0195", email: "info@solar-electric.com",   website: "https://www.solar-electric.com", notes: "Auto-scraped. Off-grid & solar equipment distributor in Flagstaff, AZ." },
    "Signature Solar":             { phone: "(903) 441-2090", email: "sales@signaturesolar.com",  website: "https://signaturesolar.com",     notes: "Auto-scraped. EG4 master distributor, Sulphur Springs TX." },
    "Current Connected":           { phone: "(530) 918-2321", email: "info@currentconnected.com", website: "https://currentconnected.com",   notes: "Auto-scraped. Off-grid inverter & battery specialist." },
    "altE Store":                  { phone: "(877) 878-4060", email: "sales@altestore.com",       website: "https://www.altestore.com",      notes: "Auto-scraped. Renewable energy retailer, Hudson MA." },
    "EG4 Electronics":             { phone: "(903) 441-2090", email: "info@eg4electronics.com",   website: "https://eg4electronics.com",     notes: "Auto-scraped. Manufacturer direct (EG4 inverters & batteries)." },
    "Renogy":                      { phone: "(909) 287-7111", email: "support@renogy.com",        website: "https://www.renogy.com",         notes: "Auto-scraped. Solar panels, inverters, batteries." },
    "Wholesale Solar":             { phone: "(800) 472-1142", email: "info@wholesalesolar.com",   website: "https://www.wholesalesolar.com", notes: "Auto-scraped. Full system kits and components." },
  };

  async function ensureVendorId(name: string): Promise<string | null> {
    if (vendorMap.has(name)) return vendorMap.get(name)!;
    const contact = VENDOR_CONTACT[name] ?? { phone: null, email: null, website: null, notes: "Auto-scraped vendor." };
    const { data, error } = await supabase.from("vendors")
      .insert({ name, contact_name: "Sales Team", ...contact, is_system: true })
      .select("id").single();
    if (error || !data) return null;
    vendorMap.set(name, data.id);
    return data.id;
  }

  for (const target of targets) {
    try {
      const result = await crawlTarget(target);
      pagesHit += result.pagesHit;
      errors.push(...result.errors);

      for (const p of result.products) {
        const vendorId = await ensureVendorId(p.vendor);
        const row = {
          category: p.category,
          manufacturer: p.brand,
          model: p.model.slice(0, 200),
          watts: p.watts || 0,
          length_mm: 0,
          width_mm: 0,
          price_per_unit_cents: p.priceCents,
          image_url: p.imageUrl,
          datasheet_url: (p.specs as { datasheet_url?: string }).datasheet_url ?? null,
          vendor_id: vendorId,
          source_url: p.url,
          source_vendor: p.vendor,
          scraped_at: new Date().toISOString(),
          is_new_arrival: true,
          is_system: true,
          specs: p.specs,
        };

        const { data: existing } = await supabase
          .from("equipment").select("id").eq("source_url", p.url).maybeSingle();

        if (existing) {
          const { error } = await supabase
            .from("equipment")
            .update({ ...row, is_new_arrival: false, updated_at: new Date().toISOString() })
            .eq("id", existing.id);
          if (error) errors.push(`update ${p.url}: ${error.message}`); else updated++;
        } else {
          const { error } = await supabase.from("equipment").insert(row);
          if (error) errors.push(`insert ${p.url}: ${error.message}`); else inserted++;
        }
      }
    } catch (e) {
      errors.push(`target ${target.vendor}/${target.category}: ${(e as Error).message}`);
    }
  }

  await supabase.from("equipment_scrape_runs").update({
    finished_at: new Date().toISOString(),
    status: errors.length === 0 ? "ok" : "partial",
    vendors_hit: targets.length,
    pages_hit: pagesHit,
    inserted,
    updated,
    errors: errors.length ? errors.slice(0, 50) : null,
  }).eq("id", run?.id);

  return new Response(
    JSON.stringify({ ok: true, inserted, updated, pagesHit, vendors: targets.length, errors: errors.length }),
    { headers: { "Content-Type": "application/json" } },
  );
});
