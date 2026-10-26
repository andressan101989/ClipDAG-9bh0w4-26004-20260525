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
import { formatCreatorPremiumBdag as exactBdag } from '@/services/creatorPremiumPresentation.mjs';
import { creatorPremiumErrorMessage } from '@/services/creatorPremiumIntegrationState';
import {
  fetchMyCreatorPremiumSubscriptions,
  fetchMyCreatorPremiumSubscriptionsSnapshot,
  type CreatorPremiumFinancePolicy,
  type CreatorPremiumCursor,
  type CreatorPremiumSubscriptionItem,
} from '@/services/creatorPremiumService';
import {
  cancelCreatorPremiumSubscription,
  setCreatorPremiumAutoRenewal,
  subscribeToPlan,
} from '@/services/financial/ledgerClient';

const date=(value:string|null|undefined)=>value&&!Number.isNaN(Date.parse(value))?new Intl.DateTimeFormat('es',{dateStyle:'medium'}).format(new Date(value)):'—';
const statusLabel:Record<CreatorPremiumSubscriptionItem['status'],string>={pending:'Pendiente',active:'Activa',cancelled:'Cancelada',expired:'Vencida',revoked:'Revocada'};
const autoRenewalResultCopy:Readonly<Record<string,string>>={
  insufficient_balance:'Saldo insuficiente. No se creó un periodo ni una deuda. Agrega saldo y renueva manualmente; después podrás autorizar de nuevo.',
  retryable_failure:'El cobro no pudo confirmarse. Los reintentos son limitados; si quedó pausada, revisa el plan y vuelve a autorizar.',
  plan_changed:'El plan o el precio cambió. Revisa la versión vigente y vuelve a dar tu consentimiento.',
  safety_blocked:'La renovación está pausada porque el contenido o una cuenta ya no es elegible.',
  finance_unavailable:'La renovación está pausada por la política financiera del servidor.',
  account_unavailable:'La renovación está pausada porque una cuenta financiera no está disponible.',
  binding_invalid:'La renovación está pausada porque no pudo verificarse el periodo pagado.',
  refunded:'La renovación quedó pausada después del reembolso.',
  cancelled:'Las renovaciones futuras fueron canceladas.',
  revoked:'La renovación automática fue desactivada.',
  renewed:'El último periodo se renovó correctamente.',
  adopted:'El servidor confirmó el periodo vigente sin un cobro duplicado.',
};

export default function MySubscriptionsScreen(){
  const {user}=useAuth();
  const contextKey=user?.id??'signed-out';
  return <MySubscriptionsScreenContent key={contextKey}/>;
}

function MySubscriptionsScreenContent(){
  const router=useRouter(),insets=useSafeAreaInsets();
  const {user}=useAuth();
  const[items,setItems]=useState<CreatorPremiumSubscriptionItem[]>([]),[nextCursor,setNextCursor]=useState<CreatorPremiumCursor|null>(null),[loading,setLoading]=useState(true),[refreshing,setRefreshing]=useState(false),[loadingMore,setLoadingMore]=useState(false),[error,setError]=useState<string|null>(null),[busyId,setBusyId]=useState<string|null>(null);
  const[policy,setPolicy]=useState<CreatorPremiumFinancePolicy>({purchase_enabled:false,subscription_enabled:false,refunds_enabled:false,platform_fee_bps:0,policy_version:'unavailable'});
  const itemsRef=useRef(items),policyRef=useRef(policy);
  itemsRef.current=items;policyRef.current=policy;
  const cancelAttempts=useRef(new Map<string,string>());
  const renewalAttempts=useRef(new Map<string,string>());
  const autoRenewalAttempts=useRef(new Map<string,string>());
  const activeCancellation=useRef<string|null>(null);
  const contextGeneration=useRef(0);
  const loadRequestGeneration=useRef(0);
  const pageRequestGeneration=useRef(0);
  const loadInFlight=useRef(false);
  const contextKey=user?.id??'signed-out';
  const contextKeyRef=useRef(contextKey);

  if(contextKeyRef.current!==contextKey){
    contextKeyRef.current=contextKey;
    contextGeneration.current+=1;
    loadRequestGeneration.current+=1;
    pageRequestGeneration.current+=1;
    loadInFlight.current=false;
    cancelAttempts.current.clear();
    renewalAttempts.current.clear();
    autoRenewalAttempts.current.clear();
    activeCancellation.current=null;
  }

  useEffect(()=>{
    setItems([]);setNextCursor(null);setBusyId(null);setError(null);setLoadingMore(false);
    return()=>{
      contextGeneration.current+=1;
      loadRequestGeneration.current+=1;
      pageRequestGeneration.current+=1;
      loadInFlight.current=false;
      activeCancellation.current=null;
    };
  },[contextKey]);

  const load=useCallback(async(refresh=false)=>{
    const generation=contextGeneration.current;
    const request=++loadRequestGeneration.current;
    pageRequestGeneration.current+=1;
    loadInFlight.current=true;
    setLoadingMore(false);
    if(refresh)setRefreshing(true);else setLoading(true);
    setError(null);
    try{
      const page=await fetchMyCreatorPremiumSubscriptions({limit:50});
      if(generation!==contextGeneration.current||request!==loadRequestGeneration.current)return;
      setItems(page.items);setNextCursor(page.nextCursor);
      setPolicy(page.policy);
    }catch(cause){
      if(generation!==contextGeneration.current||request!==loadRequestGeneration.current)return;
      setError(creatorPremiumErrorMessage(cause));
    }finally{
      if(generation===contextGeneration.current&&request===loadRequestGeneration.current){loadInFlight.current=false;setLoading(false);setRefreshing(false);}
    }
  },[]);
  useFocusEffect(useCallback(()=>{
    if(contextKeyRef.current===contextKey)void load();
    return()=>{loadRequestGeneration.current+=1;pageRequestGeneration.current+=1;loadInFlight.current=false;};
  },[contextKey,load]));

  const loadMore=useCallback(async()=>{
    if(!nextCursor||loadingMore||loadInFlight.current)return;
    const generation=contextGeneration.current;
    const request=++pageRequestGeneration.current;
    setLoadingMore(true);
    try{
      const page=await fetchMyCreatorPremiumSubscriptions({limit:50,cursor:nextCursor});
      if(generation!==contextGeneration.current||request!==pageRequestGeneration.current)return;
      setItems(current=>{const seen=new Set(current.map(item=>item.id));return[...current,...page.items.filter(item=>!seen.has(item.id))]});
      setNextCursor(page.nextCursor);
      setPolicy(page.policy);
    }catch(cause){
      if(generation===contextGeneration.current&&request===pageRequestGeneration.current)setError(creatorPremiumErrorMessage(cause));
    }finally{
      if(generation===contextGeneration.current&&request===pageRequestGeneration.current)setLoadingMore(false);
    }
  },[loadingMore,nextCursor]);

  const readBackSubscriptions=useCallback(async()=>{
    const generation=contextGeneration.current;
    const request=++loadRequestGeneration.current;
    const confirmed=await fetchMyCreatorPremiumSubscriptionsSnapshot(items.length+1);
    if(generation!==contextGeneration.current||request!==loadRequestGeneration.current)throw new Error('creator_premium_financial_readback_stale');
    setItems(confirmed.items);setNextCursor(confirmed.nextCursor);setPolicy(confirmed.policy);
    return confirmed;
  },[items.length]);

  const setAutoRenewal=useCallback((subscription:CreatorPremiumSubscriptionItem,enabled:boolean)=>{
    const generation=contextGeneration.current;
    const subscriptionId=subscription.id;
    const planId=subscription.plan.id;
    const expectedPriceBdag=subscription.plan.price_bdag;
    const expectedPlanVersion=subscription.plan.version;
    const priorEnabled=subscription.auto_renewal.enabled;
    const priorMandateState=subscription.auto_renewal.mandate_state;
    const nextCharge=date(subscription.period?.paid_through_at);
    const title=enabled?'Activar renovación automática':'Desactivar renovación automática';
    const confirmation=enabled?'Activar':'Desactivar';
    const detail=enabled
      ? `${subscription.plan.name} se cobrará por ${exactBdag(expectedPriceBdag)} al finalizar el periodo pagado. El próximo cobro está previsto para ${nextCharge}. Puedes desactivarlo antes de esa fecha.`
      : `Se detendrán los cobros futuros de ${subscription.plan.name}. El periodo ya pagado conservará acceso hasta ${nextCharge}.`;
    Alert.alert(title,detail,[
      {text:'Volver',style:'cancel'},
      {text:confirmation,style:enabled?undefined:'destructive',onPress:()=>{
        void (async()=>{
          if(generation!==contextGeneration.current||busyId||activeCancellation.current||!user?.id)return;
          const current=itemsRef.current.find(item=>item.id===subscriptionId);
          const currentMatches=Boolean(current
            && current.plan.id===planId
            && current.plan.price_bdag===expectedPriceBdag
            && current.plan.version===expectedPlanVersion
            && current.auto_renewal.enabled===priorEnabled
            && current.is_latest_relationship);
          const enableAllowed=Boolean(currentMatches
            && current?.status==='active'
            && current.access_active
            && current.plan.status==='active'
            && policyRef.current.subscription_enabled);
          if(!currentMatches||(enabled&&!enableAllowed)||enabled===priorEnabled){
            if(generation===contextGeneration.current){
              Alert.alert('No se pudo actualizar',creatorPremiumErrorMessage(new Error('creator_premium_auto_renewal_snapshot_changed')));
            }
            return;
          }
          const operationId=randomUUID();
          const attemptKey=`${subscriptionId}:${enabled}:${expectedPriceBdag}:${expectedPlanVersion}`;
          const idempotencyKey=autoRenewalAttempts.current.get(attemptKey)??randomUUID();
          autoRenewalAttempts.current.set(attemptKey,idempotencyKey);
          activeCancellation.current=operationId;
          setBusyId(subscriptionId);
          try{
            const result=await setCreatorPremiumAutoRenewal({
              subscriptionId,enabled,expectedPriceBdag,expectedPlanVersion,idempotencyKey,
            });
            if(generation!==contextGeneration.current)return;
            if(!result?.success)throw new Error(typeof result?.error==='string'?result.error:'creator_premium_auto_renewal_failed');
            const confirmed=await readBackSubscriptions();
            const confirmedSubscription=confirmed.items.find(item=>item.id===subscriptionId);
            if(!confirmedSubscription
              ||confirmedSubscription.auto_renewal.enabled!==enabled
              ||(!enabled&&priorMandateState!==null
                &&confirmedSubscription.auto_renewal.mandate_state!=='REVOKED')
              ||(enabled&&(confirmedSubscription.auto_renewal.authorized_price_bdag!==expectedPriceBdag
                ||confirmedSubscription.auto_renewal.authorized_plan_version!==expectedPlanVersion))){
              throw new Error('creator_premium_auto_renewal_readback_pending');
            }
            for(const key of autoRenewalAttempts.current.keys()){
              if(key.startsWith(`${subscriptionId}:`))autoRenewalAttempts.current.delete(key);
            }
            if(generation===contextGeneration.current){
              Alert.alert(
                enabled?'Renovación automática activada':'Renovación automática desactivada',
                enabled
                  ? 'El servidor confirmó el consentimiento y la fecha del próximo cobro.'
                  : 'El servidor confirmó que no habrá cobros futuros. El periodo pagado no cambia.',
              );
            }
          }catch(cause){
            if(generation===contextGeneration.current){
              Alert.alert('No se pudo actualizar',creatorPremiumErrorMessage(cause));
            }
          }finally{
            if(activeCancellation.current===operationId){
              activeCancellation.current=null;
              if(generation===contextGeneration.current)setBusyId(null);
            }
          }
        })();
      }},
    ]);
  },[busyId,readBackSubscriptions,user?.id]);

  const cancel=useCallback((subscription:CreatorPremiumSubscriptionItem)=>{
    const generation=contextGeneration.current;
    Alert.alert('Cancelar suscripción','La cancelación no mueve dinero. El acceso pagado continúa hasta la fecha indicada y no habrá renovación automática.',[
      {text:'Volver',style:'cancel'},
      {text:'Cancelar suscripción',style:'destructive',onPress:()=>{
        if(busyId||activeCancellation.current||!user?.id)return;
        const operationId=randomUUID();
        const idempotencyKey=cancelAttempts.current.get(subscription.id)??randomUUID();
        cancelAttempts.current.set(subscription.id,idempotencyKey);
        activeCancellation.current=operationId;
        setBusyId(subscription.id);
        void cancelCreatorPremiumSubscription({subscriptionId:subscription.id,idempotencyKey})
          .then(async result=>{
            if(generation!==contextGeneration.current)return;
            if(!result?.success)throw new Error(typeof result?.error==='string'?result.error:'creator_premium_cancellation_failed');
            const confirmed=await readBackSubscriptions();
            const current=confirmed.items.find(item=>item.id===subscription.id);
            const raced='cancellation_effect' in result.data
              &&result.data.cancellation_effect==='future_renewal_revoked_after_race';
            if(raced){
              const renewed=confirmed.items.find(item=>item.id!==subscription.id
                &&item.plan.id===subscription.plan.id
                &&item.status==='active'
                &&item.access_active
                &&item.is_latest_relationship
                &&item.period?.access_state==='active'
                &&item.auto_renewal.mandate_state==='REVOKED'
                &&item.auto_renewal.last_result==='cancelled');
              if(current?.status!=='expired'||!renewed||renewed.auto_renewal.enabled){
                throw new Error('creator_premium_cancellation_readback_pending');
              }
            }else if(current?.status!=='cancelled'){
              throw new Error('creator_premium_cancellation_readback_pending');
            }
            cancelAttempts.current.delete(subscription.id);
            if(generation===contextGeneration.current){
              Alert.alert(
                raced?'Renovación futura detenida':'Suscripción cancelada',
                raced
                  ? 'La renovación coincidió con tu cancelación. El nuevo periodo pagado permanece accesible hasta su vencimiento y no habrá otro cobro automático.'
                  : 'Tu periodo pagado conserva acceso hasta su vencimiento.',
              );
            }
          })
          .catch(cause=>{if(generation===contextGeneration.current)Alert.alert('No se pudo cancelar',creatorPremiumErrorMessage(cause))})
          .finally(()=>{if(activeCancellation.current===operationId){activeCancellation.current=null;if(generation===contextGeneration.current)setBusyId(null)}});
      }}
    ]);
  },[busyId,readBackSubscriptions,user?.id]);

  const renew=useCallback((subscription:CreatorPremiumSubscriptionItem)=>{
    const generation=contextGeneration.current;
    const planId=subscription.plan.id,amount=subscription.plan.price_bdag,days=subscription.plan.billing_period_days;
    const subscriptionId=subscription.id;
    Alert.alert('Renovar periodo',`Renovar manualmente por ${amount} BDAG para un periodo de ${days} días. Esta renovación manual no cambia tu consentimiento de renovación automática.`,[
      {text:'Volver',style:'cancel'},
      {text:'Renovar',onPress:()=>{
        if(generation!==contextGeneration.current||busyId||activeCancellation.current||!user?.id||!policy.subscription_enabled||!subscription.renewal_available)return;
        const current=itemsRef.current.find(item=>item.id===subscriptionId);
        if(!policyRef.current.subscription_enabled||!current?.renewal_available||current.plan.id!==planId||current.plan.price_bdag!==amount||current.plan.billing_period_days!==days)return;
        const operationId=randomUUID();
        const idempotencyKey=renewalAttempts.current.get(planId)??randomUUID();
        renewalAttempts.current.set(planId,idempotencyKey);
        activeCancellation.current=operationId;setBusyId(subscription.id);
        void subscribeToPlan({planId,idempotencyKey})
          .then(async result=>{
            if(generation!==contextGeneration.current)return;
            if(!result?.success)throw new Error(typeof result?.error==='string'?result.error:'creator_premium_subscription_failed');
            const confirmed=await readBackSubscriptions();
            const renewed=confirmed.items.find(item=>item.plan.id===planId&&item.access_active&&item.id!==subscriptionId);
            if(!renewed)throw new Error('creator_premium_subscription_readback_pending');
            renewalAttempts.current.delete(planId);
            if(generation===contextGeneration.current)Alert.alert('Renovación confirmada','El nuevo periodo y el acceso fueron verificados por el servidor.');
          })
          .catch(cause=>{if(generation===contextGeneration.current)Alert.alert('No se pudo renovar',creatorPremiumErrorMessage(cause))})
          .finally(()=>{if(activeCancellation.current===operationId){activeCancellation.current=null;if(generation===contextGeneration.current)setBusyId(null)}});
      }}
    ]);
  },[busyId,policy.subscription_enabled,readBackSubscriptions,user?.id]);
  return <View style={[styles.root,{paddingTop:insets.top}]}><StatusBar style="light"/><View style={styles.header}><Pressable onPress={()=>router.back()} style={styles.icon}><MaterialCommunityIcons name="arrow-left" size={24} color={Colors.textPrimary}/></Pressable><View style={styles.headerCopy}><Text style={styles.title}>Mis suscripciones Premium</Text><Text style={styles.subtitle}>Periodos y renovación</Text></View><Pressable onPress={()=>router.push('/my-premium-library')} style={styles.icon}><MaterialCommunityIcons name="bookshelf" size={22} color={Colors.purple}/></Pressable></View>{loading?<View style={styles.center}><ActivityIndicator color={Colors.purple}/><Text style={styles.muted}>Cargando suscripciones…</Text></View>:<ScrollView contentContainerStyle={[styles.content,{paddingBottom:insets.bottom+32}]} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>void load(true)} tintColor={Colors.purple}/>}><View style={styles.notice}><MaterialCommunityIcons name="information-outline" size={20} color={Colors.info}/><Text style={styles.noticeText}>{policy.subscription_enabled?'La renovación automática es opcional, requiere tu consentimiento y puede desactivarse sin perder el periodo pagado.':'Los nuevos cobros están deshabilitados por la política financiera. Aún puedes desactivar una renovación existente.'}</Text></View>{error?<Pressable style={styles.error} onPress={()=>void load()}><Text style={styles.errorText}>{error}</Text><Text style={styles.retry}>Toca para reintentar</Text></Pressable>:null}{items.length===0?<View style={styles.empty}><MaterialCommunityIcons name="star-off-outline" size={42} color={Colors.textSubtle}/><Text style={styles.emptyTitle}>Aún no tienes suscripciones</Text><Text style={styles.muted}>Los planes disponibles aparecen en las ofertas publicadas de cada creador.</Text></View>:items.map(item=><View key={item.id} style={styles.card}><View style={styles.creatorRow}>{item.creator.avatar_url?<Image source={{uri:item.creator.avatar_url}} style={styles.avatar} contentFit="cover"/>:<View style={[styles.avatar,styles.avatarFallback]}><Text style={styles.avatarText}>{(item.creator.display_name??item.creator.username??'N').slice(0,1).toUpperCase()}</Text></View>}<View style={styles.flex}><Text style={styles.planName}>{item.plan.name}</Text><Text style={styles.creatorName}>{item.creator.display_name??(item.creator.username?`@${item.creator.username}`:'Creador Nelyon')}</Text></View><View style={[styles.badge,item.access_active&&styles.badgeActive]}><Text style={[styles.badgeText,item.access_active&&styles.badgeTextActive]}>{statusLabel[item.status]}</Text></View></View><Text style={styles.description}>{item.plan.description||'Plan Premium del creador'}</Text><View style={styles.facts}><View style={styles.fact}><Text style={styles.factLabel}>Precio del periodo</Text><Text style={styles.factValue}>{exactBdag(item.plan.price_bdag)}</Text></View><View style={styles.fact}><Text style={styles.factLabel}>Duración</Text><Text style={styles.factValue}>Cada {item.plan.billing_period_days} días</Text></View><View style={styles.fact}><Text style={styles.factLabel}>Acceso pagado hasta</Text><Text style={styles.factValue}>{date(item.period?.paid_through_at)}</Text></View><View style={styles.fact}><Text style={styles.factLabel}>Estado del periodo</Text><Text style={styles.factValue}>{item.period?.access_state??'Sin periodo activo'}</Text></View></View><View style={styles.autoRenewalPanel}><Text style={styles.autoRenewalTitle}>{item.auto_renewal.enabled?'Renovación automática activa':item.auto_renewal.mandate_state==='PAUSED'?'Renovación automática pausada':'Renovación automática desactivada'}</Text><Text style={styles.noRenewal}>{item.auto_renewal.enabled?`Próximo cobro: ${date(item.auto_renewal.next_charge_at)} · ${exactBdag(item.auto_renewal.authorized_price_bdag??item.plan.price_bdag)}`:'No se programarán cobros automáticos.'}</Text>{item.auto_renewal.last_result&&autoRenewalResultCopy[item.auto_renewal.last_result]?<Text style={styles.autoRenewalWarning}>{autoRenewalResultCopy[item.auto_renewal.last_result]}</Text>:null}{item.is_latest_relationship?<Pressable disabled={busyId!==null||(!item.auto_renewal.enabled&&(!policy.subscription_enabled||item.status!=='active'||!item.access_active||item.plan.status!=='active'))} style={[styles.autoRenewalButton,(busyId!==null||(!item.auto_renewal.enabled&&(!policy.subscription_enabled||item.status!=='active'||!item.access_active||item.plan.status!=='active')))&&styles.disabled]} onPress={()=>setAutoRenewal(item,!item.auto_renewal.enabled)}>{busyId===item.id?<ActivityIndicator color={Colors.purple}/>:<Text style={styles.autoRenewalButtonText}>{item.auto_renewal.enabled?'Desactivar renovación automática':'Activar renovación automática'}</Text>}</Pressable>:null}</View>{item.access_active&&<Pressable style={styles.libraryButton} onPress={()=>router.push('/my-premium-library')}><MaterialCommunityIcons name="shield-lock-open-outline" size={19} color={Colors.textOnBrand}/><Text style={styles.libraryText}>Abrir biblioteca Premium</Text></Pressable>}{item.status==='active'&&<Pressable disabled={busyId!==null} style={styles.cancelButton} onPress={()=>cancel(item)}>{busyId===item.id?<ActivityIndicator color={Colors.error}/>:<Text style={styles.cancelText}>Cancelar futuras renovaciones</Text>}</Pressable>}{item.renewal_available&&<Pressable disabled={busyId!==null||!policy.subscription_enabled} style={styles.libraryButton} onPress={()=>renew(item)}>{busyId===item.id?<ActivityIndicator color={Colors.textOnBrand}/>:<Text style={styles.libraryText}>Renovar periodo</Text>}</Pressable>}<Text style={styles.noRenewal}>Cancelar o desactivar la renovación no revoca el periodo ya pagado.</Text></View>)}{nextCursor?<Pressable disabled={loadingMore} style={styles.more} onPress={()=>void loadMore()}>{loadingMore?<ActivityIndicator color={Colors.purple}/>:<Text style={styles.moreText}>Cargar más</Text>}</Pressable>:null}</ScrollView>}</View>;
}

const styles=StyleSheet.create({root:{flex:1,backgroundColor:Colors.bg},header:{minHeight:64,flexDirection:'row',alignItems:'center',paddingHorizontal:Spacing.md,borderBottomWidth:1,borderBottomColor:Colors.border},headerCopy:{flex:1},icon:{width:42,height:42,alignItems:'center',justifyContent:'center'},title:{color:Colors.textPrimary,fontSize:FontSize.lg,fontWeight:FontWeight.bold},subtitle:{color:Colors.textSubtle,fontSize:FontSize.xs,marginTop:2},content:{padding:Spacing.md,gap:Spacing.md},center:{flex:1,alignItems:'center',justifyContent:'center',gap:Spacing.md},muted:{color:Colors.textSubtle,fontSize:FontSize.sm,textAlign:'center'},notice:{flexDirection:'row',gap:10,padding:Spacing.md,borderRadius:Radius.md,backgroundColor:Colors.blueDim,borderWidth:1,borderColor:Colors.blue},noticeText:{flex:1,color:Colors.textSecondary,fontSize:FontSize.sm,lineHeight:19},error:{padding:Spacing.md,borderRadius:Radius.md,backgroundColor:'rgba(255,59,92,0.1)',borderWidth:1,borderColor:Colors.error},errorText:{color:Colors.error,fontSize:FontSize.sm},retry:{color:Colors.textSecondary,fontSize:FontSize.xs,marginTop:4},empty:{alignItems:'center',gap:Spacing.sm,paddingVertical:Spacing.xxl},emptyTitle:{color:Colors.textPrimary,fontSize:FontSize.lg,fontWeight:FontWeight.bold},card:{padding:Spacing.md,gap:Spacing.md,borderRadius:Radius.lg,backgroundColor:Colors.surfaceElevated,borderWidth:1,borderColor:Colors.border},creatorRow:{flexDirection:'row',alignItems:'center',gap:12},avatar:{width:46,height:46,borderRadius:23},avatarFallback:{alignItems:'center',justifyContent:'center',backgroundColor:Colors.purpleDim},avatarText:{color:Colors.purple,fontSize:FontSize.lg,fontWeight:FontWeight.bold},flex:{flex:1},planName:{color:Colors.textPrimary,fontSize:FontSize.md,fontWeight:FontWeight.bold},creatorName:{color:Colors.textSubtle,fontSize:FontSize.xs,marginTop:2},badge:{borderRadius:Radius.full,paddingHorizontal:9,paddingVertical:5,backgroundColor:Colors.surfaceHighlight},badgeActive:{backgroundColor:Colors.accentDim},badgeText:{color:Colors.textSecondary,fontSize:FontSize.xs,fontWeight:FontWeight.bold},badgeTextActive:{color:Colors.accent},description:{color:Colors.textSecondary,fontSize:FontSize.sm},facts:{gap:8,padding:12,borderRadius:Radius.md,backgroundColor:Colors.surface},fact:{flexDirection:'row',justifyContent:'space-between',gap:12},factLabel:{color:Colors.textSubtle,fontSize:FontSize.xs},factValue:{color:Colors.textPrimary,fontSize:FontSize.xs,fontWeight:FontWeight.semibold,textAlign:'right'},autoRenewalPanel:{gap:8,padding:12,borderRadius:Radius.md,backgroundColor:Colors.surface,borderWidth:1,borderColor:Colors.border},autoRenewalTitle:{color:Colors.textPrimary,fontSize:FontSize.sm,fontWeight:FontWeight.bold},autoRenewalWarning:{color:Colors.info,fontSize:FontSize.xs,lineHeight:17},autoRenewalButton:{minHeight:42,alignItems:'center',justifyContent:'center',borderRadius:Radius.md,borderWidth:1,borderColor:Colors.purple},autoRenewalButtonText:{color:Colors.purple,fontSize:FontSize.sm,fontWeight:FontWeight.semibold},disabled:{opacity:.45},libraryButton:{minHeight:46,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:8,borderRadius:Radius.md,backgroundColor:Colors.purple},libraryText:{color:Colors.textOnBrand,fontSize:FontSize.sm,fontWeight:FontWeight.bold},cancelButton:{minHeight:42,alignItems:'center',justifyContent:'center',borderRadius:Radius.md,borderWidth:1,borderColor:Colors.error},cancelText:{color:Colors.error,fontSize:FontSize.sm,fontWeight:FontWeight.semibold},noRenewal:{color:Colors.textSubtle,fontSize:FontSize.xs,lineHeight:17},more:{minHeight:46,alignItems:'center',justifyContent:'center'},moreText:{color:Colors.purple,fontWeight:FontWeight.bold}});
