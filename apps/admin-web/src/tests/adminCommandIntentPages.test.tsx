import {act,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {MemoryRouter,Route,Routes} from "react-router-dom";
import {beforeEach,expect,it,vi} from "vitest";
import {useAdminAuth} from "../auth/AdminAuthProvider";
import {AdminRpcError,getAdminUserDetail,issueAdminUserWarning,moderateAdminUser,revokeAdminUserWarning} from "../lib/adminApi";
import {AdminUserDetailPage} from "../pages/AdminUsersPages";

vi.mock("../auth/AdminAuthProvider",()=>({useAdminAuth:vi.fn()}));
vi.mock("../lib/adminApi",async(importOriginal)=>({...await importOriginal<typeof import("../lib/adminApi")>(),getAdminUserDetail:vi.fn(),issueAdminUserWarning:vi.fn(),moderateAdminUser:vi.fn(),revokeAdminUserWarning:vi.fn()}));
const id="11111111-1111-4111-8111-111111111111";
const detail={id,username:"person",display_name:"Persona",avatar_url:null,bio:null,created_at:"2026-09-01T00:00:00Z",last_sign_in_at:null,account_status:"active",banned_until:null,active_warning_count:0,public_counters:{followers_count:4,following_count:2},active_admin_roles:[],discipline:{active_warning_count:0,warning_limit:3,cycle_started_at:null,historical_warning_count:0,enforcement_required:false,last_suspension:null,last_restore:null,warnings:[]}};
const tree=()=> <MemoryRouter initialEntries={[`/users/${id}`]}><Routes><Route path="/users/:id" element={<AdminUserDetailPage/>}/></Routes></MemoryRouter>;
const submit=()=>fireEvent.click(screen.getByRole("button",{name:"Emitir advertencia 1/3"}));
const reason=(value="Motivo visible")=>fireEvent.change(screen.getByLabelText("Motivo para el usuario"),{target:{value}});
beforeEach(()=>{vi.resetAllMocks();vi.mocked(useAdminAuth).mockReturnValue({session:{user:{id:"actor"},access_token:"one"},hasCapability:()=>true} as never);vi.mocked(getAdminUserDetail).mockResolvedValue(detail as never);vi.mocked(issueAdminUserWarning).mockRejectedValue(new TypeError("Failed to fetch"));});
it("retries a lost warning response with the same UUID through an auth-provider rerender",async()=>{
 const view=render(tree());await screen.findByLabelText("Motivo para el usuario");reason();submit();await screen.findByRole("alert");
 vi.mocked(useAdminAuth).mockReturnValue({session:{user:{id:"actor"},access_token:"refreshed"},refreshing:true,hasCapability:()=>true} as never);view.rerender(tree());submit();
 await waitFor(()=>expect(issueAdminUserWarning).toHaveBeenCalledTimes(2));
 expect(vi.mocked(issueAdminUserWarning).mock.calls[1][0].idempotencyKey).toBe(vi.mocked(issueAdminUserWarning).mock.calls[0][0].idempotencyKey);
});
it("rotates the warning UUID when evidence changes, including changing back",async()=>{
 render(tree());await screen.findByLabelText("Motivo para el usuario");reason();submit();await screen.findByRole("alert");
 fireEvent.change(screen.getByLabelText("Nota interna"),{target:{value:"new note"}});fireEvent.change(screen.getByLabelText("Nota interna"),{target:{value:""}});submit();
 await waitFor(()=>expect(issueAdminUserWarning).toHaveBeenCalledTimes(2));expect(vi.mocked(issueAdminUserWarning).mock.calls[1][0].idempotencyKey).not.toBe(vi.mocked(issueAdminUserWarning).mock.calls[0][0].idempotencyKey);
});
it("explicit cancellation forgets an unresolved warning",async()=>{
 render(tree());await screen.findByLabelText("Motivo para el usuario");reason();submit();await screen.findByRole("alert");fireEvent.click(screen.getByRole("button",{name:"Descartar reintento"}));submit();
 await waitFor(()=>expect(issueAdminUserWarning).toHaveBeenCalledTimes(2));expect(vi.mocked(issueAdminUserWarning).mock.calls[1][0].idempotencyKey).not.toBe(vi.mocked(issueAdminUserWarning).mock.calls[0][0].idempotencyKey);
});
it.each(["success","denial"])("clears a warning attempt after %s",async(outcome)=>{
 if(outcome==="success")vi.mocked(issueAdminUserWarning).mockResolvedValue({} as never);else vi.mocked(issueAdminUserWarning).mockRejectedValue(new AdminRpcError("denied","42501"));
 render(tree());await screen.findByLabelText("Motivo para el usuario");reason();submit();
 if(outcome==="success")await waitFor(()=>expect(screen.getByLabelText("Motivo para el usuario")).toHaveValue(""));else await screen.findByRole("alert");reason();submit();await waitFor(()=>expect(issueAdminUserWarning).toHaveBeenCalledTimes(2));
 expect(vi.mocked(issueAdminUserWarning).mock.calls[1][0].idempotencyKey).not.toBe(vi.mocked(issueAdminUserWarning).mock.calls[0][0].idempotencyKey);
});
it("sends one request for overlapping warning clicks",async()=>{
 let finish!:(value:never)=>void;vi.mocked(issueAdminUserWarning).mockReturnValue(new Promise((resolve)=>{finish=resolve}));render(tree());await screen.findByLabelText("Motivo para el usuario");reason();
 act(()=>{submit();submit()});expect(issueAdminUserWarning).toHaveBeenCalledTimes(1);await act(async()=>finish({} as never));
});

it("keeps different user commands isolated without retiring an unresolved warning",async()=>{
 vi.mocked(moderateAdminUser).mockRejectedValue(new TypeError("Failed to fetch"));render(tree());await screen.findByLabelText("Motivo para el usuario");reason();submit();await screen.findByRole("alert");
 fireEvent.change(screen.getByLabelText("Motivo de moderación"),{target:{value:"Suspend reason"}});fireEvent.click(screen.getByRole("button",{name:"Suspender cuenta"}));await waitFor(()=>expect(moderateAdminUser).toHaveBeenCalledTimes(1));await waitFor(()=>expect(screen.getByRole("button",{name:"Emitir advertencia 1/3"})).toBeEnabled());submit();await waitFor(()=>expect(issueAdminUserWarning).toHaveBeenCalledTimes(2));
 expect(vi.mocked(issueAdminUserWarning).mock.calls[1][0].idempotencyKey).toBe(vi.mocked(issueAdminUserWarning).mock.calls[0][0].idempotencyKey);expect(vi.mocked(moderateAdminUser).mock.calls[0][0].idempotencyKey).not.toBe(vi.mocked(issueAdminUserWarning).mock.calls[0][0].idempotencyKey);
});
it("retries a warning revocation with the same UUID",async()=>{
 vi.spyOn(window,"confirm").mockReturnValue(true);vi.mocked(revokeAdminUserWarning).mockRejectedValue(new TypeError("Failed to fetch"));vi.mocked(getAdminUserDetail).mockResolvedValue({...detail,discipline:{...detail.discipline,warnings:[{id,status:"active",warning_level_at_issue:1,reason:"Earlier warning",issued_by:{id:"actor"}}]}} as never);
 render(tree());await screen.findByLabelText("Motivo para revocar advertencia 1/3");fireEvent.change(screen.getByLabelText("Motivo para revocar advertencia 1/3"),{target:{value:"Revocation reason"}});fireEvent.click(screen.getByRole("button",{name:"Revocar advertencia"}));await screen.findByRole("alert");fireEvent.click(screen.getByRole("button",{name:"Revocar advertencia"}));await waitFor(()=>expect(revokeAdminUserWarning).toHaveBeenCalledTimes(2));expect(vi.mocked(revokeAdminUserWarning).mock.calls[1][0].idempotencyKey).toBe(vi.mocked(revokeAdminUserWarning).mock.calls[0][0].idempotencyKey);
});
