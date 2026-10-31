import {readFileSync} from "node:fs";
import {join} from "node:path";
import {render,screen} from "@testing-library/react";
import {afterEach,beforeEach,expect,it} from "vitest";

const css=readFileSync(join(process.cwd(),"src/styles/admin.css"),"utf8");
const overview=readFileSync(join(process.cwd(),"src/pages/AdminOverviewPage.tsx"),"utf8");
let stylesheet:HTMLStyleElement;
beforeEach(()=>{stylesheet=document.createElement("style");stylesheet.textContent=css;document.head.append(stylesheet)});
afterEach(()=>stylesheet.remove());
const resolve=(value:string):string=>value.includes("var(")?resolve(value.replace(/var\((--[\w-]+)\)/g,(_,name)=>getComputedStyle(document.documentElement).getPropertyValue(name).trim())):value;
function rgba(value:string):number[]{
 const color=resolve(value).trim();
 if(color==="white")return [255,255,255,1];if(color==="black")return [0,0,0,1];
 if(color.startsWith("#")){const hex=color.slice(1);return (hex.length===3?[...hex].map(x=>x+x):hex.match(/../g)!).map(x=>parseInt(x,16)).concat(1)}
 const channels=color.match(/^rgba?\(([^)]+)\)$/)?.[1].split(",").map(Number);if(!channels)throw new Error(`Unresolved CSS color: ${color}`);return channels.length===3?[...channels,1]:channels;
}
const blend=(fg:number[],bg:number[])=>fg.slice(0,3).map((value,index)=>value*fg[3]+bg[index]*(1-fg[3])).concat(1);
function background(element:Element|null):number[]{if(!element)return [255,255,255,1];const style=getComputedStyle(element),shorthand=style.background.trim();const value=rgba(shorthand.startsWith("var(")?shorthand:style.backgroundColor);return value[3]===1?value:blend(value,background(element.parentElement))}
const luminance=(rgb:number[])=>rgb.slice(0,3).map(value=>value/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
const contrast=(fg:number[],bg:number[])=>{const a=luminance(blend(fg,bg)),b=luminance(bg);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
const expectReadable=(element:Element)=>expect(contrast(rgba(getComputedStyle(element).color),background(element))).toBeGreaterThanOrEqual(4.5);

it("uses a dedicated auto-fit module KPI grid rather than the global six-column page grid",()=>{
 const module=overview.slice(overview.indexOf("function ModuleSummary"),overview.indexOf("function SystemSummary"));
 expect(module).toContain('className="admin-module-kpis"');expect(module).not.toContain('className="metrics-grid"');expect(overview).toContain('className="detail-grid"');
 const rule=css.match(/\.admin-module-kpis\{([^}]+)\}/)?.[1]??"";
 expect(rule).toMatch(/grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,14rem\),1fr\)\)/);
 expect(css).toContain(".detail-grid,.dispute-detail-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))");
 // Model the existing 250px shell, 1500px content cap, 22px content padding,
 // 16px outer gaps and 19px panel padding. Browser layout remains Task 9.
 for(const viewport of [1280,1440,1920,3440]){
  const moduleWidth=(Math.min(viewport-250,1500)-44-32)/3-40;
  const columns=Math.max(1,Math.floor((moduleWidth+12)/(224+12)));
  expect((moduleWidth-(columns-1)*12)/columns).toBeGreaterThanOrEqual(224);
 }
 expect(css).toMatch(/\.admin-module-kpis \.admin-stat-card[^}]*min-width:0/);
 expect(css).toMatch(/\.admin-module-kpis \.admin-stat-card[^}]*overflow-wrap:anywhere/);
});

it("calculates WCAG contrast using the independent black/white reference pair",()=>expect(contrast(rgba("#000"),rgba("#fff"))).toBe(21));

it.each(["KPI heading","KPI amount","KPI caption","KPI detail","Source heading","Source amount","Source count","Source detail","Period heading","Period amount","Trend heading","Trend amount","Detail heading","Detail amount","Reconciliation heading","Reconciliation detail"])("keeps %s AA readable on its actual light revenue surface",label=>{
 render(<section className="platform-revenue"><div className="revenue-kpis"><article><span>KPI caption</span><h4>KPI heading</h4><strong>KPI amount</strong><small>KPI detail</small></article></div><div className="revenue-source-grid"><article><header><strong>Source heading</strong><span>Source count</span></header><b>Source amount</b><small>Source detail</small></article></div><section className="revenue-period-summary"><h4>Period heading</h4><strong>Period amount</strong></section><section className="revenue-trend"><h4>Trend heading</h4><strong>Trend amount</strong></section><section className="detail-card"><h4>Detail heading</h4><strong>Detail amount</strong><div className="admin-status-panel"><div><strong>Reconciliation heading</strong><span>Reconciliation detail</span></div></div></section></section>);
 const element=screen.getByText(label);
 expect(background(element)).toEqual(rgba(label.startsWith("KPI")||label.startsWith("Source")||label.startsWith("Reconciliation")?"#f2f6fc":label.startsWith("Period")?"#f8fbff":"#fff"));
 expectReadable(element);
});

it.each(["badge","eyebrow","back-link","back-link:hover"])("keeps default %s AA readable on its light surface",name=>{
 render(<section className="detail-card"><span className="badge">Lectura</span><p className="eyebrow">CONTROL CENTER</p><a href="/finance" className="back-link">Volver a finanzas</a></section>);
 if(name!=="back-link:hover"){expectReadable(screen.getByText(name==="badge"?"Lectura":name==="eyebrow"?"CONTROL CENTER":"Volver a finanzas"));return}
 const hover=[...css.matchAll(/\.back-link:hover\{([^}]+)\}/g)].at(-1)?.[1].match(/(?:^|;)color:([^;]+)/)?.[1];expect(hover).toBeDefined();
 expect(contrast(rgba(hover!),background(screen.getByText("Volver a finanzas")))).toBeGreaterThanOrEqual(4.5);
});

it("preserves readable dark revenue header/primary values and visible keyboard focus",()=>{
 render(<section className="platform-revenue" style={{backgroundColor:"#07182b"}}><header className="platform-revenue-heading"><p className="eyebrow">INGRESOS DE PLATAFORMA</p><h3>Ingresos reconocidos</h3></header><div className="finance-primary-kpis"><article style={{backgroundColor:"#0c3a77"}}><strong>12.00000000 BDAG</strong></article></div></section>);
 for(const label of ["INGRESOS DE PLATAFORMA","Ingresos reconocidos","12.00000000 BDAG"])expectReadable(screen.getByText(label));
 expect(css).toContain('a:focus-visible');expect(css).toContain('outline:2px solid var(--admin-blue);outline-offset:3px');
 expect(css).toContain('.badge.warn{background:rgba(238,185,78,.12);color:var(--admin-warning)}');
 expect(css).toContain('.badge.success{background:rgba(49,230,161,.11);color:var(--admin-success)}');
});
