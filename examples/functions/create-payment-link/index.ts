import {
  badRequest,
  json,
  requireObjectBody,
  serverError,
  unauthorized,
} from "../_shared/http.ts";
import { requireUser } from "../_shared/ekobaseClient.ts";
import {
  createSquarePaymentLink,
  firstAmountCents,
  firstString,
  getSquareProfile,
} from "../_shared/square.ts";

const APP_URL = process.env.APP_URL || "https://ops.lock28.com";

export async function handler(req: any) {
  if (req.method !== "POST") return badRequest("POST required");

  const auth = await requireUser(req);
  if (!auth.user) return unauthorized(auth.error ?? undefined);

  const body = requireObjectBody(req.body);
  if (!body) return badRequest("JSON body required");

  const amountCents = firstAmountCents(body, [
    "amount_cents",
    "amount",
    "deposit_amount_cents",
    "deposit_amount",
    "total_cents",
    "total",
    "price_money",
    "amount_money",
  ]);
  if (!amountCents || amountCents <= 0) return badRequest("A positive payment amount is required");

  const currency =
    firstString(body, ["currency", "currency_code"]) ||
    (typeof body.amount_money === "object" && body.amount_money && "currency" in body.amount_money
      ? String((body.amount_money as Record<string, unknown>).currency || "").trim().toUpperCase()
      : null) ||
    "USD";

  const name =
    firstString(body, ["name", "title", "label"]) ||
    "Payment";
  const description =
    firstString(body, ["description", "memo", "message"]) ||
    name;
  const redirectUrl =
    firstString(body, ["redirect_url", "redirectUrl", "callback_url", "callbackUrl", "success_url"]) ||
    APP_URL;
  const note = firstString(body, ["note"]);
  const customerId = firstString(body, ["customer_id", "customerId", "buyer_id"]);
  const referenceId = firstString(body, ["reference_id", "referenceId", "quote_id", "quoteId", "invoice_id", "invoiceId"]);
  const locationOverride = firstString(body, ["location_id", "locationId"]);

  try {
    const profile = await getSquareProfile(auth.user.id);
    const locationId = locationOverride || profile.square_location_id;
    if (!locationId) return badRequest("No Square location is connected for this user");

    const square = await createSquarePaymentLink({
      accessToken: profile.square_access_token,
      locationId,
      amountCents,
      currency,
      name,
      description,
      redirectUrl,
      note,
      customerId,
      referenceId,
      metadata: referenceId ? { reference_id: referenceId } : undefined,
    });

    return json(201, {
      id: square.payment_link.id,
      url: square.payment_link.url,
      payment_url: square.payment_link.url,
      checkout_url: square.payment_link.url,
      order_id: square.payment_link.order_id ?? null,
      payment_link: square.payment_link,
      related_resources: square.related_resources ?? null,
    });
  } catch (error) {
    return serverError("Failed to create Square payment link", error instanceof Error ? error.message : String(error));
  }
}
