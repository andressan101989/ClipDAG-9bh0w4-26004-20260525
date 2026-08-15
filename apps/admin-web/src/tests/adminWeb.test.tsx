import { fireEvent,render,screen,waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter,Route,Routes } from "react-router-dom";
import { beforeEach,describe,expect,it,vi } from "vitest";
import { AdminRoute } from "../auth/AdminRoute";
import { useAdminAuth } from "../auth/AdminAuthProvider";
import { getOrderDetail,getOverview,searchOrders } from "../lib/adminApi";
import { LoginPage } from "../pages/LoginPage";
import { MarketplaceOrderDetailPage } from "../pages/MarketplaceOrderDetailPage";
import { MarketplaceOrdersPage } from "../pages/MarketplaceOrdersPage";
import { MarketplaceOverviewPage } from "../pages/MarketplaceOverviewPage";

vi.mock("../auth/AdminAuthProvider",()=>({useAdminAuth:vi.fn()}));
vi.mock("../lib/supabase",()=>({supabase:{rpc:vi.fn(),auth:{getSession:vi.fn(),onAuthStateChange:vi.fn(),signInWithPassword:vi.fn(),signOut:vi.fn()}}}));
vi.mock("../lib/adminApi",async(importOriginal)=>{const original=await importOriginal<typeof import("../lib/adminApi")>();return{...original,getOverview:vi.fn(),searchOrders:vi.fn(),getOrderDetail:vi.fn()};});
const auth=vi.mocked(useAdminAuth),overview=vi.mocked(getOverview),orders=vi.mocked(searchOrders),detail=vi.mocked(getOrderDetail);
const admin={user_id:"10000000-0000-4000-8000-000000000001",username:"ops",display_name:"Ops",admin:true as const,capabilities:["marketplace:read"]};
const baseAuth={loading:false,session:{user:{id:admin.user_id}} as never,admin,denied:false,error:null,login:vi.fn(),logout:vi.fn(),retry:vi.fn()};

beforeEach(()=>{vi.clearAllMocks();auth.mockReturnValue(baseAuth);});

describe("authentication boundary",()=>{
  it("renders and submits the email/password login form",async()=>{const login=vi.fn().mockResolvedValue(undefined);auth.mockReturnValue({...baseAuth,session:null,admin:null,login});render(<MemoryRouter><LoginPage/></MemoryRouter>);await userEvent.type(screen.getByLabelText("Correo"),"admin@onspace.test");await userEvent.type(screen.getByLabelText("Contraseña"),"secret");await userEvent.click(screen.getByRole("button",{name:"Ingresar"}));expect(login).toHaveBeenCalledWith("admin@onspace.test","secret");});
  it("redirects an anonymous visitor to login",()=>{auth.mockReturnValue({...baseAuth,session:null,admin:null});render(<MemoryRouter initialEntries={["/marketplace"]}><Routes><Route path="/login" element={<p>login destination</p>}/><Route element={<AdminRoute/>}><Route path="/marketplace" element={<p>private</p>}/></Route></Routes></MemoryRouter>);expect(screen.getByText("login destination")).toBeInTheDocument();});
  it("shows access denied for an authenticated non-admin",()=>{auth.mockReturnValue({...baseAuth,admin:null,denied:true,error:"marketplace_admin_forbidden"});render(<MemoryRouter><Routes><Route element={<AdminRoute/>}><Route index element={<p>private</p>}/></Route></Routes></MemoryRouter>);expect(screen.getByText("Acceso restringido")).toBeInTheDocument();expect(screen.queryByText("private")).not.toBeInTheDocument();});
  it("renders the protected outlet for an authorized admin",()=>{render(<MemoryRouter><Routes><Route element={<AdminRoute/>}><Route index element={<p>admin content</p>}/></Route></Routes></MemoryRouter>);expect(screen.getByText("admin content")).toBeInTheDocument();});
  it("logs out from the denied state",async()=>{const logout=vi.fn().mockResolvedValue(undefined);auth.mockReturnValue({...baseAuth,admin:null,denied:true,error:"forbidden",logout});render(<MemoryRouter><Routes><Route element={<AdminRoute/>}><Route index element={<p>private</p>}/></Route></Routes></MemoryRouter>);await userEvent.click(screen.getByRole("button",{name:"Cerrar sesión"}));expect(logout).toHaveBeenCalledOnce();});
});

const overviewPayload={range:"30d" as const,generated_at:"2026-08-14T12:00:00Z",commerce:{orders:4,paid_orders:3,paid_gmv:"100.00000000",units:5,pending_fulfillment:1,shipped:1,delivered:1,refunded_orders:1,reversed_orders:1,reversed_gross:"20.00000000"},sellers:{approved:2,active_stores:2},products:{active_published:8,requiring_attention:1},creator_commerce:{attributed_orders:2,attributed_gmv:"70.00000000",commission_generated:"7.00000000",commission_released:"7.00000000",commission_reversed:"2.00000000",commission_net:"5.00000000"},operations:{open_disputes:1,held_allocations:1}};
describe("Marketplace overview",()=>{
  it("renders canonical metrics and changes server range",async()=>{overview.mockResolvedValue(overviewPayload);render(<MarketplaceOverviewPage/>);expect(await screen.findByText("100.00000000 BDAG")).toBeInTheDocument();await userEvent.click(screen.getByRole("button",{name:"7D"}));await waitFor(()=>expect(overview).toHaveBeenLastCalledWith("7d"));});
  it("shows an RPC error and retry action",async()=>{overview.mockRejectedValue(new Error("network"));render(<MarketplaceOverviewPage/>);expect(await screen.findByText("No se pudo cargar")).toBeInTheDocument();expect(screen.getByRole("button",{name:"Reintentar"})).toBeInTheDocument();});
});

const order={id:"20000000-0000-4000-8000-000000000001",order_number:"ORD-1",created_at:"2026-08-14T12:00:00Z",status:"confirmed",currency:"BDAG",amount:"30.00000000",buyer_name:"Buyer",seller_name:"Seller",store_id:"30000000-0000-4000-8000-000000000001",store_name:"Store",item_count:1,payment_status:"paid",fulfillment_status:null,settlement_status:null,dispute_open:false,reversed:false,creator_commerce:true,source_surfaces:["feed"]};
describe("Marketplace orders",()=>{
  it("loads a bounded order page and preserves filters in URL state",async()=>{orders.mockResolvedValue({range:"30d",orders:[order],next_cursor:null,page_size:1});render(<MemoryRouter initialEntries={["/marketplace/orders?status=confirmed&range=30d"]}><MarketplaceOrdersPage/></MemoryRouter>);expect(await screen.findByText("ORD-1")).toBeInTheDocument();expect(orders).toHaveBeenCalledWith(expect.objectContaining({status:"confirmed",range:"30d",limit:50}));});
  it("renders an empty result state",async()=>{orders.mockResolvedValue({range:"30d",orders:[],next_cursor:null,page_size:0});render(<MemoryRouter><MarketplaceOrdersPage/></MemoryRouter>);expect(await screen.findByText("Sin resultados")).toBeInTheDocument();});
  it("submits search text without exposing session data",async()=>{orders.mockResolvedValue({range:"30d",orders:[],next_cursor:null,page_size:0});render(<MemoryRouter><MarketplaceOrdersPage/></MemoryRouter>);const input=screen.getByLabelText("Buscar pedidos");fireEvent.change(input,{target:{value:"ORD-2"}});fireEvent.submit(input.closest("form")!);await waitFor(()=>expect(orders).toHaveBeenCalledWith(expect.objectContaining({query:"ORD-2"})));});
});

describe("order detail",()=>{
  it("renders item-level creator, payment, settlement, reversal, and timeline facts",async()=>{detail.mockResolvedValue({order:{id:order.id,order_number:"ORD-1",status:"delivered",currency:"BDAG",total:"100",created_at:"2026-08-14T12:00:00Z"},buyer:{display_name:"Buyer"},seller:{display_name:"Seller"},store:{name:"Store"},items:[{id:"item",product_title:"Product",sku:"SKU",quantity:1,line_total:"100",creator:{creator_display_name:"Creator",source_surface:"live",item_gmv:"100",allocation_amount:"7"}}],payment:{status:"paid",gross_amount:"100",paid_at:"2026-08-14T12:00:00Z"},payment_allocation:{status:"released"},shipping:{shipment:{status:"delivered"}},creator_attributions:[],creator_allocations:[{id:"allocation",creator_user_id:"creator",order_item_id:"item",item_gmv:"100",commission_amount:"7"}],settlement:{status:"completed",seller_net_amount:"83",platform_fee_amount:"10",creator_commission_amount:"7"},settlement_legs:[],dispute:{status:"resolved",reason_code:"other"},reversal:{gross_amount:"100",created_at:"2026-08-14T13:00:00Z"},reversal_legs:[],timeline:[{id:"event",event_type:"delivery_confirmed",created_at:"2026-08-14T12:30:00Z"}]});render(<MemoryRouter initialEntries={[`/marketplace/orders/${order.id}`]}><Routes><Route path="/marketplace/orders/:orderId" element={<MarketplaceOrderDetailPage/>}/></Routes></MemoryRouter>);expect(await screen.findByText("Product")).toBeInTheDocument();expect(screen.getByText("Origen: live")).toBeInTheDocument();expect(screen.getByText("Liquidación")).toBeInTheDocument();expect(screen.getByText("Disputa / reversión")).toBeInTheDocument();});
});
