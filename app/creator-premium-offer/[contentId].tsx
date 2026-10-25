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
import { formatCreatorPremiumBdag } from '@/services/creatorPremiumPresentation.mjs';
import { creatorPremiumErrorMessage } from '@/services/creatorPremiumIntegrationState';
import {
  CREATOR_PREMIUM_REPORT_REASONS,
  fetchCreatorPremiumCommerce, getCurrentCreatorPremiumUserId,
  reportCreatorPremiumContent, type CreatorPremiumCommerce,
  type CreatorPremiumReportReason,
} from '@/services/creatorPremiumService';
import { rememberCreatorPremiumContentKind } from '@/services/creatorPremiumViewerRuntime.mjs';
import { purchaseContent, subscribeToPlan } from '@/services/financial/ledgerClient';

const message = (cause: unknown) => creatorPremiumErrorMessage(cause);
const confirmCharge = (title: string, detail: string) => new Promise<boolean>(resolve => {
  Alert.alert(title, detail, [
    { text: 'Volver', style: 'cancel', onPress: () => resolve(false) },
    { text: 'Confirmar', onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) });
});

export default function CreatorPremiumOfferScreen() {
  const { contentId } = useLocalSearchParams<{ contentId?: string }>();
  const { user } = useAuth();
  const contextKey = `${user?.id ?? 'signed-out'}:${contentId ?? ''}`;
  return <CreatorPremiumOfferScreenContent key={contextKey} />;
}

function CreatorPremiumOfferScreenContent() {
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
  const purchaseTarget = useRef<string | null>(null);
  const commerceRef = useRef(commerce);
  commerceRef.current = commerce;
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
    purchaseTarget.current = null;
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

  const purchaseAllowed = Boolean(
    commerce?.policy.purchase_enabled && commerce?.operations.purchase_available,
  );
  const readBackCommerce = useCallback(async (): Promise<CreatorPremiumCommerce> => {
    if (!contentId) throw new Error('creator_premium_content_not_found');
    const generation = contextGeneration.current;
    const request = ++requestGeneration.current;
    const next = await fetchCreatorPremiumCommerce(contentId);
    if (generation !== contextGeneration.current || request !== requestGeneration.current) {
      throw new Error('creator_premium_financial_readback_stale');
    }
    setCommerce(next);
    return next;
  }, [contentId]);
  const runPurchase = useCallback(async () => {
    if (!commerce?.offer || !purchaseAllowed || !user?.id || inFlight.current) return;
    const generation = contextGeneration.current;
    const content = commerce.content.id;
    const offer = commerce.offer.id;
    const amount = commerce.offer.price_bdag;
    const operationId = randomUUID();
    activeOperation.current = operationId;
    inFlight.current = true; setBusy('purchase');
    try {
      if (!await confirmCharge('Confirmar compra', `Comprar este contenido por ${amount} BDAG. Esta operación está sujeta a la autorización limitada del servidor; no implica disponibilidad pública.`)) return;
      if (generation !== contextGeneration.current) return;
      const current = commerceRef.current;
      if (current?.content.id !== content || current.offer?.id !== offer
          || current.offer.price_bdag !== amount || !current.operations.purchase_available) {
        throw new Error('creator_premium_offer_changed');
      }
      if (purchaseTarget.current !== offer) {
        if (purchaseTarget.current !== null) purchaseAttempt.current = randomUUID();
        purchaseTarget.current = offer;
      }
      const result = await purchaseContent({ contentId: content, offerVersionId: offer, idempotencyKey: purchaseAttempt.current });
      if (generation !== contextGeneration.current) return;
      if (!result?.success) throw new Error(typeof result?.error === 'string' ? result.error : 'creator_premium_purchase_failed');
      const confirmed = await readBackCommerce();
      if (!confirmed.entitlement.allowed || confirmed.entitlement.source !== 'purchase') {
        throw new Error('creator_premium_purchase_readback_pending');
      }
      purchaseAttempt.current = randomUUID();
      if (generation === contextGeneration.current) {
        Alert.alert('Compra confirmada', 'Tu acceso se verificó en el servidor.');
      }
    } catch (cause) {
      if (generation === contextGeneration.current) {
        Alert.alert('Compra no completada', message(cause));
        if (cause instanceof Error && cause.message === 'creator_premium_offer_changed') await load(true);
      }
    } finally {
      if (activeOperation.current === operationId) {
        activeOperation.current = null;
        inFlight.current = false;
        if (generation === contextGeneration.current) setBusy(null);
      }
    }
  }, [commerce, load, purchaseAllowed, readBackCommerce, user?.id]);

  const runSubscription = useCallback(async (planId: string) => {
    const plan = commerce?.plans.find(item => item.id === planId);
    const operationAllowed = Boolean(plan?.subscription_available || plan?.renewal_available);
    if (!plan || !operationAllowed || !commerce?.policy.subscription_enabled || !user?.id || inFlight.current) return;
    const generation = contextGeneration.current;
    const amount = plan.price_bdag;
    const days = plan.billing_period_days;
    const renewing = plan.renewal_available;
    const operationId = randomUUID();
    activeOperation.current = operationId;
    inFlight.current = true; setBusy(planId);
    const idempotencyKey = subscriptionAttempts.current.get(planId) ?? randomUUID();
    subscriptionAttempts.current.set(planId, idempotencyKey);
    try {
      if (!await confirmCharge(renewing ? 'Renovar periodo' : 'Confirmar suscripción',
        `${renewing ? 'Renovar' : 'Iniciar'} un periodo de ${days} días por ${amount} BDAG. La renovación es manual; no hay renovación automática. Sujeto a autorización limitada del servidor, sin disponibilidad pública.`)) return;
      if (generation !== contextGeneration.current) return;
      const currentPlan = commerceRef.current?.plans.find(item => item.id === planId);
      if (!commerceRef.current?.policy.subscription_enabled || currentPlan?.price_bdag !== amount
          || currentPlan.billing_period_days !== days || currentPlan.renewal_available !== renewing
          || !(currentPlan.subscription_available || currentPlan.renewal_available)) {
        throw new Error('creator_premium_subscription_renewal_not_available');
      }
      const result = await subscribeToPlan({ planId, idempotencyKey });
      if (generation !== contextGeneration.current) return;
      if (!result?.success) throw new Error(typeof result?.error === 'string' ? result.error : 'creator_premium_subscription_failed');
      const confirmed = await readBackCommerce();
      const confirmedPlan = confirmed.plans.find(item => item.id === planId);
      if (!confirmedPlan?.relationship
          || confirmedPlan.relationship.access_state !== 'active'
          || !confirmedPlan.relationship.paid_through_at
          || Date.parse(confirmedPlan.relationship.paid_through_at) <= Date.now()) {
        throw new Error('creator_premium_subscription_readback_pending');
      }
      subscriptionAttempts.current.delete(planId);
      if (generation === contextGeneration.current) {
        Alert.alert(
          plan.renewal_available ? 'Renovación confirmada' : 'Suscripción confirmada',
          'El periodo y el acceso se verificaron en el servidor.',
        );
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
  }, [commerce, readBackCommerce, user?.id]);

  const sendReport = useCallback(async () => {
    const normalizedReason = reportReason.trim().toLowerCase();
    if (!contentId || !CREATOR_PREMIUM_REPORT_REASONS.includes(
      normalizedReason as CreatorPremiumReportReason,
    )) {
      Alert.alert('Revisa el motivo', 'Selecciona uno de los motivos de seguridad permitidos.'); return;
    }
    const generation = contextGeneration.current;
    setBusy('report');
    try {
      await reportCreatorPremiumContent({
        contentId,
        reason: normalizedReason as CreatorPremiumReportReason,
        details: reportDetails,
      });
      if (generation !== contextGeneration.current) return;
      setReportOpen(false); setReportReason(''); setReportDetails('');
      Alert.alert('Reporte enviado', 'El equipo de seguridad revisará el contenido sin recibir el original privado.');
    } catch (cause) {
      if (generation === contextGeneration.current) Alert.alert('No se envió el reporte', message(cause));
    } finally {
      if (generation === contextGeneration.current) setBusy(null);
    }
  }, [contentId, reportDetails, reportReason]);

  const financeMessage = useMemo(() => {
    if (!commerce) return 'La autoridad comercial no está disponible.';
    if (!commerce.policy.purchase_enabled && !commerce.policy.subscription_enabled) {
      return 'Compras y suscripciones están deshabilitadas por la política financiera del servidor.';
    }
    const blocker = commerce.operations.purchase_blocker
      ?? commerce.plans.find(plan => plan.subscription_blocker || plan.renewal_blocker)?.subscription_blocker
      ?? commerce.plans.find(plan => plan.renewal_blocker)?.renewal_blocker;
    return blocker
      ? creatorPremiumErrorMessage(new Error(blocker))
      : 'El servidor habilita únicamente las operaciones que superan todos los controles financieros.';
  }, [commerce]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.icon}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={Colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Contenido Premium</Text>
        <Pressable onPress={() => setReportOpen(true)} style={styles.icon}>
          <MaterialCommunityIcons name="flag-outline" size={21} color={Colors.textSecondary} />
        </Pressable>
      </View>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.purple} />
          <Text style={styles.muted}>Cargando oferta canónica…</Text>
        </View>
      ) : error || !commerce ? (
        <View style={styles.center}>
          <MaterialCommunityIcons name="alert-circle-outline" size={36} color={Colors.error} />
          <Text style={styles.title}>No disponible</Text>
          <Text style={styles.muted}>{error}</Text>
          <Pressable style={styles.secondaryButton} onPress={() => void load()}>
            <Text style={styles.secondaryText}>Reintentar</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={Colors.purple} />}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        >
          <View style={styles.hero}>
            {commerce.content.teaser_url ? (
              <Image source={{ uri: commerce.content.teaser_url }} style={styles.teaser} contentFit="cover" />
            ) : (
              <View style={[styles.teaser, styles.placeholder]}>
                <MaterialCommunityIcons name="lock" size={42} color={Colors.purple} />
              </View>
            )}
            <View style={styles.lockBadge}>
              <MaterialCommunityIcons name={commerce.entitlement.allowed ? "shield-check" : "lock"} size={16} color="#fff" />
              <Text style={styles.lockText}>{commerce.entitlement.allowed ? "Acceso verificado" : "Original protegido"}</Text>
            </View>
          </View>
          <View style={styles.copy}>
            <Text style={styles.title}>{commerce.content.title}</Text>
            <Text style={styles.creator}>{commerce.creator.display_name ?? commerce.creator.username ?? "Creador Nelyon"}</Text>
            <Text style={styles.description}>{commerce.content.description || "Contenido privado del creador."}</Text>
          </View>
          {commerce.entitlement.allowed ? (
            <Pressable style={styles.primaryButton} onPress={() => void openProtected()}>
              <MaterialCommunityIcons name="shield-lock-open-outline" size={20} color={Colors.textOnBrand} />
              <Text style={styles.primaryText}>Abrir visor protegido</Text>
            </Pressable>
          ) : (
            <>
              <View style={styles.notice}>
                <MaterialCommunityIcons name="information-outline" size={20} color={Colors.info} />
                <Text style={styles.noticeText}>{financeMessage}</Text>
              </View>
              {commerce.offer ? (
                <View style={styles.card}>
                  <View style={styles.cardHeader}>
                    <View>
                      <Text style={styles.cardTitle}>Compra individual</Text>
                      <Text style={styles.muted}>Acceso a este contenido</Text>
                    </View>
                    <Text style={styles.price}>{formatCreatorPremiumBdag(commerce.offer.price_bdag)}</Text>
                  </View>
                  <Pressable
                    disabled={!purchaseAllowed || busy !== null}
                    style={[styles.primaryButton, (!purchaseAllowed || busy !== null) && styles.disabled]}
                    onPress={() => void runPurchase()}
                  >
                    {busy === "purchase" ? <ActivityIndicator color="#fff" /> : (
                      <Text style={styles.primaryText}>{purchaseAllowed ? "Confirmar compra" : "Compra no habilitada"}</Text>
                    )}
                  </Pressable>
                </View>
              ) : null}
              {commerce.plans.map(plan => {
                const allowed = Boolean(
                  commerce.policy.subscription_enabled
                  && (plan.subscription_available || plan.renewal_available),
                );
                return (
                  <View key={plan.id} style={styles.card}>
                    <View style={styles.cardHeader}>
                      <View style={styles.flex}>
                        <Text style={styles.cardTitle}>{plan.name}</Text>
                        <Text style={styles.muted}>{plan.description || "Plan del creador"}</Text>
                        <Text style={styles.period}>Cada {plan.billing_period_days} días · renovación manual</Text>
                        {plan.relationship ? (
                          <Text style={styles.period}>
                            Relación {plan.relationship.status} · acceso hasta {plan.relationship.paid_through_at ?? "sin periodo vigente"}
                          </Text>
                        ) : null}
                      </View>
                      <Text style={styles.price}>{formatCreatorPremiumBdag(plan.price_bdag)}</Text>
                    </View>
                    <Pressable
                      disabled={!allowed || busy !== null}
                      style={[styles.primaryButton, (!allowed || busy !== null) && styles.disabled]}
                      onPress={() => void runSubscription(plan.id)}
                    >
                      {busy === plan.id ? <ActivityIndicator color="#fff" /> : (
                        <Text style={styles.primaryText}>{allowed ? (plan.renewal_available ? "Renovar periodo" : "Suscribirse") : "Suscripción no habilitada"}</Text>
                      )}
                    </Pressable>
                  </View>
                );
              })}
              {commerce.plans_truncated ? (
                <View style={styles.notice}>
                  <MaterialCommunityIcons name="alert-circle-outline" size={20} color={Colors.info} />
                  <Text style={styles.noticeText}>
                    No se muestran todos los planes. Refresca o gestiona tus opciones con el creador antes de continuar.
                  </Text>
                </View>
              ) : null}
            </>
          )}
          <Pressable style={styles.reportLink} onPress={() => setReportOpen(true)}>
            <MaterialCommunityIcons name="flag-outline" size={17} color={Colors.textSubtle} />
            <Text style={styles.reportText}>Reportar contenido Premium</Text>
          </Pressable>
        </ScrollView>
      )}
      <Modal visible={reportOpen} transparent animationType="fade" onRequestClose={() => setReportOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.cardTitle}>Reportar contenido</Text>
            <Text style={styles.muted}>No se enviarán grants ni originales privados.</Text>
            <TextInput
              style={styles.input}
              value={reportReason}
              onChangeText={setReportReason}
              placeholder="spam, child_safety, other…"
              placeholderTextColor={Colors.textSubtle}
              autoCapitalize="none"
            />
            <TextInput
              style={[styles.input, styles.multiline]}
              value={reportDetails}
              onChangeText={setReportDetails}
              placeholder="Detalles opcionales"
              placeholderTextColor={Colors.textSubtle}
              multiline
              maxLength={1000}
            />
            <View style={styles.actions}>
              <Pressable style={styles.secondaryButton} disabled={busy === "report"} onPress={() => setReportOpen(false)}>
                <Text style={styles.secondaryText}>Cancelar</Text>
              </Pressable>
              <Pressable style={styles.primaryButton} disabled={busy === "report"} onPress={() => void sendReport()}>
                <Text style={styles.primaryText}>Enviar reporte</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles=StyleSheet.create({root:{flex:1,backgroundColor:Colors.bg},header:{height:58,flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:Spacing.md,borderBottomWidth:1,borderBottomColor:Colors.border},headerTitle:{color:Colors.textPrimary,fontSize:FontSize.lg,fontWeight:FontWeight.bold},icon:{width:42,height:42,alignItems:'center',justifyContent:'center'},content:{padding:Spacing.md,gap:Spacing.md},center:{flex:1,alignItems:'center',justifyContent:'center',gap:Spacing.md,padding:Spacing.xl},hero:{height:270,borderRadius:Radius.xl,overflow:'hidden',backgroundColor:Colors.surfaceElevated},teaser:{width:'100%',height:'100%'},placeholder:{alignItems:'center',justifyContent:'center'},lockBadge:{position:'absolute',left:12,bottom:12,flexDirection:'row',alignItems:'center',gap:6,backgroundColor:'rgba(10,10,15,0.78)',borderRadius:Radius.full,paddingHorizontal:10,paddingVertical:7},lockText:{color:'#fff',fontSize:FontSize.xs,fontWeight:FontWeight.semibold},copy:{gap:6},title:{color:Colors.textPrimary,fontSize:FontSize.xxl,fontWeight:FontWeight.bold,textAlign:'center'},creator:{color:Colors.purple,fontSize:FontSize.sm,fontWeight:FontWeight.semibold},description:{color:Colors.textSecondary,fontSize:FontSize.md,lineHeight:22},muted:{color:Colors.textSubtle,fontSize:FontSize.sm},notice:{flexDirection:'row',gap:10,padding:Spacing.md,backgroundColor:Colors.blueDim,borderRadius:Radius.md,borderWidth:1,borderColor:Colors.blue},noticeText:{flex:1,color:Colors.textSecondary,fontSize:FontSize.sm,lineHeight:19},card:{padding:Spacing.md,gap:Spacing.md,backgroundColor:Colors.surfaceElevated,borderRadius:Radius.lg,borderWidth:1,borderColor:Colors.border},cardHeader:{flexDirection:'row',alignItems:'flex-start',gap:Spacing.sm},flex:{flex:1},cardTitle:{color:Colors.textPrimary,fontSize:FontSize.lg,fontWeight:FontWeight.bold},price:{color:Colors.purple,fontSize:FontSize.lg,fontWeight:FontWeight.bold},period:{color:Colors.textSecondary,fontSize:FontSize.xs,marginTop:5},primaryButton:{minHeight:48,borderRadius:Radius.md,backgroundColor:Colors.purple,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:8,paddingHorizontal:Spacing.md},primaryText:{color:Colors.textOnBrand,fontSize:FontSize.md,fontWeight:FontWeight.bold},disabled:{opacity:.45},secondaryButton:{minHeight:46,borderRadius:Radius.md,borderWidth:1,borderColor:Colors.border,alignItems:'center',justifyContent:'center',paddingHorizontal:Spacing.md},secondaryText:{color:Colors.textPrimary,fontSize:FontSize.sm,fontWeight:FontWeight.semibold},reportLink:{alignSelf:'center',flexDirection:'row',gap:7,padding:Spacing.md},reportText:{color:Colors.textSubtle,fontSize:FontSize.sm},modalBackdrop:{flex:1,backgroundColor:Colors.overlay,alignItems:'center',justifyContent:'center',padding:Spacing.lg},modalCard:{width:'100%',maxWidth:520,backgroundColor:Colors.surfaceElevated,borderRadius:Radius.xl,padding:Spacing.lg,gap:Spacing.md,borderWidth:1,borderColor:Colors.border},input:{minHeight:46,borderRadius:Radius.md,borderWidth:1,borderColor:Colors.border,backgroundColor:Colors.surface,paddingHorizontal:12,color:Colors.textPrimary},multiline:{minHeight:100,paddingTop:12,textAlignVertical:'top'},actions:{flexDirection:'row',justifyContent:'flex-end',gap:Spacing.sm}});
