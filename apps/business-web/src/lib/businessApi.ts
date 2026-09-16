import type { User } from "@supabase/supabase-js";
import { supabase, type BusinessSupabaseClient } from "./supabase";

export type SellerStatus = "pending" | "approved" | "rejected" | "suspended";
export type StoreStatus = "draft" | "active" | "suspended";

export type MarketplaceSeller = {
  userId: string;
  status: SellerStatus;
  displayName: string;
  applicationNote: string | null;
  suspensionReason: string | null;
  createdAt: string;
  updatedAt: string;
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

export type BusinessIdentity = {
  user: User;
  seller: MarketplaceSeller | null;
  store: MarketplaceStore | null;
};

export type SellerApplicationInput = {
  displayName: string;
  applicationNote: string;
};

export type StoreProfileInput = {
  name: string;
  slug: string;
  description: string;
};

type SellerRow = {
  user_id: string;
  status: SellerStatus;
  display_name: string;
  application_note: string | null;
  suspension_reason: string | null;
  created_at: string;
  updated_at: string;
};

type StoreRow = {
  id: string;
  seller_id: string;
  name: string;
  slug: string;
  description: string | null;
  logo_asset_id: string | null;
  banner_asset_id: string | null;
  status: StoreStatus;
  created_at: string;
  updated_at: string;
};

function apiError(error: { message?: string; code?: string } | null, fallback: string) {
  if (!error) return;
  const message = error.message?.trim() || fallback;
  throw new Error(message, { cause: error.code });
}

function sellerFromRow(row: SellerRow): MarketplaceSeller {
  return {
    userId: row.user_id,
    status: row.status,
    displayName: row.display_name,
    applicationNote: row.application_note,
    suspensionReason: row.suspension_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function storeFromRow(row: StoreRow): MarketplaceStore {
  return {
    id: row.id,
    sellerId: row.seller_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    logoAssetId: row.logo_asset_id,
    bannerAssetId: row.banner_asset_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadBusinessIdentity(
  client: BusinessSupabaseClient = supabase,
): Promise<BusinessIdentity> {
  const { data: userData, error: userError } = await client.auth.getUser();
  apiError(userError, "No se pudo validar la sesión");
  if (!userData.user) throw new Error("business_session_invalid");

  const { data: sellerData, error: sellerError } = await client
    .from("marketplace_sellers")
    .select(
      "user_id,status,display_name,application_note,suspension_reason,created_at,updated_at",
    )
    .eq("user_id", userData.user.id)
    .maybeSingle();
  apiError(sellerError, "No se pudo cargar el perfil de vendedor");

  const seller = sellerData ? sellerFromRow(sellerData as SellerRow) : null;
  if (!seller) return { user: userData.user, seller: null, store: null };

  const { data: storeData, error: storeError } = await client
    .from("marketplace_stores")
    .select(
      "id,seller_id,name,slug,description,logo_asset_id,banner_asset_id,status,created_at,updated_at",
    )
    .eq("seller_id", userData.user.id)
    .maybeSingle();
  apiError(storeError, "No se pudo cargar la tienda");

  return {
    user: userData.user,
    seller,
    store: storeData ? storeFromRow(storeData as StoreRow) : null,
  };
}

export async function applySellerApplication(
  input: SellerApplicationInput,
  client: BusinessSupabaseClient = supabase,
) {
  const { error } = await client.rpc("apply_marketplace_seller", {
    p_display_name: input.displayName.trim(),
    p_application_note: input.applicationNote.trim() || null,
  });
  apiError(error, "No se pudo enviar la solicitud");
}

export async function updateSellerApplication(
  input: SellerApplicationInput,
  client: BusinessSupabaseClient = supabase,
) {
  const { error } = await client.rpc("update_marketplace_seller_application", {
    p_display_name: input.displayName.trim(),
    p_application_note: input.applicationNote.trim() || null,
  });
  apiError(error, "No se pudo actualizar la solicitud");
}

export async function createStore(
  input: StoreProfileInput,
  client: BusinessSupabaseClient = supabase,
) {
  const { data, error } = await client.rpc("create_marketplace_store", {
    p_name: input.name.trim(),
    p_slug: input.slug.trim(),
    p_description: input.description.trim() || null,
  });
  apiError(error, "No se pudo crear la tienda");
  if (typeof data !== "string") throw new Error("store_create_invalid_response");
  return data;
}

export async function updateStore(
  storeId: string,
  input: StoreProfileInput,
  client: BusinessSupabaseClient = supabase,
) {
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
