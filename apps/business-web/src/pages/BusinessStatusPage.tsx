import { useBusinessAuth } from "../auth/BusinessAuthProvider";
import { StatePanel, StatusBadge } from "../components/BusinessUI";
import { BusinessInvitationNotice } from "./team/BusinessInvitationInboxPage";

export function BusinessStatusPage({ kind }: { kind: "pending" | "seller-suspended" | "store-suspended" | "no-permissions" }) {
  const { seller, store, businesses, currentBusiness, selectBusiness, logout } = useBusinessAuth();
  const content = {
    pending: {
      eyebrow: "Solicitud recibida",
      title: "Tu solicitud está en revisión",
      body: "Te avisaremos cuando la revisión haya terminado. Mientras tanto, las operaciones empresariales permanecen bloqueadas.",
      tone: "default" as const,
    },
    "seller-suspended": {
      eyebrow: "Acceso restringido",
      title: "Tu acceso como seller está suspendido",
      body: seller?.suspensionReason || "Las operaciones empresariales no están disponibles. Contacta con soporte de Nelyon para más información.",
      tone: "danger" as const,
    },
    "store-suspended": {
      eyebrow: "Tienda restringida",
      title: "Tu tienda está suspendida",
      body: "La identidad de tu cuenta permanece disponible, pero no puedes operar esta tienda mientras esté suspendida.",
      tone: "danger" as const,
    },
    "no-permissions": {
      eyebrow: "Acceso limitado",
      title: "Tu acceso no tiene permisos asignados",
      body: "Tu membership está activa, pero todavía no tiene capabilities efectivas. Contacta con el propietario del negocio.",
      tone: "warning" as const,
    },
  }[kind];

  return (
    <StatePanel {...content}>
      <div className="status-summary">
        <span>{store?.name ?? currentBusiness?.seller.displayName ?? seller?.displayName}</span>
        <StatusBadge status={store?.status ?? seller?.status ?? "pending"} />
      </div>
      {kind === "no-permissions" && businesses.length > 1 && (
        <label className="status-business-switcher">
          Cambiar de negocio
          <select
            aria-label="Cambiar de negocio"
            value={currentBusiness?.businessOwnerId ?? ""}
            onChange={(event) => selectBusiness(event.target.value)}
          >
            {businesses.map((business) => (
              <option key={business.businessOwnerId} value={business.businessOwnerId}>
                {business.store?.name ?? business.seller.displayName}
              </option>
            ))}
          </select>
        </label>
      )}
      <button className="secondary-button" type="button" onClick={() => void logout()}>
        Cerrar sesión
      </button>
      <BusinessInvitationNotice />
    </StatePanel>
  );
}
