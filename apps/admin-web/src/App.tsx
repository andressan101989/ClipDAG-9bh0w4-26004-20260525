import { Navigate,Route,Routes } from "react-router-dom";
import { AdminRoute } from "./auth/AdminRoute";
import { AdminShell } from "./layout/AdminShell";
import { LoginPage } from "./pages/LoginPage";
import { MarketplaceOrderDetailPage } from "./pages/MarketplaceOrderDetailPage";
import { MarketplaceOrdersPage } from "./pages/MarketplaceOrdersPage";
import { MarketplaceOverviewPage } from "./pages/MarketplaceOverviewPage";

export function App(){return <Routes><Route path="/login" element={<LoginPage/>}/><Route element={<AdminRoute/>}><Route element={<AdminShell/>}><Route path="/marketplace" element={<MarketplaceOverviewPage/>}/><Route path="/marketplace/orders" element={<MarketplaceOrdersPage/>}/><Route path="/marketplace/orders/:orderId" element={<MarketplaceOrderDetailPage/>}/></Route></Route><Route path="*" element={<Navigate to="/marketplace" replace/>}/></Routes>}
