// eslint-disable-next-line import/no-unresolved -- Supabase Edge resolves URL imports.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { materializeSponsoredCandidates, parseSponsoredSurface } from "./orchestration.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

  try {
    const body = await req.json();
    const surface = parseSponsoredSurface(body.surface);
    if (!surface) {
      return reply({ success: false, products: [], error: "invalid_surface" }, 400);
    }
    const limit = Math.min(Math.max(Number(body.limit) || 4, 0), 8);
    const session = typeof body.session === "string" ? body.session : null;
    const category = typeof body.category === "string" ? body.category : null;
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const args = {
      p_surface: surface,
      p_category: category,
      p_limit: limit,
      p_session: session,
    };
    const first = await admin.rpc("fetch_marketplace_sponsored_products_v2", args);
    if (first.error) throw first.error;
    await materializeSponsoredCandidates(
      first.data ?? [],
      (campaignId) => admin.rpc("materialize_marketplace_ad_campaign_spend", {
        p_campaign_id: campaignId,
      }),
    );
    const fresh = await admin.rpc("fetch_marketplace_sponsored_products_v2", args);
    if (fresh.error) throw fresh.error;
    return reply({ success: true, products: fresh.data ?? [], surface });
  } catch (error) {
    console.error("[marketplace-ads]", error);
    return reply({ success: false, products: [] }, 503);
  }
});
