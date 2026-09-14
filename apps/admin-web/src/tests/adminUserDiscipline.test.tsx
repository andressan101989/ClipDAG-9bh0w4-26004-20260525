import {render,screen} from "@testing-library/react";
import {MemoryRouter,Route,Routes} from "react-router-dom";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {useAdminAuth} from "../auth/AdminAuthProvider";
import {getAdminUserDetail,searchAdminUsers} from "../lib/adminApi";
import {AdminUserDetailPage,AdminUsersPage} from "../pages/AdminUsersPages";

vi.mock("../auth/AdminAuthProvider",()=>({useAdminAuth:vi.fn()}));
vi.mock("../lib/adminApi",async(importOriginal)=>{const actual=await importOriginal<typeof import("../lib/adminApi")>();return{...actual,getAdminUserDetail:vi.fn(),searchAdminUsers:vi.fn(),issueAdminUserWarning:vi.fn(),revokeAdminUserWarning:vi.fn(),moderateAdminUser:vi.fn()}});

const id="11111111-1111-4111-8111-111111111111";
const detail={id,username:"person",display_name:"Persona",avatar_url:null,bio:null,created_at:"2026-09-01T00:00:00Z",last_sign_in_at:null,account_status:"active" as const,banned_until:null,active_warning_count:2,public_counters:{followers_count:4,following_count:2},active_admin_roles:[],discipline:{active_warning_count:2,warning_limit:3,cycle_started_at:null,historical_warning_count:2,enforcement_required:false,last_suspension:null,last_restore:null,warnings:[{id:"22222222-2222-4222-8222-222222222222",status:"active" as const,warning_level_at_issue:2,cycle_started_at:null,reason:"Incumplimiento reiterado",internal_note:"Revisado por moderación",evidence_type:"story",evidence_id:"33333333-3333-4333-8333-333333333333",evidence_note:null,issued_at:"2026-09-10T00:00:00Z",issued_by:{id:"44444444-4444-4444-8444-444444444444",username:"admin",display_name:"Admin",avatar_url:null},revoked_at:null,revocation_reason:null,revoked_by:null}]}};

describe("user discipline UI",()=>{
  beforeEach(()=>{vi.mocked(useAdminAuth).mockReturnValue({hasCapability:()=>true} as never);vi.mocked(getAdminUserDetail).mockResolvedValue(detail);});
  it("shows cycle count, human history, third-warning confirmation action and canonical account moderation",async()=>{
    render(<MemoryRouter initialEntries={[`/users/${id}`]}><Routes><Route path="/users/:id" element={<AdminUserDetailPage/>}/></Routes></MemoryRouter>);
    expect(await screen.findByText("Advertencias del ciclo actual")).toBeInTheDocument();
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    expect(screen.getByText("Incumplimiento reiterado")).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Emitir advertencia 3/3 y suspender"})).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Revocar advertencia"})).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Suspender cuenta"})).toBeInTheDocument();
  });
  it("hides warning commands without moderate capability",async()=>{
    vi.mocked(useAdminAuth).mockReturnValue({hasCapability:(capability:string)=>capability!=="users.accounts.moderate"} as never);
    render(<MemoryRouter initialEntries={[`/users/${id}`]}><Routes><Route path="/users/:id" element={<AdminUserDetailPage/>}/></Routes></MemoryRouter>);
    await screen.findByText("Advertencias del ciclo actual");
    expect(screen.queryByText("Emitir advertencia")).not.toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"Revocar advertencia"})).not.toBeInTheDocument();
  });
  it("shows warning count in users list",async()=>{
    vi.mocked(searchAdminUsers).mockResolvedValue({items:[detail],next_cursor:null});
    render(<MemoryRouter><AdminUsersPage/></MemoryRouter>);
    expect(await screen.findByText("2/3")).toBeInTheDocument();
  });
});
