import {
  BDAG_PER_USD,
  STRIPE_MAXIMUM_USD_CENTS,
  STRIPE_MINIMUM_USD_CENTS,
  usdCentsToBdag,
} from "./bdagEconomics.ts";

export type StripeRuntimeConfig = {
  available: boolean;
  mode: "test";
  secretKey: string | null;
  webhookSecret: string | null;
  businessUrl: string | null;
};

export function stripeRuntimeConfig(env: (name: string) => string | undefined): StripeRuntimeConfig {
  const mode = env("STRIPE_MODE")?.trim().toLowerCase();
  const secretKey = env("STRIPE_SECRET_KEY")?.trim() || null;
  const webhookSecret = env("STRIPE_WEBHOOK_SECRET")?.trim() || null;
  const businessUrl = env("BUSINESS_WEB_PUBLIC_URL")?.trim().replace(/\/+$/, "") || null;
  return {
    available: mode === "test" && Boolean(
      secretKey?.startsWith("sk_test_") && webhookSecret && businessUrl,
    ),
    mode: "test",
    secretKey,
    webhookSecret,
    businessUrl,
  };
}

export function parseTopupRequest(value: unknown): { amountUsdCents: number; idempotencyKey: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_request");
  const body = value as Record<string, unknown>;
  const amountUsdCents = body.amount_usd_cents;
  const idempotencyKey = body.idempotency_key;
  if (!Number.isSafeInteger(amountUsdCents)
    || Number(amountUsdCents) < STRIPE_MINIMUM_USD_CENTS
    || Number(amountUsdCents) > STRIPE_MAXIMUM_USD_CENTS) {
    throw new Error("invalid_amount_usd_cents");
  }
  if (typeof idempotencyKey !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
    throw new Error("invalid_idempotency_key");
  }
  return { amountUsdCents: Number(amountUsdCents), idempotencyKey };
}

export function publicStripeConfig(config: StripeRuntimeConfig) {
  return {
    available: config.available,
    mode: config.mode,
    currency: "usd",
    minimum_usd_cents: STRIPE_MINIMUM_USD_CENTS,
    maximum_usd_cents: STRIPE_MAXIMUM_USD_CENTS,
    bdag_per_usd: BDAG_PER_USD,
  };
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export { usdCentsToBdag };
