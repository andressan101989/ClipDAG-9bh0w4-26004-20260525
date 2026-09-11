import {Navigate,Route,Routes} from "react-router-dom";
import {AdminRoute} from "./auth/AdminRoute";
import {CapabilityRoute} from "./auth/CapabilityRoute";
import {useAdminAuth} from "./auth/AdminAuthProvider";
import {AdminShell} from "./layout/AdminShell";
import {LoginPage} from "./pages/LoginPage";
import {AdminUsersPage,AdminUserDetailPage} from "./pages/AdminUsersPages";
import {AdminReportsPage,AdminReportDetailPage} from "./pages/AdminReportsPages";
import {AdminAccessPage} from "./pages/AdminAccessPage";
import {AdminContentDetailPage,AdminContentPage} from "./pages/AdminContentPages";
import {AdminStoriesPage,AdminStoryDetailPage} from "./pages/AdminStoriesPages";
import {AdminChatReportDetailPage,AdminChatReportsPage} from "./pages/AdminChatReportPages";
import {MarketplaceOrderDetailPage} from "./pages/MarketplaceOrderDetailPage";
import {MarketplaceOrdersPage} from "./pages/MarketplaceOrdersPage";
import {MarketplaceOverviewPage} from "./pages/MarketplaceOverviewPage";
import {MarketplaceDisputeDetailPage} from "./pages/MarketplaceDisputeDetailPage";
import {MarketplaceDisputesPage} from "./pages/MarketplaceDisputesPage";
import {MarketplaceProductDetailPage} from "./pages/MarketplaceProductDetailPage";
import {MarketplaceProductsPage} from "./pages/MarketplaceProductsPage";
import {MarketplaceSellerDetailPage} from "./pages/MarketplaceSellerDetailPage";
import {MarketplaceSellersPage} from "./pages/MarketplaceSellersPage";
import {MarketplaceActivityPage,MarketplaceAdDetailPage,MarketplaceAdsPage,MarketplaceCreatorCommercePage,MarketplaceCreatorDetailPage,MarketplaceHealthPage,MarketplacePromotionDetailPage,MarketplacePromotionsPage} from "./pages/MarketplaceIntelligencePages";

function DefaultAdminRoute(){const {hasCapability}=useAdminAuth();const target=hasCapability("marketplace.overview.read")?"/marketplace":hasCapability("reports.cases.read")?"/reports":hasCapability("content.items.read")?"/content":hasCapability("stories.items.read")?"/stories":hasCapability("chat.abuse_reports.read")?"/chat/reports":hasCapability("users.accounts.read")?"/users":hasCapability("admin.roles.read")?"/access":null;return target?<Navigate to={target} replace/>:<main className="center-state"><div className="state-card"><h1>Sin módulos disponibles</h1><p>Tu acceso al shell no incluye todavía un módulo administrativo.</p></div></main>}

export function App(){return <Routes>
  <Route path="/login" element={<LoginPage/>}/>
  <Route element={<AdminRoute/>}><Route element={<AdminShell/>}>
    <Route index element={<DefaultAdminRoute/>}/>
    <Route element={<CapabilityRoute capability="users.accounts.read"/>}><Route path="/users" element={<AdminUsersPage/>}/><Route path="/users/:id" element={<AdminUserDetailPage/>}/></Route>
    <Route element={<CapabilityRoute capability="reports.cases.read"/>}><Route path="/reports" element={<AdminReportsPage/>}/><Route path="/reports/:id" element={<AdminReportDetailPage/>}/></Route>
    <Route element={<CapabilityRoute capability="content.items.read"/>}><Route path="/content" element={<AdminContentPage/>}/><Route path="/content/:type/:id" element={<AdminContentDetailPage/>}/></Route>
    <Route element={<CapabilityRoute capability="stories.items.read"/>}><Route path="/stories" element={<AdminStoriesPage/>}/><Route path="/stories/:id" element={<AdminStoryDetailPage/>}/></Route>
    <Route element={<CapabilityRoute capability="chat.abuse_reports.read"/>}><Route path="/chat/reports" element={<AdminChatReportsPage/>}/><Route path="/chat/reports/:id" element={<AdminChatReportDetailPage/>}/></Route>
    <Route element={<CapabilityRoute capability="admin.roles.read"/>}><Route path="/access" element={<AdminAccessPage/>}/></Route>
    <Route element={<CapabilityRoute capability="marketplace.overview.read"/>}><Route path="/marketplace" element={<MarketplaceOverviewPage/>}/></Route>
    <Route element={<CapabilityRoute capability="marketplace.orders.read"/>}><Route path="/marketplace/orders" element={<MarketplaceOrdersPage/>}/><Route path="/marketplace/orders/:orderId" element={<MarketplaceOrderDetailPage/>}/></Route>
    <Route element={<CapabilityRoute capability="marketplace.disputes.read"/>}><Route path="/marketplace/disputes" element={<MarketplaceDisputesPage/>}/><Route path="/marketplace/disputes/:id" element={<MarketplaceDisputeDetailPage/>}/></Route>
    <Route element={<CapabilityRoute capability="marketplace.sellers.read"/>}><Route path="/marketplace/sellers" element={<MarketplaceSellersPage/>}/><Route path="/marketplace/sellers/:id" element={<MarketplaceSellerDetailPage/>}/></Route>
    <Route element={<CapabilityRoute capability="marketplace.products.read"/>}><Route path="/marketplace/products" element={<MarketplaceProductsPage/>}/><Route path="/marketplace/products/:id" element={<MarketplaceProductDetailPage/>}/></Route>
    <Route element={<CapabilityRoute capability="marketplace.creators.read"/>}><Route path="/marketplace/creator-commerce" element={<MarketplaceCreatorCommercePage/>}/><Route path="/marketplace/creator-commerce/:id" element={<MarketplaceCreatorDetailPage/>}/></Route>
    <Route element={<CapabilityRoute capability="marketplace.promotions.read"/>}><Route path="/marketplace/promotions" element={<MarketplacePromotionsPage/>}/><Route path="/marketplace/promotions/:id" element={<MarketplacePromotionDetailPage/>}/></Route>
    <Route element={<CapabilityRoute capability="marketplace.ads.read"/>}><Route path="/marketplace/ads" element={<MarketplaceAdsPage/>}/><Route path="/marketplace/ads/:id" element={<MarketplaceAdDetailPage/>}/></Route>
    <Route element={<CapabilityRoute capability="marketplace.health.read"/>}><Route path="/marketplace/health" element={<MarketplaceHealthPage/>}/></Route>
    <Route element={<CapabilityRoute capability="marketplace.audit.read"/>}><Route path="/marketplace/activity" element={<MarketplaceActivityPage/>}/></Route>
    <Route path="*" element={<DefaultAdminRoute/>}/>
  </Route></Route>
  <Route path="*" element={<Navigate to="/" replace/>}/>
</Routes>}
