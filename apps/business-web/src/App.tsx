import { Navigate, Route, Routes } from "react-router-dom";
import { useBusinessAuth } from "./auth/BusinessAuthProvider";
import { StatePanel } from "./components/BusinessUI";
import { BusinessLayout } from "./layout/BusinessLayout";
import { BusinessDashboardPage, BusinessSettingsPage } from "./pages/BusinessDashboardPage";
import { BusinessLoginPage } from "./pages/BusinessLoginPage";
import { BusinessOnboardingPage } from "./pages/BusinessOnboardingPage";
import { BusinessStatusPage } from "./pages/BusinessStatusPage";
import { BusinessStoreForm } from "./pages/BusinessStorePages";
import { BusinessSelectorPage } from "./pages/BusinessSelectorPage";

function BusinessHomeRoute() {
  const { hasCapability } = useBusinessAuth();
  if (hasCapability("business.home.read")) return <BusinessDashboardPage />;
  if (hasCapability("business.store.read") || hasCapability("business.store.manage")) {
    return <Navigate to="/store" replace />;
  }
  return <BusinessStatusPage kind="no-permissions" />;
}

function BusinessStoreRoute() {
  const { hasCapability } = useBusinessAuth();
  if (!hasCapability("business.store.read") && !hasCapability("business.store.manage")) {
    return <Navigate to="/" replace />;
  }
  return <BusinessStoreForm />;
}

function BusinessSettingsRoute() {
  const { hasCapability } = useBusinessAuth();
  return hasCapability("business.settings.manage")
    ? <BusinessSettingsPage />
    : <Navigate to="/" replace />;
}

function LifecycleBoundary() {
  const { phase, error, retry } = useBusinessAuth();
  if (phase === "loading") return <StatePanel eyebrow="Nelyon Business" title="Cargando tu espacio…" body="Estamos validando tu identidad empresarial." />;
  if (phase === "error") return <StatePanel tone="warning" eyebrow="No pudimos continuar" title="Error al cargar Business" body={error ?? "Inténtalo nuevamente."}><button className="primary-button" type="button" onClick={() => void retry()}>Reintentar</button></StatePanel>;
  if (phase === "signed_out") return <Navigate to="/login" replace />;
  if (phase === "no_seller") return <BusinessOnboardingPage />;
  if (phase === "seller_pending") return <BusinessStatusPage kind="pending" />;
  if (phase === "seller_rejected") return <BusinessOnboardingPage rejected />;
  if (phase === "seller_suspended") return <BusinessStatusPage kind="seller-suspended" />;
  if (phase === "select_business") return <BusinessSelectorPage />;
  if (phase === "no_permissions") return <BusinessStatusPage kind="no-permissions" />;
  if (phase === "approved_no_store") return <BusinessStoreForm setup />;
  if (phase === "store_draft") return <BusinessStoreForm />;
  if (phase === "store_suspended") return <BusinessStatusPage kind="store-suspended" />;

  return (
    <Routes>
      <Route element={<BusinessLayout />}>
        <Route index element={<BusinessHomeRoute />} />
        <Route path="store" element={<BusinessStoreRoute />} />
        <Route path="settings" element={<BusinessSettingsRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<BusinessLoginPage />} />
      <Route path="/*" element={<LifecycleBoundary />} />
    </Routes>
  );
}
