import React from 'react';
import {StyleSheet,Text,View} from 'react-native';
import {MaterialIcons} from '@expo/vector-icons';
import {Colors,Radius,Spacing} from '@/constants/theme';
import type {MarketplaceHeldAllocation,MarketplaceOrderEvent,MarketplaceOrderStatus} from '@/services/marketplaceFulfillmentService';
import{marketplaceOrderTimelineItems,type MarketplaceTimelineSettlement}from'@/services/marketplaceOrderPresentation';

export const statusLabel=(status:MarketplaceOrderStatus)=>({confirmed:'Confirmado',processing:'En preparación',shipped:'Enviado',delivered:'Entregado',cancelled:'Cancelado',refunded:'Reembolsado',partially_refunded:'Reembolso parcial'}[status]);
const compactStatusLabel=(status:MarketplaceOrderStatus)=>({confirmed:'Confirm.',processing:'Proceso',shipped:'Enviado',delivered:'Entregado',cancelled:'Cancelado',refunded:'Reembolso',partially_refunded:'Parcial'}[status]);
const statusIcon={confirmed:'inventory-2',processing:'pending-actions',shipped:'local-shipping',delivered:'task-alt',cancelled:'cancel',refunded:'undo',partially_refunded:'undo'} as const;
export function StatusBadge({status,compact=false,showLabel=true}:{status:MarketplaceOrderStatus;compact?:boolean;showLabel?:boolean}){const label=statusLabel(status);return <View accessible accessibilityRole="text" accessibilityLabel={label} style={[s.badge,compact&&s.badgeCompact]}>{compact?<MaterialIcons name={statusIcon[status]} size={15} color={Colors.primaryLight}/>:null}{showLabel?<Text style={[s.badgeText,compact&&s.badgeTextCompact]}>{compact?compactStatusLabel(status):label}</Text>:null}</View>}

export function OrderTimeline({events,allocationStatus,settlement}:{events:MarketplaceOrderEvent[];allocationStatus?:MarketplaceHeldAllocation['status']|null;settlement?:MarketplaceTimelineSettlement|null}){const timelineItems=marketplaceOrderTimelineItems(events,allocationStatus,settlement);return <View style={s.timeline}>{timelineItems.map(event=><View key={event.id} style={s.event}><View style={s.dot}/><View><Text style={s.text}>{event.label}</Text><Text style={s.muted}>{new Date(event.createdAt).toLocaleString()}</Text></View></View>)}</View>}
const s=StyleSheet.create({badge:{backgroundColor:Colors.primaryDim,borderRadius:Radius.full,paddingHorizontal:10,paddingVertical:5},badgeCompact:{minWidth:32,minHeight:32,paddingHorizontal:8,paddingVertical:4,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:4},badgeText:{color:Colors.primaryLight,fontWeight:'700'},badgeTextCompact:{fontSize:12},timeline:{gap:Spacing.md},event:{flexDirection:'row',gap:Spacing.sm},dot:{width:10,height:10,borderRadius:5,backgroundColor:Colors.primary,marginTop:5},text:{color:Colors.textPrimary,fontWeight:'600'},muted:{color:Colors.textSecondary,fontSize:12}});
