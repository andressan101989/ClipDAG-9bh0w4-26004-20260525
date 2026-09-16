import { useBusinessAuth } from "../auth/BusinessAuthProvider";
import { PageHeader, StatusBadge } from "../components/BusinessUI";

export function BusinessDashboardPage() {
  const { seller, store } = useBusinessAuth();
  return (
    <>
      <PageHeader
        eyebrow="Inicio"
        title={`Hola, ${seller?.displayName ?? "seller"}`}
        description="Tu espacio de negocio está listo. Aquí encontrarás el estado real de la fundación Business."
      />
      <section className="hero-card">
        <div className="store-identity">
          <div className="large-store-avatar" aria-hidden="true">{store?.name.slice(0, 1).toUpperCase()}</div>
          <div><p>Tu tienda</p><h2>{store?.name}</h2><span>nelyon.com/store/{store?.slug}</span></div>
        </div>
        {store && <StatusBadge status={store.status} />}
      </section>
      <section className="dashboard-grid" aria-label="Resumen empresarial">
        <article className="info-card"><p>Estado seller</p><div className="card-value"><strong>{seller?.displayName}</strong>{seller && <StatusBadge status={seller.status} />}</div><small>Identidad vinculada a tu cuenta Nelyon.</small></article>
        <article className="info-card"><p>Estado Store</p><div className="card-value"><strong>{store?.name}</strong>{store && <StatusBadge status={store.status} />}</div><small>Una Store canónica por seller.</small></article>
        <article className="info-card"><p>Configuración inicial</p><div className="progress-line"><span style={{ width: "100%" }} /></div><div className="card-value"><strong>Completada</strong><span>100%</span></div><small>Cuenta, seller aprobado y Store activa.</small></article>
      </section>
      <section className="coming-section">
        <div><p className="eyebrow">Próximas capacidades</p><h2>Una base preparada para crecer</h2><p>Productos, pedidos, publicidad, media, finanzas y analítica se habilitarán sobre sus autoridades canónicas, sin datos simulados.</p></div>
        <div className="coming-grid">{["Productos","Pedidos","Publicidad","Media","Finanzas","Analítica"].map((item)=><div key={item}><span aria-hidden="true">◇</span><strong>{item}</strong><small>Próximamente</small></div>)}</div>
      </section>
    </>
  );
}

export function BusinessSettingsPage() {
  const { user } = useBusinessAuth();
  return (
    <>
      <PageHeader eyebrow="Configuración" title="Cuenta Business" description="Business Web utiliza tu misma cuenta Nelyon." />
      <section className="info-card settings-card"><p>Propietario</p><strong>{user?.email}</strong><small>El propietario se deriva de la sesión autenticada. No puede cambiarse desde esta superficie.</small></section>
    </>
  );
}
