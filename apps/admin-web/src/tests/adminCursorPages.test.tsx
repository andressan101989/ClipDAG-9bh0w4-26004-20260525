import {act,fireEvent,render,screen,waitFor,cleanup} from "@testing-library/react";
import {MemoryRouter,useLocation,useNavigate} from "react-router-dom";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import * as api from "../lib/adminApi";
import * as obs from "../lib/adminObservabilityApi";
import {AdminUsersPage} from "../pages/AdminUsersPages";
import {AdminContentPage} from "../pages/AdminContentPages";
import {AdminStoriesPage} from "../pages/AdminStoriesPages";
import {AdminReportsPage} from "../pages/AdminReportsPages";
import {AdminChatReportsPage} from "../pages/AdminChatReportPages";
import {AdminLivePage} from "../pages/AdminLivePages";
import {AdminBattlesPage} from "../pages/AdminBattlePages";
import {AdminMediaPage} from "../pages/AdminMediaPages";
import {AdminAccessPage} from "../pages/AdminAccessPage";
import {AdminLedgerAccountsPage,AdminFinancialTransactionsPage,AdminFinanceAuditPage,AdminGlobalAuditPage,AdminSystemAuditPage} from "../pages/AdminFinanceAuditSystemPages";
vi.mock("../auth/AdminAuthProvider",()=>({useAdminAuth:()=>({session:{user:{id:"actor"}},hasCapability:()=>false})}));
vi.mock("../lib/adminApi",async original=>({...await original<typeof import("../lib/adminApi")>(),searchAdminUsers:vi.fn(),searchAdminContent:vi.fn(),searchAdminStories:vi.fn(),searchAdminReports:vi.fn(),searchAdminLiveSessions:vi.fn(),searchAdminLiveBattles:vi.fn(),searchAdminMediaAssets:vi.fn(),searchAdminRoleAssignments:vi.fn(),getAdminRoleCatalog:vi.fn()}));
vi.mock("../lib/adminObservabilityApi",async original=>({...await original<typeof import("../lib/adminObservabilityApi")>(),searchAdminLedgerAccounts:vi.fn(),searchAdminFinancialTransactions:vi.fn(),searchAdminFinanceAudit:vi.fn(),searchAdminGlobalAudit:vi.fn(),searchAdminSystemAudit:vi.fn()}));
const cursor={created_at:"2026-10-01T00:00:00Z",id:"11111111-1111-4111-8111-111111111111"};
const surfaces=[
 ["Users",AdminUsersPage,api.searchAdminUsers,"cursor"], ["Content",AdminContentPage,api.searchAdminContent,"cursor"], ["Stories",AdminStoriesPage,api.searchAdminStories,"cursor"], ["Reports",AdminReportsPage,api.searchAdminReports,"cursor"], ["Chat",AdminChatReportsPage,api.searchAdminReports,"cursor"], ["LIVE",AdminLivePage,api.searchAdminLiveSessions,"cursor"], ["Battles",AdminBattlesPage,api.searchAdminLiveBattles,"cursor"], ["Media",AdminMediaPage,api.searchAdminMediaAssets,"cursor"], ["Access",AdminAccessPage,api.searchAdminRoleAssignments,"cursor"], ["Accounts",AdminLedgerAccountsPage,obs.searchAdminLedgerAccounts,"rpc"], ["Transactions",AdminFinancialTransactionsPage,obs.searchAdminFinancialTransactions,"rpc"], ["Finance audit",AdminFinanceAuditPage,obs.searchAdminFinanceAudit,"rpc"], ["Global audit",AdminGlobalAuditPage,obs.searchAdminGlobalAudit,"rpc"], ["System audit",AdminSystemAuditPage,obs.searchAdminSystemAudit,"rpc"],
] as const;
beforeEach(()=>{vi.resetAllMocks();vi.mocked(api.getAdminRoleCatalog).mockResolvedValue([])});
afterEach(()=>{cleanup();vi.useRealTimers()});
it.each(surfaces)("%s consumes bounded cursor pages and can go back from an empty terminal page",async(_name,Page,read,shape)=>{
 const pageCursor=_name==="LIVE"?{started_at:cursor.created_at,id:cursor.id}:cursor;
 vi.mocked(read).mockResolvedValueOnce({items:[],next_cursor:pageCursor} as never).mockResolvedValueOnce({items:[],next_cursor:null} as never).mockResolvedValueOnce({items:[],next_cursor:pageCursor} as never);
 render(<MemoryRouter><Page/></MemoryRouter>);
 fireEvent.click(await screen.findByRole("button",{name:"Página siguiente"}));
 await waitFor(()=>expect(read).toHaveBeenCalledTimes(2));
 const second=vi.mocked(read).mock.calls[1][0];
 expect(second).toMatchObject(shape==="rpc"?{p_cursor_created_at:cursor.created_at,p_cursor_id:cursor.id,p_limit:50}:{cursor:pageCursor,limit:50});
 await waitFor(()=>expect(screen.getByRole("button",{name:"Página siguiente"})).toBeDisabled());
 fireEvent.click(screen.getByRole("button",{name:"Página anterior"}));
 await waitFor(()=>expect(read).toHaveBeenCalledTimes(3));
 expect(vi.mocked(read).mock.calls[2][0]).toMatchObject(shape==="rpc"?{p_cursor_created_at:null,p_cursor_id:null,p_limit:50}:{cursor:undefined,limit:50});
 expect(screen.getByText("Página 1")).toBeInTheDocument();
});
function Location(){const location=useLocation(),navigate=useNavigate();return <><output aria-label="URL">{location.search}</output><button onClick={()=>navigate("/detail")}>Detail</button><button onClick={()=>navigate(-1)}>Back</button>{location.pathname!=="/detail"&&<AdminUsersPage/>}</>}
it("restores URL filters across detail/back and debounces text before bounded reads",async()=>{
 vi.mocked(api.searchAdminUsers).mockResolvedValue({items:[],next_cursor:null});
 render(<MemoryRouter initialEntries={["/users?query=Alice&status=suspended"]}><Location/></MemoryRouter>);
 const input=await screen.findByLabelText("Buscar usuarios");expect(input).toHaveValue("Alice");
 await waitFor(()=>expect(api.searchAdminUsers).toHaveBeenCalledWith(expect.objectContaining({query:"Alice",status:"suspended",limit:50})));
 vi.useFakeTimers();fireEvent.change(input,{target:{value:"Bob"}});fireEvent.change(input,{target:{value:"Bobby"}});
 expect(api.searchAdminUsers).toHaveBeenCalledTimes(1);await act(async()=>{vi.advanceTimersByTime(300)});expect(api.searchAdminUsers).toHaveBeenCalledTimes(2);
 vi.useRealTimers();fireEvent.click(screen.getByText("Detail"));fireEvent.click(screen.getByText("Back"));expect(await screen.findByLabelText("Buscar usuarios")).toHaveValue("Bobby");
});
it("does not render stale Users responses after a filter edit and retries the current page",async()=>{
 let resolve!:(value:Awaited<ReturnType<typeof api.searchAdminUsers>>)=>void;
 vi.mocked(api.searchAdminUsers).mockImplementationOnce(()=>new Promise(r=>{resolve=r})).mockRejectedValueOnce(new Error("Current read failed")).mockResolvedValue({items:[],next_cursor:null});
 render(<MemoryRouter><AdminUsersPage/></MemoryRouter>);await waitFor(()=>expect(api.searchAdminUsers).toHaveBeenCalledTimes(1));
 fireEvent.change(screen.getByLabelText("Buscar usuarios"),{target:{value:"fresh"}});
 await act(async()=>resolve({items:[],next_cursor:cursor}));
 expect(screen.queryByText("Sin usuarios")).not.toBeInTheDocument();
 await screen.findByText("Current read failed");fireEvent.click(screen.getByRole("button",{name:/Reintentar/}));await screen.findByText("Sin usuarios");
 expect(vi.mocked(api.searchAdminUsers).mock.calls.at(-1)?.[0]).toMatchObject({query:"fresh",cursor:undefined,limit:50});
});
it("Access distinguishes an empty authoritative assignments page",async()=>{
 vi.mocked(api.searchAdminRoleAssignments).mockResolvedValue({items:[],next_cursor:null});render(<MemoryRouter><AdminAccessPage/></MemoryRouter>);expect(await screen.findByText("Sin asignaciones")).toBeInTheDocument();
});
it.each([
 [AdminUsersPage,api.searchAdminUsers,"Buscar usuarios","query","seed","query"],
 [AdminContentPage,api.searchAdminContent,"Buscar contenido","query","seed","query"],
 [AdminStoriesPage,api.searchAdminStories,"Buscar Stories","query","seed","query"],
 [AdminReportsPage,api.searchAdminReports,"Buscar reportes","query","seed","query"],
 [AdminLivePage,api.searchAdminLiveSessions,"Buscar LIVE","query","seed","query"],
 [AdminBattlesPage,api.searchAdminLiveBattles,"Buscar Battles","query","seed","query"],
 [AdminMediaPage,api.searchAdminMediaAssets,"Buscar asset","query","seed","query"],
 [AdminLedgerAccountsPage,obs.searchAdminLedgerAccounts,"Tipo de cuenta","accountType","seed","p_account_type"],
 [AdminFinancialTransactionsPage,obs.searchAdminFinancialTransactions,"Tipo de operación","operation","seed","p_operation_type"],
 [AdminFinanceAuditPage,obs.searchAdminFinanceAudit,"Acción audit","action","seed","p_action"],
 [AdminGlobalAuditPage,obs.searchAdminGlobalAudit,"Acción audit","action","seed","p_action"],
 [AdminSystemAuditPage,obs.searchAdminSystemAudit,"Acción audit","action","seed","p_action"],
] as const)("restores and debounces %s material URL input %s",async(Page,read,label,param,seed,arg)=>{
 vi.mocked(read).mockResolvedValue({items:[],next_cursor:null} as never);render(<MemoryRouter initialEntries={[`/?${param}=${seed}`]}><Page/></MemoryRouter>);const input=screen.getByLabelText(label);expect(input).toHaveValue("seed");await waitFor(()=>expect(read).toHaveBeenCalledTimes(1));
 vi.useFakeTimers();fireEvent.change(input,{target:{value:"next"}});fireEvent.change(input,{target:{value:"final"}});expect(read).toHaveBeenCalledTimes(1);await act(async()=>vi.advanceTimersByTime(300));expect(read).toHaveBeenCalledTimes(2);expect(vi.mocked(read).mock.calls[1][0]).toMatchObject({[arg]:"final"});
});
it("renders only one bounded Users page rather than accumulating earlier rows",async()=>{
 const user={id:"11111111-1111-4111-8111-111111111111",username:"first-user",display_name:"First user",avatar_url:null,created_at:"2026-10-01",last_sign_in_at:null,account_status:"active",active_warning_count:0};
 vi.mocked(api.searchAdminUsers).mockResolvedValueOnce({items:[user],next_cursor:cursor} as never).mockResolvedValueOnce({items:[{...user,id:"22222222-2222-4222-8222-222222222222",display_name:"Second user"}],next_cursor:null} as never);
 render(<MemoryRouter><AdminUsersPage/></MemoryRouter>);await screen.findByText("First user");fireEvent.click(screen.getByRole("button",{name:"Página siguiente"}));await screen.findByText("Second user");expect(screen.queryByText("First user")).not.toBeInTheDocument();expect(screen.getAllByRole("row")).toHaveLength(2);
});
it("Access clears a recovered role-catalog read failure without resetting command state",async()=>{
 vi.mocked(api.getAdminRoleCatalog).mockRejectedValueOnce(new Error("Catalog unavailable")).mockResolvedValue([]);vi.mocked(api.searchAdminRoleAssignments).mockResolvedValue({items:[],next_cursor:null});render(<MemoryRouter><AdminAccessPage/></MemoryRouter>);await screen.findByText("Catalog unavailable");fireEvent.click(screen.getByRole("button",{name:"Reintentar"}));await screen.findByText("Sin asignaciones");expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("Access can return to its previous cursor after a later-page read fails",async()=>{
 vi.mocked(api.searchAdminRoleAssignments).mockResolvedValueOnce({items:[],next_cursor:cursor}).mockRejectedValueOnce(new Error("Next page unavailable")).mockResolvedValue({items:[],next_cursor:cursor});render(<MemoryRouter><AdminAccessPage/></MemoryRouter>);fireEvent.click(await screen.findByRole("button",{name:"Página siguiente"}));await screen.findByText("Next page unavailable");fireEvent.click(screen.getByRole("button",{name:"Página anterior"}));await screen.findByText("Sin asignaciones");expect(screen.getByText("Página 1")).toBeInTheDocument();
});
