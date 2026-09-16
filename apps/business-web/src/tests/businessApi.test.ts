import type { User } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  applySellerApplication,
  createStore,
  loadBusinessIdentity,
  updateSellerApplication,
  updateStore,
} from "../lib/businessApi";
import type { BusinessSupabaseClient } from "../lib/supabase";

vi.mock("../lib/supabase", () => ({ supabase: {} }));

const owner = { id: "owner-id", email: "owner@nelyon.test" } as User;

describe("canonical Business API", () => {
  it("loads the server-derived multi-business projection for the verified auth user", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      actor_user_id: owner.id,
      owned_seller: { user_id: owner.id, status: "approved", display_name: "Owner", application_note: null, suspension_reason: null, created_at: "now", updated_at: "now" },
      businesses: [{
        business_owner_id: owner.id,
        access_type: "owner",
        membership_id: null,
        capabilities: ["business.home.read", "business.store.manage"],
        seller: { user_id: owner.id, status: "approved", display_name: "Owner" },
        store: { id: "store-id", seller_id: owner.id, name: "Store", slug: "store", description: null, logo_asset_id: null, banner_asset_id: null, status: "active", created_at: "now", updated_at: "now" },
      }],
    }, error: null });
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: owner }, error: null }) },
      rpc,
    } as unknown as BusinessSupabaseClient;
    const identity = await loadBusinessIdentity(client);
    expect(identity.user.id).toBe(owner.id);
    expect(identity.businesses[0].accessType).toBe("owner");
    expect(identity.businesses[0].store?.id).toBe("store-id");
    expect(rpc).toHaveBeenCalledWith("get_my_business_access");
  });

  it("rejects a projection that does not match the verified actor", async () => {
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: owner }, error: null }) },
      rpc: vi.fn().mockResolvedValue({ data: { actor_user_id: "other", owned_seller: null, businesses: [] }, error: null }),
    } as unknown as BusinessSupabaseClient;
    await expect(loadBusinessIdentity(client)).rejects.toThrow("business_access_response_invalid");
  });

  it("never sends a client-selected seller id to seller application RPCs", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = { rpc } as unknown as BusinessSupabaseClient;
    const input = { displayName: " Owner ", applicationNote: " Note " };
    await applySellerApplication(input, client);
    await updateSellerApplication(input, client);
    expect(rpc).toHaveBeenNthCalledWith(1, "apply_marketplace_seller", { p_display_name: "Owner", p_application_note: "Note" });
    expect(rpc).toHaveBeenNthCalledWith(2, "update_marketplace_seller_application", { p_display_name: "Owner", p_application_note: "Note" });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("seller_id");
  });

  it("creates one owner-derived Store without accepting seller_id", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "store-id", error: null });
    const client = { rpc } as unknown as BusinessSupabaseClient;
    const id = await createStore({ name: " Store ", slug: "store", description: "" }, client);
    expect(id).toBe("store-id");
    expect(rpc).toHaveBeenCalledWith("create_marketplace_store", { p_name: "Store", p_slug: "store", p_description: null });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("seller_id");
  });

  it("uses only the canonical owner-checking Store update RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = { rpc } as unknown as BusinessSupabaseClient;
    await updateStore("store-id", { name: "Store", slug: "store", description: "Profile" }, client);
    expect(rpc).toHaveBeenCalledWith("update_marketplace_store", { p_store_id: "store-id", p_name: "Store", p_slug: "store", p_description: "Profile" });
  });

  it("fails closed when the server cannot verify the authenticated user", async () => {
    const client = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) } } as unknown as BusinessSupabaseClient;
    await expect(loadBusinessIdentity(client)).rejects.toThrow("business_session_invalid");
  });
});
