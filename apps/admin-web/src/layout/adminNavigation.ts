import type {AdminIconName} from "../components/AdminIcon";

export type AdminNavigationGroup="content_safety"|"finance"|"marketplace"|"system";
export type AdminLink={
  to:string;
  label:string;
  capability:string;
  icon:AdminIconName;
  primary?:boolean;
  end?:boolean;
  group?:AdminNavigationGroup;
  sectionLabel?:string;
};

export const adminLinks:AdminLink[]=[
  {to:"/overview",label:"Overview",capability:"admin.shell.access",icon:"overview",primary:true,end:true},
  {to:"/users",label:"Users",capability:"users.accounts.read",icon:"users",primary:true},
  {to:"/reports",label:"Reports",capability:"reports.cases.read",icon:"reports",primary:true},
  {to:"/content",label:"Content",capability:"content.items.read",icon:"content",primary:true},
  {to:"/stories",label:"Stories",capability:"stories.items.read",icon:"stories",primary:true},
  {to:"/chat/reports",label:"Chat",capability:"chat.abuse_reports.read",icon:"chat",primary:true},
  {to:"/live",label:"LIVE",capability:"live.sessions.read",icon:"live",primary:true},
  {to:"/battles",label:"Battles",capability:"battles.sessions.read",icon:"battles",primary:true},
  {to:"/media",label:"Media",capability:"media.assets.read",icon:"media",primary:true},
  {to:"/content-safety",label:"Content Safety",capability:"content.items.read",icon:"content",primary:true,end:true,group:"content_safety",sectionLabel:"Alertas"},
  {to:"/content-safety/rules",label:"Content Safety · Reglas",capability:"content.items.moderate",icon:"content",group:"content_safety",sectionLabel:"Reglas"},
  {to:"/finance",label:"Finance",capability:"finance.ledger.read",icon:"finance",primary:true,end:true,group:"finance",sectionLabel:"Resumen"},
  {to:"/finance/accounts",label:"Finance · Cuentas",capability:"finance.ledger.read",icon:"finance",group:"finance",sectionLabel:"Cuentas"},
  {to:"/finance/transactions",label:"Finance · Transacciones",capability:"finance.ledger.read",icon:"finance",group:"finance",sectionLabel:"Transacciones"},
  {to:"/finance/reconciliation",label:"Finance · Reconciliación",capability:"finance.reconciliation.read",icon:"finance",group:"finance",sectionLabel:"Reconciliación"},
  {to:"/finance/anomalies",label:"Finance · Anomalías",capability:"finance.anomalies.read",icon:"finance",group:"finance",sectionLabel:"Anomalías"},
  {to:"/finance/audit",label:"Finance · Auditoría",capability:"finance.audit.read",icon:"finance",group:"finance",sectionLabel:"Auditoría"},
  {to:"/marketplace",label:"Marketplace",capability:"marketplace.overview.read",icon:"marketplace",primary:true,end:true,group:"marketplace",sectionLabel:"Resumen"},
  {to:"/marketplace/orders",label:"Marketplace · Pedidos",capability:"marketplace.orders.read",icon:"marketplace",group:"marketplace",sectionLabel:"Pedidos"},
  {to:"/marketplace/disputes",label:"Marketplace · Disputas",capability:"marketplace.disputes.read",icon:"marketplace",group:"marketplace",sectionLabel:"Disputas"},
  {to:"/marketplace/sellers",label:"Marketplace · Vendedores",capability:"marketplace.sellers.read",icon:"marketplace",group:"marketplace",sectionLabel:"Vendedores"},
  {to:"/marketplace/products",label:"Marketplace · Productos",capability:"marketplace.products.read",icon:"marketplace",group:"marketplace",sectionLabel:"Productos"},
  {to:"/marketplace/creator-commerce",label:"Marketplace · Creator Commerce",capability:"marketplace.creators.read",icon:"marketplace",group:"marketplace",sectionLabel:"Creator Commerce"},
  {to:"/marketplace/promotions",label:"Marketplace · Promociones",capability:"marketplace.promotions.read",icon:"marketplace",group:"marketplace",sectionLabel:"Promociones"},
  {to:"/marketplace/ads",label:"Marketplace · Ads",capability:"marketplace.ads.read",icon:"marketplace",group:"marketplace",sectionLabel:"Ads"},
  {to:"/marketplace/health",label:"Marketplace · Salud",capability:"marketplace.health.read",icon:"marketplace",group:"marketplace",sectionLabel:"Salud"},
  {to:"/marketplace/activity",label:"Marketplace · Actividad",capability:"marketplace.audit.read",icon:"marketplace",group:"marketplace",sectionLabel:"Actividad"},
  {to:"/audit",label:"Audit",capability:"admin.audit.read",icon:"audit",primary:true},
  {to:"/system",label:"System",capability:"system.health.read",icon:"system",primary:true,end:true,group:"system",sectionLabel:"Salud"},
  {to:"/system/jobs",label:"System · Jobs",capability:"system.jobs.read",icon:"system",group:"system",sectionLabel:"Jobs"},
  {to:"/system/audit",label:"System · Auditoría",capability:"system.audit.read",icon:"system",group:"system",sectionLabel:"Auditoría"},
  {to:"/access",label:"Access",capability:"admin.roles.read",icon:"access",primary:true},
];
