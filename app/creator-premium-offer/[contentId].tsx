import { MaterialCommunityIcons } from '@expo/vector-icons';
import { randomUUID } from 'expo-crypto';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import {
  CREATOR_PREMIUM_FINANCE_AVAILABLE, fetchCreatorPremiumCommerce,
  getCurrentCreatorPremiumUserId, reportCreatorPremiumContent,
  type CreatorPremiumCommerce,
} from '@/services/creatorPremiumService';
import { rememberCreatorPremiumContentKind } from '@/services/creatorPremiumViewerRuntime.mjs';
import { purchaseContent, subscribeToPlan } from '@/services/financial/ledgerClient';

const formatExactBdag = (value: string): string => {
  const [whole, fraction] = value.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${grouped}${fraction ? `,${fraction}` : ''} BDAG`;
};
const message = (cause: unknown) => cause instanceof Error && cause.message
  ? cause.message : 'No pudimos completar la operación.';

export default function CreatorPremiumOfferScreen() {
  const { contentId } = useLocalSearchParams<{ contentId?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [commerce, setCommerce] = useState<CreatorPremiumCommerce | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportDetails, setReportDetails] = useState('');
  const purchaseAttempt = useRef(randomUUID());
  const subscriptionAttempts = useRef(new Map<string, string>());
  const inFlight = useRef(false);
  const activeOperation = useRef<string | null>(null);
  const contextGeneration = useRef(0);
  const requestGeneration = useRef(0);
  const contextKey = `${user?.id ?? 'signed-out'}:${contentId ?? ''}`;
  const contextKeyRef = useRef(contextKey);

  if (contextKeyRef.current !== contextKey) {
    contextKeyRef.current = contextKey;
    contextGeneration.current += 1;
    requestGeneration.current += 1;
    purchaseAttempt.current = randomUUID();
    subscriptionAttempts.current.clear();
    activeOperation.current = null;
    inFlight.current = false;
  }

  useEffect(() => {
    setCommerce(null);
    setError(null);
    setLoading(true);
    setBusy(null);
    setReportOpen(false);
    return () => {
      contextGeneration.current += 1;
      requestGeneration.current += 1;
      activeOperation.current = null;
      inFlight.current = false;
    };
  }, [contextKey]);

  const load = useCallback(async (refresh = false) => {
    if (!contentId) { setError('Contenido Premium no disponible.'); setLoading(false); return; }
    const generation = contextGeneration.current;
    const request = ++requestGeneration.current;
    if (refresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const next = await fetchCreatorPremiumCommerce(contentId);
      if (generation !== contextGeneration.current || request !== requestGeneration.current) return;
      setCommerce(next);
    } catch (cause) {
      if (generation !== contextGeneration.current || request !== requestGeneration.current) return;
      setCommerce(null);
      setError(message(cause));
    } finally {
      if (generation === contextGeneration.current && request === requestGeneration.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [contentId]);
  useFocusEffect(useCallback(() => {
    if (contextKeyRef.current === contextKey) void load();
    return () => { requestGeneration.current += 1; };
  }, [contextKey, load]));

  const openProtected = useCallback(async () => {
    if (!commerce?.entitlement.allowed) return;
    const generation = contextGeneration.current;
    try {
      const userId = await getCurrentCreatorPremiumUserId();
      if (generation !== contextGeneration.current) return;
      if (!userId || userId !== user?.id) throw new Error('session_required');
      rememberCreatorPremiumContentKind(userId, commerce.content.id, commerce.content.content_kind);
      router.push({ pathname: '/creator-premium-viewer/[contentId]', params: { contentId: commerce.content.id } } as never);
    } catch {
      if (generation === contextGeneration.current) {
        Alert.alert('Sesión requerida', 'Vuelve a iniciar sesión para validar este acceso.');
      }
    }
  }, [commerce, router, user?.id]);

  const purchaseAllowed = Boolean(CREATOR_PREMIUM_FINANCE_AVAILABLE && commerce?.policy.purchase_enabled && commerce.offer);
  const runPurchase = useCallback(async () => {
    if (!commerce?.offer || !purchaseAllowed || !user?.id || inFlight.current) return;
    const generation = contextGeneration.current;
    const operationId = randomUUID();
    activeOperation.current = operationId;
    inFlight.current = true; setBusy('purchase');
    try {
      const result = await purchaseContent({ contentId: commerce.content.id, idempotencyKey: purchaseAttempt.current });
      if (generation !== contextGeneration.current) return;
      if (!result?.success) throw new Error(typeof result?.error === 'string' ? result.error : 'creator_premium_purchase_failed');
      purchaseAttempt.current = randomUUID();
      await load(true);
      if (generation === contextGeneration.current) {
        Alert.alert('Compra confirmada', 'Tu acceso se verificó en el servidor.');
      }
    } catch (cause) {
      if (generation === contextGeneration.current) Alert.alert('Compra no completada', message(cause));
    } finally {
      if (activeOperation.current === operationId) {
        activeOperation.current = null;
        inFlight.current = false;
        if (generation === contextGeneration.current) setBusy(null);
      }
    }
  }, [commerce, load, purchaseAllowed, user?.id]);

  const runSubscription = useCallback(async (planId: string) => {
    if (!commerce?.policy.subscription_enabled || !CREATOR_PREMIUM_FINANCE_AVAILABLE || !user?.id || inFlight.current) return;
    const generation = contextGeneration.current;
    const operationId = randomUUID();
    activeOperation.current = operationId;
    inFlight.current = true; setBusy(planId);
    const idempotencyKey = subscriptionAttempts.current.get(planId) ?? randomUUID();
    subscriptionAttempts.current.set(planId, idempotencyKey);
    try {
      const result = await subscribeToPlan({ planId, idempotencyKey });
      if (generation !== contextGeneration.current) return;
      if (!result?.success) throw new Error(typeof result?.error === 'string' ? result.error : 'creator_premium_subscription_failed');
      subscriptionAttempts.current.delete(planId);
      await load(true);
      if (generation === contextGeneration.current) {
        Alert.alert('Suscripción confirmada', 'El periodo y el acceso se verificaron en el servidor.');
      }
    } catch (cause) {
      if (generation === contextGeneration.current) Alert.alert('Suscripción no completada', message(cause));
    } finally {
      if (activeOperation.current === operationId) {
        activeOperation.current = null;
        inFlight.current = false;
        if (generation === contextGeneration.current) setBusy(null);
      }
    }
  }, [commerce, load, user?.id]);

  const sendReport = useCallback(async () => {
    if (!contentId || !/^[a-z][a-z0-9_]{1,79}$/.test(reportReason.trim().toLowerCase())) {
      Alert.alert('Revisa el motivo', 'Usa un código breve como contenido_ilegal o acoso.'); return;
    }
    const generation = contextGeneration.current;
    setBusy('report');
    try {
      await reportCreatorPremiumContent({ contentId, reason: reportReason.trim().toLowerCase(), details: reportDetails });
      if (generation !== contextGeneration.current) return;
      setReportOpen(false); setReportReason(''); setReportDetails('');
      Alert.alert('Reporte enviado', 'El equipo de seguridad revisará el contenido sin recibir el original privado.');
    } catch (cause) {
      if (generation === contextGeneration.current) Alert.alert('No se envió el reporte', message(cause));
    } finally {
      if (generation === contextGeneration.current) setBusy(null);
    }
  }, [contentId, reportDetails, reportReason]);

  const financeMessage = useMemo(() => !CREATOR_PREMIUM_FINANCE_AVAILABLE
    ? 'Compras y suscripciones siguen deshabilitadas mientras se completa la activación comercial y de tiendas.'
    : 'Esta opción no está habilitada por la política financiera actual.', []);

  return <View style={[styles.root, { paddingTop: insets.top }]}><StatusBar style="light"/><View style={styles.header}><Pressable onPress={()=>router.back()} style={styles.icon}><MaterialCommunityIcons name="arrow-left" size={24} color={Colors.textPrimary}/></Pressable><Text style={styles.headerTitle}>Contenido Premium</Text><Pressable onPress={()=>setReportOpen(true)} style={styles.icon}><MaterialCommunityIcons name="flag-outline" size={21} color={Colors.textSecondary}/></Pressable></View>{loading?<View style={styles.center}><ActivityIndicator color={Colors.purple}/><Text style={styles.muted}>Cargando oferta canónica…</Text></View>:error||!commerce?<View style={styles.center}><MaterialCommunityIcons name="alert-circle-outline" size={36} color={Colors.error}/><Text style={styles.title}>No disponible</Text><Text style={styles.muted}>{error}</Text><Pressable style={styles.secondaryButton} onPress={()=>void load()}><Text style={styles.secondaryText}>Reintentar</Text></Pressable></View>:<ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>void load(true)} tintColor={Colors.purple}/>} contentContainerStyle={[styles.content,{paddingBottom:insets.bottom+32}]}><View style={styles.hero}>{commerce.content.teaser_url?<Image source={{uri:commerce.content.teaser_url}} style={styles.teaser} contentFit="cover"/>:<View style={[styles.teaser,styles.placeholder]}><MaterialCommunityIcons name="lock" size={42} color={Colors.purple}/></View>}<View style={styles.lockBadge}><MaterialCommunityIcons name={commerce.entitlement.allowed?"shield-check":"lock"} size={16} color="#fff"/><Text style={styles.lockText}>{commerce.entitlement.allowed?'Acceso verificado':'Original protegido'}</Text></View></View><View style={styles.copy}><Text style={styles.title}>{commerce.content.title}</Text><Text style={styles.creator}>{commerce.creator.display_name??commerce.creator.username??'Creador Nelyon'}</Text><Text style={styles.description}>{commerce.content.description||'Contenido privado del creador.'}</Text></View>{commerce.entitlement.allowed?<Pressable style={styles.primaryButton} onPress={()=>void openProtected()}><MaterialCommunityIcons name="shield-lock-open-outline" size={20} color={Colors.textOnBrand}/><Text style={styles.primaryText}>Abrir visor protegido</Text></Pressable>:<><View style={styles.notice}><MaterialCommunityIcons name="information-outline" size={20} color={Colors.info}/><Text style={styles.noticeText}>{financeMessage}</Text></View>{commerce.offer&&<View style={styles.card}><View style={styles.cardHeader}><View><Text style={styles.cardTitle}>Compra individual</Text><Text style={styles.muted}>Acceso a este contenido</Text></View><Text style={styles.price}>{formatExactBdag(commerce.offer.price_bdag)}</Text></View><Pressable disabled={!purchaseAllowed||busy!==null} style={[styles.primaryButton,(!purchaseAllowed||busy!==null)&&styles.disabled]} onPress={()=>void runPurchase()}>{busy==='purchase'?<ActivityIndicator color="#fff"/>:<Text style={styles.primaryText}>{purchaseAllowed?'Confirmar compra':'Compra no habilitada'}</Text>}</Pressable></View>}{commerce.plans.map(plan=>{const allowed=Boolean(CREATOR_PREMIUM_FINANCE_AVAILABLE&&commerce.policy.subscription_enabled);return <View key={plan.id} style={styles.card}><View style={styles.cardHeader}><View style={styles.flex}><Text style={styles.cardTitle}>{plan.name}</Text><Text style={styles.muted}>{plan.description||'Plan del creador'}</Text><Text style={styles.period}>Cada {plan.billing_period_days} días · sin renovación automática</Text></View><Text style={styles.price}>{formatExactBdag(plan.price_bdag)}</Text></View><Pressable disabled={!allowed||busy!==null} style={[styles.primaryButton,(!allowed||busy!==null)&&styles.disabled]} onPress={()=>void runSubscription(plan.id)}>{busy===plan.id?<ActivityIndicator color="#fff"/>:<Text style={styles.primaryText}>{allowed?'Suscribirse':'Suscripción no habilitada'}</Text>}</Pressable></View>})}</>}<Pressable style={styles.reportLink} onPress={()=>setReportOpen(true)}><MaterialCommunityIcons name="flag-outline" size={17} color={Colors.textSubtle}/><Text style={styles.reportText}>Reportar contenido Premium</Text></Pressable></ScrollView>}<Modal visible={reportOpen} transparent animationType="fade" onRequestClose={()=>setReportOpen(false)}><View style={styles.modalBackdrop}><View style={styles.modalCard}><Text style={styles.cardTitle}>Reportar contenido</Text><Text style={styles.muted}>No se enviarán grants ni originales privados.</Text><TextInput style={styles.input} value={reportReason} onChangeText={setReportReason} placeholder="motivo_seguro" placeholderTextColor={Colors.textSubtle} autoCapitalize="none"/><TextInput style={[styles.input,styles.multiline]} value={reportDetails} onChangeText={setReportDetails} placeholder="Detalles opcionales" placeholderTextColor={Colors.textSubtle} multiline maxLength={1000}/><View style={styles.actions}><Pressable style={styles.secondaryButton} disabled={busy==='report'} onPress={()=>setReportOpen(false)}><Text style={styles.secondaryText}>Cancelar</Text></Pressable><Pressable style={styles.primaryButton} disabled={busy==='report'} onPress={()=>void sendReport()}><Text style={styles.primaryText}>Enviar reporte</Text></Pressable></View></View></View></Modal></View>;
}

const styles=StyleSheet.create({root:{flex:1,backgroundColor:Colors.bg},header:{height:58,flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:Spacing.md,borderBottomWidth:1,borderBottomColor:Colors.border},headerTitle:{color:Colors.textPrimary,fontSize:FontSize.lg,fontWeight:FontWeight.bold},icon:{width:42,height:42,alignItems:'center',justifyContent:'center'},content:{padding:Spacing.md,gap:Spacing.md},center:{flex:1,alignItems:'center',justifyContent:'center',gap:Spacing.md,padding:Spacing.xl},hero:{height:270,borderRadius:Radius.xl,overflow:'hidden',backgroundColor:Colors.surfaceElevated},teaser:{width:'100%',height:'100%'},placeholder:{alignItems:'center',justifyContent:'center'},lockBadge:{position:'absolute',left:12,bottom:12,flexDirection:'row',alignItems:'center',gap:6,backgroundColor:'rgba(10,10,15,0.78)',borderRadius:Radius.full,paddingHorizontal:10,paddingVertical:7},lockText:{color:'#fff',fontSize:FontSize.xs,fontWeight:FontWeight.semibold},copy:{gap:6},title:{color:Colors.textPrimary,fontSize:FontSize.xxl,fontWeight:FontWeight.bold,textAlign:'center'},creator:{color:Colors.purple,fontSize:FontSize.sm,fontWeight:FontWeight.semibold},description:{color:Colors.textSecondary,fontSize:FontSize.md,lineHeight:22},muted:{color:Colors.textSubtle,fontSize:FontSize.sm},notice:{flexDirection:'row',gap:10,padding:Spacing.md,backgroundColor:Colors.blueDim,borderRadius:Radius.md,borderWidth:1,borderColor:Colors.blue},noticeText:{flex:1,color:Colors.textSecondary,fontSize:FontSize.sm,lineHeight:19},card:{padding:Spacing.md,gap:Spacing.md,backgroundColor:Colors.surfaceElevated,borderRadius:Radius.lg,borderWidth:1,borderColor:Colors.border},cardHeader:{flexDirection:'row',alignItems:'flex-start',gap:Spacing.sm},flex:{flex:1},cardTitle:{color:Colors.textPrimary,fontSize:FontSize.lg,fontWeight:FontWeight.bold},price:{color:Colors.purple,fontSize:FontSize.lg,fontWeight:FontWeight.bold},period:{color:Colors.textSecondary,fontSize:FontSize.xs,marginTop:5},primaryButton:{minHeight:48,borderRadius:Radius.md,backgroundColor:Colors.purple,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:8,paddingHorizontal:Spacing.md},primaryText:{color:Colors.textOnBrand,fontSize:FontSize.md,fontWeight:FontWeight.bold},disabled:{opacity:.45},secondaryButton:{minHeight:46,borderRadius:Radius.md,borderWidth:1,borderColor:Colors.border,alignItems:'center',justifyContent:'center',paddingHorizontal:Spacing.md},secondaryText:{color:Colors.textPrimary,fontSize:FontSize.sm,fontWeight:FontWeight.semibold},reportLink:{alignSelf:'center',flexDirection:'row',gap:7,padding:Spacing.md},reportText:{color:Colors.textSubtle,fontSize:FontSize.sm},modalBackdrop:{flex:1,backgroundColor:Colors.overlay,alignItems:'center',justifyContent:'center',padding:Spacing.lg},modalCard:{width:'100%',maxWidth:520,backgroundColor:Colors.surfaceElevated,borderRadius:Radius.xl,padding:Spacing.lg,gap:Spacing.md,borderWidth:1,borderColor:Colors.border},input:{minHeight:46,borderRadius:Radius.md,borderWidth:1,borderColor:Colors.border,backgroundColor:Colors.surface,paddingHorizontal:12,color:Colors.textPrimary},multiline:{minHeight:100,paddingTop:12,textAlignVertical:'top'},actions:{flexDirection:'row',justifyContent:'flex-end',gap:Spacing.sm}});
