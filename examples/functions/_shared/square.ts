import { serviceClient } from "./ekobaseClient.ts";

const SQUARE_ENV = process.env.SQUARE_ENVIRONMENT || "production";
const SQUARE_VERSION = process.env.SQUARE_VERSION || "2024-01-18";

const SQUARE_BASE_URL =
  SQUARE_ENV === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";

export type SquareProfile = {
  square_access_token: string;
  square_location_id: string | null;
};

export async function getSquareProfile(userId: string): Promise<SquareProfile> {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("square_access_token, square_location_id")
    .eq("id", userId)
    .single();

  if (error || !data?.square_access_token) {
    throw new Error("Square is not connected for this user");
  }

  return {
    square_access_token: data.square_access_token,
    square_location_id: data.square_location_id ?? null,
  };
}

export async function createSquarePaymentLink(args: {
  accessToken: string;
  locationId: string;
  amountCents: number;
  currency: string;
  name: string;
  description?: string | null;
  redirectUrl?: string | null;
  note?: string | null;
  customerId?: string | null;
  referenceId?: string | null;
  metadata?: Record<string, string>;
}) {
  const payload: Record<string, unknown> = {
    idempotency_key: crypto.randomUUID(),
    quick_pay: {
      name: args.name,
      price_money: {
        amount: Math.round(args.amountCents),
        currency: args.currency.toUpperCase(),
      },
      location_id: args.locationId,
    },
  };

  if (args.description) {
    (payload.quick_pay as Record<string, unknown>).description = args.description;
  }

  if (args.note) payload.note = args.note;
  if (args.redirectUrl) payload.checkout_options = { redirect_url: args.redirectUrl };
  if (args.customerId) payload.pre_populated_data = { buyer_id: args.customerId };
  if (args.referenceId) payload.reference_id = args.referenceId;
  if (args.metadata && Object.keys(args.metadata).length > 0) payload.metadata = args.metadata;

  const response = await fetch(`${SQUARE_BASE_URL}/v2/online-checkout/payment-links`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      "Content-Type": "application/json",
      "Square-Version": SQUARE_VERSION,
    },
    body: JSON.stringify(payload),
  });

  const json = (await response.json()) as Record<string, any>;
  if (!response.ok || !json.payment_link?.url) {
    const detail = JSON.stringify(json.errors ?? json);
    throw new Error(`Square payment link creation failed: ${detail}`);
  }

  return json;
}

export function amountToCents(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Number.isInteger(value) ? value : Math.round(value * 100);
  }

  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return value.includes(".") ? Math.round(numeric * 100) : Math.round(numeric);
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const amount = record.amount;
    if ((typeof amount === "number" || typeof amount === "string") && record.currency) {
      return amountToCents(amount);
    }
  }

  return null;
}

export function firstString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function firstAmountCents(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const amount = amountToCents(source[key]);
    if (amount && amount > 0) return amount;
  }
  return null;
}
