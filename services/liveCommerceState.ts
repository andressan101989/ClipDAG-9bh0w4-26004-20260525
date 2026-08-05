import type{ShippingAddressInput}from'./marketplaceOrderService';
export interface PendingReservationCommand{signature:string;idempotencyKey:string}
export const liveReservationSignature=(sessionId:string,pinId:string,variantId:string,quantity:number,address:ShippingAddressInput)=>JSON.stringify([sessionId,pinId,variantId,quantity,address.recipientName.trim(),address.line1.trim(),address.line2?.trim()??'',address.city.trim(),address.region.trim(),address.postalCode.trim(),address.country.trim(),address.phone?.trim()??'']);
export function reservationCommandFor(signature:string,pending:PendingReservationCommand|null,newUuid:()=>string):PendingReservationCommand{return pending?.signature===signature?pending:{signature,idempotencyKey:newUuid()};}
export function mergeUniqueCandidates<T extends{id:string}>(current:T[],incoming:T[]){const map=new Map(current.map(item=>[item.id,item]));for(const item of incoming)map.set(item.id,item);return[...map.values()];}
export function stageAfterVisibilityChange<T extends string>(previousVisible:boolean,visible:boolean,current:T,hasReservation:boolean,isSuccess:boolean,shelf:T):T{return !previousVisible&&visible&&!hasReservation&&!isSuccess?shelf:current;}

export type LivePaymentGuardCode='locked'|'missing_checkout'|'checkout_not_payable'|'checkout_expired'|null;
export function livePaymentGuard(input:{locked:boolean;checkoutStatus:string|null;remaining:number}):LivePaymentGuardCode{
 if(input.locked)return'locked';
 if(!input.checkoutStatus)return'missing_checkout';
 if(input.checkoutStatus!=='pending_payment')return'checkout_not_payable';
 if(input.remaining<=0)return'checkout_expired';
 return null;
}
