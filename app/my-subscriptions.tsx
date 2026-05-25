/**
 * app/my-subscriptions.tsx
 *
 * Subscription management for subscribers:
 * • Active subscriptions with expiry, benefits, free DM quota
 * • Cancel subscription flow
 * • Browse and subscribe to new creator plans
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { getSupabaseClient } from '@/template';
import { useAlert } from '@/template';
import { subscribeToPlan, fetchSubscriptionPlans } from '@/services/economyService';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';

const SUB_COLOR  = '#A855F7';
const SUB_COLOR2 = '#7C5CFF';

interface ActiveSub {
  id: string;
  plan_id: string;
  creator_id: string;
  amount_bdag: number;
  status: string;
  expires_at: string;
  free_dms_used: number;
  free_dms_quota: number;
  quota_reset_at: string;
  plan: {
    name: string;
    price_bdag: number;
    billing_cycle: string;
    perks: string[];
    creator: { username: string; avatar_url: string | null; display_name: string | null };
  };
}

interface AvailablePlan {
  id: string;
  creator_id: string;
  name: string;
  description: string;
  perks: string[];
  price_bdag: number;
  billing_cycle: string;
  subscribers_count: number;
  creator?: { username: string; avatar_url: string | null };
}

function daysLeft(dateStr: string): number {
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86_400_000));
}

function fmt(n: number, d = 0): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

// ── Active subscription card ──────────────────────────────────────────────────
function ActiveSubCard({ sub, onCancel, onChat }: {
  sub: ActiveSub;
  onCancel: () => void;
  onChat: () => void;
}) {
  const days = daysLeft(sub.expires_at);
  const dmFree = Math.max(0, (sub.free_dms_quota ?? 10) - (sub.free_dms_used ?? 0));
  const dmUsed = sub.free_dms_used ?? 0;
  const dmQuota = sub.free_dms_quota ?? 10;
  const resetDate = new Date(sub.quota_reset_at ?? Date.now()).toLocaleDateString();

  return (
    <View style={ac.card}>
      <LinearGradient colors={['rgba(168,85,247,0.18)', 'rgba(124,92,255,0.08)']} style={ac.inner}>
        {/* Creator row */}
        <View style={ac.creatorRow}>
          {sub.plan.creator?.avatar_url ? (
            <Image source={{ uri: sub.plan.creator.avatar_url }} style={ac.avatar} contentFit="cover" />
          ) : (
            <View style={[ac.avatar, ac.avatarPlaceholder]}>
              <Text style={ac.avatarInitial}>
                {(sub.plan.creator?.username ?? '?')[0].toUpperCase()}
              </Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={ac.planName}>{sub.plan.name}</Text>
            <Text style={ac.creatorName}>@{sub.plan.creator?.username}</Text>
          </View>
          <View style={ac.activeBadge}>
            <View style={ac.activeDot} />
            <Text style={ac.activeBadgeText}>ACTIVA</Text>
          </View>
        </View>

        {/* Stats row */}
        <View style={ac.statsRow}>
          <View style={ac.stat}>
            <Text style={ac.statVal}>{days}</Text>
            <Text style={ac.statLabel}>días restantes</Text>
          </View>
          <View style={ac.statDivider} />
          <View style={ac.stat}>
            <Text style={[ac.statVal, { color: SUB_COLOR }]}>{fmt(sub.plan.price_bdag)}</Text>
            <Text style={ac.statLabel}>BDAG/mes</Text>
          </View>
          <View style={ac.statDivider} />
          <View style={ac.stat}>
            <Text style={[ac.statVal, { color: Colors.accent }]}>{dmFree}</Text>
            <Text style={ac.statLabel}>DMs gratis left</Text>
          </View>
        </View>

        {/* Free DM progress bar */}
        <View style={ac.dmBar}>
          <View style={ac.dmBarHeader}>
            <MaterialIcons name="mark-email-read" size={12} color={SUB_COLOR} />
            <Text style={ac.dmBarLabel}>DMs Premium gratis este mes</Text>
            <Text style={ac.dmBarCount}>{dmUsed}/{dmQuota}</Text>
          </View>
          <View style={ac.dmBarTrack}>
            <LinearGradient
              colors={[SUB_COLOR, SUB_COLOR2]}
              style={[ac.dmBarFill, { width: `${Math.min(100, (dmUsed / dmQuota) * 100)}%` as any }]}
            />
          </View>
          <Text style={ac.dmBarReset}>Cuota se renueva: {resetDate}</Text>
        </View>

        {/* Benefits */}
        {sub.plan.perks?.length > 0 ? (
          <View style={ac.perks}>
            {sub.plan.perks.slice(0, 4).map(perk => (
              <View key={perk} style={ac.perkRow}>
                <MaterialIcons name="check-circle" size={11} color={SUB_COLOR} />
                <Text style={ac.perkText} numberOfLines={1}>{perk}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Actions */}
        <View style={ac.actions}>
          <Pressable style={ac.chatBtn} onPress={onChat}>
            <LinearGradient colors={[SUB_COLOR, SUB_COLOR2]} style={ac.chatBtnGrad}>
              <MaterialCommunityIcons name="message-text" size={14} color="#fff" />
              <Text style={ac.chatBtnText}>Chat con creador</Text>
            </LinearGradient>
          </Pressable>
          <Pressable style={ac.cancelBtn} onPress={onCancel}>
            <Text style={ac.cancelBtnText}>Cancelar</Text>
          </Pressable>
        </View>
      </LinearGradient>
    </View>
  );
}

const ac = StyleSheet.create({
  card:            { borderRadius: Radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(168,85,247,0.3)' },
  inner:           { padding: Spacing.md, gap: Spacing.md },
  creatorRow:      { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar:          { width: 48, height: 48, borderRadius: 24 },
  avatarPlaceholder: { backgroundColor: 'rgba(168,85,247,0.2)', alignItems: 'center', justifyContent: 'center' },
  avatarInitial:   { color: SUB_COLOR, fontSize: 18, fontWeight: FontWeight.bold },
  planName:        { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  creatorName:     { color: Colors.textSubtle, fontSize: FontSize.xs, marginTop: 1 },
  activeBadge:     { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(0,229,160,0.12)', borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(0,229,160,0.3)' },
  activeDot:       { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.accent },
  activeBadgeText: { color: Colors.accent, fontSize: 9, fontWeight: FontWeight.bold },
  statsRow:        { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: Radius.md, padding: 12 },
  stat:            { flex: 1, alignItems: 'center', gap: 2 },
  statVal:         { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  statLabel:       { color: Colors.textSubtle, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.3 },
  statDivider:     { width: 1, height: 30, backgroundColor: Colors.border },
  dmBar:           { gap: 6 },
  dmBarHeader:     { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dmBarLabel:      { color: Colors.textSecondary, fontSize: FontSize.xs, flex: 1 },
  dmBarCount:      { color: SUB_COLOR, fontSize: FontSize.xs, fontWeight: FontWeight.bold },
  dmBarTrack:      { height: 5, backgroundColor: Colors.border, borderRadius: 3, overflow: 'hidden' },
  dmBarFill:       { height: '100%', borderRadius: 3 },
  dmBarReset:      { color: Colors.textSubtle, fontSize: 10 },
  perks:           { gap: 4 },
  perkRow:         { flexDirection: 'row', alignItems: 'center', gap: 6 },
  perkText:        { color: Colors.textSubtle, fontSize: FontSize.xs, flex: 1 },
  actions:         { flexDirection: 'row', gap: 10, marginTop: 2 },
  chatBtn:         { flex: 1, borderRadius: Radius.md, overflow: 'hidden' },
  chatBtnGrad:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11 },
  chatBtnText:     { color: '#fff', fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  cancelBtn:       { paddingHorizontal: 14, paddingVertical: 11, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },
  cancelBtnText:   { color: Colors.textSubtle, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
});

// ── Available plan card ───────────────────────────────────────────────────────
function PlanCard({ plan, isSubscribed, onSubscribe }: {
  plan: AvailablePlan;
  isSubscribed: boolean;
  onSubscribe: () => void;
}) {
  return (
    <View style={pl.card}>
      <View style={pl.header}>
        {plan.creator?.avatar_url ? (
          <Image source={{ uri: plan.creator.avatar_url }} style={pl.avatar} contentFit="cover" />
        ) : (
          <View style={[pl.avatar, { backgroundColor: 'rgba(168,85,247,0.2)', alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={{ color: SUB_COLOR, fontWeight: FontWeight.bold }}>
              {(plan.creator?.username ?? '?')[0].toUpperCase()}
            </Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={pl.name}>{plan.name}</Text>
          <Text style={pl.creator}>@{plan.creator?.username}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={pl.price}>{fmt(plan.price_bdag)}</Text>
          <Text style={pl.cycle}>BDAG/mes</Text>
        </View>
      </View>
      {plan.description ? (
        <Text style={pl.desc} numberOfLines={2}>{plan.description}</Text>
      ) : null}
      <View style={pl.perks}>
        {['Todo el contenido exclusivo', `10 DMs gratis/mes`, 'Insignia VIP'].concat(plan.perks?.slice(0, 2) ?? []).map(p => (
          <View key={p} style={pl.perkRow}>
            <MaterialIcons name="check" size={11} color={SUB_COLOR} />
            <Text style={pl.perkText} numberOfLines={1}>{p}</Text>
          </View>
        ))}
      </View>
      <View style={pl.footer}>
        <Text style={pl.subs}>{plan.subscribers_count} suscriptores</Text>
        <Pressable
          style={[pl.subBtn, isSubscribed && pl.subBtnActive]}
          onPress={onSubscribe}
          disabled={isSubscribed}
        >
          {isSubscribed ? (
            <>
              <MaterialIcons name="check" size={14} color={SUB_COLOR} />
              <Text style={[pl.subBtnText, { color: SUB_COLOR }]}>Suscrito</Text>
            </>
          ) : (
            <LinearGradient colors={[SUB_COLOR, SUB_COLOR2]} style={pl.subBtnGrad}>
              <MaterialIcons name="star" size={14} color="#fff" />
              <Text style={pl.subBtnText}>Suscribirse</Text>
            </LinearGradient>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const pl = StyleSheet.create({
  card:    { backgroundColor: Colors.surfaceElevated, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.border },
  header:  { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar:  { width: 44, height: 44, borderRadius: 22 },
  name:    { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  creator: { color: Colors.textSubtle, fontSize: FontSize.xs },
  price:   { color: SUB_COLOR, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  cycle:   { color: Colors.textSubtle, fontSize: 9 },
  desc:    { color: Colors.textSecondary, fontSize: FontSize.xs, lineHeight: 17 },
  perks:   { gap: 4 },
  perkRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  perkText:{ color: Colors.textSubtle, fontSize: FontSize.xs, flex: 1 },
  footer:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  subs:    { color: Colors.textSubtle, fontSize: FontSize.xs },
  subBtn:  { borderRadius: Radius.md, overflow: 'hidden' },
  subBtnActive: { backgroundColor: 'rgba(168,85,247,0.12)', borderWidth: 1, borderColor: 'rgba(168,85,247,0.3)', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.md },
  subBtnGrad: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 9 },
  subBtnText: { color: '#fff', fontSize: FontSize.xs, fontWeight: FontWeight.bold },
});

// ── Main screen ───────────────────────────────────────────────────────────────
export default function MySubscriptionsScreen() {
  const insets = useSafeAreaInsets();
  const router  = useRouter();
  const { user } = useAuth();
  const walletData = useWallet();
  const balance = walletData?.balance ?? 0;
  const { showAlert } = useAlert();
  const supabase = getSupabaseClient();

  const [activeSubs,  setActiveSubs]  = useState<ActiveSub[]>([]);
  const [available,   setAvailable]   = useState<AvailablePlan[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [activeTab,   setActiveTab]   = useState<'mine' | 'discover'>('mine');
  const [subscribing, setSubscribing] = useState<string | null>(null);

  const subscribedPlanIds = new Set(activeSubs.map(s => s.plan_id));

  const loadData = useCallback(async () => {
    if (!user?.id) return;
    const [mySubsRes, plansRes] = await Promise.all([
      supabase
        .from('creator_subscriptions')
        .select(`
          *,
          plan:subscription_plans(
            name, price_bdag, billing_cycle, perks,
            creator:user_profiles!creator_id(username, avatar_url, display_name)
          )
        `)
        .eq('subscriber_id', user.id)
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString())
        .order('started_at', { ascending: false }),
      fetchSubscriptionPlans({ limit: 30 }),
    ]);
    setActiveSubs((mySubsRes.data as ActiveSub[]) ?? []);
    setAvailable(plansRes as AvailablePlan[]);
    setLoading(false);
  }, [user?.id, supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const handleCancelSub = useCallback((sub: ActiveSub) => {
    showAlert(
      'Cancelar suscripción',
      `¿Cancelar "${sub.plan.name}"? Mantendrás acceso hasta ${new Date(sub.expires_at).toLocaleDateString()}.`,
      [
        { text: 'Mantener', style: 'cancel' },
        {
          text: 'Cancelar suscripción', style: 'destructive',
          onPress: async () => {
            const { data } = await supabase.rpc('cancel_creator_subscription', {
              p_subscriber_id: user?.id,
              p_sub_id: sub.id,
            });
            if (data?.success) {
              loadData();
              showAlert('Cancelada', 'Tu suscripción fue cancelada. El acceso se mantiene hasta la fecha de expiración.');
            } else {
              showAlert('Error', data?.error ?? 'No se pudo cancelar');
            }
          },
        },
      ]
    );
  }, [user?.id, supabase, loadData, showAlert]);

  const handleSubscribe = useCallback(async (plan: AvailablePlan) => {
    if (balance < plan.price_bdag) {
      showAlert('Saldo insuficiente', `Necesitas ${fmt(plan.price_bdag)} BDAG. Tienes ${fmt(balance)} BDAG.`);
      return;
    }
    showAlert(
      `Suscribirse a "${plan.name}"`,
      `@${plan.creator?.username} · ${fmt(plan.price_bdag)} BDAG/mes\n\nBeneficios incluidos:\n• Todo el contenido exclusivo\n• 10 DMs Premium gratis/mes\n• Insignia VIP`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: `Suscribirse · ${fmt(plan.price_bdag)} BDAG`,
          onPress: async () => {
            setSubscribing(plan.id);
            const result = await subscribeToPlan(plan.id);
            setSubscribing(null);
            if (!result.success) { showAlert('Error', result.error ?? 'No se pudo suscribir'); return; }
            walletData?.fullSync?.();
            loadData();
            showAlert(
              '¡Bienvenido al club!',
              `Suscrito a "${plan.name}" · Activo hasta ${new Date(result.expires_at ?? '').toLocaleDateString()}`
            );
          },
        },
      ]
    );
  }, [balance, walletData, loadData, showAlert]);

  const TABS = [
    { key: 'mine' as const,     label: 'Mis suscripciones',   icon: 'star' },
    { key: 'discover' as const, label: 'Descubrir creadores', icon: 'compass' },
  ];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={Colors.textPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Suscripciones</Text>
          <Text style={styles.headerSub}>{activeSubs.length} activas · {fmt(balance, 0)} BDAG</Text>
        </View>
        <Pressable onPress={() => router.push('/(tabs)/wallet')} style={styles.walletBtn}>
          <MaterialCommunityIcons name="wallet-outline" size={18} color={Colors.primary} />
        </Pressable>
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {TABS.map(t => (
          <Pressable
            key={t.key}
            style={[styles.tabBtn, activeTab === t.key && styles.tabBtnActive]}
            onPress={() => setActiveTab(t.key)}
          >
            <MaterialIcons name={t.icon as any} size={14}
              color={activeTab === t.key ? SUB_COLOR : Colors.textSubtle} />
            <Text style={[styles.tabText, activeTab === t.key && { color: SUB_COLOR }]}>{t.label}</Text>
            {t.key === 'mine' && activeSubs.length > 0 ? (
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{activeSubs.length}</Text>
              </View>
            ) : null}
          </Pressable>
        ))}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: 60 + insets.bottom }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={SUB_COLOR} />}
      >
        {loading ? (
          <View style={styles.centered}><ActivityIndicator color={SUB_COLOR} size="large" /></View>

        ) : activeTab === 'mine' ? (
          activeSubs.length === 0 ? (
            <View style={styles.empty}>
              <MaterialCommunityIcons name="star-outline" size={60} color={Colors.border} />
              <Text style={styles.emptyTitle}>Sin suscripciones activas</Text>
              <Text style={styles.emptySub}>Suscríbete a un creador para acceder a contenido exclusivo, DMs gratis y más</Text>
              <Pressable style={styles.discoverBtn} onPress={() => setActiveTab('discover')}>
                <LinearGradient colors={[SUB_COLOR, SUB_COLOR2]} style={styles.discoverBtnGrad}>
                  <MaterialIcons name="compass" size={16} color="#fff" />
                  <Text style={styles.discoverBtnText}>Descubrir creadores</Text>
                </LinearGradient>
              </Pressable>
            </View>
          ) : (
            <View style={{ gap: Spacing.md }}>
              {activeSubs.map(sub => (
                <ActiveSubCard
                  key={sub.id}
                  sub={sub}
                  onCancel={() => handleCancelSub(sub)}
                  onChat={() => router.push(`/chat/${sub.creator_id}`)}
                />
              ))}

              {/* Total monthly spend */}
              <LinearGradient colors={['rgba(168,85,247,0.12)', 'rgba(124,92,255,0.06)']} style={styles.totalCard}>
                <View style={styles.totalRow}>
                  <MaterialCommunityIcons name="hexagon-multiple" size={16} color={SUB_COLOR} />
                  <Text style={styles.totalLabel}>Gasto mensual total</Text>
                  <Text style={styles.totalVal}>
                    {fmt(activeSubs.reduce((s, sub) => s + Number(sub.amount_bdag), 0))} BDAG
                  </Text>
                </View>
              </LinearGradient>
            </View>
          )

        ) : (
          // Discover tab
          available.filter(p => !subscribedPlanIds.has(p.id) && p.creator_id !== user?.id).length === 0 ? (
            <View style={styles.empty}>
              <MaterialCommunityIcons name="star-outline" size={60} color={Colors.border} />
              <Text style={styles.emptyTitle}>No hay planes disponibles</Text>
              <Text style={styles.emptySub}>Los creadores deben configurar sus planes de suscripción</Text>
            </View>
          ) : (
            <View style={{ gap: Spacing.md }}>
              {available
                .filter(p => !subscribedPlanIds.has(p.id) && p.creator_id !== user?.id)
                .map(plan => (
                  <PlanCard
                    key={plan.id}
                    plan={plan}
                    isSubscribed={false}
                    onSubscribe={() => handleSubscribe(plan)}
                  />
                ))}
            </View>
          )
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: Colors.bg },
  scroll: { padding: Spacing.md, gap: Spacing.md },
  centered: { paddingVertical: 60, alignItems: 'center' },

  header:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.md, paddingBottom: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border },
  backBtn:     { padding: 4 },
  headerTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  headerSub:   { fontSize: FontSize.xs, color: Colors.textSubtle, marginTop: 1 },
  walletBtn:   { width: 38, height: 38, borderRadius: Radius.md, backgroundColor: Colors.primaryDim, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.primary + '33' },

  tabBar:    { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: Colors.border },
  tabBtn:    { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabBtnActive: { borderBottomColor: SUB_COLOR },
  tabText:   { color: Colors.textSubtle, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  countBadge:{ backgroundColor: SUB_COLOR, borderRadius: Radius.full, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  countBadgeText: { color: '#fff', fontSize: 9, fontWeight: FontWeight.bold },

  empty:        { alignItems: 'center', paddingVertical: 60, gap: Spacing.md, paddingHorizontal: Spacing.xl },
  emptyTitle:   { color: Colors.textSecondary, fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  emptySub:     { color: Colors.textSubtle, fontSize: FontSize.sm, textAlign: 'center', lineHeight: 20 },
  discoverBtn:  { borderRadius: Radius.md, overflow: 'hidden', marginTop: Spacing.sm },
  discoverBtnGrad: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 12 },
  discoverBtnText: { color: '#fff', fontSize: FontSize.sm, fontWeight: FontWeight.bold },

  totalCard:   { borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: 'rgba(168,85,247,0.2)' },
  totalRow:    { flexDirection: 'row', alignItems: 'center', gap: 10 },
  totalLabel:  { color: Colors.textSecondary, fontSize: FontSize.sm, flex: 1 },
  totalVal:    { color: SUB_COLOR, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
});
