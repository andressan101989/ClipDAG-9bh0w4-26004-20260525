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

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const object = event.data.object as unknown as StripeObject;
  const isSession = event.type.startsWith("checkout.session.");
  const topupId = object.metadata?.topup_id
    ?? (isSession && typeof object.client_reference_id === "string" ? object.client_reference_id : null);
  const sessionId = isSession ? objectId(object) : null;
  let paymentIntentId = objectId(object.payment_intent);
  const payloadHash = await sha256(rawBody);
  let ingested = false;

  try {
    if (event.type === "charge.dispute.created" && !paymentIntentId) {
      const chargeId = objectId(object.charge);
      if (!chargeId) throw new Error("stripe_dispute_charge_required");
      const charge = await stripe.charges.retrieve(chargeId);
      paymentIntentId = objectId(charge.payment_intent);
      if (!paymentIntentId) throw new Error("stripe_dispute_payment_intent_required");
    }
    const ingest = await admin.rpc("manage_stripe_bdag_adapter", {
      p_action: "ingest_webhook",
      p_payload: {
        stripe_event_id: event.id,
        event_type: event.type,
        livemode: event.livemode,
        payload_hash: payloadHash,
        topup_id: topupId,
        stripe_checkout_session_id: sessionId,
        stripe_payment_intent_id: paymentIntentId,
      },
    }) as RpcResult;
    if (ingest.error || !ingest.data) throw new Error(ingest.error?.message || "webhook_ingest_failed");
    ingested = true;
    if (ingest.data.already_processed === true) return json({ received: true, replay: true });

    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      if (object.payment_status !== "paid") {
        await admin.rpc("manage_stripe_bdag_adapter", {
          p_action: "complete_webhook",
          p_payload: { stripe_event_id: event.id, status: "ignored", error_code: "payment_not_paid" },
        });
        return json({ received: true, credited: false });
      }
      const resolvedTopupId = topupId ?? ingest.data.topup_id;
      const credit = await admin.rpc("credit_stripe_bdag_topup", {
        p_topup_id: resolvedTopupId,
        p_stripe_checkout_session_id: sessionId,
        p_stripe_payment_intent_id: paymentIntentId,
        p_amount_usd_cents: object.amount_total,
        p_currency: object.currency,
        p_stripe_event_id: event.id,
        p_livemode: event.livemode,
      }) as RpcResult;
      if (credit.error) throw new Error(credit.error.message || "stripe_credit_failed");
      await admin.rpc("manage_stripe_bdag_adapter", {
        p_action: "complete_webhook",
        p_payload: { stripe_event_id: event.id, status: "processed" },
      });
      return json({ received: true, credited: true, idempotent: credit.data?.idempotent === true });
    }

    const supported = new Set([
      "checkout.session.async_payment_failed",
      "checkout.session.expired",
      "charge.refunded",
      "charge.dispute.created",
    ]);
    await admin.rpc("manage_stripe_bdag_adapter", {
      p_action: "complete_webhook",
      p_payload: {
        stripe_event_id: event.id,
        status: supported.has(event.type) ? "processed" : "ignored",
        error_code: supported.has(event.type) ? null : "unsupported_event",
      },
    });
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
