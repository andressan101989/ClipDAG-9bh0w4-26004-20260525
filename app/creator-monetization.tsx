import { MaterialCommunityIcons } from '@expo/vector-icons';
import { randomUUID } from 'expo-crypto';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import {
  activateMyCreatorPremiumPlan,
  cloneMyCreatorPremiumPlanVersion,
  createMyCreatorPremiumPlanDraft,
  fetchMyCreatorPremiumContents,
  fetchMyCreatorPremiumPlans,
  normalizeCreatorPremiumPriceBdag,
  retireMyCreatorPremiumPlan,
  setMyCreatorPremiumPlanContents,
  updateMyCreatorPremiumPlanDraft,
  type CreatorPremiumCursor,
  type CreatorPremiumOwnerItem,
  type CreatorPremiumPlanItem,
} from '@/services/creatorPremiumService';

const PREMIUM = Colors.purple;
const PREMIUM_SOFT = Colors.purpleDim;

const contentStatus: Record<CreatorPremiumOwnerItem['lifecycle_status'], string> = {
  draft: 'Borrador',
  pending_review: 'En revisión',
  published: 'Publicado',
  quarantined: 'Restringido',
  removed: 'Retirado',
  deleted: 'Eliminado',
};

const planStatus: Record<CreatorPremiumPlanItem['status'], string> = {
  draft: 'Borrador',
  active: 'Activo',
  retired: 'Retirado',
};

const accessLabel: Record<CreatorPremiumOwnerItem['access_mode'], string> = {
  purchase: 'Compra',
  subscription: 'Suscripción',
  purchase_or_subscription: 'Compra o suscripción',
};

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return 'No pudimos completar la operación. Inténtalo de nuevo.';
}

function money(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return 'Sin precio';
  const [whole, fraction] = String(value).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${grouped}${fraction ? `,${fraction}` : ''} BDAG`;
}

function appendUnique<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const seen = new Set(current.map(item => item.id));
  return [...current, ...incoming.filter(item => !seen.has(item.id))];
}

function StatusChip({ label, tone = 'purple' }: { label: string; tone?: 'purple' | 'green' | 'amber' }) {
  const color = tone === 'green' ? Colors.success : tone === 'amber' ? Colors.warning : PREMIUM;
  return (
    <View style={[styles.chip, { backgroundColor: `${color}1F`, borderColor: `${color}66` }]}>
      <Text style={[styles.chipText, { color }]}>{label}</Text>
    </View>
  );
}

function EmptyState({ icon, title, copy }: { icon: 'image-multiple-outline' | 'playlist-star'; title: string; copy: string }) {
  return (
    <View style={styles.empty}>
      <MaterialCommunityIcons name={icon} size={42} color={Colors.textSubtle} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyCopy}>{copy}</Text>
    </View>
  );
}

export default function CreatorPremiumHub() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<'content' | 'plans'>('content');
  const [contents, setContents] = useState<CreatorPremiumOwnerItem[]>([]);
  const [plans, setPlans] = useState<CreatorPremiumPlanItem[]>([]);
  const [contentNextCursor, setContentNextCursor] = useState<CreatorPremiumCursor | null>(null);
  const [planNextCursor, setPlanNextCursor] = useState<CreatorPremiumCursor | null>(null);
  const [loadingMore, setLoadingMore] = useState<'content' | 'plans' | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [planModal, setPlanModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<CreatorPremiumPlanItem | null>(null);
  const [planName, setPlanName] = useState('');
  const [planDescription, setPlanDescription] = useState('');
  const [planPrice, setPlanPrice] = useState('');
  const [planDays, setPlanDays] = useState('30');
  const [selectedContentIds, setSelectedContentIds] = useState<string[]>([]);
  const [savingPlan, setSavingPlan] = useState(false);
  const planCreateAttempt = useRef<{ signature: string; key: string } | null>(null);
  const planCloneAttempts = useRef(new Map<string, string>());

  const subscriptionContents = useMemo(
    () => contents.filter(item => {
      const available = item.lifecycle_status !== 'deleted'
        && item.lifecycle_status !== 'removed'
        && item.lifecycle_status !== 'quarantined'
        && item.access_mode !== 'purchase';
      return available || selectedContentIds.includes(item.id);
    }),
    [contents, selectedContentIds],
  );
  const planGroups = useMemo(() => ([
    { status: 'draft' as const, label: 'Borradores', items: plans.filter(plan => plan.status === 'draft') },
    { status: 'active' as const, label: 'Activos', items: plans.filter(plan => plan.status === 'active') },
    { status: 'retired' as const, label: 'Retirados', items: plans.filter(plan => plan.status === 'retired') },
  ]), [plans]);

  const load = useCallback(async (refresh = false): Promise<boolean> => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [contentPage, planPage] = await Promise.all([
        fetchMyCreatorPremiumContents({ limit: 100 }),
        fetchMyCreatorPremiumPlans({ limit: 100 }),
      ]);
      setContents(contentPage.items);
      setPlans(planPage.items);
      setContentNextCursor(contentPage.nextCursor);
      setPlanNextCursor(planPage.nextCursor);
      return true;
    } catch (reason) {
      setError(errorMessage(reason));
      return false;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadMoreContents = useCallback(async () => {
    if (!contentNextCursor || loadingMore) return;
    setLoadingMore('content');
    try {
      const page = await fetchMyCreatorPremiumContents({ limit: 100, cursor: contentNextCursor });
      setContents(current => appendUnique(current, page.items));
      setContentNextCursor(page.nextCursor);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoadingMore(null);
    }
  }, [contentNextCursor, loadingMore]);

  const loadMorePlans = useCallback(async () => {
    if (!planNextCursor || loadingMore) return;
    setLoadingMore('plans');
    try {
      const page = await fetchMyCreatorPremiumPlans({ limit: 100, cursor: planNextCursor });
      setPlans(current => appendUnique(current, page.items));
      setPlanNextCursor(page.nextCursor);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoadingMore(null);
    }
  }, [loadingMore, planNextCursor]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const openPlan = useCallback((plan?: CreatorPremiumPlanItem) => {
    setEditingPlan(plan ?? null);
    setPlanName(plan?.name ?? '');
    setPlanDescription(plan?.description ?? '');
    setPlanPrice(plan ? String(plan.price_bdag) : '');
    setPlanDays(plan ? String(plan.billing_period_days) : '30');
    setSelectedContentIds(plan?.mapped_content_ids ?? []);
    setPlanModal(true);
  }, []);

  const closePlan = useCallback(() => {
    if (savingPlan) return;
    setPlanModal(false);
    setEditingPlan(null);
  }, [savingPlan]);

  const toggleContent = useCallback((contentId: string) => {
    setSelectedContentIds(current => current.includes(contentId)
      ? current.filter(id => id !== contentId)
      : [...current, contentId]);
  }, []);

  const savePlan = useCallback(async () => {
    let price: string;
    try {
      price = normalizeCreatorPremiumPriceBdag(planPrice);
    } catch {
      Alert.alert('Revisa el plan', 'Ingresa un precio BDAG positivo con hasta 8 decimales.');
      return;
    }
    const days = Number(planDays);
    if (!planName.trim() || !Number.isInteger(days) || days < 1 || days > 365) {
      Alert.alert('Revisa el plan', 'Completa el nombre, un precio válido y un período entre 1 y 365 días.');
      return;
    }
    setSavingPlan(true);
    try {
      const signature = JSON.stringify([
        planName.trim(), planDescription.trim(), price, days,
      ]);
      if (!editingPlan && planCreateAttempt.current?.signature !== signature) {
        planCreateAttempt.current = { signature, key: randomUUID() };
      }
      const saved = editingPlan
        ? await updateMyCreatorPremiumPlanDraft({
            planId: editingPlan.id,
            name: planName.trim(),
            description: planDescription.trim(),
            priceBdag: price,
            billingPeriodDays: days,
          })
        : await createMyCreatorPremiumPlanDraft({
            name: planName.trim(),
            description: planDescription.trim(),
            priceBdag: price,
            billingPeriodDays: days,
            clientRequestId: planCreateAttempt.current?.key ?? randomUUID(),
          });
      if (!saved?.id) throw new Error('creator_premium_plan_save_failed');
      await setMyCreatorPremiumPlanContents(saved.id, selectedContentIds);
      const refreshed = await load(true);
      if (!refreshed) throw new Error('creator_premium_plan_refresh_failed');
      if (!editingPlan) planCreateAttempt.current = null;
      setPlanModal(false);
      setEditingPlan(null);
    } catch (reason) {
      Alert.alert('No se guardó el plan', errorMessage(reason));
    } finally {
      setSavingPlan(false);
    }
  }, [editingPlan, load, planDays, planDescription, planName, planPrice, selectedContentIds]);

  const runPlanAction = useCallback(async (plan: CreatorPremiumPlanItem, action: 'activate' | 'clone' | 'retire') => {
    if (busyId) return;
    setBusyId(plan.id);
    try {
      if (action === 'activate') await activateMyCreatorPremiumPlan(plan.id);
      if (action === 'clone') {
        const clientRequestId = planCloneAttempts.current.get(plan.id) ?? randomUUID();
        planCloneAttempts.current.set(plan.id, clientRequestId);
        await cloneMyCreatorPremiumPlanVersion(plan.id, clientRequestId);
      }
      if (action === 'retire') await retireMyCreatorPremiumPlan(plan.id);
      const refreshed = await load(true);
      if (!refreshed) throw new Error('creator_premium_plan_refresh_failed');
      if (action === 'clone') planCloneAttempts.current.delete(plan.id);
    } catch (reason) {
      Alert.alert('No se actualizó el plan', errorMessage(reason));
    } finally {
      setBusyId(null);
    }
  }, [busyId, load]);

  const confirmPlanAction = useCallback((plan: CreatorPremiumPlanItem, action: 'activate' | 'retire') => {
    const activate = action === 'activate';
    Alert.alert(
      activate ? 'Activar plan' : 'Retirar plan',
      activate
        ? 'El plan quedará listo para uso futuro. Las suscripciones siguen deshabilitadas.'
        : 'El plan dejará de aceptar futuras suscripciones cuando finanzas se habiliten.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: activate ? 'Activar' : 'Retirar', style: activate ? 'default' : 'destructive', onPress: () => void runPlanAction(plan, action) },
      ],
    );
  }, [runPlanAction]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconButton}>
          <MaterialCommunityIcons name="arrow-left" size={23} color={Colors.textPrimary} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Contenido Premium</Text>
          <Text style={styles.subtitle}>Ventas y suscripciones aún no están habilitadas</Text>
        </View>
        <View style={styles.headerBadge}>
          <MaterialCommunityIcons name="shield-lock-outline" size={20} color={PREMIUM} />
        </View>
      </View>

      <View style={styles.tabs}>
        <Pressable onPress={() => setTab('content')} style={[styles.tab, tab === 'content' && styles.tabActive]}>
          <Text style={[styles.tabText, tab === 'content' && styles.tabTextActive]}>Contenido</Text>
        </Pressable>
        <Pressable onPress={() => setTab('plans')} style={[styles.tab, tab === 'plans' && styles.tabActive]}>
          <Text style={[styles.tabText, tab === 'plans' && styles.tabTextActive]}>Planes</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={PREMIUM} />
          <Text style={styles.loadingText}>Cargando tu espacio Premium…</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={PREMIUM} />}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.notice}>
            <MaterialCommunityIcons name="information-outline" size={20} color={Colors.info} />
            <Text style={styles.noticeText}>
              Puedes preparar borradores y enviarlos a revisión. Solo moderación podrá publicarlos.
            </Text>
          </View>

          {error ? (
            <Pressable style={styles.errorCard} onPress={() => void load()}>
              <Text style={styles.errorText}>{error}</Text>
              <Text style={styles.retryText}>Toca para reintentar</Text>
            </Pressable>
          ) : null}

          {tab === 'content' ? (
            <>
              <Pressable style={styles.primaryButton} onPress={() => router.push('/creator-premium-editor')}>
                <MaterialCommunityIcons name="plus" size={21} color={Colors.textOnBrand} />
                <Text style={styles.primaryButtonText}>Crear contenido Premium</Text>
              </Pressable>
              {contents.length === 0 ? (
                <EmptyState
                  icon="image-multiple-outline"
                  title="Aún no tienes contenido Premium"
                  copy="Crea un borrador con una vista previa pública y un original privado."
                />
              ) : contents.map(item => (
                <View key={item.id} style={styles.card}>
                  <View style={styles.contentRow}>
                    <View style={styles.teaser}>
                      {item.teaser_url ? (
                        <Image source={{ uri: item.teaser_url }} style={styles.teaserImage} />
                      ) : (
                        <MaterialCommunityIcons name="image-outline" size={28} color={Colors.textSubtle} />
                      )}
                    </View>
                    <View style={styles.cardBody}>
                      <View style={styles.cardHeading}>
                        <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
                        <StatusChip
                          label={contentStatus[item.lifecycle_status]}
                          tone={item.lifecycle_status === 'published' ? 'green' : item.lifecycle_status === 'pending_review' ? 'amber' : 'purple'}
                        />
                      </View>
                      <Text style={styles.meta}>
                        {item.content_kind === 'image' ? 'Imagen' : 'Video'} · {accessLabel[item.access_mode]}
                      </Text>
                      <Text style={styles.meta}>
                        {(item.content_kind === 'image' ? item.image_media_ready : item.video_media_ready)
                          ? 'Medios listos'
                          : 'Medios pendientes'}
                        {' · '}{item.mapped_plan_count} plan(es)
                      </Text>
                      {item.access_mode !== 'subscription' ? <Text style={styles.price}>{money(item.price_bdag)}</Text> : null}
                    </View>
                  </View>
                  {item.lifecycle_status === 'draft' ? (
                    <Pressable
                      style={styles.secondaryButton}
                      onPress={() => router.push({ pathname: '/creator-premium-editor', params: { contentId: item.id } })}
                    >
                      <MaterialCommunityIcons name="pencil-outline" size={18} color={PREMIUM} />
                      <Text style={styles.secondaryButtonText}>Editar borrador</Text>
                    </Pressable>
                  ) : (
                    <View style={styles.readOnlyRow}>
                      <MaterialCommunityIcons name="lock-outline" size={16} color={Colors.textSubtle} />
                      <Text style={styles.readOnlyText}>Solo lectura en esta etapa</Text>
                    </View>
                  )}
                </View>
              ))}
              {contentNextCursor ? (
                <Pressable style={styles.secondaryButton} onPress={() => void loadMoreContents()} disabled={loadingMore === 'content'}>
                  {loadingMore === 'content'
                    ? <ActivityIndicator color={PREMIUM} />
                    : <Text style={styles.secondaryButtonText}>Cargar más contenido</Text>}
                </Pressable>
              ) : null}
            </>
          ) : (
            <>
              <Pressable style={styles.primaryButton} onPress={() => openPlan()}>
                <MaterialCommunityIcons name="plus" size={21} color={Colors.textOnBrand} />
                <Text style={styles.primaryButtonText}>Crear plan</Text>
              </Pressable>
              {plans.length === 0 ? (
                <EmptyState
                  icon="playlist-star"
                  title="Aún no tienes planes"
                  copy="Prepara un plan por días y vincula contenido compatible con suscripción."
                />
              ) : planGroups.map(group => group.items.length ? (
                <View key={group.status} style={styles.planGroup}>
                  <Text style={styles.sectionTitle}>{group.label}</Text>
                  {group.items.map(plan => (
                    <View key={plan.id} style={styles.card}>
                      <View style={styles.cardHeading}>
                        <View style={styles.cardBody}>
                          <Text style={styles.cardTitle}>{plan.name}</Text>
                          <Text style={styles.meta}>Versión {plan.version} · Cada {plan.billing_period_days} días</Text>
                        </View>
                        <StatusChip label={planStatus[plan.status]} tone={plan.status === 'active' ? 'green' : 'purple'} />
                      </View>
                      {plan.description ? <Text style={styles.planDescription}>{plan.description}</Text> : null}
                      <View style={styles.planFacts}>
                        <Text style={styles.price}>{money(plan.price_bdag)}</Text>
                        <Text style={styles.meta}>{plan.mapped_content_count} contenido(s)</Text>
                      </View>
                      <View style={styles.actionRow}>
                        {plan.status === 'draft' ? (
                          <>
                            <Pressable style={styles.smallButton} onPress={() => openPlan(plan)} disabled={busyId === plan.id}>
                              <Text style={styles.smallButtonText}>Editar</Text>
                            </Pressable>
                            <Pressable style={styles.smallButton} onPress={() => confirmPlanAction(plan, 'activate')} disabled={busyId === plan.id}>
                              <Text style={styles.smallButtonText}>Activar</Text>
                            </Pressable>
                          </>
                        ) : (
                          <Pressable style={styles.smallButton} onPress={() => void runPlanAction(plan, 'clone')} disabled={busyId === plan.id}>
                            <Text style={styles.smallButtonText}>Nueva versión</Text>
                          </Pressable>
                        )}
                        {plan.status === 'active' ? (
                          <Pressable style={styles.dangerButton} onPress={() => confirmPlanAction(plan, 'retire')} disabled={busyId === plan.id}>
                            <Text style={styles.dangerButtonText}>Retirar</Text>
                          </Pressable>
                        ) : null}
                        {busyId === plan.id ? <ActivityIndicator size="small" color={PREMIUM} /> : null}
                      </View>
                    </View>
                  ))}
                </View>
              ) : null)}
              {planNextCursor ? (
                <Pressable style={styles.secondaryButton} onPress={() => void loadMorePlans()} disabled={loadingMore === 'plans'}>
                  {loadingMore === 'plans'
                    ? <ActivityIndicator color={PREMIUM} />
                    : <Text style={styles.secondaryButtonText}>Cargar más planes</Text>}
                </Pressable>
              ) : null}
            </>
          )}
        </ScrollView>
      )}

      <Modal visible={planModal} animationType="slide" transparent onRequestClose={closePlan}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.modalCard, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>{editingPlan ? 'Editar plan' : 'Nuevo plan'}</Text>
                <Text style={styles.modalSub}>Las suscripciones continúan deshabilitadas.</Text>
              </View>
              <Pressable onPress={closePlan} hitSlop={10} disabled={savingPlan}>
                <MaterialCommunityIcons name="close" size={24} color={Colors.textSecondary} />
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalContent}>
              <Text style={styles.label}>Nombre</Text>
              <TextInput value={planName} onChangeText={setPlanName} style={styles.input} maxLength={80} placeholder="Plan VIP" placeholderTextColor={Colors.textSubtle} editable={!savingPlan} />
              <Text style={styles.label}>Descripción</Text>
              <TextInput value={planDescription} onChangeText={setPlanDescription} style={[styles.input, styles.multiline]} multiline maxLength={1000} placeholder="Qué incluye este plan" placeholderTextColor={Colors.textSubtle} editable={!savingPlan} />
              <Text style={styles.label}>Precio futuro en BDAG</Text>
              <TextInput value={planPrice} onChangeText={setPlanPrice} style={styles.input} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={Colors.textSubtle} editable={!savingPlan} />
              <Text style={styles.label}>Período</Text>
              <TextInput value={planDays} onChangeText={setPlanDays} style={styles.input} keyboardType="number-pad" placeholder="30" placeholderTextColor={Colors.textSubtle} editable={!savingPlan} />
              <Text style={styles.helper}>Cada N días · mínimo 1, máximo 365.</Text>
              <Text style={[styles.label, { marginTop: Spacing.md }]}>Contenido incluido</Text>
              {subscriptionContents.length === 0 ? (
                <Text style={styles.helper}>Primero crea contenido con acceso por suscripción.</Text>
              ) : subscriptionContents.map(item => {
                const selected = selectedContentIds.includes(item.id);
                const mappingUnavailable = item.lifecycle_status === 'deleted'
                  || item.lifecycle_status === 'removed'
                  || item.lifecycle_status === 'quarantined'
                  || item.access_mode === 'purchase';
                return (
                  <Pressable key={item.id} style={[styles.mappingRow, selected && styles.mappingRowSelected]} onPress={() => toggleContent(item.id)} disabled={savingPlan}>
                    <MaterialCommunityIcons name={selected ? 'checkbox-marked' : 'checkbox-blank-outline'} size={22} color={selected ? PREMIUM : Colors.textSubtle} />
                    <View style={styles.cardBody}>
                      <Text style={styles.mappingTitle}>{item.title}</Text>
                      <Text style={[styles.meta, mappingUnavailable && { color: Colors.warning }]}>
                        {mappingUnavailable
                          ? 'No disponible; quítalo para guardar esta versión.'
                          : contentStatus[item.lifecycle_status]}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable style={[styles.primaryButton, savingPlan && styles.disabled]} onPress={() => void savePlan()} disabled={savingPlan}>
              {savingPlan ? <ActivityIndicator color={Colors.textOnBrand} /> : <Text style={styles.primaryButtonText}>Guardar plan</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, gap: Spacing.sm },
  headerCopy: { flex: 1 },
  iconButton: { width: 42, height: 42, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surface },
  headerBadge: { width: 42, height: 42, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: PREMIUM_SOFT },
  title: { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.bold },
  subtitle: { color: Colors.textSecondary, fontSize: FontSize.xs, marginTop: 2 },
  tabs: { marginHorizontal: Spacing.md, marginTop: Spacing.sm, padding: 4, flexDirection: 'row', backgroundColor: Colors.surface, borderRadius: Radius.lg },
  tab: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md },
  tabActive: { backgroundColor: PREMIUM_SOFT },
  tabText: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  tabTextActive: { color: PREMIUM },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  loadingText: { color: Colors.textSecondary, fontSize: FontSize.sm },
  content: { padding: Spacing.md, gap: Spacing.md },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.blueDim, borderWidth: 1, borderColor: `${Colors.info}55` },
  noticeText: { flex: 1, color: Colors.textSecondary, fontSize: FontSize.sm, lineHeight: 20 },
  errorCard: { padding: Spacing.md, borderRadius: Radius.md, borderWidth: 1, borderColor: `${Colors.error}66`, backgroundColor: `${Colors.error}12` },
  errorText: { color: Colors.error, fontSize: FontSize.sm },
  retryText: { color: Colors.textSecondary, fontSize: FontSize.xs, marginTop: 4 },
  primaryButton: { minHeight: 48, borderRadius: Radius.md, backgroundColor: PREMIUM, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.md },
  primaryButtonText: { color: Colors.textOnBrand, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  card: { padding: Spacing.md, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, gap: Spacing.md },
  contentRow: { flexDirection: 'row', gap: Spacing.md },
  teaser: { width: 82, height: 82, borderRadius: Radius.md, overflow: 'hidden', backgroundColor: Colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
  teaserImage: { width: '100%', height: '100%' },
  cardBody: { flex: 1, minWidth: 0 },
  cardHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  cardTitle: { flex: 1, color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  meta: { color: Colors.textSecondary, fontSize: FontSize.xs, marginTop: 4 },
  price: { color: PREMIUM, fontSize: FontSize.sm, fontWeight: FontWeight.bold, marginTop: 5 },
  chip: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: Radius.full, borderWidth: 1 },
  chipText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  secondaryButton: { minHeight: 42, borderRadius: Radius.md, borderWidth: 1, borderColor: `${PREMIUM}66`, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  secondaryButtonText: { color: PREMIUM, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  readOnlyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  readOnlyText: { color: Colors.textSubtle, fontSize: FontSize.xs },
  empty: { alignItems: 'center', paddingVertical: Spacing.xxl, paddingHorizontal: Spacing.lg },
  emptyTitle: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.semibold, marginTop: Spacing.md, textAlign: 'center' },
  emptyCopy: { color: Colors.textSecondary, fontSize: FontSize.sm, lineHeight: 20, textAlign: 'center', marginTop: Spacing.sm },
  planDescription: { color: Colors.textSecondary, fontSize: FontSize.sm, lineHeight: 20 },
  planGroup: { gap: Spacing.sm },
  sectionTitle: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold, marginTop: Spacing.sm },
  planFacts: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.sm },
  smallButton: { minHeight: 40, paddingHorizontal: Spacing.md, borderRadius: Radius.md, borderWidth: 1, borderColor: `${PREMIUM}66`, alignItems: 'center', justifyContent: 'center' },
  smallButtonText: { color: PREMIUM, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  dangerButton: { minHeight: 40, paddingHorizontal: Spacing.md, borderRadius: Radius.md, borderWidth: 1, borderColor: `${Colors.error}66`, alignItems: 'center', justifyContent: 'center' },
  dangerButtonText: { color: Colors.error, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: Colors.overlay },
  modalCard: { maxHeight: '92%', backgroundColor: Colors.surfaceElevated, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.md, gap: Spacing.md },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.bold },
  modalSub: { color: Colors.textSecondary, fontSize: FontSize.xs, marginTop: 2 },
  modalContent: { gap: Spacing.sm, paddingBottom: Spacing.md },
  label: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  input: { minHeight: 46, paddingHorizontal: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, color: Colors.textPrimary, fontSize: FontSize.md },
  multiline: { minHeight: 88, paddingTop: 12, textAlignVertical: 'top' },
  helper: { color: Colors.textSubtle, fontSize: FontSize.xs, lineHeight: 17 },
  mappingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 54, padding: Spacing.sm, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  mappingRowSelected: { borderColor: `${PREMIUM}88`, backgroundColor: PREMIUM_SOFT },
  mappingTitle: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  disabled: { opacity: 0.55 },
});
