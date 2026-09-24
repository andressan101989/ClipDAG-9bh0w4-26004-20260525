/* eslint-disable import/no-unresolved */
import { admin, authenticatedUser, corsHeaders, json } from "../_shared/mediaAuth.ts";
import { handleAdsV2DeliveryRequest } from "./contract.mjs";

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const database = admin();
  const result = await handleAdsV2DeliveryRequest(
    request,
    async (incoming: Request) => (await authenticatedUser(incoming))?.id ?? null,
    (name: string, args: Record<string, unknown>) => database.rpc(name, args),
  );
  return json(result.body, result.status);
});
