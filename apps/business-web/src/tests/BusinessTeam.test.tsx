import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BusinessAccess } from "../lib/businessApi";
import { TEAM_PRESETS } from "../lib/businessTeamPresets";
import { BusinessInvitationInboxPage } from "../pages/team/BusinessInvitationInboxPage";
import { BusinessTeamPage } from "../pages/team/BusinessTeamPage";

const teamMocks = vi.hoisted(() => ({
  get: vi.fn(),
  inbox: vi.fn(),
  create: vi.fn(),
  revokeInvitation: vi.fn(),
  accept: vi.fn(),
  decline: vi.fn(),
  setCapabilities: vi.fn(),
  revokeMember: vi.fn(),
}));

vi.mock("../lib/businessTeamApi", () => ({
  getBusinessTeam: teamMocks.get,
  getMyBusinessInvitations: teamMocks.inbox,
  createBusinessInvitation: teamMocks.create,
  revokeBusinessInvitation: teamMocks.revokeInvitation,
  acceptBusinessInvitation: teamMocks.accept,
  declineBusinessInvitation: teamMocks.decline,
  setBusinessMemberCapabilities: teamMocks.setCapabilities,
  revokeBusinessMember: teamMocks.revokeMember,
}));

const authState = vi.hoisted(() => ({
  currentBusiness: null as BusinessAccess | null,
  accessType: "owner" as "owner" | "member",
  effectiveCapabilities: [] as BusinessAccess["capabilities"],
  user: { id: "owner-a", email: "owner@nelyon.test" },
  phase: "store_active",
  retry: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("../auth/BusinessAuthProvider", () => ({ useBusinessAuth: () => authState }));

const catalog = [
  { code: "business.home.read", domain: "home", label: "Ver inicio", description: "Ver el resumen.", protected: false },
  { code: "business.ads.read", domain: "ads", label: "Ver publicidad", description: "Ver campañas.", protected: false },
  { code: "business.team.read", domain: "team", label: "Ver equipo", description: "Ver miembros.", protected: false },
  { code: "business.team.manage", domain: "team", label: "Gestionar equipo", description: "Gestionar miembros.", protected: true },
  { code: "business.finance.read", domain: "finance", label: "Ver finanzas", description: "Ver finanzas.", protected: true },
] as const;

const ownerTeam = {
  businessOwnerId: "owner-a",
  actor: { userId: "owner-a", isOwner: true, canManage: true, canManageProtected: true },
  owner: { userId: "owner-a", displayName: "Nelyon Shop", username: "owner", avatarUrl: null, email: "owner@nelyon.test", status: "active" as const },
  members: [{
    membershipId: "member-row", userId: "member-a", displayName: "Ana", username: "ana", avatarUrl: null,
    email: "ana@nelyon.test", status: "active" as const, createdAt: "2026-09-18T00:00:00Z",
    updatedAt: "2026-09-18T00:00:00Z", revokedAt: null,
    capabilities: ["business.home.read", "business.team.read"] as BusinessAccess["capabilities"],
  }],
  invitations: [{
    id: "invite-a", email: "invitee@nelyon.test", status: "pending" as const,
    createdAt: "2026-09-18T00:00:00Z", expiresAt: "2026-09-25T00:00:00Z",
    invitedBy: { userId: "owner-a", displayName: "Nelyon Shop", username: "owner" },
    capabilities: ["business.home.read"] as BusinessAccess["capabilities"],
  }],
  capabilityCatalog: [...catalog],
};

function business(ownerId = "owner-a", capabilities: BusinessAccess["capabilities"] = ["business.team.read", "business.team.manage"]): BusinessAccess {
  return {
    businessOwnerId: ownerId, accessType: authState.accessType, membershipId: authState.accessType === "owner" ? null : "actor-membership",
    capabilities, seller: { userId: ownerId, status: "approved", displayName: ownerId === "owner-a" ? "Nelyon Shop" : "Otro negocio" },
    store: { id: `store-${ownerId}`, sellerId: ownerId, name: ownerId === "owner-a" ? "Nelyon Shop" : "Otro negocio", slug: ownerId, description: null, logoAssetId: null, bannerAssetId: null, status: "active", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  };
}

describe("Business Team UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.accessType = "owner";
    authState.currentBusiness = business();
    authState.effectiveCapabilities = ["business.team.read", "business.team.manage", "business.home.read", "business.ads.read", "business.finance.read"];
    teamMocks.get.mockResolvedValue(ownerTeam);
    teamMocks.inbox.mockResolvedValue({ actorUserId: "owner-a", items: [] });
    teamMocks.create.mockResolvedValue({ action: "create_invitation" });
    teamMocks.setCapabilities.mockResolvedValue({ action: "set_member_capabilities" });
    teamMocks.accept.mockResolvedValue({ action: "accept_invitation", status: "accepted" });
    teamMocks.decline.mockResolvedValue({ action: "decline_invitation", status: "declined" });
    authState.retry.mockResolvedValue(undefined);
  });

  it("renders owner first with full access and management controls", async () => {
    render(<MemoryRouter><BusinessTeamPage /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Team" })).toBeInTheDocument();
    expect(screen.getByText("Full access")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invitar miembro" })).toBeEnabled();
    const owner = screen.getByTestId("team-owner");
    expect(within(owner).queryByRole("button", { name: /Editar permisos|Revocar/ })).not.toBeInTheDocument();
  });

  it("copies the invitation link under the Business base path", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<MemoryRouter><BusinessTeamPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Copiar enlace" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/business/invitations?invitation=invite-a`,
    ));
  });

  it("keeps team.read strictly read-only", async () => {
    authState.accessType = "member";
    authState.currentBusiness = business("owner-a", ["business.team.read"]);
    authState.effectiveCapabilities = ["business.team.read"];
    teamMocks.get.mockResolvedValue({
      ...ownerTeam,
      actor: { userId: "reader-a", isOwner: false, canManage: false, canManageProtected: false },
      owner: { ...ownerTeam.owner, email: null }, members: ownerTeam.members.map((item) => ({ ...item, email: null })),
      invitations: null, capabilityCatalog: null,
    });
    render(<MemoryRouter><BusinessTeamPage /></MemoryRouter>);
    expect(await screen.findByText("Ana")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Invitar miembro" })).not.toBeInTheDocument();
    expect(screen.queryByText("ana@nelyon.test")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Editar permisos|Revocar miembro/ })).not.toBeInTheDocument();
  });

  it("disables protected and unowned capabilities for a delegated manager", async () => {
    authState.accessType = "member";
    authState.user = { id: "manager-a", email: "manager@nelyon.test" };
    authState.currentBusiness = business();
    authState.effectiveCapabilities = ["business.team.manage", "business.home.read"];
    teamMocks.get.mockResolvedValue({
      ...ownerTeam,
      actor: { userId: "manager-a", isOwner: false, canManage: true, canManageProtected: false },
    });
    render(<MemoryRouter><BusinessTeamPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Editar permisos de Ana" }));
    expect(screen.getByRole("checkbox", { name: /Gestionar equipo/ })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /Ver finanzas/ })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /Ver publicidad/ })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /Ver inicio/ })).toBeEnabled();
  });

  it("applies presets as capability sets and becomes Custom after a manual change", async () => {
    render(<MemoryRouter><BusinessTeamPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Invitar miembro" }));
    fireEvent.change(screen.getByLabelText("Preset de permisos"), { target: { value: "marketing" } });
    expect(screen.getByLabelText("Preset de permisos")).toHaveValue("marketing");
    fireEvent.click(screen.getByRole("checkbox", { name: /Ver equipo/ }));
    expect(screen.getByLabelText("Preset de permisos")).toHaveValue("custom");
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "person@nelyon.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar invitación" }));
    await waitFor(() => expect(teamMocks.create).toHaveBeenCalledWith(
      "owner-a", "person@nelyon.test", expect.arrayContaining([...TEAM_PRESETS.marketing, "business.team.read"]),
    ));
  });

  it("focuses and closes the permission editor from the keyboard", async () => {
    render(<MemoryRouter><BusinessTeamPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Invitar miembro" }));
    expect(screen.getByRole("button", { name: "Cerrar" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Invitar miembro" })).not.toBeInTheDocument();
  });

  it("resets prior business data and ignores a stale Team response", async () => {
    let releaseA: ((value: typeof ownerTeam) => void) | undefined;
    teamMocks.get.mockImplementationOnce(() => new Promise((resolve) => { releaseA = resolve; }));
    const view = render(<MemoryRouter><BusinessTeamPage /></MemoryRouter>);
    authState.currentBusiness = business("owner-b");
    teamMocks.get.mockResolvedValueOnce({ ...ownerTeam, businessOwnerId: "owner-b", owner: { ...ownerTeam.owner, userId: "owner-b", displayName: "Otro negocio" }, members: [] });
    view.rerender(<MemoryRouter><BusinessTeamPage /></MemoryRouter>);
    expect(await screen.findByText("Otro negocio")).toBeInTheDocument();
    releaseA?.(ownerTeam);
    await waitFor(() => expect(screen.queryByText("Ana")).not.toBeInTheDocument());
  });

  it("accepts an invitation and refreshes canonical business access immediately", async () => {
    teamMocks.inbox.mockResolvedValue({ actorUserId: "invitee-a", items: [{
      id: "invite-a", businessOwnerId: "owner-a", businessName: "Nelyon Shop",
      createdAt: "2026-09-18T00:00:00Z", expiresAt: "2026-09-25T00:00:00Z",
      invitedBy: { displayName: "Nelyon Shop", username: "owner" },
      capabilities: [{ code: "business.home.read", domain: "home", label: "Ver inicio", description: "Ver el resumen." }],
    }] });
    render(<MemoryRouter initialEntries={["/invitations?invitation=invite-a"]}><BusinessInvitationInboxPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Aceptar" }));
    await waitFor(() => expect(teamMocks.accept).toHaveBeenCalledWith("invite-a"));
    expect(authState.retry).toHaveBeenCalledTimes(1);
  });
});
