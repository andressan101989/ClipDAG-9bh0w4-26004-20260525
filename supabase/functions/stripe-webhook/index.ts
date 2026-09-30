// eslint-disable-next-line import/no-unresolved -- Supabase Edge resolves npm specifiers.
import Stripe from "npm:stripe@22.6.2";
// eslint-disable-next-line import/no-unresolved -- Supabase Edge resolves URL imports.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sha256, stripeRuntimeConfig } from "../_shared/stripeBilling.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

type StripeObject = Record<string, unknown> & { metadata?: Record<string, string> };
type RpcResult = { data: Record<string, unknown> | null; error: { message?: string } | null };

function objectId(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && "id" in value && typeof (value as { id?: unknown }).id === "string") {
    return (value as { id: string }).id;
  }
  return null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const signature = req.headers.get("Stripe-Signature");
  if (!signature) return json({ error: "stripe_signature_required" }, 400);
  const config = stripeRuntimeConfig((name) => Deno.env.get(name));
  if (!config.available || !config.secretKey || !config.webhookSecret) {
    return json({ error: "stripe_webhook_not_configured" }, 503);
  }
  const rawBody = await req.text();
  const stripe = new Stripe(config.secretKey, { httpClient: Stripe.createFetchHttpClient() });
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      config.webhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    return json({ error: "invalid_stripe_signature" }, 400);
  }
  if (event.livemode !== false) return json({ error: "stripe_mode_mismatch" }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const completeWebhook = async (status: "processed" | "ignored", errorCode: string | null = null) => {
    const completed = await admin.rpc("manage_stripe_bdag_adapter", {
      p_action: "complete_webhook",
      p_payload: { stripe_event_id: event.id, status, error_code: errorCode },
    }) as RpcResult;
    if (completed.error || !completed.data) {
      throw new Error(completed.error?.message || "webhook_completion_failed");
    }
  };
  const object = event.data.object as unknown as StripeObject;
  const isSession = event.type.startsWith("checkout.session.");
  const topupId = object.metadata?.topup_id
    ?? (isSession && typeof object.client_reference_id === "string" ? object.client_reference_id : null);
  const sessionId = isSession ? objectId(object) : null;
  let paymentIntentId = objectId(object.payment_intent);
  let resolvedTopupId = topupId;
  const providerObjectId = objectId(object);
  const amountUsdCents = event.type === "charge.refunded"
    ? integer(object.amount_refunded)
    : event.type.startsWith("charge.dispute.")
      ? integer(object.amount)
      : integer(object.amount_total);
  const currency = typeof object.currency === "string" ? object.currency.toLowerCase() : null;
  const providerStatus = isSession && typeof object.payment_status === "string"
    ? object.payment_status
    : typeof object.status === "string" ? object.status : null;
  const payloadHash = await sha256(rawBody);
  let ingested = false;

  try {
    if (event.type.startsWith("charge.dispute.") && !paymentIntentId) {
      const chargeId = objectId(object.charge);
      if (!chargeId) throw new Error("stripe_dispute_charge_required");
      const charge = await stripe.charges.retrieve(chargeId);
      paymentIntentId = objectId(charge.payment_intent);
      if (!paymentIntentId) throw new Error("stripe_dispute_payment_intent_required");
    }
    if (!resolvedTopupId && paymentIntentId && event.type.startsWith("charge.")) {
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      resolvedTopupId = paymentIntent.metadata?.topup_id ?? null;
    }
    const ingest = await admin.rpc("manage_stripe_bdag_adapter", {
      p_action: "ingest_webhook",
      p_payload: {
        stripe_event_id: event.id,
        event_type: event.type,
        livemode: event.livemode,
        payload_hash: payloadHash,
        topup_id: resolvedTopupId,
        stripe_checkout_session_id: sessionId,
        stripe_payment_intent_id: paymentIntentId,
        provider_object_id: providerObjectId,
        amount_usd_cents: amountUsdCents,
        currency,
        provider_status: providerStatus,
        provider_created_at: new Date(event.created * 1000).toISOString(),
      },
    }) as RpcResult;
    if (ingest.error || !ingest.data) throw new Error(ingest.error?.message || "webhook_ingest_failed");
    ingested = true;
    if (ingest.data.already_processed === true) return json({ received: true, replay: true });

    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      if (object.payment_status !== "paid") {
        await completeWebhook("ignored", "payment_not_paid");
        return json({ received: true, credited: false });
      }
      resolvedTopupId = resolvedTopupId ?? (typeof ingest.data.topup_id === "string" ? ingest.data.topup_id : null);
      const credit = await admin.rpc("credit_stripe_bdag_topup", {
        p_topup_id: resolvedTopupId,
        p_stripe_checkout_session_id: sessionId,
        p_stripe_payment_intent_id: paymentIntentId,
        p_amount_usd_cents: amountUsdCents,
        p_currency: currency,
        p_stripe_event_id: event.id,
        p_livemode: event.livemode,
      }) as RpcResult;
      if (credit.error) throw new Error(credit.error.message || "stripe_credit_failed");
      await completeWebhook("processed");
      return json({ received: true, credited: true, idempotent: credit.data?.idempotent === true });
    }

    const lifecycleEvents = new Set([
      "checkout.session.async_payment_failed",
      "checkout.session.expired",
    ]);
    const adjustmentEvents = new Set([
      "charge.refunded",
      "charge.dispute.created",
      "charge.dispute.funds_withdrawn",
      "charge.dispute.funds_reinstated",
      "charge.dispute.closed",
    ]);
    if (adjustmentEvents.has(event.type)) {
      const adjustment = await admin.rpc("apply_stripe_bdag_adjustment", {
        p_stripe_event_id: event.id,
      }) as RpcResult;
      if (adjustment.error) throw new Error(adjustment.error.message || "stripe_adjustment_failed");
      if (adjustment.data?.pending === true) throw new Error("pending_insufficient_funds");
    }
    const supported = lifecycleEvents.has(event.type) || adjustmentEvents.has(event.type);
    await completeWebhook(supported ? "processed" : "ignored", supported ? null : "unsupported_event");
    return json({ received: true, credited: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "stripe_webhook_failed";
    if (ingested) {
      await admin.rpc("manage_stripe_bdag_adapter", {
        p_action: "complete_webhook",
        p_payload: { stripe_event_id: event.id, status: "error", error_code: message.slice(0, 160) },
      });
    }
    console.error("[stripe-webhook]", event.id, message);
    return json({ error: "stripe_webhook_processing_failed" }, 500);
  }
});
