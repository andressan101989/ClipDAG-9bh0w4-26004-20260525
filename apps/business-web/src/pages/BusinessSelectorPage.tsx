import { useBusinessAuth } from "../auth/BusinessAuthProvider";
import { BrandMark, StatusBadge } from "../components/BusinessUI";

export function BusinessSelectorPage() {
  const { businesses, selectBusiness, logout } = useBusinessAuth();
  return (
    <main className="centered-page business-selector-page">
      <section className="business-selector-card">
        <BrandMark />
        <p className="eyebrow">Tus accesos</p>
        <h1>Selecciona un negocio</h1>
        <p className="state-copy">Elige el espacio en el que quieres trabajar. El servidor validará cada operación.</p>
        <div className="business-choice-list">
          {businesses.map((business) => (
            <button
              className="business-choice"
              key={business.businessOwnerId}
              type="button"
              onClick={() => selectBusiness(business.businessOwnerId)}
            >
              <span className="store-avatar" aria-hidden="true">
                {(business.store?.name ?? business.seller.displayName).slice(0, 1).toUpperCase()}
              </span>
              <span>
                <strong>{business.store?.name ?? business.seller.displayName}</strong>
                <small>{business.accessType === "owner" ? "Propietario" : "Miembro"}</small>
              </span>
              {business.store && <StatusBadge status={business.store.status} />}
            </button>
          ))}
        </div>
        <button className="text-button" type="button" onClick={() => void logout()}>Cerrar sesión</button>
      </section>
    </main>
  );
}
