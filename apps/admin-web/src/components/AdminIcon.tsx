import type {ReactNode} from "react";

export type AdminIconName="overview"|"users"|"reports"|"content"|"stories"|"chat"|"live"|"battles"|"media"|"finance"|"marketplace"|"audit"|"system"|"access"|"search"|"logout"|"menu"|"close";

const paths:Record<AdminIconName,ReactNode>={
  overview:<><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
  users:<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
  reports:<><path d="M6 3h12l3 3v15H3V3h3Z"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
  content:<><rect x="3" y="4" width="18" height="16" rx="3"/><path d="m9 9 6 3-6 3V9Z"/></>,
  stories:<><rect x="5" y="2" width="14" height="20" rx="4"/><path d="m10 9 5 3-5 3V9Z"/></>,
  chat:<><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z"/><path d="M8 9h8M8 13h5"/></>,
  live:<><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/><circle cx="12" cy="12" r="2"/></>,
  battles:<><path d="m8 4 8 16M16 4 8 20M5 7l3-3 3 3M13 17l3 3 3-3"/></>,
  media:<><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></>,
  finance:<><circle cx="12" cy="12" r="9"/><path d="M16 8.5c-.7-1-1.8-1.5-3.3-1.5-1.8 0-3.2.9-3.2 2.3 0 3.5 6.5 1.6 6.5 5 0 1.6-1.5 2.7-3.5 2.7-1.7 0-3-.6-3.8-1.8M12.5 5v14"/></>,
  marketplace:<><path d="M4 8h16l-1-4H5L4 8Z"/><path d="M5 8v12h14V8M9 20v-6h6v6"/><path d="M4 8c0 2 3 2 4 0 1 2 3 2 4 0 1 2 3 2 4 0 1 2 4 2 4 0"/></>,
  audit:<><path d="M12 3 4 6v6c0 5 3.4 8 8 9 4.6-1 8-4 8-9V6l-8-3Z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></>,
  system:<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
  access:<><circle cx="8" cy="8" r="4"/><path d="M11 11 21 21M15 15l2-2M18 18l2-2"/></>,
  search:<><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
  logout:<><path d="M10 17l5-5-5-5M15 12H3M21 3v18h-8"/></>,
  menu:<><path d="M4 7h16M4 12h16M4 17h16"/></>,
  close:<><path d="m6 6 12 12M18 6 6 18"/></>,
};

export function AdminIcon({name,size=18}:{name:AdminIconName;size?:number}){return <svg aria-hidden="true" className="admin-icon" fill="none" height={size} viewBox="0 0 24 24" width={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7">{paths[name]}</svg>}
