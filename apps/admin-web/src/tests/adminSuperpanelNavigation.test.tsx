import {readFileSync} from "node:fs";
import {join} from "node:path";
import {render,screen,within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {MemoryRouter,Route,Routes} from "react-router-dom";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {useAdminAuth} from "../auth/AdminAuthProvider";
import {AdminShell} from "../layout/AdminShell";
import {adminLinks} from "../layout/adminNavigation";

vi.mock("../auth/AdminAuthProvider",()=>({useAdminAuth:vi.fn()}));

const access=(capabilities:string[])=>(
  {
    loading:false,
    session:{user:{id:"10000000-0000-4000-8000-000000000001"}} as never,
    admin:{user_id:"10000000-0000-4000-8000-000000000001",username:"root",display_name:"Root Operator",avatar_url:null,admin:true,roles:["CUSTOM_AUTHORITY"],capabilities,authority_version:"v1"},
    denied:false,error:null,login:vi.fn(),logout:vi.fn(),retry:vi.fn(),
    hasCapability:(capability:string)=>capabilities.includes(capability),
  }
);

function renderShell(path:string){
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/" element={<AdminShell/>}><Route path="*" element={<p>Ruta activa</p>}/></Route></Routes></MemoryRouter>);
}

beforeEach(()=>vi.mocked(useAdminAuth).mockReturnValue(access(adminLinks.map((link)=>link.capability)) as never));

describe("ADMIN-SUPERPANEL-FULL-F1 navigation",()=>{
  it("shows every grouped child, including Content Safety, for capability breadth without checking a role",()=>{
    renderShell("/overview");
    const navigation=screen.getByRole("navigation",{name:"Administración global"});
    const expected={
      finance:["Resumen","Cuentas","Transacciones","Reconciliación","Anomalías","Auditoría"],
      marketplace:["Resumen","Pedidos","Disputas","Vendedores","Productos","Creator Commerce","Promociones","Ads","Salud","Actividad"],
      system:["Salud","Jobs","Auditoría"],
      content_safety:["Alertas","Reglas"],
    };
    for(const [group,labels] of Object.entries(expected)){
      const groupLabel=group==="content_safety"?"Content Safety":group;
      const button=within(navigation).getByRole("button",{name:new RegExp(`^${groupLabel}`,"i")});
      expect(button).toHaveAttribute("aria-expanded","true");
      const children=document.getElementById(`admin-group-${group}`);
      expect(children).not.toBeNull();
      labels.forEach((label)=>expect(within(children as HTMLElement).getByRole("link",{name:label})).toBeInTheDocument());
    }
    expect(screen.getAllByText("CUSTOM_AUTHORITY").length).toBeGreaterThan(0);
  });

  it("filters every child independently by capability",()=>{
    vi.mocked(useAdminAuth).mockReturnValue(access(["admin.shell.access","finance.ledger.read","marketplace.overview.read","marketplace.orders.read","system.health.read"]) as never);
    renderShell("/finance");
    const finance=document.getElementById("admin-group-finance") as HTMLElement;
    expect(within(finance).getByRole("link",{name:"Resumen"})).toBeInTheDocument();
    expect(within(finance).getByRole("link",{name:"Cuentas"})).toBeInTheDocument();
    expect(within(finance).getByRole("link",{name:"Transacciones"})).toBeInTheDocument();
    expect(within(finance).queryByRole("link",{name:"Reconciliación"})).not.toBeInTheDocument();
    expect(within(finance).queryByRole("link",{name:"Anomalías"})).not.toBeInTheDocument();
    expect(within(finance).queryByRole("link",{name:"Auditoría"})).not.toBeInTheDocument();
  });

  it("keeps a child discoverable even when its group overview capability is absent",()=>{
    vi.mocked(useAdminAuth).mockReturnValue(access(["admin.shell.access","finance.reconciliation.read"]) as never);
    renderShell("/finance/reconciliation");
    const finance=document.getElementById("admin-group-finance") as HTMLElement;
    expect(screen.getByRole("button",{name:"Finance"})).toHaveAttribute("aria-expanded","true");
    expect(within(finance).getByRole("link",{name:"Reconciliación"})).toHaveAttribute("href","/finance/reconciliation");
    expect(within(finance).queryByRole("link",{name:"Resumen"})).not.toBeInTheDocument();
  });

  it("supports collapsible groups and keeps the active parent highlighted",async()=>{
    renderShell("/marketplace/orders");
    const marketplace=screen.getByRole("button",{name:"Marketplace"});
    expect(marketplace).toHaveClass("is-active");
    expect(marketplace).toHaveAttribute("aria-expanded","true");
    await userEvent.click(marketplace);
    expect(marketplace).toHaveAttribute("aria-expanded","false");
    expect(document.getElementById("admin-group-marketplace")).toBeNull();
  });

  it("keeps every visual navigation entry backed by App routing and every detail route reachable",()=>{
    const app=readFileSync(join(process.cwd(),"src","App.tsx"),"utf8");
    const guardedRoutes=new Map<string,string>();
    for(const match of app.matchAll(/<Route element={<CapabilityRoute capability="([^"]+)"\/>}>(.*?)<\/Route>/gs)){
      for(const route of match[2].matchAll(/path="([^"]+)"/g))guardedRoutes.set(route[1],match[1]);
    }
    adminLinks.forEach((link)=>{
      expect(guardedRoutes.has(link.to),link.to).toBe(true);
      expect(guardedRoutes.get(link.to),link.to).toBe(link.capability);
    });
    const administrativeRoutes=[...app.matchAll(/path="(\/[^"]+)"/g)].map((item)=>item[1]).filter((path)=>path!=="/login");
    administrativeRoutes.forEach((path)=>{
      expect(guardedRoutes.has(path),`${path} capability guard`).toBe(true);
      const visibleParent=adminLinks.some((link)=>path===link.to||path.startsWith(`${link.to}/:`));
      expect(visibleParent,`${path} navigation parent`).toBe(true);
    });
    for(const route of [
      "/finance/transactions/:id","/system/jobs/:id","/marketplace/orders/:orderId",
      "/marketplace/disputes/:id","/marketplace/sellers/:id","/marketplace/products/:id",
      "/marketplace/creator-commerce/:id","/marketplace/promotions/:id","/marketplace/ads/:id",
    ])expect(app,route).toContain(`path="${route}"`);
    const shell=readFileSync(join(process.cwd(),"src","layout","AdminShell.tsx"),"utf8");
    expect(shell).not.toMatch(/SUPER_ADMIN|SUPERUSER|role_code/);
    expect(shell).not.toContain("sectionLinks");
  });
});
