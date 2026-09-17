import { supabase, type BusinessSupabaseClient } from "./supabase";

type Row = Record<string, unknown>;

export type StripeTopup = {
  id: string;
  status: "created" | "checkout_open" | "paid" | "credited" | "failed" | "expired" | "requires_review";
  amountUsdCents: number;
  bdagAmount: number;
  createdAt: string;
  creditedAt: string | null;
};

export type StripeProviderConfig = {
  available: boolean;
  mode: "test";
  currency: "usd";
  minimumUsdCents: number;
  maximumUsdCents: number;
  bdagPerUsd: number;
};

export type BusinessBillingOverview = {
  businessOwnerId: string;
  bdagBalance: number;
  stripe: StripeProviderConfig & { topups: StripeTopup[] };
};

function object(value: unknown, code: string): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Row;
}
function string(value: unknown, code: string) {
  if (typeof value !== "string" || !value) throw new Error(code);
  return value;
}
function number(value: unknown, code: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(code);
  return parsed;
}
function optionalString(value: unknown) { return typeof value === "string" && value ? value : null; }
function topupStatus(value: unknown): StripeTopup["status"] {
  const allowed: StripeTopup["status"][] = ["created", "checkout_open", "paid", "credited", "failed", "expired", "requires_review"];
  if (typeof value !== "string" || !allowed.includes(value as StripeTopup["status"])) throw new Error("billing_topup_invalid");
  return value as StripeTopup["status"];
}

function parseProviderConfig(value: unknown): StripeProviderConfig {
  const config = object(value, "stripe_config_invalid");
  return {
    available: config.available === true,
    mode: "test",
    currency: "usd",
    minimumUsdCents: number(config.minimum_usd_cents, "stripe_config_invalid"),
    maximumUsdCents: number(config.maximum_usd_cents, "stripe_config_invalid"),
    bdagPerUsd: number(config.bdag_per_usd, "stripe_config_invalid"),
  };
}

export async function getStripeProviderConfig(client: BusinessSupabaseClient = supabase): Promise<StripeProviderConfig> {
  const { data, error } = await client.functions.invoke("stripe-bdag-checkout", { method: "GET" });
  if (error) throw new Error(error.message || "stripe_config_unavailable");
  return parseProviderConfig(data);
}

export async function getBusinessBillingOverview(
  businessOwnerId: string,
  client: BusinessSupabaseClient = supabase,
): Promise<BusinessBillingOverview> {
  const [{ data, error }, provider] = await Promise.all([
    client.rpc("get_my_business_billing_overview", { p_business_owner_id: businessOwnerId, p_limit: 20 }),
    getStripeProviderConfig(client).catch((): StripeProviderConfig => ({
      available: false, mode: "test", currency: "usd",
      minimumUsdCents: 50, maximumUsdCents: 99_999_999, bdagPerUsd: 0,
    })),
  ]);
  if (error) throw new Error(error.message || "billing_overview_unavailable");
  const payload = object(data, "billing_overview_invalid");
  const stripe = object(payload.stripe, "billing_overview_invalid");
  if (!Array.isArray(stripe.topups)) throw new Error("billing_overview_invalid");
  return {
    businessOwnerId: string(payload.business_owner_id, "billing_overview_invalid"),
    bdagBalance: number(payload.bdag_balance, "billing_overview_invalid"),
    stripe: {
      ...provider,
      topups: stripe.topups.map((value) => {
        const topup = object(value, "billing_topup_invalid");
        return {
          id: string(topup.id, "billing_topup_invalid"),
          status: topupStatus(topup.status),
          amountUsdCents: number(topup.amount_usd_cents, "billing_topup_invalid"),
          bdagAmount: number(topup.bdag_amount, "billing_topup_invalid"),
          createdAt: string(topup.created_at, "billing_topup_invalid"),
          creditedAt: optionalString(topup.credited_at),
        };
      }),
    },
  };
}

export function usdInputToCents(input: string): number | null {
  const value = input.trim();
  if (!/^\d+(?:\.\d{0,2})?$/.test(value)) return null;
  const [whole, decimals = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export async function createStripeBdagCheckout(
  amountUsdCents: number,
  idempotencyKey = crypto.randomUUID(),
  client: BusinessSupabaseClient = supabase,
) {
  const { data, error } = await client.functions.invoke("stripe-bdag-checkout", {
    method: "POST",
    body: { amount_usd_cents: amountUsdCents, idempotency_key: idempotencyKey },
  });
  if (error) throw new Error(error.message || "stripe_checkout_unavailable");
  const payload = object(data, "stripe_checkout_invalid");
  const checkoutUrl = string(payload.checkout_url, "stripe_checkout_invalid");
  if (!checkoutUrl.startsWith("https://")) throw new Error("stripe_checkout_invalid");
  return {
    checkoutUrl,
    topupId: string(payload.topup_id, "stripe_checkout_invalid"),
    bdagAmount: number(payload.bdag_amount, "stripe_checkout_invalid"),
  };
}
