import React from 'react';
import {StyleSheet,Text,View} from 'react-native';
import {MaterialIcons} from '@expo/vector-icons';
import {Colors,Radius,Spacing} from '@/constants/theme';
import type {MarketplaceDisputeOutcome,MarketplaceHeldAllocation,MarketplaceOrderEvent,MarketplaceOrderStatus} from '@/services/marketplaceFulfillmentService';

export const statusLabel=(status:MarketplaceOrderStatus)=>({confirmed:'Confirmado',processing:'En preparación',shipped:'Enviado',delivered:'Entregado',cancelled:'Cancelado',refunded:'Reembolsado',partially_refunded:'Reembolso parcial'}[status]);
const compactStatusLabel=(status:MarketplaceOrderStatus)=>({confirmed:'Confirm.',processing:'Proceso',shipped:'Enviado',delivered:'Entregado',cancelled:'Cancelado',refunded:'Reembolso',partially_refunded:'Parcial'}[status]);
const statusIcon={confirmed:'inventory-2',processing:'pending-actions',shipped:'local-shipping',delivered:'task-alt',cancelled:'cancel',refunded:'undo',partially_refunded:'undo'} as const;
export function StatusBadge({status,compact=false,showLabel=true}:{status:MarketplaceOrderStatus;compact?:boolean;showLabel?:boolean}){const label=statusLabel(status);return <View accessible accessibilityRole="text" accessibilityLabel={label} style={[s.badge,compact&&s.badgeCompact]}>{compact?<MaterialIcons name={statusIcon[status]} size={15} color={Colors.primaryLight}/>:null}{showLabel?<Text style={[s.badgeText,compact&&s.badgeTextCompact]}>{compact?compactStatusLabel(status):label}</Text>:null}</View>}

type TimelineSettlement={status:string;releasedAt:string};
type TimelineItem={id:string;eventType:string;createdAt:string;sourceIndex:number};
const disputeResolutionLabel=(outcome:MarketplaceDisputeOutcome|null|undefined)=>{
  if(outcome==='refund_buyer')return 'Reclamo resuelto: reembolso al comprador';
  if(outcome==='release_seller')return 'Reclamo resuelto a favor del vendedor';
  if(outcome==='reject_claim')return 'Reclamo rechazado por administración';
  return 'Reclamo resuelto';
};
const timelineLabel=(eventType:string,disputeOutcome:MarketplaceDisputeOutcome|null|undefined)=>{
  if(eventType==='dispute_resolved')return disputeResolutionLabel(disputeOutcome);
  return ({order_confirmed:'Pedido confirmado',processing_started:'El vendedor comenzó a preparar el pedido',shipment_created:'Pedido enviado',order_shipped:'Pedido enviado',shipment_updated:'Información de seguimiento actualizada',delivery_confirmed:'Entrega confirmada',escrow_released:'Fondos liberados al vendedor',dispute_opened:'Problema reportado',refund_created:'Fondos reembolsados al comprador'}[eventType]??'Actualización del pedido');
};
const chronologicalTimelineItems=(events:MarketplaceOrderEvent[],allocationStatus:MarketplaceHeldAllocation['status']|null|undefined,settlement:TimelineSettlement|null|undefined):TimelineItem[]=>{
  const items:TimelineItem[]=events.map((event,sourceIndex)=>({id:event.id,eventType:event.eventType,createdAt:event.createdAt,sourceIndex}));
  const hasReleaseEvent=events.some(event=>event.eventType==='escrow_released');
  if(!hasReleaseEvent&&allocationStatus==='released'&&settlement?.status==='completed')items.push({id:'derived-settlement-release',eventType:'escrow_released',createdAt:settlement.releasedAt,sourceIndex:events.length});
  return items.sort((left,right)=>{const timestampDifference=Date.parse(left.createdAt)-Date.parse(right.createdAt);return timestampDifference||left.sourceIndex-right.sourceIndex});
};
export function OrderTimeline({events,disputeOutcome,allocationStatus,settlement}:{events:MarketplaceOrderEvent[];disputeOutcome?:MarketplaceDisputeOutcome|null;allocationStatus?:MarketplaceHeldAllocation['status']|null;settlement?:TimelineSettlement|null}){const timelineItems=chronologicalTimelineItems(events,allocationStatus,settlement);return <View style={s.timeline}>{timelineItems.map(event=><View key={event.id} style={s.event}><View style={s.dot}/><View><Text style={s.text}>{timelineLabel(event.eventType,disputeOutcome)}</Text><Text style={s.muted}>{new Date(event.createdAt).toLocaleString()}</Text></View></View>)}</View>}
const s=StyleSheet.create({badge:{backgroundColor:Colors.primaryDim,borderRadius:Radius.full,paddingHorizontal:10,paddingVertical:5},badgeCompact:{minWidth:32,minHeight:32,paddingHorizontal:8,paddingVertical:4,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:4},badgeText:{color:Colors.primaryLight,fontWeight:'700'},badgeTextCompact:{fontSize:12},timeline:{gap:Spacing.md},event:{flexDirection:'row',gap:Spacing.sm},dot:{width:10,height:10,borderRadius:5,backgroundColor:Colors.primary,marginTop:5},text:{color:Colors.textPrimary,fontWeight:'600'},muted:{color:Colors.textSecondary,fontSize:12}});
