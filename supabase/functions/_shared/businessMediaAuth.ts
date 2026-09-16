import { authenticatedClient } from "./mediaAuth.ts";

export function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function businessActorHasAnyCapability(
  req: Request,
  businessOwnerId: string,
  capabilities: readonly string[],
) {
  if (!isUuid(businessOwnerId)) return false;
  const client = authenticatedClient(req);
  if (!client) return false;
  const { data, error } = await client.rpc("get_my_business_access");
  if (error || !data || !Array.isArray(data.businesses)) return false;
  const access = data.businesses.find((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    return (item as Record<string, unknown>).business_owner_id === businessOwnerId;
  }) as Record<string, unknown> | undefined;
  if (!access || !Array.isArray(access.capabilities)) return false;
  return capabilities.some((capability) => access.capabilities.includes(capability));
}
