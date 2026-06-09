import {
  badRequest,
  json,
  requireObjectBody,
  serverError,
  unauthorized,
} from "../_shared/http.ts";
import { requireUser, serviceClient } from "../_shared/ekobaseClient.ts";
import {
  createSquarePaymentLink,
  firstAmountCents,
  firstString,
  getSquareProfile,
} from "../_shared/square.ts";

const APP_URL = process.env.APP_URL || "https://ops.lock28.com";

function amountFromQuote(record: Record<string, unknown>): number | null {
  return firstAmountCents(record, [
    "deposit_amount_cents",
    "deposit_amount",
    "required_deposit_cents",
    "required_deposit",
    "amount_cents",
    "amount",
    "total_cents",
    "total",
  ]);
}

export async function handler(req: any) {
  if (req.method !== "POST") return badRequest("POST required");

  const auth = await requireUser(req);
  if (!auth.user) return unauthorized(auth.error ?? undefined);

  const body = requireObjectBody(req.body);
  if (!body) return badRequest("JSON body required");

  const quoteId = firstString(body, ["quote_id", "quoteId", "id"]);
  if (!quoteId) return badRequest("quote_id is required");

  const supabase = serviceClient();

  let quoteRecord: Record<string, unknown> | null = null;
  try {
    const { data } = await supabase.from("quotes").select("*").eq("id", quoteId).single();
    quoteRecord = (data as Record<string, unknown> | null) ?? null;
  } catch (error) {
    console.error("quote fetch failed:", error);
  }

  const amountCents =
    firstAmountCents(body, ["amount_cents", "amount", "deposit_amount_cents", "deposit_amount"]) ||
    (quoteRecord ? amountFromQuote(quoteRecord) : null);
  if (!amountCents || amountCents <= 0) {
    return badRequest("Quote deposit amount is missing");
  }

  const currency =
    firstString(body, ["currency", "currency_code"]) ||
    (quoteRecord ? firstString(quoteRecord, ["currency", "currency_code"]) : null) ||
    "USD";
  const title =
    firstString(body, ["name", "title"]) ||
    (quoteRecord ? firstString(quoteRecord, ["title", "name", "quote_number"]) : null) ||
    `Quote ${quoteId} deposit`;
  const description =
    firstString(body, ["description", "memo"]) ||
    `Deposit payment for ${title}`;
  const redirectUrl =
    firstString(body, ["redirect_url", "redirectUrl", "success_url"]) ||
    APP_URL;
  const note =
    firstString(body, ["note"]) ||
    `quote:${quoteId}`;
  const customerId =
    firstString(body, ["customer_id", "customerId"]) ||
    (quoteRecord ? firstString(quoteRecord, ["square_customer_id", "customer_id", "client_id"]) : null);

  try {
    const profile = await getSquareProfile(auth.user.id);
    const locationId =
      firstString(body, ["location_id", "locationId"]) ||
      profile.square_location_id;
    if (!locationId) return badRequest("No Square location is connected for this user");

    const square = await createSquarePaymentLink({
      accessToken: profile.square_access_token,
      locationId,
      amountCents,
      currency,
      name: title,
      description,
      redirectUrl,
      note,
      customerId,
      referenceId: quoteId,
      metadata: { quote_id: quoteId },
    });

    try {
      await supabase.from("quotes").update({
        square_payment_url: square.payment_link.url,
      }).eq("id", quoteId);
    } catch (error) {
      console.error("quote square_payment_url update failed:", error);
    }

    return json(201, {
      quote_id: quoteId,
      id: square.payment_link.id,
      url: square.payment_link.url,
      payment_url: square.payment_link.url,
      checkout_url: square.payment_link.url,
      payment_link: square.payment_link,
      related_resources: square.related_resources ?? null,
    });
  } catch (error) {
    return serverError("Failed to create quote deposit payment link", error instanceof Error ? error.message : String(error));
  }
}
