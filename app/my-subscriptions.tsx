import { MaterialCommunityIcons } from '@expo/vector-icons';
import { randomUUID } from 'expo-crypto';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import {
  fetchMyCreatorPremiumSubscriptions,
  type CreatorPremiumCursor,
  type CreatorPremiumSubscriptionItem,
} from '@/services/creatorPremiumService';
import { cancelCreatorPremiumSubscription } from '@/services/financial/ledgerClient';

const exactBdag=(value:string)=>{const[whole,fraction]=value.split('.');return`${whole.replace(/\B(?=(\d{3})+(?!\d))/g,'.')}${fraction?`,${fraction}`:''} BDAG`};
const date=(value:string|null|undefined)=>value&&!Number.isNaN(Date.parse(value))?new Intl.DateTimeFormat('es',{dateStyle:'medium'}).format(new Date(value)):'—';
const statusLabel:Record<CreatorPremiumSubscriptionItem['status'],string>={pending:'Pendiente',active:'Activa',cancelled:'Cancelada',expired:'Vencida',revoked:'Revocada'};

export default function MySubscriptionsScreen(){
  const router=useRouter(),insets=useSafeAreaInsets();
  const {user}=useAuth();
  const[items,setItems]=useState<CreatorPremiumSubscriptionItem[]>([]),[nextCursor,setNextCursor]=useState<CreatorPremiumCursor|null>(null),[loading,setLoading]=useState(true),[refreshing,setRefreshing]=useState(false),[loadingMore,setLoadingMore]=useState(false),[error,setError]=useState<string|null>(null),[busyId,setBusyId]=useState<string|null>(null);
  const cancelAttempts=useRef(new Map<string,string>());
  const activeCancellation=useRef<string|null>(null);
  const contextGeneration=useRef(0);
  const requestGeneration=useRef(0);
  const contextKey=user?.id??'signed-out';
  const contextKeyRef=useRef(contextKey);

  if(contextKeyRef.current!==contextKey){
    contextKeyRef.current=contextKey;
    contextGeneration.current+=1;
    requestGeneration.current+=1;
    cancelAttempts.current.clear();
    activeCancellation.current=null;
  }

  useEffect(()=>{
    setItems([]);setNextCursor(null);setBusyId(null);setError(null);
    return()=>{
      contextGeneration.current+=1;
      requestGeneration.current+=1;
      activeCancellation.current=null;
    };
  },[contextKey]);

  const load=useCallback(async(refresh=false)=>{
    const generation=contextGeneration.current;
    const request=++requestGeneration.current;
    if(refresh)setRefreshing(true);else setLoading(true);
    setError(null);
    try{
      const page=await fetchMyCreatorPremiumSubscriptions({limit:50});
      if(generation!==contextGeneration.current||request!==requestGeneration.current)return;
      setItems(page.items);setNextCursor(page.nextCursor);
    }catch(cause){
      if(generation!==contextGeneration.current||request!==requestGeneration.current)return;
      setError(cause instanceof Error?cause.message:'No pudimos cargar tus suscripciones.');
    }finally{
      if(generation===contextGeneration.current&&request===requestGeneration.current){setLoading(false);setRefreshing(false);}
    }
  },[]);
  useFocusEffect(useCallback(()=>{
    if(contextKeyRef.current===contextKey)void load();
    return()=>{requestGeneration.current+=1;};
  },[contextKey,load]));

  const loadMore=useCallback(async()=>{
    if(!nextCursor||loadingMore)return;
    const generation=contextGeneration.current;
    const request=++requestGeneration.current;
    setLoadingMore(true);
    try{
      const page=await fetchMyCreatorPremiumSubscriptions({limit:50,cursor:nextCursor});
      if(generation!==contextGeneration.current||request!==requestGeneration.current)return;
      setItems(current=>{const seen=new Set(current.map(item=>item.id));return[...current,...page.items.filter(item=>!seen.has(item.id))]});
      setNextCursor(page.nextCursor);
    }catch(cause){
      if(generation===contextGeneration.current&&request===requestGeneration.current)setError(cause instanceof Error?cause.message:'No pudimos cargar más resultados.');
    }finally{
      if(generation===contextGeneration.current&&request===requestGeneration.current)setLoadingMore(false);
    }
  },[loadingMore,nextCursor]);

  const cancel=useCallback((subscription:CreatorPremiumSubscriptionItem)=>{
    const generation=contextGeneration.current;
    Alert.alert('Cancelar suscripción','La cancelación no mueve dinero. El acceso pagado continúa hasta la fecha indicada y no habrá renovación automática.',[
      {text:'Volver',style:'cancel'},
      {text:'Cancelar suscripción',style:'destructive',onPress:()=>{
        if(busyId||!user?.id)return;
        const operationId=randomUUID();
        const idempotencyKey=cancelAttempts.current.get(subscription.id)??randomUUID();
        cancelAttempts.current.set(subscription.id,idempotencyKey);
        activeCancellation.current=operationId;
        setBusyId(subscription.id);
        void cancelCreatorPremiumSubscription({subscriptionId:subscription.id,idempotencyKey})
          .then(async result=>{
            if(generation!==contextGeneration.current)return;
            if(!result?.success)throw new Error(typeof result?.error==='string'?result.error:'creator_premium_cancellation_failed');
            cancelAttempts.current.delete(subscription.id);
            await load(true);
            if(generation===contextGeneration.current)Alert.alert('Suscripción cancelada','Tu periodo pagado conserva acceso hasta su vencimiento.');
          })
          .catch(cause=>{if(generation===contextGeneration.current)Alert.alert('No se pudo cancelar',cause instanceof Error?cause.message:'Inténtalo de nuevo.')})
          .finally(()=>{if(activeCancellation.current===operationId){activeCancellation.current=null;if(generation===contextGeneration.current)setBusyId(null)}});
      }}
    ]);
  },[busyId,load,user?.id]);
  return <View style={[styles.root,{paddingTop:insets.top}]}><StatusBar style="light"/><View style={styles.header}><Pressable onPress={()=>router.back()} style={styles.icon}><MaterialCommunityIcons name="arrow-left" size={24} color={Colors.textPrimary}/></Pressable><View style={styles.headerCopy}><Text style={styles.title}>Mis suscripciones Premium</Text><Text style={styles.subtitle}>Periodos reales, sin renovación automática</Text></View><Pressable onPress={()=>router.push('/my-premium-library')} style={styles.icon}><MaterialCommunityIcons name="bookshelf" size={22} color={Colors.purple}/></Pressable></View>{loading?<View style={styles.center}><ActivityIndicator color={Colors.purple}/><Text style={styles.muted}>Cargando suscripciones…</Text></View>:<ScrollView contentContainerStyle={[styles.content,{paddingBottom:insets.bottom+32}]} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>void load(true)} tintColor={Colors.purple}/>}><View style={styles.notice}><MaterialCommunityIcons name="information-outline" size={20} color={Colors.info}/><Text style={styles.noticeText}>Cada plan muestra su periodo canónico. Nelyon no ejecuta renovación automática en esta fase.</Text></View>{error?<Pressable style={styles.error} onPress={()=>void load()}><Text style={styles.errorText}>{error}</Text><Text style={styles.retry}>Toca para reintentar</Text></Pressable>:null}{items.length===0?<View style={styles.empty}><MaterialCommunityIcons name="star-off-outline" size={42} color={Colors.textSubtle}/><Text style={styles.emptyTitle}>Aún no tienes suscripciones</Text><Text style={styles.muted}>Los planes disponibles aparecen en las ofertas publicadas de cada creador.</Text></View>:items.map(item=><View key={item.id} style={styles.card}><View style={styles.creatorRow}>{item.creator.avatar_url?<Image source={{uri:item.creator.avatar_url}} style={styles.avatar} contentFit="cover"/>:<View style={[styles.avatar,styles.avatarFallback]}><Text style={styles.avatarText}>{(item.creator.display_name??item.creator.username??'N').slice(0,1).toUpperCase()}</Text></View>}<View style={styles.flex}><Text style={styles.planName}>{item.plan.name}</Text><Text style={styles.creatorName}>{item.creator.display_name??(item.creator.username?`@${item.creator.username}`:'Creador Nelyon')}</Text></View><View style={[styles.badge,item.access_active&&styles.badgeActive]}><Text style={[styles.badgeText,item.access_active&&styles.badgeTextActive]}>{statusLabel[item.status]}</Text></View></View><Text style={styles.description}>{item.plan.description||'Plan Premium del creador'}</Text><View style={styles.facts}><View style={styles.fact}><Text style={styles.factLabel}>Precio del periodo</Text><Text style={styles.factValue}>{exactBdag(item.plan.price_bdag)}</Text></View><View style={styles.fact}><Text style={styles.factLabel}>Duración</Text><Text style={styles.factValue}>Cada {item.plan.billing_period_days} días</Text></View><View style={styles.fact}><Text style={styles.factLabel}>Acceso pagado hasta</Text><Text style={styles.factValue}>{date(item.period?.paid_through_at)}</Text></View><View style={styles.fact}><Text style={styles.factLabel}>Estado del periodo</Text><Text style={styles.factValue}>{item.period?.access_state??'Sin periodo activo'}</Text></View></View>{item.access_active&&<Pressable style={styles.libraryButton} onPress={()=>router.push('/my-premium-library')}><MaterialCommunityIcons name="shield-lock-open-outline" size={19} color={Colors.textOnBrand}/><Text style={styles.libraryText}>Abrir biblioteca Premium</Text></Pressable>}{item.status==='active'&&<Pressable disabled={busyId!==null} style={styles.cancelButton} onPress={()=>cancel(item)}>{busyId===item.id?<ActivityIndicator color={Colors.error}/>:<Text style={styles.cancelText}>Cancelar futuras renovaciones</Text>}</Pressable>}<Text style={styles.noRenewal}>Sin renovación automática. Cancelar no revoca el periodo ya pagado.</Text></View>)}{nextCursor?<Pressable disabled={loadingMore} style={styles.more} onPress={()=>void loadMore()}>{loadingMore?<ActivityIndicator color={Colors.purple}/>:<Text style={styles.moreText}>Cargar más</Text>}</Pressable>:null}</ScrollView>}</View>;
}

const styles=StyleSheet.create({root:{flex:1,backgroundColor:Colors.bg},header:{minHeight:64,flexDirection:'row',alignItems:'center',paddingHorizontal:Spacing.md,borderBottomWidth:1,borderBottomColor:Colors.border},headerCopy:{flex:1},icon:{width:42,height:42,alignItems:'center',justifyContent:'center'},title:{color:Colors.textPrimary,fontSize:FontSize.lg,fontWeight:FontWeight.bold},subtitle:{color:Colors.textSubtle,fontSize:FontSize.xs,marginTop:2},content:{padding:Spacing.md,gap:Spacing.md},center:{flex:1,alignItems:'center',justifyContent:'center',gap:Spacing.md},muted:{color:Colors.textSubtle,fontSize:FontSize.sm,textAlign:'center'},notice:{flexDirection:'row',gap:10,padding:Spacing.md,borderRadius:Radius.md,backgroundColor:Colors.blueDim,borderWidth:1,borderColor:Colors.blue},noticeText:{flex:1,color:Colors.textSecondary,fontSize:FontSize.sm,lineHeight:19},error:{padding:Spacing.md,borderRadius:Radius.md,backgroundColor:'rgba(255,59,92,0.1)',borderWidth:1,borderColor:Colors.error},errorText:{color:Colors.error,fontSize:FontSize.sm},retry:{color:Colors.textSecondary,fontSize:FontSize.xs,marginTop:4},empty:{alignItems:'center',gap:Spacing.sm,paddingVertical:Spacing.xxl},emptyTitle:{color:Colors.textPrimary,fontSize:FontSize.lg,fontWeight:FontWeight.bold},card:{padding:Spacing.md,gap:Spacing.md,borderRadius:Radius.lg,backgroundColor:Colors.surfaceElevated,borderWidth:1,borderColor:Colors.border},creatorRow:{flexDirection:'row',alignItems:'center',gap:12},avatar:{width:46,height:46,borderRadius:23},avatarFallback:{alignItems:'center',justifyContent:'center',backgroundColor:Colors.purpleDim},avatarText:{color:Colors.purple,fontSize:FontSize.lg,fontWeight:FontWeight.bold},flex:{flex:1},planName:{color:Colors.textPrimary,fontSize:FontSize.md,fontWeight:FontWeight.bold},creatorName:{color:Colors.textSubtle,fontSize:FontSize.xs,marginTop:2},badge:{borderRadius:Radius.full,paddingHorizontal:9,paddingVertical:5,backgroundColor:Colors.surfaceHighlight},badgeActive:{backgroundColor:Colors.accentDim},badgeText:{color:Colors.textSecondary,fontSize:FontSize.xs,fontWeight:FontWeight.bold},badgeTextActive:{color:Colors.accent},description:{color:Colors.textSecondary,fontSize:FontSize.sm},facts:{gap:8,padding:12,borderRadius:Radius.md,backgroundColor:Colors.surface},fact:{flexDirection:'row',justifyContent:'space-between',gap:12},factLabel:{color:Colors.textSubtle,fontSize:FontSize.xs},factValue:{color:Colors.textPrimary,fontSize:FontSize.xs,fontWeight:FontWeight.semibold,textAlign:'right'},libraryButton:{minHeight:46,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:8,borderRadius:Radius.md,backgroundColor:Colors.purple},libraryText:{color:Colors.textOnBrand,fontSize:FontSize.sm,fontWeight:FontWeight.bold},cancelButton:{minHeight:42,alignItems:'center',justifyContent:'center',borderRadius:Radius.md,borderWidth:1,borderColor:Colors.error},cancelText:{color:Colors.error,fontSize:FontSize.sm,fontWeight:FontWeight.semibold},noRenewal:{color:Colors.textSubtle,fontSize:FontSize.xs,lineHeight:17},more:{minHeight:46,alignItems:'center',justifyContent:'center'},moreText:{color:Colors.purple,fontWeight:FontWeight.bold}});
