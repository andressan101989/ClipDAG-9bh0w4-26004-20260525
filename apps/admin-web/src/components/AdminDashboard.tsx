import type {ReactNode} from "react";
import {AdminIcon,type AdminIconName} from "./AdminIcon";

export function AdminMetricCard({label,value,detail,icon}:{label:string;value:ReactNode;detail:string;icon:AdminIconName}){return <article className="dashboard-metric"><span className="dashboard-icon"><AdminIcon name={icon}/></span><div><span>{label}</span><strong>{value}</strong><small><i/> {detail}</small></div></article>}

export function AdminPanel({title,aside,children,className=""}:{title:string;aside?:ReactNode;children:ReactNode;className?:string}){return <section className={`dashboard-panel ${className}`.trim()}><header><h3>{title}</h3>{aside}</header>{children}</section>}

export function AdminStatusBadge({children,tone="neutral"}:{children:ReactNode;tone?:"success"|"warning"|"danger"|"neutral"}){return <span className={`admin-status ${tone}`}><i/>{children}</span>}
