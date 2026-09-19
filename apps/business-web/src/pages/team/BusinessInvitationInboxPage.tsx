import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useBusinessAuth } from "../../auth/BusinessAuthProvider";
import { BrandMark, InlineError } from "../../components/BusinessUI";
import {
  acceptBusinessInvitation,
  declineBusinessInvitation,
  getMyBusinessInvitations,
  type PendingBusinessInvitation,
} from "../../lib/businessTeamApi";

export function BusinessInvitationNotice() {
  const { user } = useBusinessAuth();
  const [count, setCount] = useState(0);
  useEffect(() => {
    let active = true;
    if (!user) return;
    void getMyBusinessInvitations().then((result) => { if (active) setCount(result.items.length); }).catch(() => { if (active) setCount(0); });
    return () => { active = false; };
  }, [user]);
  if (!count) return null;
  return <Link className="invitation-notice" to="/invitations">{count} {count === 1 ? "invitación pendiente" : "invitaciones pendientes"}</Link>;
}

export function BusinessInvitationInboxPage() {
  const { user, retry, logout } = useBusinessAuth();
  const [searchParams] = useSearchParams();
  const targetId = searchParams.get("invitation");
  const [items, setItems] = useState<PendingBusinessInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const requestRef = useRef(0);

  useEffect(() => {
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    void getMyBusinessInvitations().then((result) => {
      if (request !== requestRef.current) return;
      const sorted = targetId ? [...result.items].sort((a, b) => Number(b.id === targetId) - Number(a.id === targetId)) : result.items;
      setItems(sorted);
    }).catch((cause) => {
      if (request === requestRef.current) setError(cause instanceof Error ? cause.message : "No se pudieron cargar las invitaciones");
    }).finally(() => {
      if (request === requestRef.current) setLoading(false);
    });
    return () => { requestRef.current += 1; };
  }, [targetId, refreshKey]);

  async function respond(invitationId: string, accept: boolean) {
    setError(null);
    try {
      if (accept) {
        await acceptBusinessInvitation(invitationId);
        await retry();
        setNotice("Invitación aceptada. Tu acceso empresarial ya está actualizado.");
      } else {
        await declineBusinessInvitation(invitationId);
        setNotice("Invitación rechazada.");
      }
      setRefreshKey((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo responder la invitación");
    }
  }

  return (
    <main className="invitation-page">
      <header className="onboarding-topbar"><BrandMark /><div className="invitation-page-actions"><Link className="text-button" to="/home">Volver a Business</Link><button className="text-button" type="button" onClick={() => void logout()}>Cerrar sesión</button></div></header>
      <section className="invitation-shell">
        <p className="eyebrow">Accesos compartidos</p>
        <h1>Invitaciones a negocios</h1>
        <p className="page-lead">Estas invitaciones coinciden con el email autenticado {user?.email}. Aceptar actualiza tu acceso canónico sin cerrar sesión.</p>
        {notice && <div className="inline-success" role="status">{notice}</div>}
        <InlineError message={error} />
        {loading ? <section className="business-card" aria-busy="true">Cargando invitaciones…</section> : items.length === 0 ? <section className="business-card invitation-empty"><h2>No tienes invitaciones pendientes</h2><p>Cuando alguien te invite a un negocio Nelyon, aparecerá aquí.</p></section> : <div className="invitation-inbox-list">{items.map((invitation) => (
          <article className={`business-card invitation-card ${invitation.id === targetId ? "is-target" : ""}`} key={invitation.id}>
            <div><p className="eyebrow">Invitación de {invitation.invitedBy.displayName}</p><h2>{invitation.businessName}</h2><span>Vence {new Date(invitation.expiresAt).toLocaleDateString("es")}</span></div>
            <ul>{invitation.capabilities.map((capability) => <li key={capability.code}>{capability.label}</li>)}</ul>
            <div className="form-actions"><button className="secondary-button" type="button" onClick={() => void respond(invitation.id, false)}>Rechazar</button><button className="primary-button" type="button" onClick={() => void respond(invitation.id, true)}>Aceptar</button></div>
          </article>
        ))}</div>}
      </section>
    </main>
  );
}
