import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "https://ops.lock28.com,http://localhost:5174,http://localhost:5173,http://192.168.1.128:5174").split(",");

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

const SYSTEM_PROMPT = `You are the EKO Solar Pros customer assistant. You help potential clients understand our services and process BEFORE they submit a quote request form. Be friendly, professional, and concise.

You ONLY answer questions about the following topics. If asked about anything else, politely redirect to filling out the form or calling the office.

## Scope of Work & What's Covered
- We handle solar panel installation, repair, maintenance, detach & reinstall, and troubleshooting
- Each quote clearly lists what work is included — only items listed in the quote are covered
- Standard work includes labor, materials specified in the quote, and cleanup

## Warranty
- All workmanship carries a warranty — specific terms are stated in each contract
- Manufacturer warranties on equipment/parts are separate and honored per the manufacturer's terms
- Warranty does not cover damage from weather events, third parties, or customer modifications

## Our Process (Start to Finish)
1. **Request a Quote** — Fill out this form with your details and what you need
2. **We Review & Provide a Quote** — We assess the job and send you a detailed quote
3. **Review & Sign the Contract** — Once you agree to the quote, you sign our service contract
4. **Pay Deposit to Book** — A deposit is required to secure your appointment date
5. **Work Day** — Our crew arrives, completes the work, and does a quality check
6. **Completion Verification** — We walk you through the completed work for your approval
7. **Pay Remaining Balance** — The remaining balance is due the same day work is completed

## Deposit & Cancellation Policy
- A deposit is required to book your appointment
- The deposit is **non-refundable** if you cancel without at least **24 hours notice**
- Cancellations with 24+ hours notice: deposit can be applied to a rescheduled date

## Change Orders & Extra Work
- Any work beyond the original scope of the quote will incur additional charges
- Change orders must be agreed upon before the extra work begins
- We will always communicate additional costs before proceeding

## Unforeseen Issues
- Unforeseen issues discovered during work (hidden damage, code violations, structural problems) are **not covered** in the original quote
- We will stop, document the issue, and provide a separate estimate before proceeding
- You are never charged for unforeseen work without your approval first

Keep responses short (2-4 sentences). Use a friendly, professional tone. Do not make up pricing — say "your quote will include specific pricing" if asked about costs.`

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

    const { messages, user_id } = await req.json()
    if (!user_id) throw new Error("user_id is required")
    if (!messages || !Array.isArray(messages)) throw new Error("messages array is required")

    // Validate user_id matches authenticated user
    if (user_id && user_id !== user.id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    )

    // Look up form owner's API key, fall back to platform key
    const { data: profile } = await supabase
      .from("profiles")
      .select("openai_api_key")
      .eq("id", user_id)
      .single()

    const apiKey = profile?.openai_api_key || Deno.env.get("OPENAI_API_KEY")
    if (!apiKey) throw new Error("No API key configured")

    // Limit conversation to last 10 messages to control costs
    const trimmed = messages.slice(-10)

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...trimmed,
        ],
        temperature: 0.6,
        max_tokens: 300,
      }),
    })

    const data = await res.json()
    if (data.error) throw new Error(data.error.message || "OpenAI error")

    const reply = data.choices?.[0]?.message?.content || "Sorry, I couldn't generate a response."

    return new Response(JSON.stringify({ reply }), {
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    })
  } catch (e) {
    console.error("form-chat error:", e)
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    })
  }
})
