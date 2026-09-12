import {render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {MemoryRouter,Route,Routes} from "react-router-dom";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {useAdminAuth} from "../auth/AdminAuthProvider";
import {CapabilityRoute} from "../auth/CapabilityRoute";
import {AdminShell} from "../layout/AdminShell";
import {AdminOverviewPage} from "../pages/AdminOverviewPage";
import {getOverview} from "../lib/adminApi";
import {searchActivity} from "../lib/adminIntelligenceApi";
import {getAdminFinanceOverview,getAdminSystemHealth,searchAdminGlobalAudit,searchAdminSystemJobs} from "../lib/adminObservabilityApi";

vi.mock("../auth/AdminAuthProvider",()=>({useAdminAuth:vi.fn()}));
vi.mock("../lib/adminApi",()=>({getOverview:vi.fn(),formatDate:(value:unknown)=>String(value)}));
vi.mock("../lib/adminIntelligenceApi",()=>({searchActivity:vi.fn()}));
vi.mock("../lib/adminObservabilityApi",()=>({getAdminFinanceOverview:vi.fn(),getAdminSystemHealth:vi.fn(),searchAdminGlobalAudit:vi.fn(),searchAdminSystemJobs:vi.fn()}));

const access=(capabilities:string[],roles=["MARKETPLACE_ADMIN"])=>({
  loading:false,session:{user:{id:"10000000-0000-4000-8000-000000000001"}} as never,
  admin:{user_id:"10000000-0000-4000-8000-000000000001",username:"ops",display_name:"Marketplace Ops",avatar_url:null,admin:true,roles,capabilities,authority_version:"a1b2c3d4"},
  denied:false,error:null,login:vi.fn(),logout:vi.fn(),retry:vi.fn(),hasCapability:(capability:string)=>capabilities.includes(capability),
});

beforeEach(()=>{vi.clearAllMocks();vi.mocked(useAdminAuth).mockReturnValue(access(["admin.shell.access"]) as never);vi.mocked(getAdminFinanceOverview).mockResolvedValue({financial_transaction_count:921,ledger_account_count:131,ledger_entry_count:1896,frozen_account_count:0,marketplace_settlement_count:34,marketplace_refund_count:4,transactions_by_status:[]});vi.mocked(getAdminSystemHealth).mockResolvedValue({cron:{active_jobs:11,total_jobs:12,runs_24h:10,non_successes_24h:0},live_battles:{active_live_sessions:0,open_battles:0}});vi.mocked(searchAdminGlobalAudit).mockResolvedValue({items:[],next_cursor:null});vi.mocked(searchAdminSystemJobs).mockResolvedValue({items:[]});vi.mocked(searchActivity).mockResolvedValue({items:[],nextCursor:null,pageSize:0});});

describe("SUPERUSER-UI-FINAL",()=>{
  it("protects /overview with admin.shell.access",()=>{vi.mocked(useAdminAuth).mockReturnValue(access([]) as never);render(<MemoryRouter initialEntries={["/overview"]}><Routes><Route element={<CapabilityRoute capability="admin.shell.access"/>}><Route path="/overview" element={<AdminOverviewPage/>}/></Route></Routes></MemoryRouter>);expect(screen.getByText("Acceso restringido")).toBeInTheDocument();expect(screen.queryByText("Good to see you")).not.toBeInTheDocument()});

  it("does not fetch any unauthorized overview domain",async()=>{render(<MemoryRouter><AdminOverviewPage/></MemoryRouter>);await waitFor(()=>expect(screen.getByText("No hay métricas adicionales autorizadas para este acceso.")).toBeInTheDocument());expect(getOverview).not.toHaveBeenCalled();expect(getAdminFinanceOverview).not.toHaveBeenCalled();expect(getAdminSystemHealth).not.toHaveBeenCalled();expect(searchAdminGlobalAudit).not.toHaveBeenCalled();expect(searchAdminSystemJobs).not.toHaveBeenCalled();expect(searchActivity).not.toHaveBeenCalled()});

  it("fetches finance without crossing into system, audit, or Marketplace",async()=>{vi.mocked(useAdminAuth).mockReturnValue(access(["admin.shell.access","finance.ledger.read"],["FINANCE_AUDITOR"]) as never);render(<MemoryRouter><AdminOverviewPage/></MemoryRouter>);expect(await screen.findByText("921")).toBeInTheDocument();expect(getAdminFinanceOverview).toHaveBeenCalledOnce();expect(getAdminSystemHealth).not.toHaveBeenCalled();expect(searchAdminGlobalAudit).not.toHaveBeenCalled();expect(searchAdminSystemJobs).not.toHaveBeenCalled();expect(getOverview).not.toHaveBeenCalled()});

  it("uses the effective role and never invents SUPER_ADMIN or SUPERUSER",()=>{vi.mocked(useAdminAuth).mockReturnValue(access(["admin.shell.access","marketplace.overview.read"]) as never);render(<MemoryRouter initialEntries={["/overview"]}><Routes><Route element={<AdminShell/>}><Route path="/overview" element={<p>Dashboard</p>}/></Route></Routes></MemoryRouter>);expect(screen.getAllByText("MARKETPLACE_ADMIN").length).toBeGreaterThan(0);expect(screen.queryByText("SUPER_ADMIN")).not.toBeInTheDocument();expect(screen.queryByText("SUPERUSER")).not.toBeInTheDocument()});

  it("searches only authorized routes",async()=>{vi.mocked(useAdminAuth).mockReturnValue(access(["admin.shell.access","marketplace.overview.read","marketplace.orders.read"]) as never);render(<MemoryRouter initialEntries={["/overview"]}><Routes><Route element={<AdminShell/>}><Route path="/overview" element={<p>Dashboard</p>}/></Route></Routes></MemoryRouter>);const search=screen.getByRole("textbox",{name:"Buscar módulos y secciones"});await userEvent.type(search,"Finance");expect(screen.queryByRole("listbox")).not.toBeInTheDocument();await userEvent.clear(search);await userEvent.type(search,"Marketplace");const results=screen.getByRole("listbox",{name:"Rutas autorizadas"});expect(results).toHaveTextContent("Marketplace · Orders");expect(results).not.toHaveTextContent("Marketplace · Disputes")});

  it("exposes an accessible responsive drawer and closes it with Escape",async()=>{render(<MemoryRouter initialEntries={["/overview"]}><Routes><Route element={<AdminShell/>}><Route path="/overview" element={<p>Dashboard</p>}/></Route></Routes></MemoryRouter>);const toggle=screen.getByRole("button",{name:"Abrir navegación"});expect(toggle).toHaveAttribute("aria-controls","admin-navigation");expect(toggle).toHaveAttribute("aria-expanded","false");await userEvent.click(toggle);expect(toggle).toHaveAttribute("aria-expanded","true");await userEvent.keyboard("{Escape}");expect(toggle).toHaveAttribute("aria-expanded","false")});
});
