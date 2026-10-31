import {useEffect,useId,useRef,type FormEvent,type ReactNode} from "react";
import {createPortal} from "react-dom";
import {NavLink} from "react-router-dom";

const FOCUSABLE_SELECTOR='a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const getFocusableElements=(root:HTMLElement)=>Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element)=>{const style=getComputedStyle(element);return !element.hidden&&element.getAttribute("aria-hidden")!=="true"&&style.display!=="none"&&style.visibility!=="hidden"});

export function AdminPageHeader({eyebrow,title,description,actions}:{eyebrow?:string;title:string;description?:string;actions?:ReactNode}){
  return <header className="admin-page-header"><div>{eyebrow&&<p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description&&<p>{description}</p>}</div>{actions&&<div className="admin-page-actions">{actions}</div>}</header>;
}

export function AdminBreadcrumbs({items}:{items:Array<{label:string;to?:string;current?:boolean}>}){
  return <nav aria-label="Ruta actual" className="admin-breadcrumbs"><ol>{items.map((item,index)=><li key={`${item.label}-${index}`}>{item.to&&!item.current?<NavLink to={item.to}>{item.label}</NavLink>:<span aria-current={item.current?"page":undefined}>{item.label}</span>}</li>)}</ol></nav>;
}

export function AdminStatCard({label,value,detail,tone="neutral"}:{label:string;value:ReactNode;detail?:string;tone?:"neutral"|"success"|"warning"|"danger"}){
  return <article aria-label={label} className={`admin-stat-card ${tone}`}><span>{label}</span><strong>{value}</strong>{detail&&<small>{detail}</small>}</article>;
}

export function AdminChartPanel({title,description,data,valueLabel}:{title:string;description:string;data:Array<{label:string;value:number}>;valueLabel:string}){
  const titleId=useId(),descriptionId=useId(),maximum=Math.max(1,...data.map((item)=>Math.max(0,item.value)));
  return <figure aria-describedby={descriptionId} aria-labelledby={titleId} className="admin-chart-panel"><figcaption><strong id={titleId}>{title}</strong><span id={descriptionId}>{description}</span></figcaption><div aria-hidden="true" className="admin-chart-bars">{data.map((item)=><div key={item.label}><span>{item.label}</span><i><b style={{width:`${Math.max(0,item.value)/maximum*100}%`}}/></i><strong>{item.value}</strong></div>)}</div><table className="sr-only"><caption>{`Datos de ${title}`}</caption><thead><tr><th>Periodo</th><th>{valueLabel}</th></tr></thead><tbody>{data.map((item)=><tr key={item.label}><td>{item.label}</td><td>{item.value}</td></tr>)}</tbody></table></figure>;
}

export function AdminFilterBar({label,children,onSubmit}:{label:string;children:ReactNode;onSubmit?:()=>void}){
  const submit=(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();onSubmit?.()};
  return <form aria-label={label} className="admin-filter-bar" onSubmit={submit}>{children}</form>;
}

export function AdminSearchInput({label,value,onChange,placeholder="Buscar…"}:{label:string;value:string;onChange:(value:string)=>void;placeholder?:string}){
  return <label className="admin-search-input"><span>{label}</span><input aria-label={label} onChange={(event)=>onChange(event.target.value)} placeholder={placeholder} type="search" value={value}/></label>;
}

export function AdminDateRangeFilter({label,value,options,onChange}:{label:string;value:string;options:Array<{value:string;label:string}>;onChange:(value:string)=>void}){
  return <label className="admin-date-range"><span>{label}</span><select aria-label={label} onChange={(event)=>onChange(event.target.value)} value={value}>{options.map((option)=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

export type AdminDataTableColumn<T>={key:string;label:string;render:(row:T)=>ReactNode;align?:"start"|"center"|"end"};
export function AdminDataTable<T>({caption,columns,rows,rowKey,emptyTitle="Sin resultados"}:{caption:string;columns:Array<AdminDataTableColumn<T>>;rows:T[];rowKey:(row:T)=>string;emptyTitle?:string}){
  return <div className="admin-data-table-wrap"><table className="admin-data-table"><caption>{caption}</caption><thead><tr>{columns.map((column)=><th className={column.align?`align-${column.align}`:undefined} key={column.key} scope="col">{column.label}</th>)}</tr></thead><tbody>{rows.length?rows.map((row)=><tr key={rowKey(row)}>{columns.map((column)=><td className={column.align?`align-${column.align}`:undefined} key={column.key}>{column.render(row)}</td>)}</tr>):<tr><td className="admin-data-table-empty" colSpan={Math.max(1,columns.length)}>{emptyTitle}</td></tr>}</tbody></table></div>;
}

export function AdminPagination({label,page,hasPrevious,hasNext,onPrevious,onNext}:{label:string;page:number;hasPrevious:boolean;hasNext:boolean;onPrevious:()=>void;onNext:()=>void}){
  return <nav aria-label={label} className="admin-pagination"><button className="secondary" disabled={!hasPrevious} onClick={onPrevious} type="button">Página anterior</button><span aria-live="polite">Página {page}</span><button className="secondary" disabled={!hasNext} onClick={onNext} type="button">Página siguiente</button></nav>;
}

export function AdminDetailDrawer({open,title,children,onClose}:{open:boolean;title:string;children:ReactNode;onClose:()=>void}){
  const titleId=useId(),backdropRef=useRef<HTMLDivElement>(null),dialogRef=useRef<HTMLElement>(null),closeRef=useRef<HTMLButtonElement>(null),returnFocusRef=useRef<HTMLElement|null>(null),onCloseRef=useRef(onClose);
  onCloseRef.current=onClose;
  useEffect(()=>{
    const backdrop=backdropRef.current,dialog=dialogRef.current;
    if(!open||!backdrop||!dialog)return;
    returnFocusRef.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const background=Array.from(document.body.children).filter((element)=>element!==backdrop).map((element)=>({element,hadInert:element.hasAttribute("inert"),ariaHidden:element.getAttribute("aria-hidden")}));
    for(const {element} of background){element.setAttribute("inert","");element.setAttribute("aria-hidden","true")}
    closeRef.current?.focus();
    const onKeyDown=(event:KeyboardEvent)=>{
      if(event.key==="Escape"){event.preventDefault();onCloseRef.current();return}
      if(event.key!=="Tab")return;
      const focusable=getFocusableElements(dialog),first=focusable[0],last=focusable.at(-1),active=document.activeElement;
      if(!first||!last){event.preventDefault();dialog.focus();return}
      if(event.shiftKey&&(active===first||!dialog.contains(active))){event.preventDefault();last.focus()}
      else if(!event.shiftKey&&(active===last||!dialog.contains(active))){event.preventDefault();first.focus()}
    };
    document.addEventListener("keydown",onKeyDown);
    return()=>{
      document.removeEventListener("keydown",onKeyDown);
      for(const {element,hadInert,ariaHidden} of background){if(!hadInert)element.removeAttribute("inert");if(ariaHidden===null)element.removeAttribute("aria-hidden");else element.setAttribute("aria-hidden",ariaHidden)}
      returnFocusRef.current?.focus();returnFocusRef.current=null;
    };
  },[open]);
  if(!open)return null;
  return createPortal(<div className="admin-drawer-backdrop" onMouseDown={(event)=>{if(event.target===event.currentTarget)onClose()}} ref={backdropRef}><aside aria-labelledby={titleId} aria-modal="true" className="admin-detail-drawer" ref={dialogRef} role="dialog" tabIndex={-1}><header><h2 id={titleId}>{title}</h2><button aria-label="Cerrar detalle" className="icon-button" onClick={onClose} ref={closeRef} type="button">×</button></header><div className="admin-detail-drawer-body">{children}</div></aside></div>,document.body);
}

export function AdminSectionNavigation({label,items}:{label:string;items:Array<{to:string;label:string;end?:boolean}>}){
  const hasChild=(route:string)=>items.some((item)=>item.to!==route&&item.to.startsWith(`${route.replace(/\/$/,"")}/`));
  return <nav aria-label={label} className="admin-section-navigation">{items.map((item)=><NavLink end={item.end??hasChild(item.to)} key={item.to} to={item.to}>{item.label}</NavLink>)}</nav>;
}
