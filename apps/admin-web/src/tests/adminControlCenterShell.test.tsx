import {render,screen,within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {MemoryRouter,Route,Routes,useLocation} from "react-router-dom";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {useAdminAuth} from "../auth/AdminAuthProvider";
import {AdminShell} from "../layout/AdminShell";
import {adminLinks} from "../layout/adminNavigation";
import * as navigation from "../layout/adminNavigation";

vi.mock("../auth/AdminAuthProvider",()=>({useAdminAuth:vi.fn()}));

const allCapabilities=[...new Set(adminLinks.flatMap((link)=>[link.capability,...(link.additionalCapabilities??[])]))];

function access(capabilities=allCapabilities){
  return {
    loading:false,
    session:{user:{id:"10000000-0000-4000-8000-000000000001"}} as never,
    admin:{user_id:"10000000-0000-4000-8000-000000000001",username:"root",display_name:"Root Operator",avatar_url:null,admin:true,roles:["SUPER_ADMIN"],capabilities,authority_version:"control-center-v1"},
    denied:false,error:null,login:vi.fn(),logout:vi.fn(),retry:vi.fn(),
    hasCapability:(capability:string)=>capabilities.includes(capability),
  };
}

function CurrentLocation(){const location=useLocation();return <output aria-label="Ruta resuelta">{location.pathname}</output>}

function renderShell(path="/overview"){
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route element={<AdminShell/>}><Route path="*" element={<><p>Contenido del módulo</p><CurrentLocation/></>}/></Route></Routes></MemoryRouter>);
}

beforeEach(()=>{
  localStorage.clear();
  vi.mocked(useAdminAuth).mockReturnValue(access() as never);
});

describe("Admin Control Center shell",()=>{
  it("classifies every canonical route into the approved eight capability-filtered groups",()=>{
    const groups=(navigation as typeof navigation&{adminNavigationGroups?:Array<{id:string;label:string}>}).adminNavigationGroups;
    expect(groups).toBeDefined();
    expect(groups).toHaveLength(8);
    expect(new Set(groups?.map((group)=>group.id))).toEqual(new Set(["overview","community","content_safety","live","marketplace","advertising","finance","system"]));
    expect(adminLinks.every((link)=>groups?.some((group)=>group.id===link.group))).toBe(true);

    renderShell();
    const sidebar=screen.getByRole("navigation",{name:"Administración global"});
    expect(within(sidebar).getAllByRole("button")).toHaveLength(8);
  });

  it("shows only groups and destinations backed by the current capabilities",()=>{
    vi.mocked(useAdminAuth).mockReturnValue(access(["admin.shell.access","marketplace.orders.read"]) as never);
    renderShell("/marketplace/orders");
    const sidebar=screen.getByRole("navigation",{name:"Administración global"});
    expect(within(sidebar).getAllByRole("button")).toHaveLength(2);
    expect(within(sidebar).getByRole("button",{name:"Marketplace"})).toBeInTheDocument();
    expect(within(sidebar).queryByRole("button",{name:"Finance"})).not.toBeInTheDocument();
    const marketplace=document.getElementById("admin-group-marketplace") as HTMLElement;
    expect(within(marketplace).getByRole("link",{name:"Pedidos"})).toHaveAttribute("href","/marketplace/orders");
    expect(within(marketplace).queryByRole("link",{name:"Resumen"})).not.toBeInTheDocument();
  });

  it("renders an authorized breadcrumb trail for the active route",()=>{
    renderShell("/marketplace/orders");
    const breadcrumbs=screen.getByRole("navigation",{name:"Ruta actual"});
    expect(within(breadcrumbs).getByText("Marketplace")).toBeInTheDocument();
    expect(within(breadcrumbs).getByText("Pedidos")).toHaveAttribute("aria-current","page");
  });

  it("persists an operator's expanded group choice across shell remounts",async()=>{
    vi.mocked(useAdminAuth).mockReturnValue(access(["admin.shell.access","marketplace.orders.read"]) as never);
    const first=renderShell();
    const marketplace=screen.getByRole("button",{name:"Marketplace"});
    expect(marketplace).toHaveAttribute("aria-expanded","false");
    await userEvent.click(marketplace);
    expect(marketplace).toHaveAttribute("aria-expanded","true");
    first.unmount();

    renderShell();
    expect(screen.getByRole("button",{name:"Marketplace"})).toHaveAttribute("aria-expanded","true");
  });

  it("navigates authorized command results with Arrow keys and Enter and dismisses with Escape",async()=>{
    vi.mocked(useAdminAuth).mockReturnValue(access(["admin.shell.access","marketplace.overview.read","marketplace.orders.read","marketplace.disputes.read"]) as never);
    renderShell();
    const search=screen.getByRole("combobox",{name:"Buscar módulos y secciones"});
    await userEvent.type(search,"Marketplace");
    const results=screen.getAllByRole("option");
    expect(results[0]).toHaveAttribute("aria-selected","true");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(screen.getByRole("status",{name:"Ruta resuelta"})).toHaveTextContent("/marketplace/orders");

    await userEvent.type(search,"Marketplace");
    expect(screen.getByRole("listbox",{name:"Rutas autorizadas"})).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox",{name:"Rutas autorizadas"})).not.toBeInTheDocument();
    expect(search).toHaveValue("");
  });

  it("marks the canonical shell as the light Nelyon desktop theme while retaining the responsive drawer",()=>{
    renderShell();
    expect(document.querySelector(".admin-layout")).toHaveAttribute("data-theme","nelyon-admin-light");
    expect(screen.getByRole("button",{name:"Abrir navegación"})).toHaveAttribute("aria-controls","admin-navigation");
  });
});
