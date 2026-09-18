import type { BusinessCapability } from "./businessApi";
import { supabase, type BusinessSupabaseClient } from "./supabase";

type JsonRecord = Record<string, unknown>;

export type TeamCapability = {
  code: BusinessCapability;
  domain: string;
  label: string;
  description: string;
  protected: boolean;
};

export type TeamPerson = {
  userId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  email: string | null;
  status: "active" | "revoked";
};

export type TeamMember = TeamPerson & {
  membershipId: string;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
  capabilities: BusinessCapability[];
};

export type TeamInvitation = {
  id: string;
  email: string;
  status: "pending" | "expired";
  createdAt: string;
  expiresAt: string;
  invitedBy: { userId: string; displayName: string; username: string | null };
  capabilities: BusinessCapability[];
};

export type BusinessTeam = {
  businessOwnerId: string;
  actor: { userId: string; isOwner: boolean; canManage: boolean; canManageProtected: boolean };
  owner: TeamPerson;
  members: TeamMember[];
  invitations: TeamInvitation[] | null;
  capabilityCatalog: TeamCapability[] | null;
};

export type PendingBusinessInvitation = {
  id: string;
  businessOwnerId: string;
  businessName: string;
  createdAt: string;
  expiresAt: string;
  invitedBy: { displayName: string; username: string | null };
  capabilities: Omit<TeamCapability, "protected">[];
};

export type PendingBusinessInvitations = {
  actorUserId: string;
  items: PendingBusinessInvitation[];
};

export type TeamCommandReceipt = JsonRecord & {
  action: string;
  status?: string;
  invitation_id?: string;
  membership_id?: string;
};

function apiError(error: { message?: string } | null, fallback: string) {
  if (error) throw new Error(error.message?.trim() || fallback);
}

function object(value: unknown, code: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as JsonRecord;
}

function requiredString(value: unknown, code: string) {
  if (typeof value !== "string" || !value) throw new Error(code);
  return value;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function requiredBoolean(value: unknown, code: string) {
  if (typeof value !== "boolean") throw new Error(code);
  return value;
}

function capabilities(value: unknown, code: string): BusinessCapability[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.startsWith("business."))) {
    throw new Error(code);
  }
  return value as BusinessCapability[];
}

function person(value: unknown, code: string): TeamPerson {
  const row = object(value, code);
  const status = requiredString(row.status, code);
  if (status !== "active" && status !== "revoked") throw new Error(code);
  return {
    userId: requiredString(row.user_id, code),
    displayName: requiredString(row.display_name, code),
    username: optionalString(row.username),
    avatarUrl: optionalString(row.avatar_url),
    email: optionalString(row.email),
    status,
  };
}

function catalogItem(value: unknown, includeProtected: boolean): TeamCapability {
  const row = object(value, "business_team_catalog_invalid");
  return {
    code: requiredString(row.code, "business_team_catalog_invalid") as BusinessCapability,
    domain: requiredString(row.domain, "business_team_catalog_invalid"),
    label: requiredString(row.label, "business_team_catalog_invalid"),
    description: requiredString(row.description, "business_team_catalog_invalid"),
    protected: includeProtected ? requiredBoolean(row.protected, "business_team_catalog_invalid") : false,
  };
}

export async function getBusinessTeam(
  businessOwnerId: string,
  client: BusinessSupabaseClient = supabase,
): Promise<BusinessTeam> {
  const { data, error } = await client.rpc("get_my_business_team", { p_business_owner_id: businessOwnerId });
  apiError(error, "business_team_unavailable");
  const payload = object(data, "business_team_invalid");
  const actor = object(payload.actor, "business_team_actor_invalid");
  if (!Array.isArray(payload.members)) throw new Error("business_team_invalid");
  if (payload.invitations_authorized !== (payload.invitations !== null)) throw new Error("business_team_invitations_invalid");
  if (payload.capability_catalog_authorized !== (payload.capability_catalog !== null)) throw new Error("business_team_catalog_invalid");

  return {
    businessOwnerId: requiredString(payload.business_owner_id, "business_team_invalid"),
    actor: {
      userId: requiredString(actor.user_id, "business_team_actor_invalid"),
      isOwner: requiredBoolean(actor.is_owner, "business_team_actor_invalid"),
      canManage: requiredBoolean(actor.can_manage, "business_team_actor_invalid"),
      canManageProtected: requiredBoolean(actor.can_manage_protected, "business_team_actor_invalid"),
    },
    owner: person(payload.owner, "business_team_owner_invalid"),
    members: payload.members.map((value) => {
      const row = object(value, "business_team_member_invalid");
      return {
        ...person(row, "business_team_member_invalid"),
        membershipId: requiredString(row.membership_id, "business_team_member_invalid"),
        createdAt: requiredString(row.created_at, "business_team_member_invalid"),
        updatedAt: requiredString(row.updated_at, "business_team_member_invalid"),
        revokedAt: optionalString(row.revoked_at),
        capabilities: capabilities(row.capabilities, "business_team_member_invalid"),
      };
    }),
    invitations: payload.invitations === null ? null : (() => {
      if (!Array.isArray(payload.invitations)) throw new Error("business_team_invitations_invalid");
      return payload.invitations.map((value) => {
        const row = object(value, "business_team_invitation_invalid");
        const inviter = object(row.invited_by, "business_team_invitation_invalid");
        const status = requiredString(row.status, "business_team_invitation_invalid");
        if (status !== "pending" && status !== "expired") throw new Error("business_team_invitation_invalid");
        return {
          id: requiredString(row.id, "business_team_invitation_invalid"),
          email: requiredString(row.email, "business_team_invitation_invalid"),
          status,
          createdAt: requiredString(row.created_at, "business_team_invitation_invalid"),
          expiresAt: requiredString(row.expires_at, "business_team_invitation_invalid"),
          invitedBy: {
            userId: requiredString(inviter.user_id, "business_team_invitation_invalid"),
            displayName: requiredString(inviter.display_name, "business_team_invitation_invalid"),
            username: optionalString(inviter.username),
          },
          capabilities: capabilities(row.capabilities, "business_team_invitation_invalid"),
        } satisfies TeamInvitation;
      });
    })(),
    capabilityCatalog: payload.capability_catalog === null ? null : (() => {
      if (!Array.isArray(payload.capability_catalog)) throw new Error("business_team_catalog_invalid");
      return payload.capability_catalog.map((value) => catalogItem(value, true));
    })(),
  };
}

export async function getMyBusinessInvitations(
  client: BusinessSupabaseClient = supabase,
): Promise<PendingBusinessInvitations> {
  const { data, error } = await client.rpc("get_my_pending_business_invitations");
  apiError(error, "business_invitations_unavailable");
  const payload = object(data, "business_invitations_invalid");
  if (!Array.isArray(payload.items)) throw new Error("business_invitations_invalid");
  return {
    actorUserId: requiredString(payload.actor_user_id, "business_invitations_invalid"),
    items: payload.items.map((value) => {
      const row = object(value, "business_invitation_invalid");
      const inviter = object(row.invited_by, "business_invitation_invalid");
      if (!Array.isArray(row.capabilities)) throw new Error("business_invitation_invalid");
      return {
        id: requiredString(row.id, "business_invitation_invalid"),
        businessOwnerId: requiredString(row.business_owner_id, "business_invitation_invalid"),
        businessName: requiredString(row.business_name, "business_invitation_invalid"),
        createdAt: requiredString(row.created_at, "business_invitation_invalid"),
        expiresAt: requiredString(row.expires_at, "business_invitation_invalid"),
        invitedBy: {
          displayName: requiredString(inviter.display_name, "business_invitation_invalid"),
          username: optionalString(inviter.username),
        },
        capabilities: row.capabilities.map((item) => {
          const parsed = catalogItem(item, false);
          return { code: parsed.code, domain: parsed.domain, label: parsed.label, description: parsed.description };
        }),
      };
    }),
  };
}

async function command(action: string, payload: JsonRecord, client: BusinessSupabaseClient) {
  const { data, error } = await client.rpc("manage_business_team", { p_action: action, p_payload: payload });
  apiError(error, "business_team_command_failed");
  const receipt = object(data, "business_team_command_invalid");
  requiredString(receipt.action, "business_team_command_invalid");
  return receipt as TeamCommandReceipt;
}

export function createBusinessInvitation(
  businessOwnerId: string,
  email: string,
  capabilityCodes: readonly BusinessCapability[],
  client: BusinessSupabaseClient = supabase,
) {
  return command("create_invitation", {
    business_owner_id: businessOwnerId,
    email: email.trim(),
    capability_codes: [...capabilityCodes],
  }, client);
}

export function revokeBusinessInvitation(invitationId: string, client: BusinessSupabaseClient = supabase) {
  return command("revoke_invitation", { invitation_id: invitationId }, client);
}

export function acceptBusinessInvitation(invitationId: string, client: BusinessSupabaseClient = supabase) {
  return command("accept_invitation", { invitation_id: invitationId }, client);
}

export function declineBusinessInvitation(invitationId: string, client: BusinessSupabaseClient = supabase) {
  return command("decline_invitation", { invitation_id: invitationId }, client);
}

export function setBusinessMemberCapabilities(
  membershipId: string,
  capabilityCodes: readonly BusinessCapability[],
  client: BusinessSupabaseClient = supabase,
) {
  return command("set_member_capabilities", { membership_id: membershipId, capability_codes: [...capabilityCodes] }, client);
}

export function revokeBusinessMember(membershipId: string, client: BusinessSupabaseClient = supabase) {
  return command("revoke_member", { membership_id: membershipId }, client);
}
