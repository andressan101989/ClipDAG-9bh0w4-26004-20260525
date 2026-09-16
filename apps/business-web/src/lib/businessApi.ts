import type { User } from "@supabase/supabase-js";
import { supabase, type BusinessSupabaseClient } from "./supabase";

export type SellerStatus = "pending" | "approved" | "rejected" | "suspended";
export type StoreStatus = "draft" | "active" | "suspended";
export type BusinessAccessType = "owner" | "member";
export type BusinessCapability = `business.${string}.${string}`;

export type MarketplaceSeller = {
  userId: string;
  status: SellerStatus;
  displayName: string;
  applicationNote: string | null;
  suspensionReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BusinessSellerSummary = {
  userId: string;
  status: SellerStatus;
  displayName: string;
};

export type MarketplaceStore = {
  id: string;
  sellerId: string;
  name: string;
  slug: string;
  description: string | null;
  logoAssetId: string | null;
  bannerAssetId: string | null;
  status: StoreStatus;
  createdAt: string;
  updatedAt: string;
};

export type BusinessAccess = {
  businessOwnerId: string;
  accessType: BusinessAccessType;
  membershipId: string | null;
  capabilities: BusinessCapability[];
  seller: BusinessSellerSummary;
  store: MarketplaceStore | null;
};

export type BusinessIdentity = {
  user: User;
  ownedSeller: MarketplaceSeller | null;
  businesses: BusinessAccess[];
};

export type SellerApplicationInput = { displayName: string; applicationNote: string };
export type StoreProfileInput = { name: string; slug: string; description: string };
type JsonRecord = Record<string, unknown>;

function apiError(error: { message?: string; code?: string } | null, fallback: string) {
  if (!error) return;
  throw new Error(error.message?.trim() || fallback, { cause: error.code });
}

function record(value: unknown, code: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as JsonRecord;
}

function requiredString(value: unknown, code: string) {
  if (typeof value !== "string" || !value) throw new Error(code);
  return value;
}

function sellerFromPayload(value: unknown): MarketplaceSeller {
  const row = record(value, "business_owned_seller_invalid");
  return {
    userId: requiredString(row.user_id, "business_owned_seller_invalid"),
    status: requiredString(row.status, "business_owned_seller_invalid") as SellerStatus,
    displayName: requiredString(row.display_name, "business_owned_seller_invalid"),
    applicationNote: typeof row.application_note === "string" ? row.application_note : null,
    suspensionReason: typeof row.suspension_reason === "string" ? row.suspension_reason : null,
    createdAt: requiredString(row.created_at, "business_owned_seller_invalid"),
    updatedAt: requiredString(row.updated_at, "business_owned_seller_invalid"),
  };
}

function storeFromPayload(value: unknown): MarketplaceStore {
  const row = record(value, "business_store_invalid");
  return {
    id: requiredString(row.id, "business_store_invalid"),
    sellerId: requiredString(row.seller_id, "business_store_invalid"),
    name: requiredString(row.name, "business_store_invalid"),
    slug: requiredString(row.slug, "business_store_invalid"),
    description: typeof row.description === "string" ? row.description : null,
    logoAssetId: typeof row.logo_asset_id === "string" ? row.logo_asset_id : null,
    bannerAssetId: typeof row.banner_asset_id === "string" ? row.banner_asset_id : null,
    status: requiredString(row.status, "business_store_invalid") as StoreStatus,
    createdAt: requiredString(row.created_at, "business_store_invalid"),
    updatedAt: requiredString(row.updated_at, "business_store_invalid"),
  };
}

function businessFromPayload(value: unknown): BusinessAccess {
  const row = record(value, "business_access_invalid");
  const seller = record(row.seller, "business_access_seller_invalid");
  const accessType = requiredString(row.access_type, "business_access_invalid");
  if (accessType !== "owner" && accessType !== "member") throw new Error("business_access_invalid");
  if (!Array.isArray(row.capabilities) || !row.capabilities.every((item) => typeof item === "string")) {
    throw new Error("business_capabilities_invalid");
  }
  return {
    businessOwnerId: requiredString(row.business_owner_id, "business_access_invalid"),
    accessType,
    membershipId: typeof row.membership_id === "string" ? row.membership_id : null,
    capabilities: row.capabilities as BusinessCapability[],
    seller: {
      userId: requiredString(seller.user_id, "business_access_seller_invalid"),
      status: requiredString(seller.status, "business_access_seller_invalid") as SellerStatus,
      displayName: requiredString(seller.display_name, "business_access_seller_invalid"),
    },
    store: row.store ? storeFromPayload(row.store) : null,
  };
}

export async function loadBusinessIdentity(client: BusinessSupabaseClient = supabase): Promise<BusinessIdentity> {
  const { data: userData, error: userError } = await client.auth.getUser();
  apiError(userError, "No se pudo validar la sesión");
  if (!userData.user) throw new Error("business_session_invalid");

  const { data, error } = await client.rpc("get_my_business_access");
  apiError(error, "No se pudo cargar el acceso empresarial");
  const payload = record(data, "business_access_response_invalid");
  if (payload.actor_user_id !== userData.user.id || !Array.isArray(payload.businesses)) {
    throw new Error("business_access_response_invalid");
  }
  return {
    user: userData.user,
    ownedSeller: payload.owned_seller ? sellerFromPayload(payload.owned_seller) : null,
    businesses: payload.businesses.map(businessFromPayload),
  };
}

export async function applySellerApplication(input: SellerApplicationInput, client: BusinessSupabaseClient = supabase) {
  const { error } = await client.rpc("apply_marketplace_seller", {
    p_display_name: input.displayName.trim(),
    p_application_note: input.applicationNote.trim() || null,
  });
  apiError(error, "No se pudo enviar la solicitud");
}

export async function updateSellerApplication(input: SellerApplicationInput, client: BusinessSupabaseClient = supabase) {
  const { error } = await client.rpc("update_marketplace_seller_application", {
    p_display_name: input.displayName.trim(),
    p_application_note: input.applicationNote.trim() || null,
  });
  apiError(error, "No se pudo actualizar la solicitud");
}

export async function createStore(input: StoreProfileInput, client: BusinessSupabaseClient = supabase) {
  const { data, error } = await client.rpc("create_marketplace_store", {
    p_name: input.name.trim(),
    p_slug: input.slug.trim(),
    p_description: input.description.trim() || null,
  });
  apiError(error, "No se pudo crear la tienda");
  if (typeof data !== "string") throw new Error("store_create_invalid_response");
  return data;
}

export async function updateStore(storeId: string, input: StoreProfileInput, client: BusinessSupabaseClient = supabase) {
  const { error } = await client.rpc("update_marketplace_store", {
    p_store_id: storeId,
    p_name: input.name.trim(),
    p_slug: input.slug.trim(),
    p_description: input.description.trim() || null,
  });
  apiError(error, "No se pudo actualizar la tienda");
}

export type BusinessGateway = {
  loadIdentity: typeof loadBusinessIdentity;
  applySeller: typeof applySellerApplication;
  updateSeller: typeof updateSellerApplication;
  createStore: typeof createStore;
  updateStore: typeof updateStore;
};

export const businessGateway: BusinessGateway = {
  loadIdentity: loadBusinessIdentity,
  applySeller: applySellerApplication,
  updateSeller: updateSellerApplication,
  createStore,
  updateStore,
};
