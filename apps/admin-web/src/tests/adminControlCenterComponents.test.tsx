import {useState,type ComponentType, type ReactNode} from "react";
import {render,screen,waitFor,within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {MemoryRouter} from "react-router-dom";
import {describe,expect,it,vi} from "vitest";
import * as dashboard from "../components/AdminDashboard";

type ControlCenterModule={
  AdminPageHeader:ComponentType<{eyebrow?:string;title:string;description?:string;actions?:ReactNode}>;
  AdminStatCard:ComponentType<{label:string;value:ReactNode;detail?:string;tone?:"neutral"|"success"|"warning"|"danger"}>;
  AdminChartPanel:ComponentType<{title:string;description:string;data:Array<{label:string;value:number}>;valueLabel:string}>;
  AdminFilterBar:ComponentType<{label:string;children:ReactNode;onSubmit?:()=>void}>;
  AdminSearchInput:ComponentType<{label:string;value:string;onChange:(value:string)=>void;placeholder?:string}>;
  AdminDateRangeFilter:ComponentType<{label:string;value:string;options:Array<{value:string;label:string}>;onChange:(value:string)=>void}>;
  AdminDataTable:ComponentType<{caption:string;columns:Array<{key:string;label:string;render:(row:{id:string;name:string;status:string})=>ReactNode}>;rows:Array<{id:string;name:string;status:string}>;rowKey:(row:{id:string})=>string;emptyTitle?:string}>;
  AdminPagination:ComponentType<{label:string;page:number;hasPrevious:boolean;hasNext:boolean;onPrevious:()=>void;onNext:()=>void}>;
  AdminDetailDrawer:ComponentType<{open:boolean;title:string;children:ReactNode;onClose:()=>void}>;
  AdminSectionNavigation:ComponentType<{label:string;items:Array<{to:string;label:string}>}>;
  AdminErrorBoundary:ComponentType<{children:ReactNode}>;
};

const ui=dashboard as unknown as ControlCenterModule;

describe("Admin Control Center reusable presentation",()=>{
  it("presents page identity, a status-aware KPI, and an accessible chart with a data fallback",()=>{
    expect(ui.AdminPageHeader).toBeTypeOf("function");
    expect(ui.AdminStatCard).toBeTypeOf("function");
    expect(ui.AdminChartPanel).toBeTypeOf("function");
    render(<><ui.AdminPageHeader eyebrow="Operaciones" title="Centro de control" description="Estado real de Nelyon" actions={<button>Exportar</button>}/><ui.AdminStatCard label="Usuarios activos" value="1,024" detail="Últimos 30 días" tone="success"/><ui.AdminChartPanel title="Actividad" description="Actividad por día" valueLabel="Eventos" data={[{label:"Lun",value:10},{label:"Mar",value:20}]}/></>);
    expect(screen.getByRole("heading",{name:"Centro de control"})).toBeInTheDocument();
    expect(screen.getByRole("article",{name:"Usuarios activos"})).toHaveTextContent("1,024");
    expect(screen.getByRole("figure",{name:"Actividad"})).toHaveAccessibleDescription("Actividad por día");
    const table=screen.getByRole("table",{name:"Datos de Actividad"});
    expect(within(table).getByRole("cell",{name:"20"})).toBeInTheDocument();
  });

  it("provides a labelled filter bar whose search and date range remain controlled",async()=>{
    expect(ui.AdminFilterBar).toBeTypeOf("function");
    expect(ui.AdminSearchInput).toBeTypeOf("function");
    expect(ui.AdminDateRangeFilter).toBeTypeOf("function");
    function Harness(){const [query,setQuery]=useState(""),[range,setRange]=useState("7d"),[submitted,setSubmitted]=useState(false);return <><ui.AdminFilterBar label="Filtros de auditoría" onSubmit={()=>setSubmitted(true)}><ui.AdminSearchInput label="Buscar actor" value={query} onChange={setQuery}/><ui.AdminDateRangeFilter label="Rango" value={range} onChange={setRange} options={[{value:"7d",label:"7 días"},{value:"30d",label:"30 días"}]}/><button type="submit">Aplicar</button></ui.AdminFilterBar><output>{query}|{range}|{submitted?"aplicado":"pendiente"}</output></>}
    render(<Harness/>);
    await userEvent.type(screen.getByRole("searchbox",{name:"Buscar actor"}),"ana");
    await userEvent.selectOptions(screen.getByRole("combobox",{name:"Rango"}),"30d");
    await userEvent.click(screen.getByRole("button",{name:"Aplicar"}));
    expect(screen.getByRole("status")).toHaveTextContent("ana|30d|aplicado");
  });

  it("renders a semantic data table and bounded pagination controls",async()=>{
    expect(ui.AdminDataTable).toBeTypeOf("function");
    expect(ui.AdminPagination).toBeTypeOf("function");
    function Harness(){const [page,setPage]=useState(2);return <><ui.AdminDataTable caption="Administradores" columns={[{key:"name",label:"Nombre",render:(row)=>row.name},{key:"status",label:"Estado",render:(row)=>row.status}]} rows={[{id:"1",name:"Ana",status:"Activa"}]} rowKey={(row)=>row.id}/><ui.AdminPagination label="Páginas de administradores" page={page} hasPrevious={page>1} hasNext={page<3} onPrevious={()=>setPage((value)=>value-1)} onNext={()=>setPage((value)=>value+1)}/></>}
    render(<Harness/>);
    expect(screen.getByRole("table",{name:"Administradores"})).toBeInTheDocument();
    expect(screen.getByRole("columnheader",{name:"Estado"})).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button",{name:"Página siguiente"}));
    expect(screen.getByText("Página 3")).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Página siguiente"})).toBeDisabled();
  });

  it("exposes section links and an Escape-dismissible detail drawer without losing focus",async()=>{
    expect(ui.AdminDetailDrawer).toBeTypeOf("function");
    expect(ui.AdminSectionNavigation).toBeTypeOf("function");
    function Harness(){const [open,setOpen]=useState(false);return <><button onClick={()=>setOpen(true)}>Abrir detalle</button><ui.AdminSectionNavigation label="Secciones financieras" items={[{to:"/finance",label:"Resumen"},{to:"/finance/transactions",label:"Transacciones"}]}/><ui.AdminDetailDrawer open={open} title="Detalle de transacción" onClose={()=>setOpen(false)}><p>Contenido seguro</p></ui.AdminDetailDrawer></>}
    render(<MemoryRouter><Harness/></MemoryRouter>);
    const trigger=screen.getByRole("button",{name:"Abrir detalle"});
    await userEvent.click(trigger);
    expect(screen.getByRole("dialog",{name:"Detalle de transacción"})).toBeInTheDocument();
    await waitFor(()=>expect(screen.getByRole("button",{name:"Cerrar detalle"})).toHaveFocus());
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(screen.getByRole("navigation",{name:"Secciones financieras"})).toHaveTextContent("Transacciones");
  });

  it("contains an unexpected module crash and lets the operator retry",async()=>{
    expect(ui.AdminErrorBoundary).toBeTypeOf("function");
    let shouldThrow=true;
    function Unstable(){if(shouldThrow)throw new Error("sensitive internal detail");return <p>Módulo recuperado</p>}
    const consoleError=vi.spyOn(console,"error").mockImplementation(()=>undefined);
    render(<ui.AdminErrorBoundary><Unstable/></ui.AdminErrorBoundary>);
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo mostrar este módulo");
    expect(screen.queryByText("sensitive internal detail")).not.toBeInTheDocument();
    shouldThrow=false;
    await userEvent.click(screen.getByRole("button",{name:"Reintentar módulo"}));
    expect(screen.getByText("Módulo recuperado")).toBeInTheDocument();
    consoleError.mockRestore();
  });
});
