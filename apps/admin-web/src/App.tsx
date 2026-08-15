import { Navigate, Route, Routes } from "react-router-dom";
import { AdminRoute } from "./auth/AdminRoute";
import { AdminShell } from "./layout/AdminShell";
import { LoginPage } from "./pages/LoginPage";
import { MarketplaceOrderDetailPage } from "./pages/MarketplaceOrderDetailPage";
import { MarketplaceOrdersPage } from "./pages/MarketplaceOrdersPage";
import { MarketplaceOverviewPage } from "./pages/MarketplaceOverviewPage";
import { MarketplaceDisputeDetailPage } from "./pages/MarketplaceDisputeDetailPage";
import { MarketplaceDisputesPage } from "./pages/MarketplaceDisputesPage";
import { MarketplaceProductDetailPage } from "./pages/MarketplaceProductDetailPage";
import { MarketplaceProductsPage } from "./pages/MarketplaceProductsPage";
import { MarketplaceSellerDetailPage } from "./pages/MarketplaceSellerDetailPage";
import { MarketplaceSellersPage } from "./pages/MarketplaceSellersPage";
import {
  MarketplaceActivityPage,
  MarketplaceAdDetailPage,
  MarketplaceAdsPage,
  MarketplaceCreatorCommercePage,
  MarketplaceCreatorDetailPage,
  MarketplaceHealthPage,
  MarketplacePromotionDetailPage,
  MarketplacePromotionsPage,
} from "./pages/MarketplaceIntelligencePages";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AdminRoute />}>
        <Route element={<AdminShell />}>
          <Route path="/marketplace" element={<MarketplaceOverviewPage />} />
          <Route
            path="/marketplace/orders"
            element={<MarketplaceOrdersPage />}
          />
          <Route
            path="/marketplace/orders/:orderId"
            element={<MarketplaceOrderDetailPage />}
          />
          <Route
            path="/marketplace/disputes"
            element={<MarketplaceDisputesPage />}
          />
          <Route
            path="/marketplace/disputes/:id"
            element={<MarketplaceDisputeDetailPage />}
          />
          <Route
            path="/marketplace/sellers"
            element={<MarketplaceSellersPage />}
          />
          <Route
            path="/marketplace/sellers/:id"
            element={<MarketplaceSellerDetailPage />}
          />
          <Route
            path="/marketplace/products"
            element={<MarketplaceProductsPage />}
          />
          <Route
            path="/marketplace/products/:id"
            element={<MarketplaceProductDetailPage />}
          />
          <Route
            path="/marketplace/creator-commerce"
            element={<MarketplaceCreatorCommercePage />}
          />
          <Route
            path="/marketplace/creator-commerce/:id"
            element={<MarketplaceCreatorDetailPage />}
          />
          <Route
            path="/marketplace/promotions"
            element={<MarketplacePromotionsPage />}
          />
          <Route
            path="/marketplace/promotions/:id"
            element={<MarketplacePromotionDetailPage />}
          />
          <Route path="/marketplace/ads" element={<MarketplaceAdsPage />} />
          <Route
            path="/marketplace/ads/:id"
            element={<MarketplaceAdDetailPage />}
          />
          <Route
            path="/marketplace/health"
            element={<MarketplaceHealthPage />}
          />
          <Route
            path="/marketplace/activity"
            element={<MarketplaceActivityPage />}
          />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/marketplace" replace />} />
    </Routes>
  );
}
