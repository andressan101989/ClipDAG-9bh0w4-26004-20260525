import { useBusinessAuth } from "../auth/BusinessAuthProvider";
import { StatePanel, StatusBadge } from "../components/BusinessUI";

export function BusinessStatusPage({ kind }: { kind: "pending" | "seller-suspended" | "store-suspended" }) {
  const { seller, store, logout } = useBusinessAuth();
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
  }[kind];

  return (
    <StatePanel {...content}>
      <div className="status-summary">
        <span>{store?.name ?? seller?.displayName}</span>
        <StatusBadge status={store?.status ?? seller?.status ?? "pending"} />
      </div>
      <button className="secondary-button" type="button" onClick={() => void logout()}>
        Cerrar sesión
      </button>
    </StatePanel>
  );
}
