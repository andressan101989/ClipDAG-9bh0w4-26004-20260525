import {act,fireEvent,render,screen,waitFor,within} from "@testing-library/react";
import {MemoryRouter} from "react-router-dom";
import {beforeEach,expect,it,vi} from "vitest";
import {useAdminAuth} from "../auth/AdminAuthProvider";
import {AdminOverviewPage} from "../pages/AdminOverviewPage";
import {getAdminControlCenterOverview,controlCenterRange} from "../lib/adminControlCenterApi";
import {getAdminPlatformRevenue,getAdminSystemHealth} from "../lib/adminObservabilityApi";
vi.mock("../auth/AdminAuthProvider",()=>({useAdminAuth:vi.fn()}));
vi.mock("../lib/adminControlCenterApi",async original=>({...await original<object>(),getAdminControlCenterOverview:vi.fn()}));
vi.mock("../lib/adminObservabilityApi",()=>({getAdminPlatformRevenue:vi.fn(),getAdminSystemHealth:vi.fn().mockResolvedValue({cron:{non_successes_24h:0,active_jobs:3,total_jobs:4}})}));
const caps=["users.accounts.read","content.items.read","stories.items.read"];
const snapshot=(module:string)=>({authority:"admin_control_center_v1",module,from:"2026-10-01",to:"2026-10-30",timezone:"UTC",metrics:[{key:module,label:`${module} count`,value:0,unit:"count",source:`canonical.${module}`,reason:null}],series:[{day:"2026-10-30",value:0}],recent:[]});
beforeEach(()=>{vi.clearAllMocks();vi.mocked(useAdminAuth).mockReturnValue({hasCapability:(cap:string)=>caps.includes(cap)} as never);vi.mocked(getAdminControlCenterOverview).mockImplementation(async module=>snapshot(module) as never)});
it("uses explicit UTC day boundaries including leap days and rejects invalid or over-90-day dates",()=>{
 expect(controlCenterRange("today",undefined,undefined,new Date("2026-10-30T00:01:00Z"))).toEqual({from:"2026-10-30",to:"2026-10-30"});
 expect(controlCenterRange("7d",undefined,undefined,new Date("2026-11-01T01:00:00-04:00"))).toEqual({from:"2026-10-26",to:"2026-11-01"});
 expect(controlCenterRange("custom","2024-02-29","2024-02-29")).toEqual({from:"2024-02-29",to:"2024-02-29"});
 for(const dates of [["2026-02-29","2026-03-01"],["2026-10-30","2026-10-01"],["2026-01-01","2026-04-01"]])expect(()=>controlCenterRange("custom",...dates as [string,string])).toThrow();
});
it("renders server zero, accessible chart table and separate denied/unavailable/failed modules",async()=>{
 vi.mocked(getAdminControlCenterOverview).mockImplementation(async module=>{if(module==="content")throw new Error("SQLSTATE secret query");if(module==="stories")return {...snapshot(module),metrics:[{key:"stories",label:"Stories",value:null,unit:"count",source:"stories",reason:"source unavailable"}]} as never;return snapshot(module) as never});
 render(<MemoryRouter><AdminOverviewPage/></MemoryRouter>);
 expect(await screen.findByRole("article",{name:"users count"})).toHaveTextContent("0");
 expect(within(screen.getByRole("region",{name:"Contenido"})).getByRole("alert")).not.toHaveTextContent("SQLSTATE");
 expect(within(screen.getByRole("region",{name:"Stories"})).getByText("No disponible")).toBeInTheDocument();
 expect(within(screen.getByRole("region",{name:"Marketplace"})).getByText(/Sin permiso/)).toBeInTheDocument();
 expect(screen.getByRole("table",{name:"Datos de Usuarios por día"})).toBeInTheDocument();
 expect(vi.mocked(getAdminControlCenterOverview).mock.calls.some(([module])=>module==="marketplace")).toBe(false);
});
it("applies a custom range and fences old range success",async()=>{
 let resolve!:(value:never)=>void;vi.mocked(getAdminControlCenterOverview).mockImplementationOnce(()=>new Promise(r=>resolve=r));
 render(<MemoryRouter><AdminOverviewPage/></MemoryRouter>);
 await waitFor(()=>expect(getAdminControlCenterOverview).toHaveBeenCalled());
 fireEvent.change(screen.getByLabelText("Periodo"),{target:{value:"custom"}});
 fireEvent.change(screen.getByLabelText("Desde (UTC)"),{target:{value:"2026-10-01"}});fireEvent.change(screen.getByLabelText("Hasta (UTC)"),{target:{value:"2026-10-02"}});
 fireEvent.click(screen.getByRole("button",{name:"Aplicar fechas"}));
 await waitFor(()=>expect(vi.mocked(getAdminControlCenterOverview).mock.calls.some(([module,range])=>module==="users"&&range.from==="2026-10-01"&&range.to==="2026-10-02")).toBe(true));
 await act(async()=>resolve({...snapshot("users"),metrics:[{key:"old",label:"Obsolete count",value:999,unit:"count",source:"old",reason:null}]} as never));
 expect(screen.queryByText("Obsolete count")).not.toBeInTheDocument();
});
it("aborts superseded module reads instead of leaving obsolete SQL running",async()=>{
 let resolve!:(value:never)=>void;vi.mocked(getAdminControlCenterOverview).mockImplementationOnce(()=>new Promise(r=>resolve=r));
 render(<MemoryRouter><AdminOverviewPage/></MemoryRouter>);
 await waitFor(()=>expect(getAdminControlCenterOverview).toHaveBeenCalled());
 const calls=vi.mocked(getAdminControlCenterOverview).mock.calls as unknown as Array<[string,unknown,AbortSignal|undefined]>;
 const originalSignal=calls[0]?.[2];
 expect(originalSignal).toBeInstanceOf(AbortSignal);
 fireEvent.change(screen.getByLabelText("Periodo"),{target:{value:"custom"}});
 fireEvent.change(screen.getByLabelText("Desde (UTC)"),{target:{value:"2026-10-01"}});fireEvent.change(screen.getByLabelText("Hasta (UTC)"),{target:{value:"2026-10-02"}});
 fireEvent.click(screen.getByRole("button",{name:"Aplicar fechas"}));
 await waitFor(()=>expect(originalSignal?.aborted).toBe(true));
 await act(async()=>resolve(snapshot("users") as never));
});
it("reads recognized income from the existing revenue authority in its explicit today scope",async()=>{
 vi.mocked(useAdminAuth).mockReturnValue({hasCapability:(cap:string)=>cap==="finance.ledger.read"} as never);
 vi.mocked(getAdminPlatformRevenue).mockResolvedValue({summary:[{currency:"BDAG",net_revenue:"12.50000000"}]});
 render(<MemoryRouter><AdminOverviewPage/></MemoryRouter>);
 expect(await screen.findByRole("article",{name:"Ingresos reconocidos hoy (UTC)"})).toHaveTextContent("12.50000000 BDAG");
 expect(getAdminPlatformRevenue).toHaveBeenCalledWith("today");expect(screen.getByText(/Ventana propia de hoy; no usa el filtro/)).toBeInTheDocument();
});
it("does not interpret an empty revenue amount as zero",async()=>{
 vi.mocked(useAdminAuth).mockReturnValue({hasCapability:(cap:string)=>cap==="finance.ledger.read"} as never);
 vi.mocked(getAdminPlatformRevenue).mockResolvedValue({summary:[{currency:"BDAG",net_revenue:""}]});
 render(<MemoryRouter><AdminOverviewPage/></MemoryRouter>);
 expect(await screen.findByRole("article",{name:"Ingresos reconocidos hoy (UTC)"})).toHaveTextContent("No disponible");
});
it("retries only the failed source and keeps server denial distinct",async()=>{
 vi.mocked(getAdminControlCenterOverview).mockImplementation(async module=>{if(module==="content")throw Object.assign(new Error("forbidden"),{code:"42501"});if(module==="stories")throw new Error("failed");return snapshot(module) as never});
 render(<MemoryRouter><AdminOverviewPage/></MemoryRouter>);
 expect(await within(screen.getByRole("region",{name:"Contenido"})).findByText(/Sin permiso/)).toBeInTheDocument();
 const stories=screen.getByRole("region",{name:"Stories"});await within(stories).findByRole("alert");
 const reads=vi.mocked(getAdminControlCenterOverview).mock.calls.filter(([module])=>module==="users").length;
 vi.mocked(getAdminControlCenterOverview).mockImplementation(async module=>snapshot(module) as never);fireEvent.click(within(stories).getByRole("button",{name:"Reintentar"}));
 expect(await within(stories).findByRole("article",{name:"stories count"})).toHaveTextContent("0");expect(vi.mocked(getAdminControlCenterOverview).mock.calls.filter(([module])=>module==="users")).toHaveLength(reads);
});
it.each(["revenue","health"])("renders a post-authorization SQLSTATE denial for %s without raw details",async source=>{
 vi.mocked(useAdminAuth).mockReturnValue({hasCapability:(cap:string)=>["finance.ledger.read","system.health.read"].includes(cap)} as never);
 const read=source==="revenue"?getAdminPlatformRevenue:getAdminSystemHealth;
 vi.mocked(read).mockRejectedValueOnce(Object.assign(new Error("private SQL detail"),{code:"42501",status:403}));
 render(<MemoryRouter><AdminOverviewPage/></MemoryRouter>);
 const region=screen.getByLabelText(source==="revenue"?"Ingresos reconocidos":"Salud del sistema");
 expect(await within(region).findByText(/Sin permiso/)).toBeInTheDocument();expect(within(region).queryByRole("alert")).not.toBeInTheDocument();expect(region).not.toHaveTextContent("private SQL detail");
});
