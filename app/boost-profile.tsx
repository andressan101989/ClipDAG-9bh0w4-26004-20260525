/**
 * app/boost-profile.tsx
 *
 * Boost Profile / Promocionar Perfil
 *
 * TikTok/Instagram-style creator promotion screen powered by internal BDAG.
 * Creators spend BDAG to amplify profile visibility, discoverability,
 * feed reach, and algorithmic ranking.
 *
 * Features:
 *  • 4 boost tiers (Visibilidad, Trending, Sugerido, Patrocinado)
 *  • How it works section with platform effects
 *  • Active boost status (if already boosted)
 *  • Duration + estimated reach per tier
 *  • BDAG balance check
 *  • Real boost purchase via boostService
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView,
  Dimensions, ActivityIndicator,
} from 'react-native';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { useAlert } from '@/template';
import { useI18n } from '@/contexts/I18nContext';
import {
  boostCreatorProfile, isProfileBoosted, fetchActiveBoosts,
  PROFILE_BOOST_TIERS, type BoostTier, type ActiveBoost,
} from '@/services/boostService';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';

const { width: W } = Dimensions.get('window');

function fmt(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Estimated reach per tier (multiplier × base impressions)
const ESTIMATED_REACH: Record<number, string> = {
  0: '2K–8K',
  1: '12K–40K',
  2: '50K–200K',
  3: '300K–1.5M',
};

export default function BoostProfileScreen() {
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const { user }  = useAuth();
  const walletData = useWallet();
  const balance  = walletData?.balance ?? 0;
  const { showAlert } = useAlert();
  const { t } = useI18n();

  const [selectedTier, setSelectedTier] = useState(0);
  const [loading,       setLoading]      = useState(false);
  const [checkingBoost, setCheckingBoost] = useState(true);
  const [activeBoost,   setActiveBoost]  = useState<ActiveBoost | null>(null);
  const [isBoosted,     setIsBoosted]    = useState(false);

  // ── Load current boost status ────────────────────────────────────────────
  useEffect(() => {
    if (!user?.id) { setCheckingBoost(false); return; }
    Promise.all([
      isProfileBoosted(user.id),
      fetchActiveBoosts(user.id),
    ]).then(([boostResult, activeBoosts]) => {
      setIsBoosted(boostResult.boosted);
      const profileBoost = activeBoosts.find(b => b.reference_type === 'profile' && b.reference_id === user.id);
      setActiveBoost(profileBoost ?? null);
      setCheckingBoost(false);
    });
  }, [user?.id]);

  const tier = PROFILE_BOOST_TIERS[selectedTier];
  const canAfford = balance >= tier.bdag;

  const handleActivateBoost = useCallback(async () => {
    if (!user?.id) return;
    if (!canAfford) {
      showAlert(
        t('common.insufficient_balance'),
        t('boost.insufficientBalance', { amount: fmt(tier.bdag) })
      );
      return;
    }

    showAlert(
      t('boost.activateBoost'),
      `${tier.label} · ${fmt(tier.bdag)} BDAG · ${tier.hours}h`,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('boost.activateBoost'),
          onPress: async () => {
            setLoading(true);
            const result = await boostCreatorProfile({ creatorId: user.id, tier });
            setLoading(false);

            if (!result.success) {
              showAlert(t('common.error'), result.error ?? 'No se pudo activar el boost');
              return;
            }

            walletData?.fullSync?.();
            setIsBoosted(true);
            showAlert(
              t('boost.boostActivated'),
              t('boost.boostActivatedMsg', { hours: String(tier.hours) })
            );
            router.back();
          },
        },
      ]
    );
  }, [user?.id, canAfford, tier, balance, walletData, showAlert, t, router]);

  // ── HOW IT WORKS items ────────────────────────────────────────────────────
  const effects = [
    { icon: 'search',         text: t('boost.effects.search') },
    { icon: 'trending-up',    text: t('boost.effects.trending') },
    { icon: 'people',         text: t('boost.effects.suggested') },
    { icon: 'rss-feed',       text: t('boost.effects.feed') },
    { icon: 'bolt',           text: t('boost.effects.algorithm') },
  ];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={Colors.textPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{t('boost.title')}</Text>
          <Text style={styles.headerSub}>{t('boost.subtitle')}</Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: 120 + insets.bottom }]}
      >
        {/* ── Active boost status ──────────────────────────────────────── */}
        {checkingBoost ? (
          <View style={styles.centered}><ActivityIndicator color={Colors.primary} /></View>
        ) : isBoosted && activeBoost ? (
          <LinearGradient colors={['rgba(255,157,0,0.20)', 'rgba(124,92,255,0.12)']} style={styles.activeCard}>
            <LinearGradient colors={['#FF9D00', '#FF5A00']} style={styles.activeIcon}>
              <MaterialCommunityIcons name="rocket-launch" size={20} color="#fff" />
            </LinearGradient>
            <View style={{ flex: 1 }}>
              <View style={styles.activeRow}>
                <View style={styles.activeDot} />
                <Text style={styles.activeTitle}>{t('boost.boostActive')}</Text>
              </View>
              <Text style={styles.activeUntil}>
                {t('boost.activeUntil')}: {formatDate(activeBoost.expires_at)}
              </Text>
              <Text style={styles.activeImpressions}>
                {fmt(activeBoost.impressions)} {t('boost.impressions')}
              </Text>
            </View>
          </LinearGradient>
        ) : null}

        {/* ── How it works ─────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('boost.howItWorks')}</Text>
          <View style={styles.effectsCard}>
            {effects.map(e => (
              <View key={e.text} style={styles.effectRow}>
                <LinearGradient colors={['rgba(255,157,0,0.2)', 'rgba(255,90,0,0.1)']} style={styles.effectIconBg}>
                  <MaterialIcons name={e.icon as any} size={15} color="#FF9D00" />
                </LinearGradient>
                <Text style={styles.effectText}>{e.text}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── Tier selector ────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('boost.chooseTier')}</Text>
          <View style={styles.tierGrid}>
            {PROFILE_BOOST_TIERS.map((tr, i) => {
              const isSelected = selectedTier === i;
              const afford = balance >= tr.bdag;
              return (
                <Pressable
                  key={i}
                  style={[
                    styles.tierCard,
                    isSelected && { borderColor: tr.color, borderWidth: 2 },
                    !afford && { opacity: 0.55 },
                  ]}
                  onPress={() => setSelectedTier(i)}
                >
                  {isSelected ? (
                    <LinearGradient colors={[tr.color + '28', tr.color + '08']} style={StyleSheet.absoluteFillObject} />
                  ) : null}

                  {/* Tier header */}
                  <View style={styles.tierHeader}>
                    <Text style={[styles.tierLabel, isSelected && { color: tr.color }]}>{tr.label}</Text>
                    {isSelected ? (
                      <MaterialIcons name="check-circle" size={14} color={tr.color} />
                    ) : null}
                  </View>

                  {/* Multiplier */}
                  <Text style={[styles.tierMultiplier, { color: tr.color }]}>{tr.multiplier}</Text>

                  {/* BDAG cost */}
                  <Text style={[styles.tierCost, isSelected && { color: tr.color }]}>
                    {fmt(tr.bdag)} BDAG
                  </Text>

                  {/* Duration */}
                  <View style={styles.tierDuration}>
                    <MaterialCommunityIcons name="clock-outline" size={11} color={Colors.textSubtle} />
                    <Text style={styles.tierDurationText}>{tr.hours}h</Text>
                  </View>

                  {/* Estimated reach */}
                  <View style={[styles.reachBadge, { backgroundColor: tr.color + '18' }]}>
                    <MaterialIcons name="people" size={9} color={tr.color} />
                    <Text style={[styles.reachText, { color: tr.color }]}>{ESTIMATED_REACH[i]}</Text>
                  </View>

                  {/* Can't afford indicator */}
                  {!afford ? (
                    <View style={styles.insufficientBadge}>
                      <Text style={styles.insufficientText}>Sin saldo</Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* ── Selected tier detail ─────────────────────────────────────── */}
        <LinearGradient
          colors={[tier.color + '18', tier.color + '05']}
          style={styles.tierDetailCard}
        >
          <View style={styles.tierDetailRow}>
            <MaterialCommunityIcons name="rocket-launch" size={16} color={tier.color} />
            <Text style={[styles.tierDetailName, { color: tier.color }]}>{tier.label}</Text>
          </View>
          <Text style={styles.tierDetailDesc}>{tier.description}</Text>
          <View style={styles.tierDetailStats}>
            <View style={styles.tierDetailStat}>
              <Text style={[styles.tierDetailStatVal, { color: tier.color }]}>{fmt(tier.bdag)}</Text>
              <Text style={styles.tierDetailStatLabel}>BDAG</Text>
            </View>
            <View style={styles.tierDetailDivider} />
            <View style={styles.tierDetailStat}>
              <Text style={[styles.tierDetailStatVal, { color: tier.color }]}>{tier.multiplier}</Text>
              <Text style={styles.tierDetailStatLabel}>Multiplicador</Text>
            </View>
            <View style={styles.tierDetailDivider} />
            <View style={styles.tierDetailStat}>
              <Text style={[styles.tierDetailStatVal, { color: tier.color }]}>{ESTIMATED_REACH[selectedTier]}</Text>
              <Text style={styles.tierDetailStatLabel}>Alcance est.</Text>
            </View>
          </View>
        </LinearGradient>

        {/* ── Balance display ──────────────────────────────────────────── */}
        <View style={styles.balanceRow}>
          <MaterialCommunityIcons name="hexagon-multiple" size={14} color={Colors.textSubtle} />
          <Text style={styles.balanceText}>
            {t('boost.yourBalance')}: {fmt(balance)} BDAG
          </Text>
          {!canAfford ? (
            <Pressable onPress={() => router.push('/(tabs)/wallet')}>
              <Text style={styles.depositLink}>Depositar</Text>
            </Pressable>
          ) : null}
        </View>

        {/* ── CTA Button ───────────────────────────────────────────────── */}
        <Pressable
          style={[styles.ctaBtn, (!canAfford || loading) && { opacity: 0.45 }]}
          onPress={handleActivateBoost}
          disabled={loading || !canAfford}
        >
          <LinearGradient
            colors={canAfford ? [tier.color, tier.color + 'CC'] : ['#3A3A50', '#2C2C3A']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={styles.ctaBtnGrad}
          >
            {loading
              ? <ActivityIndicator color="#fff" size="small" />
              : <MaterialCommunityIcons name="rocket-launch" size={18} color="#fff" />}
            <Text style={styles.ctaBtnText}>
              {loading ? 'Activando...'
                : !canAfford ? t('common.insufficient_balance')
                : `${t('boost.activateBoost')} · ${fmt(tier.bdag)} BDAG`}
            </Text>
          </LinearGradient>
        </Pressable>

        {/* ── Fine print ───────────────────────────────────────────────── */}
        <Text style={styles.finePrint}>
          El boost activa el algoritmo de visibilidad de ClipDAG. Los resultados son estimados y pueden variar según la competencia del mercado. El BDAG se descuenta al activar.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: Colors.bg },
  scroll: { padding: Spacing.md, gap: Spacing.lg },
  centered: { paddingVertical: Spacing.md, alignItems: 'center' },

  // Header
  header:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.md, paddingBottom: Spacing.md },
  backBtn:   { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border },
  headerTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  headerSub:   { fontSize: FontSize.xs, color: Colors.textSubtle, marginTop: 1 },

  // Active boost card
  activeCard:         { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: 'rgba(255,157,0,0.4)' },
  activeIcon:         { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  activeRow:          { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  activeDot:          { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF9D00' },
  activeTitle:        { color: '#FF9D00', fontSize: FontSize.md, fontWeight: FontWeight.bold },
  activeUntil:        { color: Colors.textSecondary, fontSize: FontSize.xs },
  activeImpressions:  { color: Colors.textSubtle, fontSize: FontSize.xs, marginTop: 2 },

  // Section
  section:      { gap: Spacing.sm },
  sectionTitle: { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.textPrimary },

  // Effects
  effectsCard: { backgroundColor: Colors.surfaceElevated, borderRadius: Radius.lg, padding: Spacing.md, gap: 10, borderWidth: 1, borderColor: 'rgba(255,157,0,0.2)' },
  effectRow:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  effectIconBg:{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  effectText:  { color: Colors.textSecondary, fontSize: FontSize.sm, flex: 1, lineHeight: 18 },

  // Tier grid
  tierGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tierCard: {
    width: (W - Spacing.md * 2 - Spacing.sm) / 2,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.lg, padding: Spacing.md,
    gap: 5, borderWidth: 1.5, borderColor: Colors.border,
    overflow: 'hidden', position: 'relative',
  },
  tierHeader:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tierLabel:       { color: Colors.textSecondary, fontSize: FontSize.xs, fontWeight: FontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.5 },
  tierMultiplier:  { fontSize: 28, fontWeight: FontWeight.extrabold, lineHeight: 32 },
  tierCost:        { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  tierDuration:    { flexDirection: 'row', alignItems: 'center', gap: 3 },
  tierDurationText:{ color: Colors.textSubtle, fontSize: 11 },
  reachBadge:      { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: Radius.sm, paddingHorizontal: 6, paddingVertical: 3, alignSelf: 'flex-start', marginTop: 2 },
  reachText:       { fontSize: 10, fontWeight: FontWeight.semibold },
  insufficientBadge: { position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(255,59,92,0.2)', borderRadius: Radius.sm, paddingHorizontal: 5, paddingVertical: 2 },
  insufficientText:  { color: Colors.error, fontSize: 8, fontWeight: FontWeight.semibold },

  // Tier detail
  tierDetailCard:      { borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.border },
  tierDetailRow:       { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tierDetailName:      { fontSize: FontSize.md, fontWeight: FontWeight.bold },
  tierDetailDesc:      { color: Colors.textSubtle, fontSize: FontSize.xs },
  tierDetailStats:     { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: Radius.md, padding: Spacing.md },
  tierDetailStat:      { flex: 1, alignItems: 'center', gap: 2 },
  tierDetailStatVal:   { fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  tierDetailStatLabel: { color: Colors.textSubtle, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.3 },
  tierDetailDivider:   { width: 1, height: 28, backgroundColor: Colors.border },

  // Balance
  balanceRow:  { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' },
  balanceText: { color: Colors.textSubtle, fontSize: FontSize.sm },
  depositLink: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold, marginLeft: 4 },

  // CTA
  ctaBtn:     { borderRadius: Radius.lg, overflow: 'hidden' },
  ctaBtnGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16 },
  ctaBtnText: { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },

  // Fine print
  finePrint: { color: Colors.textSubtle, fontSize: 10, textAlign: 'center', lineHeight: 15, paddingHorizontal: Spacing.md },
});
