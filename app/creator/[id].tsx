/**
 * app/creator/[id].tsx
 *
 * Public creator profile page — the central creator monetization hub.
 *
 * Features:
 *  • Creator header: avatar, stats, bio, verified badge
 *  • Follow / Unfollow
 *  • Subscribe button with plan selection sheet
 *  • Premium DM button (if enabled by creator)
 *  • Boost/Sponsor Profile (spend BDAG to amplify creator's reach)
 *  • Content tabs: Videos · Exclusive · Products
 *  • Exclusive content grid with lock/unlock
 *  • Subscriber badge + perks when subscribed
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet,
  ActivityIndicator, Modal, FlatList, Dimensions,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { useAlert } from '@/template';
import {
  fetchCreatorProfile, fetchCreatorVideos, fetchCreatorExclusiveContent,
  fetchCreatorStats, checkIsFollowing, followCreator, unfollowCreator,
  type CreatorProfile, type CreatorStats,
} from '@/services/creatorService';
import {
  fetchSubscriptionPlans as fetchCreatorSubscriptionPlans, checkSubscription, subscribeToPlan,
  type SubscriptionPlan,
} from '@/services/subscriptionService';
import { getPremiumDMConfig, type PremiumDMConfig } from '@/services/premiumDmService';
import {
  boostCreatorProfile, PROFILE_BOOST_TIERS, isProfileBoosted, type BoostTier,
} from '@/services/boostService';
import { fetchPurchasedContentIds, purchaseContent } from '@/services/economyService';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';

const { width: W } = Dimensions.get('window');
const THUMB = (W - Spacing.md * 2 - 4) / 3;

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n: number, d = 0) {
  return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtShort(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}
function daysLeft(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

type ProfileTab = 'videos' | 'exclusive' | 'products';

// ── Subscribe Sheet ────────────────────────────────────────────────────────────
function SubscribeSheet({
  visible, plans, balance, isSubscribed,
  currentPlanName, freeDmsLeft,
  onClose, onSubscribe,
}: {
  visible: boolean;
  plans: SubscriptionPlan[];
  balance: number;
  isSubscribed: boolean;
  currentPlanName: string;
  freeDmsLeft: number;
  onClose: () => void;
  onSubscribe: (plan: SubscriptionPlan) => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const insets = useSafeAreaInsets();

  const handleSub = async (plan: SubscriptionPlan) => {
    setLoading(true);
    await onSubscribe(plan);
    setLoading(false);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide"
      presentationStyle="overFullScreen" onRequestClose={onClose}>
      <Pressable style={ss.backdrop} onPress={onClose} />
      <View style={[ss.sheet, { paddingBottom: insets.bottom + 24 }]}>
        <View style={ss.handle} />

        {isSubscribed ? (
          // Already subscribed — show status
          <>
            <LinearGradient colors={['#A855F7', '#7C5CFF']} style={ss.subActiveHeader}>
              <MaterialIcons name="star" size={24} color="#fff" />
              <Text style={ss.subActiveTitle}>Suscrito — {currentPlanName}</Text>
            </LinearGradient>
            <View style={ss.benefitsList}>
              {[
                'Acceso a todo el contenido exclusivo',
                `${freeDmsLeft} DMs Premium gratis este mes`,
                'Insignia de suscriptor VIP',
                'Acceso al club privado del creador',
              ].map(b => (
                <View key={b} style={ss.benefitRow}>
                  <MaterialIcons name="check-circle" size={14} color="#A855F7" />
                  <Text style={ss.benefitText}>{b}</Text>
                </View>
              ))}
            </View>
            <Pressable style={ss.closeBtn} onPress={onClose}>
              <Text style={ss.closeBtnText}>Cerrar</Text>
            </Pressable>
          </>
        ) : plans.length === 0 ? (
          <>
            <Text style={ss.noPlansTitle}>Sin planes disponibles</Text>
            <Text style={ss.noPlansText}>Este creador aún no configuró planes de suscripción.</Text>
            <Pressable style={ss.closeBtn} onPress={onClose}>
              <Text style={ss.closeBtnText}>Cerrar</Text>
            </Pressable>
          </>
        ) : (
          <>
            <View style={ss.header}>
              <LinearGradient colors={['#A855F7', '#7C5CFF']} style={ss.headerIcon}>
                <MaterialIcons name="star" size={18} color="#fff" />
              </LinearGradient>
              <View style={{ flex: 1 }}>
                <Text style={ss.title}>Suscribirte al creador</Text>
                <Text style={ss.subtitle}>Elige un plan y accede a todos los beneficios VIP</Text>
              </View>
            </View>

            {/* Auto-benefits */}
            <View style={ss.autoBenefits}>
              {['Todo el contenido exclusivo sin pago individual',
                '10 DMs Premium gratis por mes',
                'Insignia de suscriptor VIP + club privado'].map(b => (
                <View key={b} style={ss.benefitRow}>
                  <MaterialIcons name="check-circle" size={12} color="#A855F7" />
                  <Text style={[ss.benefitText, { fontSize: 11 }]}>{b}</Text>
                </View>
              ))}
            </View>

            {/* Plans */}
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 280 }}>
              {plans.map(plan => {
                const canAfford = balance >= plan.price_bdag;
                return (
                  <Pressable key={plan.id} style={ss.planCard}
                    onPress={() => canAfford ? handleSub(plan) : null}
                  >
                    <LinearGradient colors={['rgba(168,85,247,0.15)', 'rgba(124,92,255,0.07)']} style={ss.planCardInner}>
                      <View style={ss.planHeader}>
                        <LinearGradient colors={['#A855F7', '#7C5CFF']} style={ss.planIcon}>
                          <MaterialIcons name="star" size={14} color="#fff" />
                        </LinearGradient>
                        <View style={{ flex: 1 }}>
                          <Text style={ss.planName}>{plan.name}</Text>
                          {plan.description ? (
                            <Text style={ss.planDesc} numberOfLines={1}>{plan.description}</Text>
                          ) : null}
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={ss.planPrice}>{fmt(plan.price_bdag)} BDAG</Text>
                          <Text style={ss.planCycle}>/{plan.billing_cycle === 'monthly' ? 'mes' : plan.billing_cycle}</Text>
                        </View>
                      </View>
                      {plan.perks?.slice(0, 3).map(perk => (
                        <View key={perk} style={ss.perkRow}>
                          <MaterialIcons name="check" size={10} color="#A855F7" />
                          <Text style={ss.perkText} numberOfLines={1}>{perk}</Text>
                        </View>
                      ))}
                      <Pressable
                        style={[ss.subBtn, !canAfford && { opacity: 0.4 }]}
                        onPress={() => canAfford && handleSub(plan)}
                        disabled={loading}
                      >
                        <LinearGradient colors={['#A855F7', '#7C5CFF']} style={ss.subBtnGrad}>
                          {loading
                            ? <ActivityIndicator color="#fff" size="small" />
                            : <MaterialIcons name="star" size={14} color="#fff" />}
                          <Text style={ss.subBtnText}>
                            {loading ? 'Procesando...' : canAfford ? `Suscribirse · ${fmt(plan.price_bdag)} BDAG` : 'Saldo insuficiente'}
                          </Text>
                        </LinearGradient>
                      </Pressable>
                    </LinearGradient>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={ss.balRow}>
              <MaterialCommunityIcons name="hexagon-multiple" size={13} color={Colors.textSubtle} />
              <Text style={ss.balText}>Tu saldo: {fmt(balance)} BDAG</Text>
            </View>
            <Pressable style={ss.closeBtn} onPress={onClose}>
              <Text style={ss.closeBtnText}>Cancelar</Text>
            </Pressable>
          </>
        )}
      </View>
    </Modal>
  );
}

const ss = StyleSheet.create({
  backdrop:        { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)' },
  sheet:           { backgroundColor: Colors.surfaceElevated, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.lg, gap: Spacing.md, borderTopWidth: 1, borderColor: Colors.border },
  handle:          { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 4 },
  header:          { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerIcon:      { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  title:           { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  subtitle:        { color: Colors.textSubtle, fontSize: FontSize.xs, marginTop: 1 },
  autoBenefits:    { backgroundColor: 'rgba(168,85,247,0.08)', borderRadius: Radius.md, padding: 10, gap: 5, borderWidth: 1, borderColor: 'rgba(168,85,247,0.2)' },
  benefitRow:      { flexDirection: 'row', alignItems: 'center', gap: 7 },
  benefitText:     { color: Colors.textSecondary, fontSize: FontSize.xs, flex: 1 },
  planCard:        { borderRadius: Radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(168,85,247,0.3)', marginBottom: 10 },
  planCardInner:   { padding: Spacing.md, gap: 6 },
  planHeader:      { flexDirection: 'row', alignItems: 'center', gap: 10 },
  planIcon:        { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  planName:        { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  planDesc:        { color: Colors.textSubtle, fontSize: FontSize.xs },
  planPrice:       { color: '#A855F7', fontSize: FontSize.md, fontWeight: FontWeight.bold },
  planCycle:       { color: Colors.textSubtle, fontSize: 10 },
  perkRow:         { flexDirection: 'row', alignItems: 'center', gap: 5 },
  perkText:        { color: Colors.textSubtle, fontSize: 11, flex: 1 },
  subBtn:          { borderRadius: Radius.md, overflow: 'hidden', marginTop: 4 },
  subBtnGrad:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 11 },
  subBtnText:      { color: '#fff', fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  balRow:          { flexDirection: 'row', alignItems: 'center', gap: 5, justifyContent: 'center' },
  balText:         { color: Colors.textSubtle, fontSize: FontSize.xs },
  closeBtn:        { alignItems: 'center', paddingVertical: 12, backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border },
  closeBtnText:    { color: Colors.textSubtle, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  subActiveHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: Radius.lg, padding: 14 },
  subActiveTitle:  { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
  benefitsList:    { gap: 8 },
  noPlansTitle:    { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold, textAlign: 'center' },
  noPlansText:     { color: Colors.textSubtle, fontSize: FontSize.sm, textAlign: 'center' },
});

// ── Boost Profile Sheet ───────────────────────────────────────────────────────
function BoostProfileSheet({
  visible, creatorName, balance,
  onClose, onBoost,
}: {
  visible: boolean; creatorName: string; balance: number;
  onClose: () => void;
  onBoost: (tier: BoostTier) => Promise<void>;
}) {
  const [selected, setSelected] = useState(0);
  const [loading,  setLoading]  = useState(false);
  const insets = useSafeAreaInsets();

  const handleBoost = async () => {
    setLoading(true);
    await onBoost(PROFILE_BOOST_TIERS[selected]);
    setLoading(false);
    onClose();
  };

  const tier = PROFILE_BOOST_TIERS[selected];
  const canAfford = balance >= tier.bdag;

  return (
    <Modal visible={visible} transparent animationType="slide"
      presentationStyle="overFullScreen" onRequestClose={onClose}>
      <Pressable style={bs.backdrop} onPress={onClose} />
      <View style={[bs.sheet, { paddingBottom: insets.bottom + 24 }]}>
        <View style={bs.handle} />

        <View style={bs.header}>
          <LinearGradient colors={['#FF9D00', '#FF5A00']} style={bs.headerIcon}>
            <MaterialCommunityIcons name="rocket-launch" size={18} color="#fff" />
          </LinearGradient>
          <View style={{ flex: 1 }}>
            <Text style={bs.title}>Patrocinar a @{creatorName}</Text>
            <Text style={bs.subtitle}>Gasta BDAG para amplificar su visibilidad en el feed</Text>
          </View>
        </View>

        {/* What boosting does */}
        <View style={bs.effectsBox}>
          {[
            { icon: 'search',         text: 'Mayor visibilidad en búsqueda y explorar' },
            { icon: 'trending-up',    text: 'Posición en sección trending de creadores' },
            { icon: 'people',         text: 'Sugerido a nuevos usuarios potenciales' },
            { icon: 'feed',           text: 'Aparece en feed patrocinado de seguidores' },
          ].map(e => (
            <View key={e.text} style={bs.effectRow}>
              <MaterialIcons name={e.icon as any} size={12} color="#FF9D00" />
              <Text style={bs.effectText}>{e.text}</Text>
            </View>
          ))}
        </View>

        {/* Tier selector */}
        <View style={bs.tierGrid}>
          {PROFILE_BOOST_TIERS.map((t, i) => (
            <Pressable key={i}
              style={[bs.tierCard, selected === i && { borderColor: t.color, backgroundColor: t.color + '18' }]}
              onPress={() => setSelected(i)}
            >
              <Text style={[bs.tierLabel, { color: selected === i ? t.color : Colors.textSubtle }]}>{t.label}</Text>
              <Text style={[bs.tierMult, { color: t.color }]}>{t.multiplier}</Text>
              <Text style={[bs.tierBdag, { color: selected === i ? t.color : Colors.textSecondary }]}>
                {t.bdag.toLocaleString()} BDAG
              </Text>
              <Text style={bs.tierHrs}>{t.hours}h</Text>
            </Pressable>
          ))}
        </View>

        <Text style={bs.tierDesc}>{tier.description}</Text>

        <View style={bs.balRow}>
          <MaterialCommunityIcons name="hexagon-multiple" size={13} color={Colors.textSubtle} />
          <Text style={bs.balText}>Tu saldo: {fmt(balance)} BDAG</Text>
          {!canAfford ? <Text style={{ color: Colors.error, fontSize: 11 }}>· Insuficiente</Text> : null}
        </View>

        <Pressable
          style={[bs.boostBtn, !canAfford && { opacity: 0.4 }]}
          onPress={handleBoost} disabled={loading || !canAfford}
        >
          <LinearGradient colors={['#FF9D00', '#FF5A00']} style={bs.boostBtnGrad}>
            {loading
              ? <ActivityIndicator color="#fff" size="small" />
              : <MaterialCommunityIcons name="rocket-launch" size={16} color="#fff" />}
            <Text style={bs.boostBtnText}>
              {loading ? 'Activando...' : `Patrocinar · ${tier.bdag.toLocaleString()} BDAG · ${tier.hours}h`}
            </Text>
          </LinearGradient>
        </Pressable>
        <Pressable style={bs.cancelBtn} onPress={onClose}>
          <Text style={bs.cancelText}>Cancelar</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const bs = StyleSheet.create({
  backdrop:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)' },
  sheet:        { backgroundColor: Colors.surfaceElevated, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.lg, gap: Spacing.md, borderTopWidth: 1, borderColor: Colors.border },
  handle:       { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 4 },
  header:       { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerIcon:   { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  title:        { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  subtitle:     { color: Colors.textSubtle, fontSize: FontSize.xs, marginTop: 1 },
  effectsBox:   { backgroundColor: 'rgba(255,157,0,0.08)', borderRadius: Radius.md, padding: 10, gap: 6, borderWidth: 1, borderColor: 'rgba(255,157,0,0.2)' },
  effectRow:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  effectText:   { color: Colors.textSecondary, fontSize: 11, flex: 1 },
  tierGrid:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tierCard:     { width: (W - Spacing.lg * 2 - 24) / 2, backgroundColor: Colors.surface, borderRadius: Radius.md, padding: 12, gap: 2, borderWidth: 1.5, borderColor: Colors.border },
  tierLabel:    { fontSize: 11, fontWeight: FontWeight.semibold },
  tierMult:     { fontSize: 20, fontWeight: FontWeight.extrabold },
  tierBdag:     { fontSize: 11, fontWeight: FontWeight.semibold },
  tierHrs:      { color: Colors.textSubtle, fontSize: 10 },
  tierDesc:     { color: Colors.textSubtle, fontSize: FontSize.xs, textAlign: 'center' },
  balRow:       { flexDirection: 'row', alignItems: 'center', gap: 5, justifyContent: 'center' },
  balText:      { color: Colors.textSubtle, fontSize: FontSize.xs },
  boostBtn:     { borderRadius: Radius.md, overflow: 'hidden' },
  boostBtnGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  boostBtnText: { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
  cancelBtn:    { alignItems: 'center', paddingVertical: 12, backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border },
  cancelText:   { color: Colors.textSubtle, fontSize: FontSize.sm },
});

// ════════════════════════════════════════════════════════════════════════════
// MAIN SCREEN
// ════════════════════════════════════════════════════════════════════════════
export default function CreatorProfileScreen() {
  const { id: creatorId } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router  = useRouter();
  const { user } = useAuth();
  const walletData = useWallet();
  const balance = walletData?.balance ?? 0;
  const { showAlert } = useAlert();

  const isOwnProfile = user?.id === creatorId;

  // Data state
  const [creator,     setCreator]     = useState<CreatorProfile | null>(null);
  const [stats,       setStats]       = useState<CreatorStats | null>(null);
  const [videos,      setVideos]      = useState<any[]>([]);
  const [exclusive,   setExclusive]   = useState<any[]>([]);
  const [plans,       setPlans]       = useState<SubscriptionPlan[]>([]);
  const [dmConfig,    setDmConfig]    = useState<PremiumDMConfig | null>(null);
  const [loading,     setLoading]     = useState(true);

  // User-specific state
  const [isFollowing,   setIsFollowing]   = useState(false);
  const [subStatus,     setSubStatus]     = useState<{
    isSubscribed: boolean; freeDmsLeft: number; planName: string; expiresAt?: string;
  }>({ isSubscribed: false, freeDmsLeft: 0, planName: '' });
  const [isBoosted,     setIsBoosted]     = useState(false);
  const [purchasedIds,  setPurchasedIds]  = useState<Set<string>>(new Set());

  // UI state
  const [profileTab,    setProfileTab]    = useState<ProfileTab>('videos');
  const [subSheetVis,   setSubSheetVis]   = useState(false);
  const [boostSheetVis, setBoostSheetVis] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);

  // ── Load all data ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!creatorId) return;
    const load = async () => {
      setLoading(true);
      const [profile, creatorStats, vids, excl, subPlans, dm, followStatus, purchased, boosted] =
        await Promise.all([
          fetchCreatorProfile(creatorId),
          fetchCreatorStats(creatorId),
          fetchCreatorVideos(creatorId, 24),
          fetchCreatorExclusiveContent(creatorId),
          fetchCreatorSubscriptionPlans(creatorId),
          getPremiumDMConfig(creatorId),
          user?.id && user.id !== creatorId
            ? checkIsFollowing(user.id, creatorId)
            : Promise.resolve(false),
          user?.id ? fetchPurchasedContentIds(user.id) : Promise.resolve(new Set<string>()),
          isProfileBoosted(creatorId),
        ]);

      setCreator(profile);
      setStats(creatorStats);
      setVideos(vids);
      setExclusive(excl);
      setPlans(subPlans);
      setDmConfig(dm);
      setIsFollowing(followStatus);
      setPurchasedIds(purchased);
      setIsBoosted(boosted.boosted);

      // Subscription status
      if (user?.id && user.id !== creatorId) {
        const sub = await checkSubscription(user.id, creatorId);
        setSubStatus({
          isSubscribed: sub.isSubscribed,
          freeDmsLeft: sub.freeDmsRemaining,
          planName: sub.planName,
        });
      }

      setLoading(false);
    };
    load();
  }, [creatorId, user?.id]);

  // ── Follow / Unfollow ─────────────────────────────────────────────────────
  const handleFollow = useCallback(async () => {
    if (!user?.id || followLoading) return;
    setFollowLoading(true);
    if (isFollowing) {
      await unfollowCreator(user.id, creatorId!);
      setIsFollowing(false);
      setCreator(prev => prev ? { ...prev, followers_count: Math.max(0, prev.followers_count - 1) } : prev);
    } else {
      await followCreator(user.id, creatorId!);
      setIsFollowing(true);
      setCreator(prev => prev ? { ...prev, followers_count: prev.followers_count + 1 } : prev);
    }
    setFollowLoading(false);
  }, [user?.id, creatorId, isFollowing, followLoading]);

  // ── Subscribe ─────────────────────────────────────────────────────────────
  const handleSubscribe = useCallback(async (plan: SubscriptionPlan) => {
    if (balance < plan.price_bdag) {
      showAlert('Saldo insuficiente', `Necesitas ${fmt(plan.price_bdag)} BDAG`);
      return;
    }
    const result = await subscribeToPlan(plan.id);
    if (!result.success) { showAlert('Error', result.error ?? 'No se pudo suscribir'); return; }
    walletData?.fullSync?.();
    setSubStatus({ isSubscribed: true, freeDmsLeft: 10, planName: plan.name });
    showAlert('¡Bienvenido al club!', `Suscrito a "${plan.name}" · Activo hasta ${new Date(result.expires_at ?? '').toLocaleDateString()}`);
  }, [balance, walletData, showAlert]);

  // ── Boost Profile ─────────────────────────────────────────────────────────
  const handleBoostProfile = useCallback(async (tier: BoostTier) => {
    if (balance < tier.bdag) {
      showAlert('Saldo insuficiente', `Necesitas ${tier.bdag.toLocaleString()} BDAG`);
      return;
    }
    const result = await boostCreatorProfile({ creatorId: creatorId!, tier });
    if (!result.success) { showAlert('Error', result.error ?? 'No se pudo activar'); return; }
    walletData?.fullSync?.();
    setIsBoosted(true);
    showAlert('¡Perfil patrocinado!', `@${creator?.username} aparecerá en posiciones destacadas durante ${tier.hours}h`);
  }, [balance, creatorId, creator, walletData, showAlert]);

  // ── Purchase exclusive content ────────────────────────────────────────────
  const handlePurchaseContent = useCallback(async (contentId: string, priceBdag: number) => {
    if (subStatus.isSubscribed) {
      showAlert('Acceso gratis', 'Eres suscriptor — acceso automático a este contenido');
      return;
    }
    if (balance < priceBdag) {
      showAlert('Saldo insuficiente', `Necesitas ${fmt(priceBdag)} BDAG`);
      return;
    }
    showAlert(
      'Desbloquear contenido',
      `Precio: ${fmt(priceBdag)} BDAG`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: `Desbloquear · ${fmt(priceBdag)} BDAG`,
          onPress: async () => {
            const result = await purchaseContent(contentId);
            if (!result.success && !result.already_owned) {
              showAlert('Error', result.error ?? 'No se pudo completar');
              return;
            }
            walletData?.fullSync?.();
            setPurchasedIds(prev => new Set([...prev, contentId]));
            showAlert('¡Desbloqueado!', 'Ahora tienes acceso a este contenido');
          },
        },
      ]
    );
  }, [balance, subStatus.isSubscribed, walletData, showAlert]);

  if (loading) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <StatusBar style="light" />
        <ActivityIndicator color={Colors.primary} size="large" />
      </View>
    );
  }

  if (!creator) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <StatusBar style="light" />
        <Text style={styles.notFoundText}>Creador no encontrado</Text>
        <Pressable onPress={() => router.back()} style={styles.backBtnAlt}>
          <Text style={{ color: Colors.primary, fontWeight: FontWeight.semibold }}>Volver</Text>
        </Pressable>
      </View>
    );
  }

  const avatarUri = creator.avatar_url ||
    `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(creator.username || 'user')}`;

  const PROFILE_TABS: { key: ProfileTab; icon: string; label: string }[] = [
    { key: 'videos',    icon: 'videocam',         label: 'Videos' },
    { key: 'exclusive', icon: 'lock',              label: 'Exclusivo' },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* ── Top nav ─────────────────────────────────────────────────────── */}
      <View style={styles.topNav}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.topNavBtn}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={Colors.textPrimary} />
        </Pressable>
        <Text style={styles.topNavTitle} numberOfLines={1}>@{creator.username}</Text>
        <Pressable
          onPress={() => showAlert('Opciones', '', [
            { text: 'Compartir perfil', onPress: () => {} },
            { text: 'Reportar', style: 'destructive', onPress: () => {} },
            { text: 'Cancelar', style: 'cancel' },
          ])}
          hitSlop={10} style={styles.topNavBtn}
        >
          <MaterialCommunityIcons name="dots-vertical" size={22} color={Colors.textSecondary} />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}>

        {/* ── Hero section ─────────────────────────────────────────────── */}
        <View style={styles.hero}>
          {/* Avatar with boost glow */}
          <View style={styles.avatarContainer}>
            {isBoosted ? (
              <LinearGradient colors={['#FF9D00', '#FF5A00', '#A855F7']} style={styles.boostRing}>
                <Image source={{ uri: avatarUri }} style={styles.avatarImg} contentFit="cover" transition={200} />
              </LinearGradient>
            ) : subStatus.isSubscribed ? (
              <LinearGradient colors={['#A855F7', '#7C5CFF']} style={styles.boostRing}>
                <Image source={{ uri: avatarUri }} style={styles.avatarImg} contentFit="cover" transition={200} />
              </LinearGradient>
            ) : (
              <LinearGradient colors={['#2C2C3A', '#1C1C28']} style={styles.boostRing}>
                <Image source={{ uri: avatarUri }} style={styles.avatarImg} contentFit="cover" transition={200} />
              </LinearGradient>
            )}

            {/* Boosted badge */}
            {isBoosted ? (
              <View style={styles.boostedBadge}>
                <MaterialCommunityIcons name="rocket-launch" size={9} color="#fff" />
                <Text style={styles.boostedBadgeText}>BOOST</Text>
              </View>
            ) : null}
          </View>

          {/* Name + profession */}
          <Text style={styles.displayName}>
            {creator.display_name || creator.username}
          </Text>
          {creator.profession ? (
            <Text style={styles.profession}>{creator.profession}</Text>
          ) : null}
          {creator.bio ? (
            <Text style={styles.bio} numberOfLines={3}>{creator.bio}</Text>
          ) : null}

          {/* Subscriber badge */}
          {subStatus.isSubscribed ? (
            <LinearGradient colors={['#A855F7', '#7C5CFF']} style={styles.subBadge}>
              <MaterialIcons name="star" size={11} color="#fff" />
              <Text style={styles.subBadgeText}>SUSCRIPTOR · {subStatus.planName}</Text>
              {subStatus.freeDmsLeft > 0 ? (
                <Text style={styles.subBadgeDMs}>{subStatus.freeDmsLeft} DMs gratis</Text>
              ) : null}
            </LinearGradient>
          ) : null}

          {/* Stats row */}
          <View style={styles.statsRow}>
            {[
              { label: 'Videos',    val: fmtShort(stats?.total_videos ?? 0) },
              { label: 'Seguidores', val: fmtShort(creator.followers_count) },
              { label: 'Likes',     val: fmtShort(stats?.total_likes ?? 0) },
              { label: 'Suscrip.',  val: fmtShort(stats?.active_subscribers ?? 0) },
            ].map((s, i) => (
              <React.Fragment key={s.label}>
                {i > 0 ? <View style={styles.statDivider} /> : null}
                <View style={styles.statItem}>
                  <Text style={styles.statVal}>{s.val}</Text>
                  <Text style={styles.statLabel}>{s.label}</Text>
                </View>
              </React.Fragment>
            ))}
          </View>

          {/* ── Action buttons ──────────────────────────────────────────── */}
          {isOwnProfile ? (
            // Own profile — edit and settings
            <View style={styles.actionRow}>
              <Pressable style={[styles.actionBtn, { flex: 1 }]}
                onPress={() => router.push('/(tabs)/profile')}>
                <Text style={styles.actionBtnText}>Editar perfil</Text>
              </Pressable>
              <Pressable style={[styles.actionBtn, { flex: 1 }]}
                onPress={() => router.push('/creator-monetization')}>
                <LinearGradient colors={['#A855F7', '#7C5CFF']} style={styles.actionBtnGradInner}>
                  <MaterialIcons name="star" size={14} color="#fff" />
                  <Text style={[styles.actionBtnText, { color: '#fff' }]}>Monetizar</Text>
                </LinearGradient>
              </Pressable>
            </View>
          ) : (
            <>
              {/* Primary action row */}
              <View style={styles.actionRow}>
                {/* Follow */}
                <Pressable
                  style={[styles.actionBtn, isFollowing && styles.actionBtnActive, { flex: 1 }]}
                  onPress={handleFollow}
                  disabled={followLoading}
                >
                  {followLoading
                    ? <ActivityIndicator color={Colors.primary} size="small" />
                    : <Text style={[styles.actionBtnText, isFollowing && { color: Colors.primary }]}>
                        {isFollowing ? 'Siguiendo' : 'Seguir'}
                      </Text>}
                </Pressable>

                {/* Subscribe */}
                <Pressable
                  style={[styles.actionBtn, { flex: 1 }, subStatus.isSubscribed && styles.actionBtnSubbed]}
                  onPress={() => setSubSheetVis(true)}
                >
                  {subStatus.isSubscribed ? (
                    <LinearGradient colors={['#A855F7', '#7C5CFF']} style={styles.actionBtnGradInner}>
                      <MaterialIcons name="star" size={14} color="#fff" />
                      <Text style={[styles.actionBtnText, { color: '#fff' }]}>Suscrito</Text>
                    </LinearGradient>
                  ) : (
                    <>
                      <MaterialIcons name="star-border" size={14} color={Colors.textSecondary} />
                      <Text style={styles.actionBtnText}>Suscribirse</Text>
                    </>
                  )}
                </Pressable>

                {/* Message */}
                <Pressable
                  style={[styles.iconBtn, dmConfig?.enabled && styles.iconBtnPremium]}
                  onPress={() => router.push(`/chat/${creatorId}`)}
                  hitSlop={4}
                >
                  {dmConfig?.enabled ? (
                    <LinearGradient colors={['#FF9D00', '#FF5A00']} style={styles.iconBtnGrad}>
                      <MaterialIcons name="mark-email-read" size={16} color="#fff" />
                    </LinearGradient>
                  ) : (
                    <MaterialCommunityIcons name="message-text-outline" size={18} color={Colors.textSecondary} />
                  )}
                </Pressable>
              </View>

              {/* Boost/Sponsor row */}
              <Pressable style={styles.boostBar} onPress={() => setBoostSheetVis(true)}>
                <LinearGradient colors={['rgba(255,157,0,0.14)', 'rgba(255,90,0,0.07)']} style={styles.boostBarInner}>
                  <MaterialCommunityIcons name="rocket-launch" size={14} color="#FF9D00" />
                  <Text style={styles.boostBarText}>
                    {isBoosted ? 'Perfil patrocinado activo ✓' : 'Patrocinar perfil · Amplifica su visibilidad'}
                  </Text>
                  <Text style={styles.boostBarCta}>{isBoosted ? 'Activo' : 'Boost'}</Text>
                </LinearGradient>
              </Pressable>

              {/* Premium DM hint */}
              {dmConfig?.enabled ? (
                <Pressable style={styles.premiumDMBar}
                  onPress={() => router.push(`/chat/${creatorId}`)}>
                  <LinearGradient colors={['rgba(255,157,0,0.12)', 'rgba(255,90,0,0.06)']} style={styles.premiumDMBarInner}>
                    <MaterialIcons name="mark-email-read" size={13} color="#FF9D00" />
                    <Text style={styles.premiumDMBarText}>
                      DM Premium activo · {fmt(dmConfig.price_bdag)} BDAG
                      {subStatus.isSubscribed && subStatus.freeDmsLeft > 0
                        ? ` · ${subStatus.freeDmsLeft} gratis por tu suscripción`
                        : ' · Responde en 72h o reembolso automático'}
                    </Text>
                  </LinearGradient>
                </Pressable>
              ) : null}
            </>
          )}
        </View>

        {/* ── Content tabs ─────────────────────────────────────────────── */}
        <View style={styles.contentTabsBar}>
          {PROFILE_TABS.map(t => (
            <Pressable key={t.key}
              style={[styles.contentTabBtn, profileTab === t.key && styles.contentTabBtnActive]}
              onPress={() => setProfileTab(t.key)}
            >
              <MaterialIcons
                name={t.icon as any}
                size={18}
                color={profileTab === t.key ? Colors.textPrimary : Colors.textSubtle}
              />
              <Text style={[styles.contentTabText, profileTab === t.key && { color: Colors.textPrimary }]}>
                {t.label}
              </Text>
              {t.key === 'exclusive' && exclusive.length > 0 ? (
                <View style={styles.contentTabBadge}>
                  <Text style={styles.contentTabBadgeText}>{exclusive.length}</Text>
                </View>
              ) : null}
            </Pressable>
          ))}
        </View>

        {/* ── Videos grid ──────────────────────────────────────────────── */}
        {profileTab === 'videos' && (
          videos.length === 0 ? (
            <View style={styles.emptyState}>
              <MaterialCommunityIcons name="video-off-outline" size={44} color={Colors.border} />
              <Text style={styles.emptyTitle}>Sin videos aún</Text>
            </View>
          ) : (
            <View style={styles.videoGrid}>
              {videos.map(v => {
                const thumb = v.thumbnail_url?.startsWith('http')
                  ? { uri: v.thumbnail_url }
                  : v.video_url?.startsWith('http')
                    ? { uri: v.video_url }
                    : { uri: `https://picsum.photos/seed/${v.id}/300/400` };
                return (
                  <View key={v.id} style={styles.videoThumbWrap}>
                    <Image source={thumb} style={styles.videoThumb} contentFit="cover" transition={150} />
                    <LinearGradient colors={['transparent', 'rgba(0,0,0,0.7)']} style={styles.videoThumbOverlay}>
                      <MaterialIcons name="favorite" size={10} color={Colors.secondary} />
                      <Text style={styles.videoThumbLikes}>
                        {fmtShort(v.likes_count ?? 0)}
                      </Text>
                    </LinearGradient>
                  </View>
                );
              })}
            </View>
          )
        )}

        {/* ── Exclusive content grid ────────────────────────────────────── */}
        {profileTab === 'exclusive' && (
          exclusive.length === 0 ? (
            <View style={styles.emptyState}>
              <MaterialIcons name="lock" size={44} color={Colors.border} />
              <Text style={styles.emptyTitle}>Sin contenido exclusivo</Text>
              {isOwnProfile ? (
                <Pressable style={styles.emptyActionBtn}
                  onPress={() => router.push('/(tabs)/upload')}>
                  <Text style={styles.emptyActionText}>Publicar contenido exclusivo</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <View style={styles.exclusiveGrid}>
              {exclusive.map(item => {
                const owned  = purchasedIds.has(item.id) || isOwnProfile;
                const isFree = subStatus.isSubscribed;
                const thumb  = item.preview_url?.startsWith('http')
                  ? { uri: item.preview_url }
                  : { uri: `https://picsum.photos/seed/${item.id}/300/400` };
                return (
                  <Pressable key={item.id} style={styles.exclusiveCard}
                    onPress={() => !owned && !isFree
                      ? handlePurchaseContent(item.id, item.price_bdag)
                      : showAlert('Contenido desbloqueado', 'Puedes acceder a este contenido')
                    }
                  >
                    <Image source={thumb} style={styles.exclusiveThumb} contentFit="cover" transition={150} />
                    {/* Blur/lock overlay for non-subscribers */}
                    {!owned && !isFree ? (
                      <LinearGradient colors={['rgba(7,7,15,0.3)', 'rgba(7,7,15,0.85)']}
                        style={styles.exclusiveLockOverlay}>
                        <View style={styles.lockIcon}>
                          <MaterialIcons name="lock" size={16} color="#fff" />
                        </View>
                        <Text style={styles.exclusivePrice}>{fmt(item.price_bdag)} BDAG</Text>
                      </LinearGradient>
                    ) : (
                      <View style={styles.exclusiveUnlockedBadge}>
                        <MaterialIcons name={isFree && !owned ? 'star' : 'check'} size={10} color="#fff" />
                      </View>
                    )}
                    <View style={styles.exclusiveCardFooter}>
                      <Text style={styles.exclusiveCardTitle} numberOfLines={1}>{item.title}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )
        )}
      </ScrollView>

      {/* Subscribe sheet */}
      <SubscribeSheet
        visible={subSheetVis}
        plans={plans}
        balance={balance}
        isSubscribed={subStatus.isSubscribed}
        currentPlanName={subStatus.planName}
        freeDmsLeft={subStatus.freeDmsLeft}
        onClose={() => setSubSheetVis(false)}
        onSubscribe={handleSubscribe}
      />

      {/* Boost profile sheet */}
      <BoostProfileSheet
        visible={boostSheetVis}
        creatorName={creator.username || 'creador'}
        balance={balance}
        onClose={() => setBoostSheetVis(false)}
        onBoost={handleBoostProfile}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  centered:  { alignItems: 'center', justifyContent: 'center' },

  // Top nav
  topNav:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm },
  topNavBtn:   { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border },
  topNavTitle: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.semibold, flex: 1, textAlign: 'center', marginHorizontal: Spacing.sm },

  // Hero
  hero:           { alignItems: 'center', paddingHorizontal: Spacing.md, paddingBottom: Spacing.md, gap: Spacing.sm },
  avatarContainer:{ position: 'relative', marginBottom: 4 },
  boostRing:      { width: 100, height: 100, borderRadius: 50, alignItems: 'center', justifyContent: 'center', padding: 2.5 },
  avatarImg:      { width: 93, height: 93, borderRadius: 47, borderWidth: 2, borderColor: Colors.bg },
  boostedBadge:   { position: 'absolute', bottom: 2, right: -2, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#FF9D00', borderRadius: Radius.full, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1.5, borderColor: Colors.bg },
  boostedBadgeText: { color: '#fff', fontSize: 8, fontWeight: FontWeight.bold },
  displayName:    { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.textPrimary, textAlign: 'center' },
  profession:     { fontSize: FontSize.sm, color: Colors.primary, fontWeight: FontWeight.medium, textAlign: 'center' },
  bio:            { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20, maxWidth: 300 },
  subBadge:       { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 5 },
  subBadgeText:   { color: '#fff', fontSize: 10, fontWeight: FontWeight.bold, letterSpacing: 0.3 },
  subBadgeDMs:    { color: 'rgba(255,255,255,0.8)', fontSize: 9, marginLeft: 4 },

  // Stats
  statsRow:     { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surfaceElevated, borderRadius: Radius.xl, padding: Spacing.md, width: '100%', borderWidth: 1, borderColor: Colors.border },
  statItem:     { flex: 1, alignItems: 'center', gap: 2 },
  statVal:      { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  statLabel:    { color: Colors.textSubtle, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.3 },
  statDivider:  { width: 1, height: 28, backgroundColor: Colors.border },

  // Actions
  actionRow:          { flexDirection: 'row', gap: Spacing.sm, width: '100%' },
  actionBtn:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 42, borderRadius: Radius.md, backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  actionBtnActive:    { borderColor: Colors.primary, backgroundColor: Colors.primaryDim },
  actionBtnSubbed:    { overflow: 'hidden' },
  actionBtnGradInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, flex: 1, paddingVertical: 10 },
  actionBtnText:      { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  iconBtn:            { width: 42, height: 42, borderRadius: Radius.md, backgroundColor: Colors.surfaceElevated, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  iconBtnPremium:     { borderColor: 'rgba(255,157,0,0.4)' },
  iconBtnGrad:        { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },

  // Boost bar
  boostBar:         { width: '100%', borderRadius: Radius.md, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,157,0,0.3)' },
  boostBarInner:    { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  boostBarText:     { color: Colors.textSecondary, fontSize: FontSize.xs, flex: 1 },
  boostBarCta:      { color: '#FF9D00', fontSize: FontSize.xs, fontWeight: FontWeight.bold },

  // Premium DM bar
  premiumDMBar:      { width: '100%', borderRadius: Radius.md, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,157,0,0.2)' },
  premiumDMBarInner: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  premiumDMBarText:  { color: Colors.textSubtle, fontSize: 11, flex: 1, lineHeight: 16 },

  // Content tabs
  contentTabsBar:     { flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: Colors.border },
  contentTabBtn:      { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, height: 44, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  contentTabBtnActive:{ borderBottomColor: Colors.textPrimary },
  contentTabText:     { color: Colors.textSubtle, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  contentTabBadge:    { backgroundColor: '#A855F7', borderRadius: Radius.full, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  contentTabBadgeText:{ color: '#fff', fontSize: 9, fontWeight: FontWeight.bold },

  // Video grid
  videoGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
  videoThumbWrap:  { width: THUMB, height: THUMB * 1.3, position: 'relative', backgroundColor: Colors.surface },
  videoThumb:      { width: '100%', height: '100%' },
  videoThumbOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 5, flexDirection: 'row', alignItems: 'center', gap: 3, justifyContent: 'flex-end' },
  videoThumbLikes: { color: '#fff', fontSize: 10, fontWeight: FontWeight.semibold },

  // Exclusive content grid
  exclusiveGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: 2, padding: 2 },
  exclusiveCard:       { width: (W - 4) / 2 - 1, height: 180, position: 'relative', backgroundColor: Colors.surface, borderRadius: 2, overflow: 'hidden' },
  exclusiveThumb:      { width: '100%', height: '100%' },
  exclusiveLockOverlay:{ ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 6 },
  lockIcon:            { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  exclusivePrice:      { color: '#fff', fontSize: FontSize.sm, fontWeight: FontWeight.bold, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.full },
  exclusiveUnlockedBadge: { position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,229,160,0.85)', alignItems: 'center', justifyContent: 'center' },
  exclusiveCardFooter:{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.6)', padding: 6 },
  exclusiveCardTitle:  { color: '#fff', fontSize: 10, fontWeight: FontWeight.semibold },

  // Empty states
  emptyState:     { alignItems: 'center', paddingVertical: 48, gap: Spacing.md },
  emptyTitle:     { color: Colors.textSubtle, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  emptyActionBtn: { backgroundColor: Colors.primaryDim, borderRadius: Radius.md, paddingHorizontal: 20, paddingVertical: 10, borderWidth: 1, borderColor: Colors.primary + '44' },
  emptyActionText:{ color: Colors.primary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },

  // Not found
  notFoundText:  { color: Colors.textSecondary, fontSize: FontSize.lg, marginBottom: Spacing.md },
  backBtnAlt:    { paddingHorizontal: 20, paddingVertical: 10 },
});
