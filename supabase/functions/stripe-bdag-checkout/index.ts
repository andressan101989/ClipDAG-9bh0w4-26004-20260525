// eslint-disable-next-line import/no-unresolved -- Supabase Edge resolves npm specifiers.
import Stripe from "npm:stripe@22.6.2";
// eslint-disable-next-line import/no-unresolved -- Supabase Edge resolves URL imports.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  parseTopupRequest,
  publicStripeConfig,
  sha256,
  stripeRuntimeConfig,
  usdCentsToBdag,
} from "../_shared/stripeBilling.ts";

type RpcResult = { data: Record<string, unknown> | null; error: { message?: string } | null };

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const config = stripeRuntimeConfig((name) => Deno.env.get(name));
  if (req.method === "GET") return reply(publicStripeConfig(config));
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405);
  if (!config.available || !config.secretKey || !config.businessUrl) {
    return reply({ error: "stripe_provider_not_configured", ...publicStripeConfig(config) }, 503);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return reply({ error: "authentication_required" }, 401);
  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const { data: { user }, error: authError } = await admin.auth.getUser(token);
  if (authError || !user) return reply({ error: "authentication_required" }, 401);

  try {
    const { amountUsdCents, idempotencyKey } = parseTopupRequest(await req.json());
    const bdagAmount = usdCentsToBdag(amountUsdCents);
    const fingerprint = await sha256(`${user.id}|${amountUsdCents}|test`);
    const prepared = await admin.rpc("manage_stripe_bdag_adapter", {
      p_action: "prepare_checkout",
      p_payload: {
        owner_id: user.id,
        actor_id: user.id,
        amount_usd_cents: amountUsdCents,
        usd_to_bdag_rate: publicStripeConfig(config).bdag_per_usd,
        bdag_amount: bdagAmount,
        idempotency_key: idempotencyKey,
        request_fingerprint: fingerprint,
        livemode: false,
      },
    }) as RpcResult;
    if (prepared.error || !prepared.data) throw new Error(prepared.error?.message || "topup_prepare_failed");
    if (typeof prepared.data.checkout_url === "string" && prepared.data.checkout_url) {
      return reply({
        checkout_url: prepared.data.checkout_url,
        topup_id: prepared.data.topup_id,
        bdag_amount: prepared.data.bdag_amount,
        mode: "test",
        reused: true,
      });
    }

    const stripe = new Stripe(config.secretKey, { httpClient: Stripe.createFetchHttpClient() });
    let customerId = typeof prepared.data.stripe_customer_id === "string"
      ? prepared.data.stripe_customer_id
      : null;
    if (!customerId) {
      const customer = await stripe.customers.create(
        user.email ? { email: user.email } : {},
        { idempotencyKey: `nelyon-test-customer-${user.id}` },
      );
      customerId = customer.id;
    }

    const topupId = String(prepared.data.topup_id);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer: customerId,
      client_reference_id: topupId,
      metadata: { topup_id: topupId },
      payment_intent_data: { metadata: { topup_id: topupId } },
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: amountUsdCents,
          product_data: { name: "Nelyon Business BDAG balance top-up" },
        },
      }],
      success_url: `${config.businessUrl}/finance?stripe=success`,
      cancel_url: `${config.businessUrl}/finance?stripe=cancelled`,
    }, { idempotencyKey: `nelyon-test-topup-${topupId}` });
    if (!session.url) throw new Error("stripe_checkout_url_missing");

    const bound = await admin.rpc("manage_stripe_bdag_adapter", {
      p_action: "bind_checkout",
      p_payload: {
        topup_id: topupId,
        owner_id: user.id,
        livemode: false,
        stripe_customer_id: customerId,
        stripe_checkout_session_id: session.id,
        checkout_url: session.url,
      },
    }) as RpcResult;
    if (bound.error) throw new Error(bound.error.message || "checkout_bind_failed");
    return reply({ checkout_url: session.url, topup_id: topupId, bdag_amount: bdagAmount, mode: "test", reused: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "stripe_checkout_failed";
    const status = message.includes("idempotency_conflict") ? 409
      : message.includes("business_owner_required") || message.includes("approved_business_owner_required") ? 403
      : message.startsWith("invalid_") ? 400 : 503;
    console.error("[stripe-bdag-checkout]", message);
    return reply({ error: message }, status);
  }
});
