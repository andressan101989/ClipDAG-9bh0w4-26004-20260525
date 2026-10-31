import {Link} from "react-router-dom";
import {useAdminAuth} from "../auth/AdminAuthProvider";
import {AdminPageHeader,AdminStatCard} from "../components/AdminControlCenter";
const unavailable=[
 {name:"Stripe",source:"Billing Business dispone de autoridades de top-up por propietario; no existe una proyección administrativa de conexión, credenciales o modo LIVE. Estado externo pendiente de verificación."},
 {name:"Banuba",source:"No existe una autoridad canónica administrativa de integración o runtime del proveedor. Estado pendiente de verificación."},
 {name:"Creator Studio",source:"Las autoridades Premium y Media describen contenido; no prueban disponibilidad del servicio Creator Studio externo. Estado pendiente de verificación."},
 {name:"ALGO-6",source:"Los contratos y reportes locales de ALGO-6 no son una autoridad administrativa de runtime en producción. Estado pendiente de verificación."},
];
const links=[
 {cap:"marketplace.creators.read",to:"/marketplace/creator-commerce",label:"Creator Commerce · atribución de ventas"},
 {cap:"marketplace.sellers.read",to:"/marketplace/sellers",label:"Vendedores · solicitudes y estado canónico"},
 {cap:"advertising.ads.read",to:"/advertising",label:"Business Accounts · inventario Ads canónico"},
 {cap:"finance.ledger.read",to:"/finance",label:"Comisiones y regalos LIVE · ingresos canónicos"},
 {cap:"finance.ledger.read",to:"/finance/creator-premium",label:"Premium · activación y comisión canónicas"},
 {cap:"system.health.read",to:"/system",label:"Sistema · salud y jobs canónicos"},
];
export function AdminOperationalStatusPage(){const {hasCapability}=useAdminAuth();return <>
 <AdminPageHeader eyebrow="SISTEMA · SOLO LECTURA" title="Integraciones y estado operativo" description="El estado de cada servicio requiere su propia autoridad. Las fuentes sin proyección administrativa quedan pendientes y sin acciones de activación."/>
 <section className="detail-card"><h2>Seguridad</h2><p>La sesión, el nivel AAL y los factores verificados se consultan en la pantalla de seguridad existente.</p><Link to="/system/security">Seguridad y MFA · sesión actual</Link></section>
 <section className="detail-card"><h2>Superficies canónicas</h2><p>Las métricas por fecha están en el dashboard ejecutivo. Estos enlaces abren la autoridad contextual existente.</p><ul>{links.filter(item=>hasCapability(item.cap)).map(item=><li key={item.to}><Link to={item.to}>{item.label}</Link></li>)}</ul></section>
 <div className="detail-grid">{unavailable.map(item=><section role="region" aria-label={item.name} className="detail-card" key={item.name}><h2>{item.name}</h2><AdminStatCard label={`Estado de ${item.name}`} value="No disponible" detail={item.source}/></section>)}</div>
 </>}
