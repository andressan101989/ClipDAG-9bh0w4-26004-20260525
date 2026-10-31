import {act,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {MemoryRouter,Route,Routes} from "react-router-dom";
import {beforeEach,expect,it,vi} from "vitest";
import {useAdminAuth} from "../auth/AdminAuthProvider";
import * as api from "../lib/adminApi";
import {AdminContentDetailPage} from "../pages/AdminContentPages";
import {AdminLiveDetailPage} from "../pages/AdminLivePages";
import {AdminBattleDetailPage} from "../pages/AdminBattlePages";
import {AdminAccessPage} from "../pages/AdminAccessPage";
vi.mock("../auth/AdminAuthProvider",()=>({useAdminAuth:vi.fn()}));
vi.mock("../lib/adminApi",async(original)=>({...await original<typeof import("../lib/adminApi")>(),getAdminContentDetail:vi.fn(),moderateAdminContent:vi.fn(),getAdminLiveSessionDetail:vi.fn(),moderateAdminLiveParticipant:vi.fn(),terminateAdminLiveSession:vi.fn(),getAdminLiveBattleDetail:vi.fn(),cancelAdminLiveBattle:vi.fn(),getAdminRoleCatalog:vi.fn(),searchAdminRoleAssignments:vi.fn(),searchAdminUsers:vi.fn(),assignAdminRole:vi.fn(),revokeAdminRole:vi.fn()}));
const id="11111111-1111-4111-8111-111111111111";
beforeEach(()=>{vi.resetAllMocks();vi.mocked(useAdminAuth).mockReturnValue({session:{user:{id:"actor"}},hasCapability:()=>true} as never);vi.spyOn(window,"confirm").mockReturnValue(true);vi.spyOn(window,"prompt").mockReturnValue("Motivo humano");});
it.each([
 ["content",AdminContentDetailPage,"/content/:type/:id",`/content/video/${id}`,api.getAdminContentDetail,{id,type:"video",visibility:"visible",owner:{}},api.moderateAdminContent,"Motivo","Ocultar contenido"],
 ["LIVE termination",AdminLiveDetailPage,"/live/:id",`/live/${id}`,api.getAdminLiveSessionDetail,{session:{id,status:"live"}},api.terminateAdminLiveSession,"Motivo LIVE","Terminar LIVE"],
 ["LIVE participant",AdminLiveDetailPage,"/live/:id",`/live/${id}`,api.getAdminLiveSessionDetail,{session:{id,status:"live"},participants:[{id,role:"cohost",status:"active",user:{id}}]},api.moderateAdminLiveParticipant,"Motivo LIVE","Mute"],
 ["Battle",AdminBattleDetailPage,"/battles/:id",`/battles/${id}`,api.getAdminLiveBattleDetail,{battle:{id,status:"active"}},api.cancelAdminLiveBattle,"Motivo Battle","Cancelar Battle"],
] as const)("keeps %s retries stable and blocks overlapping submissions",async(_label,Page,path,url,read,data,mutate,input,button)=>{
 vi.mocked(read).mockResolvedValue(data as never);vi.mocked(mutate).mockRejectedValue(new TypeError("Failed to fetch"));
 render(<MemoryRouter initialEntries={[url]}><Routes><Route path={path} element={<Page/>}/></Routes></MemoryRouter>);await screen.findByLabelText(input);fireEvent.change(screen.getByLabelText(input),{target:{value:"Motivo humano"}});fireEvent.click(screen.getByRole("button",{name:button}));await screen.findByRole("alert");fireEvent.click(screen.getByRole("button",{name:button}));await waitFor(()=>expect(mutate).toHaveBeenCalledTimes(2));
 expect(vi.mocked(mutate).mock.calls[1][0].idempotencyKey).toBe(vi.mocked(mutate).mock.calls[0][0].idempotencyKey);
 await waitFor(()=>expect(screen.getByRole("button",{name:button})).toBeEnabled());let finish!:(v:never)=>void;vi.mocked(mutate).mockReturnValueOnce(new Promise((resolve)=>{finish=resolve}));act(()=>{fireEvent.click(screen.getByRole("button",{name:button}));fireEvent.click(screen.getByRole("button",{name:button}))});expect(mutate).toHaveBeenCalledTimes(3);await act(async()=>finish({} as never));
});
const role={role_code:"SUPPORT",display_name:"Support",description:"Support",capability_count:1,is_assignable:true,is_root:false,is_exclusive:false};
async function access(){vi.mocked(api.getAdminRoleCatalog).mockResolvedValue([role]);vi.mocked(api.searchAdminRoleAssignments).mockResolvedValue({items:[{assignment_id:id,user:{id,username:"person"},role_code:"SUPPORT",grant_actor_kind:"human",granted_at:"2026-10-01",version:1}],next_cursor:null} as never);render(<MemoryRouter><AdminAccessPage/></MemoryRouter>);await screen.findByText("Asignar rol ordinario");}
it("reuses the role revocation key after an ambiguous response and resets on prompt cancellation",async()=>{
 vi.mocked(api.revokeAdminRole).mockRejectedValue(new TypeError("Failed to fetch"));await access();for(let index=0;index<2;index++){fireEvent.click(screen.getByRole("button",{name:"Revocar"}));await waitFor(()=>expect(api.revokeAdminRole).toHaveBeenCalledTimes(index+1));await screen.findByRole("alert");}
 const calls=vi.mocked(api.revokeAdminRole).mock.calls;expect(calls[1][0].idempotencyKey).toBe(calls[0][0].idempotencyKey);
 vi.mocked(window.prompt).mockReturnValueOnce(null);fireEvent.click(screen.getByRole("button",{name:"Revocar"}));fireEvent.click(screen.getByRole("button",{name:"Revocar"}));await waitFor(()=>expect(api.revokeAdminRole).toHaveBeenCalledTimes(3));expect(calls[2][0].idempotencyKey).not.toBe(calls[1][0].idempotencyKey);
});
it("reuses role assignment UUIDs and prevents double assignment",async()=>{
 vi.mocked(api.searchAdminUsers).mockResolvedValue({items:[{id,username:"person"}],next_cursor:null} as never);vi.mocked(api.assignAdminRole).mockRejectedValue(new TypeError("Failed to fetch"));await access();fireEvent.change(screen.getByLabelText("Usuario"),{target:{value:"person"}});fireEvent.click(await screen.findByRole("option",{name:/person/}));fireEvent.change(screen.getByLabelText("Rol"),{target:{value:"SUPPORT"}});fireEvent.change(screen.getByLabelText("Motivo"),{target:{value:"Motivo humano"}});
 fireEvent.click(screen.getByRole("button",{name:"Asignar"}));await screen.findByRole("alert");fireEvent.click(screen.getByRole("button",{name:"Asignar"}));await waitFor(()=>expect(api.assignAdminRole).toHaveBeenCalledTimes(2));expect(vi.mocked(api.assignAdminRole).mock.calls[1][0].idempotencyKey).toBe(vi.mocked(api.assignAdminRole).mock.calls[0][0].idempotencyKey);
 await waitFor(()=>expect(screen.getByRole("button",{name:"Asignar"})).toBeEnabled());let finish!:(value:never)=>void;vi.mocked(api.assignAdminRole).mockReturnValueOnce(new Promise(resolve=>{finish=resolve}));act(()=>{fireEvent.click(screen.getByRole("button",{name:"Asignar"}));fireEvent.click(screen.getByRole("button",{name:"Asignar"}))});expect(api.assignAdminRole).toHaveBeenCalledTimes(3);await act(async()=>finish({} as never));
});
