import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useBusinessAuth } from "../../auth/BusinessAuthProvider";
import { InlineError, PageHeader, StatusBadge } from "../../components/BusinessUI";
import type { BusinessCapability } from "../../lib/businessApi";
import {
  createBusinessInvitation,
  getBusinessTeam,
  revokeBusinessInvitation,
  revokeBusinessMember,
  setBusinessMemberCapabilities,
  type BusinessTeam,
  type TeamCapability,
  type TeamMember,
} from "../../lib/businessTeamApi";
import {
  deriveTeamPreset,
  isProtectedTeamCapability,
  TEAM_PRESET_LABELS,
  TEAM_PRESETS,
  type TeamPreset,
} from "../../lib/businessTeamPresets";

const domainLabels: Record<string, string> = {
  home: "Inicio",
  store: "Tienda",
  catalog: "Catálogo",
  inventory: "Inventario",
  orders: "Pedidos",
  returns: "Devoluciones",
  disputes: "Disputas",
  media: "Media",
  ads: "Publicidad",
  analytics: "Analytics",
  finance: "Finanzas",
  payouts: "Payouts",
  team: "Team",
  settings: "Configuración",
};

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "N";
}

function capabilityGroups(catalog: readonly TeamCapability[]) {
  return catalog.reduce<Record<string, TeamCapability[]>>((groups, item) => {
    (groups[item.domain] ??= []).push(item);
    return groups;
  }, {});
}

function CapabilityEditor({
  title,
  catalog,
  initial,
  actorCapabilities,
  canManageProtected,
  email,
  submitLabel,
  onClose,
  onSubmit,
}: {
  title: string;
  catalog: TeamCapability[];
  initial: readonly BusinessCapability[];
  actorCapabilities: readonly BusinessCapability[];
  canManageProtected: boolean;
  email?: boolean;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (capabilities: BusinessCapability[], emailValue?: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState<BusinessCapability[]>([...initial]);
  const [emailValue, setEmailValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preset = deriveTeamPreset(selected);
  const groups = useMemo(() => capabilityGroups(catalog), [catalog]);
  const actorSet = useMemo(() => new Set(actorCapabilities), [actorCapabilities]);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeFromKeyboard);
    return () => {
      document.removeEventListener("keydown", closeFromKeyboard);
      if (previous?.isConnected) previous.focus();
    };
  }, [onClose]);

  function selectPreset(value: TeamPreset) {
    if (value === "custom") return;
    setSelected([...TEAM_PRESETS[value]]);
  }

  function toggle(code: BusinessCapability) {
    setSelected((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (selected.length === 0) {
      setError("Selecciona al menos un permiso.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(selected, emailValue.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar el acceso");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="media-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="media-dialog team-dialog" role="dialog" aria-modal="true" aria-label={title} onSubmit={(event) => void submit(event)}>
        <header><div><p className="eyebrow">Acceso empresarial</p><h2>{title}</h2></div><button ref={closeButtonRef} className="icon-button" type="button" aria-label="Cerrar" onClick={onClose}>×</button></header>
        {email && <label className="form-field"><span>Email</span><input aria-label="Email" type="email" required value={emailValue} onChange={(event) => setEmailValue(event.target.value)} /></label>}
        <label className="form-field team-preset-field">
          <span>Preset de permisos</span>
          <select aria-label="Preset de permisos" value={preset} onChange={(event) => selectPreset(event.target.value as TeamPreset)}>
            {(Object.keys(TEAM_PRESET_LABELS) as TeamPreset[]).map((value) => {
              const codes = value === "custom" ? [] : TEAM_PRESETS[value];
              const unavailable = value !== "custom" && codes.some((code) => (!canManageProtected && isProtectedTeamCapability(code)) || !actorSet.has(code));
              return <option key={value} value={value} disabled={unavailable}>{TEAM_PRESET_LABELS[value]}</option>;
            })}
          </select>
          <small>Los presets solo preseleccionan capabilities; el acceso se guarda permiso por permiso.</small>
        </label>
        <div className="team-capability-groups">
          {Object.entries(groups).map(([domain, items]) => (
            <fieldset className="team-capability-group" key={domain}>
              <legend>{domainLabels[domain] ?? domain}</legend>
              {items.map((item) => {
                const protectedCapability = item.protected || isProtectedTeamCapability(item.code);
                const disabled = (!canManageProtected && protectedCapability) || !actorSet.has(item.code);
                return (
                  <label className={`team-capability ${disabled ? "is-disabled" : ""}`} key={item.code}>
                    <input type="checkbox" aria-label={`${item.label}${protectedCapability ? " · sensible" : ""}`} checked={selected.includes(item.code)} disabled={disabled} onChange={() => toggle(item.code)} />
                    <span><strong>{item.label}</strong><small>{item.description}</small></span>
                    {protectedCapability && <em>Acceso sensible</em>}
                  </label>
                );
              })}
            </fieldset>
          ))}
        </div>
        {email && <section className="team-invite-summary"><strong>Resumen</strong><span>{selected.length} permisos · vence en 7 días</span></section>}
        <InlineError message={error} />
        <footer className="form-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancelar</button><button className="primary-button" type="submit" disabled={submitting || selected.length === 0}>{submitting ? "Guardando…" : submitLabel}</button></footer>
      </form>
    </div>
  );
}

export function BusinessTeamPage() {
  const { currentBusiness, effectiveCapabilities } = useBusinessAuth();
  const ownerId = currentBusiness?.businessOwnerId ?? null;
  const [team, setTeam] = useState<BusinessTeam | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const requestRef = useRef(0);

  const reload = useCallback(() => setRefreshKey((value) => value + 1), []);

  useEffect(() => {
    const request = ++requestRef.current;
    setTeam(null);
    setInviteOpen(false);
    setEditing(null);
    setError(null);
    if (!ownerId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void getBusinessTeam(ownerId).then((result) => {
      if (request === requestRef.current) setTeam(result);
    }).catch((cause) => {
      if (request === requestRef.current) setError(cause instanceof Error ? cause.message : "No se pudo cargar Team");
    }).finally(() => {
      if (request === requestRef.current) setLoading(false);
    });
    return () => { requestRef.current += 1; };
  }, [ownerId, refreshKey]);

  const actorSet = useMemo(() => new Set(effectiveCapabilities), [effectiveCapabilities]);
  const activeMembers = team?.members.filter((item) => item.status === "active") ?? [];
  const canEditMember = useCallback((member: TeamMember) => {
    if (!team?.actor.canManage || member.status !== "active" || member.userId === team.actor.userId) return false;
    if (team.actor.isOwner) return true;
    if (member.capabilities.includes("business.team.manage")) return false;
    return !member.capabilities.some((code) => isProtectedTeamCapability(code));
  }, [team]);

  async function copyInvitation(invitationId: string) {
    const link = `${window.location.origin}/invitations?invitation=${invitationId}`;
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(link);
  }

  if (!ownerId) return <section className="business-card" role="alert">Selecciona un negocio para ver su equipo.</section>;

  return (
    <div className="team-page">
      <PageHeader eyebrow="Acceso empresarial" title="Team" description={`${currentBusiness?.store?.name ?? currentBusiness?.seller.displayName} · ${activeMembers.length + 1} miembros activos`} action={team?.actor.canManage ? <button className="primary-button" type="button" onClick={() => setInviteOpen(true)}>Invitar miembro</button> : undefined} />
      {loading && <section className="business-card team-loading" aria-busy="true"><span className="skeleton-line" /><span className="skeleton-line" /></section>}
      {error && <section className="business-card" role="alert"><strong>No pudimos cargar Team</strong><p>{error}</p><button className="secondary-button" type="button" onClick={reload}>Reintentar</button></section>}
      {team && <>
        <section className="business-card team-section">
          <div className="team-section-head"><div><p className="eyebrow">Personas</p><h2>Miembros del negocio</h2></div><span>{activeMembers.length + 1} activos</span></div>
          <div className="team-list">
            <article className="team-person" data-testid="team-owner">
              <span className="team-avatar">{initials(team.owner.displayName)}</span>
              <div className="team-person-copy"><strong>{team.owner.displayName}</strong><span>{team.owner.email ?? `@${team.owner.username ?? "owner"}`}</span><small>Full access</small></div>
              <div className="team-person-meta"><span className="team-role">Owner</span><StatusBadge status="active" /></div>
            </article>
            {team.members.map((member) => (
              <article className={`team-person ${member.status === "revoked" ? "is-revoked" : ""}`} key={member.membershipId}>
                <span className="team-avatar">{initials(member.displayName)}</span>
                <div className="team-person-copy"><strong>{member.displayName}</strong><span>{member.email ?? `@${member.username ?? "miembro"}`}</span><small>{member.capabilities.length} capabilities</small></div>
                <div className="team-person-meta"><span className="team-role">{TEAM_PRESET_LABELS[deriveTeamPreset(member.capabilities)]}</span><StatusBadge status={member.status} /></div>
                {canEditMember(member) && <div className="team-person-actions"><button className="secondary-button" type="button" aria-label={`Editar permisos de ${member.displayName}`} onClick={() => setEditing(member)}>Editar permisos</button><button className="danger-button" type="button" aria-label={`Revocar miembro ${member.displayName}`} onClick={() => { if (window.confirm(`Revocar acceso de ${member.displayName}?`)) void revokeBusinessMember(member.membershipId).then(reload).catch((cause) => setError(cause instanceof Error ? cause.message : "No se pudo revocar")); }}>Revocar</button></div>}
              </article>
            ))}
          </div>
        </section>

        {team.invitations && <section className="business-card team-section">
          <div className="team-section-head"><div><p className="eyebrow">Pendientes</p><h2>Invitaciones</h2></div><span>{team.invitations.length}</span></div>
          {team.invitations.length === 0 ? <p className="muted-copy">No hay invitaciones pendientes.</p> : <div className="team-invitation-list">{team.invitations.map((invitation) => {
            const canRevoke = team.actor.isOwner || (!invitation.capabilities.some(isProtectedTeamCapability) && invitation.capabilities.every((code) => actorSet.has(code)));
            return <article key={invitation.id}><div><strong>{invitation.email}</strong><span>{TEAM_PRESET_LABELS[deriveTeamPreset(invitation.capabilities)]} · {invitation.capabilities.length} capabilities</span><small>Creada {new Date(invitation.createdAt).toLocaleDateString("es")} por {invitation.invitedBy.displayName} · vence {new Date(invitation.expiresAt).toLocaleDateString("es")}</small><div className="team-capability-summary">{invitation.capabilities.map((code) => <span key={code}>{team.capabilityCatalog?.find((item) => item.code === code)?.label ?? code}</span>)}</div></div><StatusBadge status={invitation.status} /><button className="text-button" type="button" onClick={() => void copyInvitation(invitation.id)}>Copiar enlace</button>{canRevoke && <button className="danger-button" type="button" onClick={() => void revokeBusinessInvitation(invitation.id).then(reload).catch((cause) => setError(cause instanceof Error ? cause.message : "No se pudo revocar"))}>Revocar</button>}</article>;
          })}</div>}
        </section>}
      </>}

      {inviteOpen && team?.capabilityCatalog && <CapabilityEditor title="Invitar miembro" catalog={team.capabilityCatalog} initial={TEAM_PRESETS.viewer} actorCapabilities={effectiveCapabilities} canManageProtected={team.actor.canManageProtected} email submitLabel="Enviar invitación" onClose={() => setInviteOpen(false)} onSubmit={async (codes, email) => { await createBusinessInvitation(ownerId, email ?? "", codes); setInviteOpen(false); reload(); }} />}
      {editing && team?.capabilityCatalog && <CapabilityEditor title={`Permisos de ${editing.displayName}`} catalog={team.capabilityCatalog} initial={editing.capabilities} actorCapabilities={effectiveCapabilities} canManageProtected={team.actor.canManageProtected} submitLabel="Guardar permisos" onClose={() => setEditing(null)} onSubmit={async (codes) => { await setBusinessMemberCapabilities(editing.membershipId, codes); setEditing(null); reload(); }} />}
    </div>
  );
}
