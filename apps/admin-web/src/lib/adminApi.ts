import { supabase } from "./supabase";

export const ranges = ["7d", "30d", "90d", "all"] as const;
export type AdminRange = (typeof ranges)[number];
export type Money = string | number;
export type AdminAccess = { user_id:string;username:string|null;display_name:string|null;admin:true;capabilities:string[] };
export type Overview = {
  range:AdminRange;generated_at:string;
  commerce:{ orders:number;paid_orders:number;paid_gmv:Money;units:number;pending_fulfillment:number;shipped:number;delivered:number;refunded_orders:number;reversed_orders:number;reversed_gross:Money };
  sellers:{ approved:number;active_stores:number };
  products:{ active_published:number;requiring_attention:number };
  creator_commerce:{ attributed_orders:number;attributed_gmv:Money;commission_generated:Money;commission_released:Money;commission_reversed:Money;commission_net:Money };
  operations:{ open_disputes:number;held_allocations:number };
};
export type OrderSummary = { id:string;order_number:string;created_at:string;status:string;currency:string;amount:Money;buyer_name:string;seller_name:string;store_id:string;store_name:string;item_count:number;payment_status:string|null;fulfillment_status:string|null;settlement_status:string|null;dispute_open:boolean;reversed:boolean;creator_commerce:boolean;source_surfaces:string[] };
export type OrderCursor = { created_at:string;id:string };
export type OrderPage = { range:AdminRange;orders:OrderSummary[];next_cursor:OrderCursor|null;page_size:number };
export type OrderDetail = {
  order:Record<string,unknown>;buyer:Record<string,unknown>;seller:Record<string,unknown>;store:Record<string,unknown>;
  items:Array<Record<string,unknown>>;payment:Record<string,unknown>|null;payment_allocation:Record<string,unknown>|null;
  shipping:{ address:Record<string,unknown>|null;shipment:Record<string,unknown>|null };
  creator_attributions:Array<Record<string,unknown>>;creator_allocations:Array<Record<string,unknown>>;
  settlement:Record<string,unknown>|null;settlement_legs:Array<Record<string,unknown>>;
  dispute:Record<string,unknown>|null;reversal:Record<string,unknown>|null;
  reversal_legs:Array<Record<string,unknown>>;timeline:Array<Record<string,unknown>>;
};
export type OrderSearch = { query?:string;status?:string;range:AdminRange;storeId?:string;sourceSurface?:string;cursor?:OrderCursor;limit?:number };

const invalid=(name:string):never=>{throw new Error(`Respuesta inválida: ${name}`);};
const object=(value:unknown,name:string):Record<string,unknown>=>value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:invalid(name);
const nullableObject=(value:unknown,name:string)=>value===null?null:object(value,name);
const string=(value:unknown,name:string)=>typeof value==="string"?value:invalid(name);
const nullableString=(value:unknown,name:string)=>value===null?null:string(value,name);
const number=(value:unknown,name:string)=>typeof value==="number"&&Number.isFinite(value)?value:invalid(name);
const integer=(value:unknown,name:string)=>{const parsed=number(value,name);return Number.isInteger(parsed)?parsed:invalid(name);};
const bool=(value:unknown,name:string)=>typeof value==="boolean"?value:invalid(name);
const array=(value:unknown,name:string)=>Array.isArray(value)?value:invalid(name);
const uuid=(value:unknown,name:string)=>{const parsed=string(value,name);return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed)?parsed:invalid(name);};
const nullableUuid=(value:unknown,name:string)=>value===null?null:uuid(value,name);
const date=(value:unknown,name:string)=>{const parsed=string(value,name);return Number.isNaN(Date.parse(parsed))?invalid(name):parsed;};
const nullableDate=(value:unknown,name:string)=>value===null?null:date(value,name);
const money=(value:unknown,name:string):Money=>(typeof value==="string"||typeof value==="number")&&/^\d+(\.\d+)?$/.test(String(value))?value:invalid(name);
const nullableMoney=(value:unknown,name:string)=>value===null?null:money(value,name);
const range=(value:unknown):AdminRange=>ranges.includes(value as AdminRange)?value as AdminRange:invalid("range");

async function rpc(name:string,args:Record<string,unknown>={}){const {data,error}=await supabase.rpc(name,args);if(error)throw new Error(error.message||"No se pudo consultar Marketplace");return data as unknown;}

export async function getAdminAccess():Promise<AdminAccess>{
  const value=object(await rpc("get_my_marketplace_admin_access"),"access");
  if(value.admin!==true)throw new Error("Acceso administrativo denegado");
  return {user_id:uuid(value.user_id,"user_id"),username:nullableString(value.username,"username"),display_name:nullableString(value.display_name,"display_name"),admin:true,capabilities:array(value.capabilities,"capabilities").map((entry)=>string(entry,"capability"))};
}

export async function getOverview(selected:AdminRange):Promise<Overview>{
  const value=object(await rpc("get_marketplace_admin_overview",{p_range:selected}),"overview"),commerce=object(value.commerce,"commerce"),sellers=object(value.sellers,"sellers"),products=object(value.products,"products"),creator=object(value.creator_commerce,"creator_commerce"),operations=object(value.operations,"operations");
  return {range:range(value.range),generated_at:date(value.generated_at,"generated_at"),commerce:{orders:number(commerce.orders,"orders"),paid_orders:number(commerce.paid_orders,"paid_orders"),paid_gmv:money(commerce.paid_gmv,"paid_gmv"),units:number(commerce.units,"units"),pending_fulfillment:number(commerce.pending_fulfillment,"pending_fulfillment"),shipped:number(commerce.shipped,"shipped"),delivered:number(commerce.delivered,"delivered"),refunded_orders:number(commerce.refunded_orders,"refunded_orders"),reversed_orders:number(commerce.reversed_orders,"reversed_orders"),reversed_gross:money(commerce.reversed_gross,"reversed_gross")},sellers:{approved:number(sellers.approved,"approved"),active_stores:number(sellers.active_stores,"active_stores")},products:{active_published:number(products.active_published,"active_published"),requiring_attention:number(products.requiring_attention,"requiring_attention")},creator_commerce:{attributed_orders:number(creator.attributed_orders,"attributed_orders"),attributed_gmv:money(creator.attributed_gmv,"attributed_gmv"),commission_generated:money(creator.commission_generated,"commission_generated"),commission_released:money(creator.commission_released,"commission_released"),commission_reversed:money(creator.commission_reversed,"commission_reversed"),commission_net:money(creator.commission_net,"commission_net")},operations:{open_disputes:number(operations.open_disputes,"open_disputes"),held_allocations:number(operations.held_allocations,"held_allocations")}};
}

export async function searchOrders(input:OrderSearch):Promise<OrderPage>{
  const value=object(await rpc("search_marketplace_admin_orders",{p_query:input.query||null,p_status:input.status||null,p_range:input.range,p_store_id:input.storeId||null,p_source_surface:input.sourceSurface||null,p_cursor_created_at:input.cursor?.created_at||null,p_cursor_id:input.cursor?.id||null,p_limit:input.limit??50}),"order_page");
  const orders=array(value.orders,"orders").map((entry):OrderSummary=>{const item=object(entry,"order");return{id:uuid(item.id,"id"),order_number:string(item.order_number,"order_number"),created_at:date(item.created_at,"created_at"),status:string(item.status,"status"),currency:string(item.currency,"currency"),amount:money(item.amount,"amount"),buyer_name:string(item.buyer_name,"buyer_name"),seller_name:string(item.seller_name,"seller_name"),store_id:uuid(item.store_id,"store_id"),store_name:string(item.store_name,"store_name"),item_count:number(item.item_count,"item_count"),payment_status:nullableString(item.payment_status,"payment_status"),fulfillment_status:nullableString(item.fulfillment_status,"fulfillment_status"),settlement_status:nullableString(item.settlement_status,"settlement_status"),dispute_open:bool(item.dispute_open,"dispute_open"),reversed:bool(item.reversed,"reversed"),creator_commerce:bool(item.creator_commerce,"creator_commerce"),source_surfaces:array(item.source_surfaces,"source_surfaces").map((surface)=>string(surface,"source_surface"))};});
  const next=value.next_cursor===null?null:(()=>{const cursor=object(value.next_cursor,"cursor");return{created_at:date(cursor.created_at,"cursor.created_at"),id:uuid(cursor.id,"cursor.id")};})();
  return {range:range(value.range),orders,next_cursor:next,page_size:number(value.page_size,"page_size")};
}

const validateOrder=(value:unknown)=>{const item=object(value,"order");uuid(item.id,"order.id");string(item.order_number,"order.order_number");string(item.status,"order.status");string(item.currency,"order.currency");money(item.subtotal,"order.subtotal");money(item.shipping_amount,"order.shipping_amount");money(item.total,"order.total");date(item.created_at,"order.created_at");for(const key of["confirmed_at","processing_at","shipped_at","delivered_at"] as const)nullableDate(item[key],`order.${key}`);return item;};
const validateBuyer=(value:unknown)=>{const item=object(value,"buyer");uuid(item.id,"buyer.id");nullableString(item.username,"buyer.username");nullableString(item.display_name,"buyer.display_name");return item;};
const validateSeller=(value:unknown)=>{const item=object(value,"seller");uuid(item.id,"seller.id");nullableString(item.display_name,"seller.display_name");string(item.status,"seller.status");return item;};
const validateStore=(value:unknown)=>{const item=object(value,"store");uuid(item.id,"store.id");string(item.name,"store.name");string(item.slug,"store.slug");string(item.status,"store.status");return item;};
const validateItem=(value:unknown,index:number)=>{const name=`items[${index}]`,item=object(value,name);uuid(item.id,`${name}.id`);uuid(item.product_id,`${name}.product_id`);uuid(item.variant_id,`${name}.variant_id`);string(item.product_title,`${name}.product_title`);nullableString(item.variant_title,`${name}.variant_title`);string(item.sku,`${name}.sku`);nullableString(item.image_url,`${name}.image_url`);string(item.currency,`${name}.currency`);money(item.unit_price,`${name}.unit_price`);if(integer(item.quantity,`${name}.quantity`)<1)invalid(`${name}.quantity`);money(item.line_total,`${name}.line_total`);const creator=nullableObject(item.creator,`${name}.creator`);if(creator){uuid(creator.creator_user_id,`${name}.creator.creator_user_id`);nullableString(creator.creator_username,`${name}.creator.creator_username`);nullableString(creator.creator_display_name,`${name}.creator.creator_display_name`);string(creator.source_surface,`${name}.creator.source_surface`);uuid(creator.source_entity_id,`${name}.creator.source_entity_id`);integer(creator.historical_bps,`${name}.creator.historical_bps`);money(creator.item_gmv,`${name}.creator.item_gmv`);nullableMoney(creator.allocation_amount,`${name}.creator.allocation_amount`);nullableUuid(creator.allocation_id,`${name}.creator.allocation_id`);}return{...item,creator};};
const validatePayment=(value:unknown)=>{const item=nullableObject(value,"payment");if(!item)return null;uuid(item.id,"payment.id");string(item.status,"payment.status");string(item.currency,"payment.currency");money(item.gross_amount,"payment.gross_amount");money(item.escrow_amount,"payment.escrow_amount");integer(item.fee_bps,"payment.fee_bps");date(item.paid_at,"payment.paid_at");nullableDate(item.refunded_at,"payment.refunded_at");return item;};
const validatePaymentAllocation=(value:unknown)=>{const item=nullableObject(value,"payment_allocation");if(!item)return null;uuid(item.id,"payment_allocation.id");string(item.status,"payment_allocation.status");for(const key of["gross_amount","platform_fee_amount","seller_net_amount","creator_commission_amount"] as const)money(item[key],`payment_allocation.${key}`);nullableDate(item.released_at,"payment_allocation.released_at");nullableDate(item.refunded_at,"payment_allocation.refunded_at");return item;};
const validateShipping=(value:unknown)=>{const item=object(value,"shipping"),address=nullableObject(item.address,"shipping.address"),shipment=nullableObject(item.shipment,"shipping.shipment");if(address){string(address.recipient_name,"shipping.address.recipient_name");string(address.line1,"shipping.address.line1");nullableString(address.line2,"shipping.address.line2");for(const key of["city","region","postal_code","country"] as const)string(address[key],`shipping.address.${key}`);}if(shipment){string(shipment.status,"shipping.shipment.status");string(shipment.carrier_name,"shipping.shipment.carrier_name");nullableString(shipment.service_level,"shipping.shipment.service_level");string(shipment.tracking_number,"shipping.shipment.tracking_number");nullableString(shipment.tracking_url,"shipping.shipment.tracking_url");date(shipment.shipped_at,"shipping.shipment.shipped_at");nullableDate(shipment.estimated_delivery_at,"shipping.shipment.estimated_delivery_at");nullableDate(shipment.delivered_at,"shipping.shipment.delivered_at");}return{address,shipment};};
const validateAttribution=(value:unknown,index:number)=>{const name=`creator_attributions[${index}]`,item=object(value,name);for(const key of["order_item_id","creator_user_id","source_entity_id","product_id","variant_id"] as const)uuid(item[key],`${name}.${key}`);string(item.source_surface,`${name}.source_surface`);integer(item.historical_bps,`${name}.historical_bps`);date(item.attributed_at,`${name}.attributed_at`);return item;};
const validateAllocation=(value:unknown,index:number)=>{const name=`creator_allocations[${index}]`,item=object(value,name);for(const key of["id","order_item_id","creator_user_id"] as const)uuid(item[key],`${name}.${key}`);integer(item.commission_bps,`${name}.commission_bps`);money(item.item_gmv,`${name}.item_gmv`);money(item.commission_amount,`${name}.commission_amount`);date(item.created_at,`${name}.created_at`);return item;};
const validateSettlement=(value:unknown)=>{const item=nullableObject(value,"settlement");if(!item)return null;uuid(item.id,"settlement.id");string(item.status,"settlement.status");for(const key of["gross_amount","seller_net_amount","platform_fee_amount","creator_commission_amount"] as const)money(item[key],`settlement.${key}`);date(item.released_at,"settlement.released_at");return item;};
const validateSettlementLeg=(value:unknown,index:number)=>{const name=`settlement_legs[${index}]`,item=object(value,name);uuid(item.id,`${name}.id`);string(item.leg_type,`${name}.leg_type`);nullableUuid(item.beneficiary_user_id,`${name}.beneficiary_user_id`);money(item.amount,`${name}.amount`);string(item.status,`${name}.status`);date(item.created_at,`${name}.created_at`);return item;};
const validateDispute=(value:unknown)=>{const item=nullableObject(value,"dispute");if(!item)return null;uuid(item.id,"dispute.id");string(item.status,"dispute.status");string(item.reason_code,"dispute.reason_code");nullableString(item.buyer_note,"dispute.buyer_note");date(item.created_at,"dispute.created_at");nullableDate(item.resolved_at,"dispute.resolved_at");return item;};
const validateReversal=(value:unknown)=>{const item=nullableObject(value,"reversal");if(!item)return null;uuid(item.id,"reversal.id");money(item.gross_amount,"reversal.gross_amount");string(item.currency,"reversal.currency");string(item.reason_code,"reversal.reason_code");date(item.created_at,"reversal.created_at");return item;};
const validateReversalLeg=(value:unknown,index:number)=>{const name=`reversal_legs[${index}]`,item=object(value,name);uuid(item.id,`${name}.id`);string(item.leg_type,`${name}.leg_type`);nullableUuid(item.beneficiary_user_id,`${name}.beneficiary_user_id`);money(item.original_amount,`${name}.original_amount`);money(item.reversal_amount,`${name}.reversal_amount`);date(item.created_at,`${name}.created_at`);return item;};
const validateTimelineEvent=(value:unknown,index:number)=>{const name=`timeline[${index}]`,item=object(value,name);uuid(item.id,`${name}.id`);string(item.event_type,`${name}.event_type`);nullableString(item.from_status,`${name}.from_status`);nullableString(item.to_status,`${name}.to_status`);string(item.actor_role,`${name}.actor_role`);nullableString(item.reason_code,`${name}.reason_code`);date(item.created_at,`${name}.created_at`);return item;};

export function validateOrderDetail(value:unknown):OrderDetail{
  const detail=object(value,"detail");
  return {order:validateOrder(detail.order),buyer:validateBuyer(detail.buyer),seller:validateSeller(detail.seller),store:validateStore(detail.store),items:array(detail.items,"items").map(validateItem),payment:validatePayment(detail.payment),payment_allocation:validatePaymentAllocation(detail.payment_allocation),shipping:validateShipping(detail.shipping),creator_attributions:array(detail.creator_attributions,"creator_attributions").map(validateAttribution),creator_allocations:array(detail.creator_allocations,"creator_allocations").map(validateAllocation),settlement:validateSettlement(detail.settlement),settlement_legs:array(detail.settlement_legs,"settlement_legs").map(validateSettlementLeg),dispute:validateDispute(detail.dispute),reversal:validateReversal(detail.reversal),reversal_legs:array(detail.reversal_legs,"reversal_legs").map(validateReversalLeg),timeline:array(detail.timeline,"timeline").map(validateTimelineEvent)};
}

export async function getOrderDetail(orderId:string):Promise<OrderDetail>{uuid(orderId,"orderId");return validateOrderDetail(await rpc("get_marketplace_admin_order_detail",{p_order_id:orderId}));}

export const formatBdag=(value:Money)=>`${String(value)} BDAG`;
export const formatDate=(value:unknown)=>typeof value==="string"&&!Number.isNaN(Date.parse(value))?new Intl.DateTimeFormat("es",{dateStyle:"medium",timeStyle:"short"}).format(new Date(value)):"—";
