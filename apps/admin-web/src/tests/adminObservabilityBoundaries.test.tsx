import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {MemoryRouter} from "react-router-dom";
import {beforeEach,expect,it,vi} from "vitest";
import {supabase} from "../lib/supabase";
import {searchAdminLedgerAccounts,searchAdminFinancialTransactions,searchAdminFinanceAudit,searchAdminGlobalAudit,searchAdminSystemAudit,getAdminPlatformRevenue,getAdminSystemHealth} from "../lib/adminObservabilityApi";
import {AdminLedgerAccountsPage,AdminFinanceOverviewPage,AdminSystemHealthPage} from "../pages/AdminFinanceAuditSystemPages";
vi.mock("../lib/supabase",()=>({supabase:{rpc:vi.fn()}}));
const id="11111111-1111-4111-8111-111111111111",created_at="2026-10-01T00:00:00.123456Z";
const reads=[searchAdminLedgerAccounts,searchAdminFinancialTransactions,searchAdminFinanceAudit,searchAdminGlobalAudit,searchAdminSystemAudit];
beforeEach(()=>vi.resetAllMocks());
it.each(reads)("rejects malformed Finance/audit response cursors in %s",async read=>{
 for(const cursor of [{},{id},{created_at},{id,created_at:null},{id:null,created_at},{id,created_at:"2026-10-01"},{id,created_at:"2026-02-30T12:00:00Z"},{id,created_at:"2026-10-01T24:00:00Z"},{id:"bad",created_at},{id,created_at,extra:true},[],"cursor"]){
  vi.mocked(supabase.rpc).mockResolvedValue({data:{items:[],next_cursor:cursor},error:null} as never);
  await expect(read()).rejects.toThrow(/next_cursor/);
 }
 vi.mocked(supabase.rpc).mockResolvedValue({data:{items:[],next_cursor:{id,created_at}},error:null} as never);
 expect((await read()).next_cursor).toEqual({id,created_at});
});
it.each(reads)("never sends partial or malformed Finance/audit request cursor pairs in %s",async read=>{
 for(const args of [{p_cursor_id:id},{p_cursor_created_at:created_at},{p_cursor_id:null,p_cursor_created_at:created_at},{p_cursor_id:id,p_cursor_created_at:null},{p_cursor_id:"bad",p_cursor_created_at:created_at},{p_cursor_id:id,p_cursor_created_at:"2026-02-30T12:00:00Z"}])await expect(read(args)).rejects.toThrow(/cursor/);
 expect(supabase.rpc).not.toHaveBeenCalled();
 vi.mocked(supabase.rpc).mockResolvedValue({data:{items:[],next_cursor:null},error:null} as never);
 await read({p_cursor_id:id,p_cursor_created_at:created_at,p_limit:50});expect(supabase.rpc).toHaveBeenLastCalledWith(expect.any(String),{p_cursor_id:id,p_cursor_created_at:created_at,p_limit:50});
});
it("a malformed later-page cursor is an error and cannot silently send a page-one request",async()=>{
 vi.mocked(supabase.rpc).mockResolvedValueOnce({data:{items:[],next_cursor:{id,created_at}},error:null} as never).mockResolvedValueOnce({data:{items:[],next_cursor:{}},error:null} as never);
 render(<MemoryRouter><AdminLedgerAccountsPage/></MemoryRouter>);
 fireEvent.click(await screen.findByRole("button",{name:"Página siguiente"}));
 await waitFor(()=>expect(supabase.rpc).toHaveBeenCalledTimes(2));
 expect(await screen.findByRole("alert")).toHaveTextContent(/next_cursor/);
 expect(screen.getByText("Página 2")).toBeInTheDocument();expect(screen.getByRole("button",{name:"Página siguiente"})).toBeDisabled();
 fireEvent.click(screen.getByRole("button",{name:"Página siguiente"}));expect(supabase.rpc).toHaveBeenCalledTimes(2);
});
it.each([getAdminPlatformRevenue,getAdminSystemHealth])("preserves only safe SQLSTATE/status on observability errors in %s",async read=>{
 vi.mocked(supabase.rpc).mockResolvedValue({data:null,status:403,error:{code:"42501",message:"private SQL relation and financial detail",details:"secret",hint:"secret"}} as never);
 const error=await read().catch(reason=>reason);expect(error).toMatchObject({code:"42501",status:403});expect(error.message).not.toMatch(/private|relation|financial detail/);expect(error).not.toHaveProperty("details");expect(error).not.toHaveProperty("hint");
});
it.each([[AdminFinanceOverviewPage,"get_admin_platform_revenue"],[AdminSystemHealthPage,"get_admin_system_health"]] as const)("the existing %s page renders canonical 42501 as denied after authorization changes",async(Page,name)=>{
 vi.mocked(supabase.rpc).mockImplementation((async(rpcName:string)=>rpcName===name?{data:null,status:403,error:{code:"42501",message:"private SQL detail"}}:{data:{},error:null}) as never);
 render(<MemoryRouter><Page/></MemoryRouter>);expect(await screen.findByText("Sin permiso para esta fuente.")).toBeInTheDocument();expect(screen.queryByRole("alert")).not.toBeInTheDocument();expect(screen.queryByText(/private SQL detail/)).not.toBeInTheDocument();
});
