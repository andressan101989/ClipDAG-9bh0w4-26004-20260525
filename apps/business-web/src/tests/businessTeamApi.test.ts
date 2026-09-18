import { describe, expect, it, vi } from "vitest";
import type { BusinessSupabaseClient } from "../lib/supabase";
import {
  acceptBusinessInvitation,
  createBusinessInvitation,
  getBusinessTeam,
  getMyBusinessInvitations,
  revokeBusinessMember,
  setBusinessMemberCapabilities,
} from "../lib/businessTeamApi";

vi.mock("../lib/supabase", () => ({ supabase: {} }));

const teamPayload = {
  business_owner_id: "owner-a",
  actor: { user_id: "actor-a", is_owner: true, can_manage: true, can_manage_protected: true },
  owner: { user_id: "owner-a", display_name: "Owner", username: "owner", avatar_url: null, email: "owner@nelyon.test", status: "active" },
  members: [{
    membership_id: "membership-a", user_id: "member-a", display_name: "Member", username: "member",
    avatar_url: null, email: "member@nelyon.test", status: "active", created_at: "2026-09-18T00:00:00Z",
    updated_at: "2026-09-18T00:00:00Z", revoked_at: null,
    capabilities: ["business.team.read"],
  }],
  invitations_authorized: true,
  invitations: [{
    id: "invite-a", email: "invitee@nelyon.test", status: "pending",
    created_at: "2026-09-18T00:00:00Z", expires_at: "2026-09-25T00:00:00Z",
    invited_by: { user_id: "owner-a", display_name: "Owner", username: "owner" },
    capabilities: ["business.home.read"],
  }],
  capability_catalog_authorized: true,
  capability_catalog: [{
    code: "business.home.read", domain: "home", label: "Ver inicio",
    description: "Ver el resumen.", protected: false,
  }],
};

describe("Business Team API", () => {
  it("parses the scoped Team projection without inventing PII", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: teamPayload, error: null });
    const result = await getBusinessTeam("owner-a", { rpc } as unknown as BusinessSupabaseClient);
    expect(rpc).toHaveBeenCalledWith("get_my_business_team", { p_business_owner_id: "owner-a" });
    expect(result.owner.email).toBe("owner@nelyon.test");
    expect(result.members[0]).toMatchObject({ membershipId: "membership-a", capabilities: ["business.team.read"] });
    expect(result.invitations?.[0].email).toBe("invitee@nelyon.test");
  });

  it("preserves an unauthorized catalog/invitation section as null", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ...teamPayload, actor: { ...teamPayload.actor, is_owner: false, can_manage: false, can_manage_protected: false }, invitations_authorized: false, invitations: null, capability_catalog_authorized: false, capability_catalog: null },
      error: null,
    });
    const result = await getBusinessTeam("owner-a", { rpc } as unknown as BusinessSupabaseClient);
    expect(result.invitations).toBeNull();
    expect(result.capabilityCatalog).toBeNull();
  });

  it("parses only the authenticated actor's invitation inbox", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      actor_user_id: "actor-a",
      items: [{
        id: "invite-a", business_owner_id: "owner-a", business_name: "Nelyon Shop",
        created_at: "2026-09-18T00:00:00Z", expires_at: "2026-09-25T00:00:00Z",
        invited_by: { display_name: "Owner", username: "owner" },
        capabilities: [{ code: "business.home.read", domain: "home", label: "Ver inicio", description: "Ver el resumen." }],
      }],
    }, error: null });
    const result = await getMyBusinessInvitations({ rpc } as unknown as BusinessSupabaseClient);
    expect(rpc).toHaveBeenCalledWith("get_my_pending_business_invitations");
    expect(result.items[0]).toMatchObject({ businessOwnerId: "owner-a", businessName: "Nelyon Shop" });
  });

  it("routes every mutation through the single command RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { action: "ok", status: "active" }, error: null });
    const client = { rpc } as unknown as BusinessSupabaseClient;
    await createBusinessInvitation("owner-a", " Person@Example.com ", ["business.home.read"], client);
    await setBusinessMemberCapabilities("membership-a", ["business.ads.read"], client);
    await revokeBusinessMember("membership-a", client);
    await acceptBusinessInvitation("invite-a", client);
    expect(rpc.mock.calls).toEqual([
      ["manage_business_team", { p_action: "create_invitation", p_payload: { business_owner_id: "owner-a", email: "Person@Example.com", capability_codes: ["business.home.read"] } }],
      ["manage_business_team", { p_action: "set_member_capabilities", p_payload: { membership_id: "membership-a", capability_codes: ["business.ads.read"] } }],
      ["manage_business_team", { p_action: "revoke_member", p_payload: { membership_id: "membership-a" } }],
      ["manage_business_team", { p_action: "accept_invitation", p_payload: { invitation_id: "invite-a" } }],
    ]);
  });

  it("rejects malformed Team envelopes", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ...teamPayload, members: [{ user_id: "leak" }] }, error: null });
    await expect(getBusinessTeam("owner-a", { rpc } as unknown as BusinessSupabaseClient)).rejects.toThrow("business_team_member_invalid");
  });
});
