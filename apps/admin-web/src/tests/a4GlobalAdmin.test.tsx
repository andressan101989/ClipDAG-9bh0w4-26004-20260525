import {render,screen} from "@testing-library/react";
import {MemoryRouter,Route,Routes} from "react-router-dom";
import {describe,expect,it,vi} from "vitest";
import {CapabilityRoute} from "../auth/CapabilityRoute";
import {useAdminAuth} from "../auth/AdminAuthProvider";
import {getAdminAccess} from "../lib/adminApi";
import {supabase} from "../lib/supabase";

vi.mock("../auth/AdminAuthProvider",()=>({useAdminAuth:vi.fn()}));
vi.mock("../lib/supabase",()=>({supabase:{rpc:vi.fn(),functions:{invoke:vi.fn()}}}));

describe("A4 global authority contract",()=>{
  it("bootstraps roles, effective capabilities and authority version from get_my_admin_access",async()=>{
    vi.mocked(supabase.rpc).mockResolvedValue({data:{user_id:"10000000-0000-4000-8000-000000000001",username:"ops",display_name:"Ops",avatar_url:null,admin:true,roles:["MODERATOR"],capabilities:["admin.shell.access"],effective_capabilities:["admin.shell.access"],authority_version:"abc123"},error:null} as never);
    await expect(getAdminAccess()).resolves.toMatchObject({roles:["MODERATOR"],capabilities:["admin.shell.access"],authority_version:"abc123"});
    expect(supabase.rpc).toHaveBeenCalledWith("get_my_admin_access",{});
  });
  it("denies a route without its exact capability",()=>{
    vi.mocked(useAdminAuth).mockReturnValue({hasCapability:()=>false} as never);
    render(<MemoryRouter><Routes><Route element={<CapabilityRoute capability="users.accounts.read"/>}><Route index element={<p>Usuarios privados</p>}/></Route></Routes></MemoryRouter>);
    expect(screen.getByText("Acceso restringido")).toBeInTheDocument();
    expect(screen.queryByText("Usuarios privados")).not.toBeInTheDocument();
  });
  it("renders the route with the exact capability",()=>{
    vi.mocked(useAdminAuth).mockReturnValue({hasCapability:(capability:string)=>capability==="users.accounts.read"} as never);
    render(<MemoryRouter><Routes><Route element={<CapabilityRoute capability="users.accounts.read"/>}><Route index element={<p>Usuarios privados</p>}/></Route></Routes></MemoryRouter>);
    expect(screen.getByText("Usuarios privados")).toBeInTheDocument();
  });
});
