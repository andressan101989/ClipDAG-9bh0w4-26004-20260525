import type {AdminIconName} from "../components/AdminIcon";

export type AdminNavigationGroup="overview"|"community"|"content_safety"|"live"|"marketplace"|"advertising"|"finance"|"system";
export type AdminNavigationGroupDefinition={id:AdminNavigationGroup;label:string;icon:AdminIconName};
export type AdminLink={
  to:string;
  label:string;
  capability:string;
  additionalCapabilities?:string[];
  icon:AdminIconName;
  primary?:boolean;
  end?:boolean;
  group:AdminNavigationGroup;
  sectionLabel:string;
};

export const adminNavigationGroups:AdminNavigationGroupDefinition[]=[
  {id:"overview",label:"Overview",icon:"overview"},
  {id:"community",label:"Users & Community",icon:"users"},
  {id:"content_safety",label:"Content Safety",icon:"content"},
  {id:"live",label:"LIVE & Entertainment",icon:"live"},
  {id:"marketplace",label:"Marketplace",icon:"marketplace"},
  {id:"advertising",label:"Advertising",icon:"advertising"},
  {id:"finance",label:"Finance",icon:"finance"},
  {id:"system",label:"System",icon:"system"},
];

export const adminLinks:AdminLink[]=[
  {to:"/overview",label:"Overview",capability:"admin.shell.access",icon:"overview",primary:true,end:true,group:"overview",sectionLabel:"Dashboard ejecutivo"},
  {to:"/users",label:"Users",capability:"users.accounts.read",icon:"users",primary:true,group:"community",sectionLabel:"Usuarios"},
  {to:"/reports",label:"Reports",capability:"reports.cases.read",icon:"reports",primary:true,group:"community",sectionLabel:"Reportes"},
  {to:"/access",label:"Access",capability:"admin.roles.read",icon:"access",primary:true,group:"community",sectionLabel:"Roles y permisos"},
  {to:"/content",label:"Content",capability:"content.items.read",icon:"content",primary:true,group:"content_safety",sectionLabel:"Publicaciones"},
  {to:"/stories",label:"Stories",capability:"stories.items.read",icon:"stories",primary:true,group:"content_safety",sectionLabel:"Stories"},
  {to:"/creator-premium",label:"Seguridad Premium",capability:"creator_premium.review.read",icon:"content",primary:true,group:"content_safety",sectionLabel:"Creator Premium"},
  {to:"/chat/reports",label:"Chat",capability:"chat.abuse_reports.read",icon:"chat",primary:true,group:"content_safety",sectionLabel:"Chat reportado"},
  {to:"/media",label:"Media",capability:"media.assets.read",icon:"media",primary:true,group:"content_safety",sectionLabel:"Media y Cloudflare"},
  {to:"/content-safety",label:"Content Safety",capability:"content.items.read",icon:"content",primary:true,end:true,group:"content_safety",sectionLabel:"Alertas"},
  {to:"/content-safety/audio",label:"Content Safety · Audio AI",capability:"content.items.read",icon:"content",group:"content_safety",sectionLabel:"Audio AI"},
  {to:"/content-safety/visual",label:"Content Safety · Visual AI",capability:"content.items.read",icon:"content",group:"content_safety",sectionLabel:"Visual AI"},
  {to:"/content-safety/rules",label:"Content Safety · Reglas",capability:"content.items.moderate",icon:"content",group:"content_safety",sectionLabel:"Reglas"},
  {to:"/live",label:"LIVE",capability:"live.sessions.read",icon:"live",primary:true,group:"live",sectionLabel:"Transmisiones LIVE"},
  {to:"/battles",label:"Battles",capability:"battles.sessions.read",icon:"battles",primary:true,group:"live",sectionLabel:"Batallas"},
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
  {to:"/advertising",label:"Advertising",capability:"advertising.ads.read",icon:"advertising",primary:true,end:true,group:"advertising",sectionLabel:"Overview"},
  {to:"/advertising/campaigns",label:"Advertising · Campaigns",capability:"advertising.ads.read",icon:"advertising",group:"advertising",sectionLabel:"Campaigns"},
  {to:"/advertising/review",label:"Advertising · Review Queue",capability:"content.items.read",icon:"advertising",group:"advertising",sectionLabel:"Review Queue"},
  {to:"/advertising/analytics",label:"Advertising · Analytics",capability:"advertising.ads.read",icon:"advertising",group:"advertising",sectionLabel:"Analytics"},
  {to:"/advertising/health",label:"Advertising · Health",capability:"advertising.ads.read",icon:"advertising",group:"advertising",sectionLabel:"Health"},
  {to:"/advertising/billing",label:"Advertising · Billing",capability:"advertising.billing.read",icon:"advertising",group:"advertising",sectionLabel:"Billing & Rates"},
  {to:"/advertising/finance-health",label:"Advertising · Finance Health",capability:"finance.reconciliation.read",additionalCapabilities:["advertising.billing.read"],icon:"advertising",group:"advertising",sectionLabel:"Finance Health"},
  {to:"/finance",label:"Finance",capability:"finance.ledger.read",icon:"finance",primary:true,end:true,group:"finance",sectionLabel:"Resumen"},
  {to:"/finance/accounts",label:"Finance · Cuentas",capability:"finance.ledger.read",icon:"finance",group:"finance",sectionLabel:"Cuentas"},
  {to:"/finance/transactions",label:"Finance · Transacciones",capability:"finance.ledger.read",icon:"finance",group:"finance",sectionLabel:"Transacciones"},
  {to:"/finance/creator-premium",label:"Finance · Creator Premium",capability:"finance.ledger.read",icon:"finance",group:"finance",sectionLabel:"Creator Premium"},
  {to:"/finance/reconciliation",label:"Finance · Reconciliación",capability:"finance.reconciliation.read",icon:"finance",group:"finance",sectionLabel:"Reconciliación"},
  {to:"/finance/anomalies",label:"Finance · Anomalías",capability:"finance.anomalies.read",icon:"finance",group:"finance",sectionLabel:"Anomalías"},
  {to:"/finance/audit",label:"Finance · Auditoría",capability:"finance.audit.read",icon:"finance",group:"finance",sectionLabel:"Auditoría"},
  {to:"/audit",label:"Audit",capability:"admin.audit.read",icon:"audit",primary:true,group:"system",sectionLabel:"Auditoría administrativa"},
  {to:"/system",label:"System",capability:"system.health.read",icon:"system",primary:true,end:true,group:"system",sectionLabel:"Salud"},
  {to:"/system/jobs",label:"System · Jobs",capability:"system.jobs.read",icon:"system",group:"system",sectionLabel:"Jobs"},
  {to:"/system/security",label:"System · Seguridad",capability:"admin.shell.access",icon:"system",group:"system",sectionLabel:"Seguridad de la cuenta"},
  {to:"/system/audit",label:"System · Auditoría",capability:"system.audit.read",icon:"system",group:"system",sectionLabel:"Auditoría técnica"},
];
