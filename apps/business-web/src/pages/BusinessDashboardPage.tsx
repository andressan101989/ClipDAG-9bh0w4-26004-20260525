import { useBusinessAuth } from "../auth/BusinessAuthProvider";
import { PageHeader, StatusBadge } from "../components/BusinessUI";

export function BusinessDashboardPage() {
  const { currentBusiness, store, accessType } = useBusinessAuth();
  const businessName = store?.name ?? currentBusiness?.seller.displayName ?? "Business";
  return (
    <>
      <PageHeader
        eyebrow="Inicio"
        title={`Hola, ${businessName}`}
        description="Tu espacio de negocio está listo. Aquí encontrarás el estado real de la fundación Business."
      />
      <section className="hero-card">
        <div className="store-identity">
          <div className="large-store-avatar" aria-hidden="true">{businessName.slice(0, 1).toUpperCase()}</div>
          <div><p>{accessType === "owner" ? "Tu negocio" : "Negocio compartido"}</p><h2>{businessName}</h2>{store && <span>nelyon.com/store/{store.slug}</span>}</div>
        </div>
        {store && <StatusBadge status={store.status} />}
      </section>
      <section className="dashboard-grid" aria-label="Resumen empresarial">
        <article className="info-card"><p>Tipo de acceso</p><div className="card-value"><strong>{accessType === "owner" ? "Propietario" : "Miembro"}</strong></div><small>Autorización empresarial validada por el servidor.</small></article>
        <article className="info-card"><p>Estado Store</p><div className="card-value"><strong>{store?.name}</strong>{store && <StatusBadge status={store.status} />}</div><small>Una Store canónica por seller.</small></article>
        <article className="info-card"><p>Capabilities efectivas</p><div className="card-value"><strong>{currentBusiness?.capabilities.length ?? 0}</strong></div><small>Los permisos se resuelven server-side para este negocio.</small></article>
      </section>
      <section className="coming-section">
        <div><p className="eyebrow">Próximas capacidades</p><h2>Una base preparada para crecer</h2><p>Productos, pedidos, publicidad, media, finanzas y analítica se habilitarán sobre sus autoridades canónicas, sin datos simulados.</p></div>
        <div className="coming-grid">{["Productos","Pedidos","Publicidad","Media","Finanzas","Analítica"].map((item)=><div key={item}><span aria-hidden="true">◇</span><strong>{item}</strong><small>Próximamente</small></div>)}</div>
      </section>
    </>
  );
}

export function BusinessSettingsPage() {
  const { user, accessType } = useBusinessAuth();
  return (
    <>
      <PageHeader eyebrow="Configuración" title="Cuenta Business" description="Business Web utiliza tu misma cuenta Nelyon." />
      <section className="info-card settings-card"><p>{accessType === "owner" ? "Propietario" : "Miembro"}</p><strong>{user?.email}</strong><small>La identidad se deriva de la sesión autenticada y la autorización se valida en el servidor.</small></section>
    </>
  );
}
