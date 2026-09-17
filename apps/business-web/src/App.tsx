import { Navigate, Route, Routes } from "react-router-dom";
import { useBusinessAuth } from "./auth/BusinessAuthProvider";
import { StatePanel } from "./components/BusinessUI";
import { BusinessLayout } from "./layout/BusinessLayout";
import { BusinessDashboardPage, BusinessSettingsPage } from "./pages/BusinessDashboardPage";
import { BusinessLoginPage } from "./pages/BusinessLoginPage";
import { BusinessMediaPage } from "./pages/BusinessMediaPage";
import { BusinessOnboardingPage } from "./pages/BusinessOnboardingPage";
import { BusinessStatusPage } from "./pages/BusinessStatusPage";
import { BusinessStoreForm } from "./pages/BusinessStorePages";
import { BusinessSelectorPage } from "./pages/BusinessSelectorPage";
import { BusinessProductDetailPage } from "./pages/products/BusinessProductDetailPage";
import { BusinessProductsPage } from "./pages/products/BusinessProductsPage";
import { BusinessShippingPage } from "./pages/products/BusinessShippingPage";
import { BusinessOrderDetailPage } from "./pages/orders/BusinessOrderDetailPage";
import { BusinessOrdersPage } from "./pages/orders/BusinessOrdersPage";
import { BusinessAdsPage } from "./pages/ads/BusinessAdsPage";
import { BusinessAdCreatePage } from "./pages/ads/BusinessAdCreatePage";
import { BusinessAdDetailPage } from "./pages/ads/BusinessAdDetailPage";
import { BusinessFinancePage } from "./pages/finance/BusinessFinancePage";
import { BusinessPayoutsPage } from "./pages/finance/BusinessPayoutsPage";

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

function BusinessMediaRoute() {
  const { hasCapability } = useBusinessAuth();
  return hasCapability("business.media.read") || hasCapability("business.media.manage")
    ? <BusinessMediaPage />
    : <Navigate to="/" replace />;
}

function BusinessProductsRoute({ detail = false, shipping = false }: { detail?: boolean; shipping?: boolean }) {
  const { hasCapability } = useBusinessAuth();
  if (!hasCapability("business.catalog.read") && !hasCapability("business.catalog.manage")) return <Navigate to="/" replace />;
  if (shipping) return <BusinessShippingPage />;
  return detail ? <BusinessProductDetailPage /> : <BusinessProductsPage />;
}

function BusinessOrdersRoute({ detail = false }: { detail?: boolean }) {
  const { hasCapability } = useBusinessAuth();
  const allowed = hasCapability("business.orders.read") || hasCapability("business.orders.fulfill")
    || hasCapability("business.returns.read") || hasCapability("business.returns.manage")
    || hasCapability("business.disputes.read") || hasCapability("business.disputes.respond");
  if (!allowed) return <Navigate to="/" replace />;
  return detail ? <BusinessOrderDetailPage /> : <BusinessOrdersPage />;
}

function BusinessAdsRoute({ detail = false, create = false }: { detail?: boolean; create?: boolean }) {
  const { hasCapability } = useBusinessAuth();
  const canRead = hasCapability("business.ads.read") || hasCapability("business.ads.manage");
  if (!canRead) return <Navigate to="/" replace />;
  if (create && !hasCapability("business.ads.manage")) return <Navigate to="/ads" replace />;
  if (create) return <BusinessAdCreatePage />;
  return detail ? <BusinessAdDetailPage /> : <BusinessAdsPage />;
}

function BusinessFinanceRoute() {
  const { hasCapability } = useBusinessAuth();
  if (hasCapability("business.finance.read")) return <BusinessFinancePage />;
  if (hasCapability("business.payouts.read") || hasCapability("business.payouts.manage")) return <Navigate to="/finance/payouts" replace />;
  return <Navigate to="/" replace />;
}

function BusinessPayoutsRoute() {
  const { hasCapability } = useBusinessAuth();
  return hasCapability("business.payouts.read") || hasCapability("business.payouts.manage")
    ? <BusinessPayoutsPage />
    : <Navigate to="/finance" replace />;
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
        <Route path="media" element={<BusinessMediaRoute />} />
        <Route path="products" element={<BusinessProductsRoute />} />
        <Route path="products/shipping" element={<BusinessProductsRoute shipping />} />
        <Route path="products/:productId" element={<BusinessProductsRoute detail />} />
        <Route path="orders" element={<BusinessOrdersRoute />} />
        <Route path="orders/:orderId" element={<BusinessOrdersRoute detail />} />
        <Route path="ads" element={<BusinessAdsRoute />} />
        <Route path="ads/new" element={<BusinessAdsRoute create />} />
        <Route path="ads/:campaignId" element={<BusinessAdsRoute detail />} />
        <Route path="finance" element={<BusinessFinanceRoute />} />
        <Route path="finance/payouts" element={<BusinessPayoutsRoute />} />
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
