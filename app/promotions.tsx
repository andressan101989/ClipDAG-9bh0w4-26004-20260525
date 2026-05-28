import React, { useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView,
  Dimensions,
} from 'react-native';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { useFeed } from '@/hooks/useFeed';
import { useAlert } from '@/template';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { formatNumber } from '@/services/mockData';

const { width: SCREEN_W } = Dimensions.get('window');

type PromoTab = 'overview' | 'campaigns' | 'analytics' | 'affiliate';

// ── Metric card ───────────────────────────────────────────────────────────────
function MetricCard({
  icon, gradient, label, value, change, suffix = '',
}: {
  icon: string; gradient: string[]; label: string;
  value: string | number; change?: string; suffix?: string;
}) {
  const isPositive = change?.startsWith('+');
  return (
    <View style={styles.metricCard}>
      <LinearGradient colors={gradient as [string, string, ...string[]]} style={styles.metricIcon}>
        <MaterialCommunityIcons name={icon as any} size={18} color="#fff" />
      </LinearGradient>
      <Text style={styles.metricValue}>{value}{suffix}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
      {change ? (
        <View style={[styles.metricChange, { backgroundColor: isPositive ? Colors.accent + '22' : Colors.error + '22' }]}>
          <MaterialIcons name={isPositive ? 'trending-up' : 'trending-down'} size={11} color={isPositive ? Colors.accent : Colors.error} />
          <Text style={[styles.metricChangeText, { color: isPositive ? Colors.accent : Colors.error }]}>{change}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ── Campaign card ─────────────────────────────────────────────────────────────
function CampaignCard({
  title, status, budget, spent, reach, ctr, onPress,
}: {
  title: string; status: 'active' | 'paused' | 'ended';
  budget: number; spent: number; reach: number; ctr: string;
  onPress: () => void;
}) {
  const statusColors = { active: Colors.accent, paused: Colors.warning, ended: Colors.textSubtle };
  const statusLabels = { active: 'Activa', paused: 'Pausada', ended: 'Finalizada' };
  const progress = Math.min(1, spent / budget);

  return (
    <Pressable style={styles.campaignCard} onPress={onPress}>
      <View style={styles.campaignHeader}>
        <Text style={styles.campaignTitle} numberOfLines={1}>{title}</Text>
        <View style={[styles.statusBadge, { backgroundColor: statusColors[status] + '22' }]}>
          <View style={[styles.statusDot, { backgroundColor: statusColors[status] }]} />
          <Text style={[styles.statusText, { color: statusColors[status] }]}>{statusLabels[status]}</Text>
        </View>
      </View>

      <View style={styles.campaignStats}>
        <View style={styles.campaignStat}>
          <Text style={styles.campaignStatVal}>{formatNumber(reach)}</Text>
          <Text style={styles.campaignStatLbl}>Alcance</Text>
        </View>
        <View style={styles.campaignStat}>
          <Text style={styles.campaignStatVal}>{ctr}</Text>
          <Text style={styles.campaignStatLbl}>CTR</Text>
        </View>
        <View style={styles.campaignStat}>
          <Text style={styles.campaignStatVal}>${spent.toFixed(0)}</Text>
          <Text style={styles.campaignStatLbl}>Gastado</Text>
        </View>
        <View style={styles.campaignStat}>
          <Text style={styles.campaignStatVal}>${budget.toFixed(0)}</Text>
          <Text style={styles.campaignStatLbl}>Budget</Text>
        </View>
      </View>

      <View style={styles.progressBarWrap}>
        <View style={styles.progressBar}>
          <LinearGradient
            colors={['#7C5CFF', '#FF2D78']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]}
          />
        </View>
        <Text style={styles.progressLabel}>{Math.round(progress * 100)}% del presupuesto</Text>
      </View>
    </Pressable>
  );
}

const MOCK_CAMPAIGNS = [
  { id: '1', title: 'Campaña BlockDAG Awareness', status: 'active' as const, budget: 200, spent: 142, reach: 48200, ctr: '4.2%' },
  { id: '2', title: 'Promocion Nuevo Reel #NFT', status: 'paused' as const, budget: 100, spent: 67, reach: 22100, ctr: '3.8%' },
  { id: '3', title: 'Sorteo $DAG Seguidores', status: 'ended' as const, budget: 50, spent: 50, reach: 15800, ctr: '6.1%' },
];

const AFFILIATE_PROGRAMS = [
  { id: '1', name: 'BlockDAG Official', commission: '15%', earnings: 124.50, status: 'active' },
  { id: '2', name: 'Crypto Exchange Partner', commission: '10%', earnings: 89.20, status: 'active' },
  { id: '3', name: 'NFT Marketplace', commission: '8%', earnings: 45.80, status: 'pending' },
];

export default function PromotionsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { videos } = useFeed();
  const { showAlert } = useAlert();

  const [activeTab, setActiveTab] = useState<PromoTab>('overview');

  const myVideos = videos.filter(v => v.userId === user?.id);
  const totalReach = myVideos.reduce((s, v) => s + (v.viewsCount || 0), 0);
  const totalLikes = myVideos.reduce((s, v) => s + (v.likes || 0), 0);
  const totalEarnings = totalLikes * 0.01;

  const TABS: { key: PromoTab; label: string; icon: string }[] = [
    { key: 'overview', label: 'Resumen', icon: 'view-dashboard-outline' },
    { key: 'campaigns', label: 'Campanas', icon: 'bullhorn-outline' },
    { key: 'analytics', label: 'Analiticas', icon: 'chart-line' },
    { key: 'affiliate', label: 'Afiliados', icon: 'link-variant' },
  ];

  const handleCreateCampaign = () => {
    showAlert(
      'Nueva Campana',
      'Selecciona el tipo de promocion',
      [
        { text: 'Promover un Post', onPress: () => showAlert('Proximamente', 'La gestion de campanas estara disponible pronto') },
        { text: 'Campana de Seguidores', onPress: () => showAlert('Proximamente', 'La gestion de campanas estara disponible pronto') },
        { text: 'Patrocinado', onPress: () => showAlert('Proximamente', 'La gestion de campanas estara disponible pronto') },
        { text: 'Cancelar', style: 'cancel' },
      ]
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={24} color={Colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Promociones</Text>
        <Pressable
          style={styles.createBtn}
          onPress={handleCreateCampaign}
        >
          <MaterialCommunityIcons name="plus" size={20} color={Colors.primary} />
        </Pressable>
      </View>

      {/* Tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsScroll}
        contentContainerStyle={styles.tabsContent}
      >
        {TABS.map(t => (
          <Pressable
            key={t.key}
            style={[styles.tab, activeTab === t.key && styles.tabActive]}
            onPress={() => setActiveTab(t.key)}
          >
            <MaterialCommunityIcons
              name={t.icon as any}
              size={14}
              color={activeTab === t.key ? '#fff' : Colors.textSubtle}
            />
            <Text style={[styles.tabLabel, activeTab === t.key && styles.tabLabelActive]}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: 80 + insets.bottom }]}
      >
        {activeTab === 'overview' ? (
          <>
            {/* Creator tier */}
            <LinearGradient
              colors={['rgba(124,92,255,0.15)', 'rgba(255,45,120,0.1)']}
              style={styles.tierCard}
            >
              <View style={styles.tierLeft}>
                <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={styles.tierIcon}>
                  <Text style={styles.tierEmoji}>⭐</Text>
                </LinearGradient>
                <View>
                  <Text style={styles.tierName}>Creador Explorer</Text>
                  <Text style={styles.tierDesc}>Sube de nivel con mas contenido y engagement</Text>
                </View>
              </View>
              <View style={styles.tierProgress}>
                <Text style={styles.tierProgressLabel}>Hacia Rising</Text>
                <View style={styles.tierProgressBar}>
                  <LinearGradient
                    colors={['#7C5CFF', '#FF2D78']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[styles.tierProgressFill, { width: '34%' }]}
                  />
                </View>
                <Text style={styles.tierProgressSub}>340 / 1000 $DAG</Text>
              </View>
            </LinearGradient>

            {/* Key metrics */}
            <View style={styles.metricsGrid}>
              <MetricCard icon="eye-outline" gradient={['#2D9EFF', '#7C5CFF']} label="Alcance Total" value={formatNumber(totalReach)} change="+12.4%" />
              <MetricCard icon="heart-outline" gradient={['#FF2D78', '#FF6FA8']} label="Total Likes" value={formatNumber(totalLikes)} change="+8.7%" />
              <MetricCard icon="currency-usd" gradient={['#00E5A0', '#2D9EFF']} label="$DAG Ganados" value={totalEarnings.toFixed(2)} suffix=" DAG" change="+8.7%" />
              <MetricCard icon="account-plus-outline" gradient={['#FFB800', '#FF6B00']} label="Seguidores" value={formatNumber(user?.followers || 0)} change="+5.2%" />
            </View>

            {/* Quick actions */}
            <Text style={styles.sectionTitle}>Herramientas de Creador</Text>
            <View style={styles.quickActionsGrid}>
              {[
                { icon: 'bullhorn-outline', gradient: ['#7C5CFF', '#FF2D78'], label: 'Crear Campana', onPress: handleCreateCampaign },
                { icon: 'link-variant', gradient: ['#2D9EFF', '#7C5CFF'], label: 'Programa de Afiliados', onPress: () => setActiveTab('affiliate') },
                { icon: 'storefront-outline', gradient: ['#00E5A0', '#2D9EFF'], label: 'Mi Tienda', onPress: () => router.push('/(tabs)/shop') },
                { icon: 'hand-coin-outline', gradient: ['#FFB800', '#FF6B00'], label: 'Donaciones', onPress: () => showAlert('Donaciones', `Has recibido donaciones de tus fans. Ve a tu billetera para ver el total.`) },
              ].map(a => (
                <Pressable key={a.label} style={styles.quickAction} onPress={a.onPress}>
                  <LinearGradient colors={a.gradient as [string, string, ...string[]]} style={styles.quickActionIcon}>
                    <MaterialCommunityIcons name={a.icon as any} size={22} color="#fff" />
                  </LinearGradient>
                  <Text style={styles.quickActionLabel}>{a.label}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : activeTab === 'campaigns' ? (
          <>
            {MOCK_CAMPAIGNS.map(c => (
              <CampaignCard
                key={c.id}
                {...c}
                onPress={() => showAlert(c.title, `Estado: ${c.status}\nAlcance: ${formatNumber(c.reach)}\nCTR: ${c.ctr}\nGastado: $${c.spent} de $${c.budget}`)}
              />
            ))}
            <Pressable style={styles.newCampaignBtn} onPress={handleCreateCampaign}>
              <LinearGradient
                colors={['rgba(124,92,255,0.12)', 'rgba(255,45,120,0.08)']}
                style={styles.newCampaignBtnInner}
              >
                <MaterialCommunityIcons name="plus-circle-outline" size={24} color={Colors.primary} />
                <Text style={styles.newCampaignBtnText}>Crear nueva campana</Text>
              </LinearGradient>
            </Pressable>
          </>
        ) : activeTab === 'analytics' ? (
          <>
            <View style={styles.analyticsCard}>
              <Text style={styles.analyticsCardTitle}>Rendimiento General (30 dias)</Text>
              <View style={styles.analyticsGrid}>
                {[
                  { label: 'Impresiones', value: formatNumber(totalReach * 3), icon: 'eye-outline', color: Colors.blue },
                  { label: 'Alcance', value: formatNumber(totalReach), icon: 'account-outline', color: Colors.primary },
                  { label: 'Engagement', value: `${((totalLikes / Math.max(1, totalReach)) * 100).toFixed(1)}%`, icon: 'heart-outline', color: Colors.secondary },
                  { label: 'Clicks', value: formatNumber(Math.round(totalReach * 0.02)), icon: 'cursor-default-click-outline', color: Colors.accent },
                  { label: 'Guardados', value: formatNumber(Math.round(totalLikes * 0.15)), icon: 'bookmark-outline', color: Colors.warning },
                  { label: 'Compartidos', value: formatNumber(Math.round(totalReach * 0.01)), icon: 'share-variant-outline', color: Colors.purple },
                ].map(m => (
                  <View key={m.label} style={styles.analyticsMetric}>
                    <MaterialCommunityIcons name={m.icon as any} size={20} color={m.color} />
                    <Text style={[styles.analyticsMetricVal, { color: m.color }]}>{m.value}</Text>
                    <Text style={styles.analyticsMetricLbl}>{m.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.analyticsCard}>
              <Text style={styles.analyticsCardTitle}>Top Contenido</Text>
              {myVideos.slice(0, 5).map((v, i) => (
                <View key={v.id} style={[styles.topContentRow, i === Math.min(4, myVideos.length - 1) && { borderBottomWidth: 0 }]}>
                  <Text style={styles.topContentRank}>#{i + 1}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.topContentCaption} numberOfLines={1}>
                      {v.caption || 'Sin descripcion'}
                    </Text>
                    <Text style={styles.topContentStats}>
                      {formatNumber(v.likes || 0)} likes · {formatNumber(v.viewsCount || 0)} vistas
                    </Text>
                  </View>
                  <Text style={styles.topContentDag}>{((v.likes || 0) * 0.01).toFixed(2)} $DAG</Text>
                </View>
              ))}
              {myVideos.length === 0 ? (
                <Text style={styles.emptyNote}>Sube contenido para ver estadisticas</Text>
              ) : null}
            </View>
          </>
        ) : (
          /* Affiliate */
          <>
            <LinearGradient
              colors={['rgba(45,158,255,0.12)', 'rgba(124,92,255,0.08)']}
              style={styles.affiliateBanner}
            >
              <MaterialCommunityIcons name="link-variant" size={28} color={Colors.blue} />
              <View style={{ flex: 1 }}>
                <Text style={styles.affiliateBannerTitle}>Programa de Afiliados</Text>
                <Text style={styles.affiliateBannerDesc}>Gana comisiones promoviendo productos y plataformas</Text>
              </View>
            </LinearGradient>

            <View style={styles.affiliateSummary}>
              <View style={styles.affiliateSummaryItem}>
                <Text style={styles.affiliateSummaryVal}>
                  ${AFFILIATE_PROGRAMS.reduce((s, p) => s + p.earnings, 0).toFixed(2)}
                </Text>
                <Text style={styles.affiliateSummaryLbl}>Total Ganado</Text>
              </View>
              <View style={styles.affiliateSummaryDivider} />
              <View style={styles.affiliateSummaryItem}>
                <Text style={styles.affiliateSummaryVal}>{AFFILIATE_PROGRAMS.filter(p => p.status === 'active').length}</Text>
                <Text style={styles.affiliateSummaryLbl}>Programas Activos</Text>
              </View>
              <View style={styles.affiliateSummaryDivider} />
              <View style={styles.affiliateSummaryItem}>
                <Text style={styles.affiliateSummaryVal}>-</Text>
                <Text style={styles.affiliateSummaryLbl}>Proxima liquidacion</Text>
              </View>
            </View>

            <Text style={styles.sectionTitle}>Mis Programas</Text>
            {AFFILIATE_PROGRAMS.map(p => (
              <View key={p.id} style={styles.affiliateCard}>
                <View style={styles.affiliateCardLeft}>
                  <LinearGradient
                    colors={p.status === 'active' ? ['#00E5A0', '#2D9EFF'] : ['#5A5A72', '#3D3D52']}
                    style={styles.affiliateCardIcon}
                  >
                    <MaterialCommunityIcons name="handshake-outline" size={18} color="#fff" />
                  </LinearGradient>
                  <View>
                    <Text style={styles.affiliateCardName}>{p.name}</Text>
                    <Text style={styles.affiliateCardComm}>Comision: {p.commission}</Text>
                  </View>
                </View>
                <View style={styles.affiliateCardRight}>
                  <Text style={styles.affiliateEarnings}>${p.earnings.toFixed(2)}</Text>
                  <View style={[
                    styles.affiliateStatus,
                    { backgroundColor: p.status === 'active' ? Colors.accent + '22' : Colors.textSubtle + '22' }
                  ]}>
                    <Text style={[
                      styles.affiliateStatusText,
                      { color: p.status === 'active' ? Colors.accent : Colors.textSubtle }
                    ]}>
                      {p.status === 'active' ? 'Activo' : 'Pendiente'}
                    </Text>
                  </View>
                </View>
              </View>
            ))}

            <Pressable
              style={styles.joinAffiliateBtn}
              onPress={() => showAlert('Programa de Afiliados', 'Para unirte a nuevos programas de afiliados, contacta a nuestro equipo en partnerships@clipdag.io')}
            >
              <LinearGradient
                colors={['rgba(45,158,255,0.12)', 'rgba(124,92,255,0.08)']}
                style={styles.joinAffiliateBtnInner}
              >
                <MaterialCommunityIcons name="plus-circle-outline" size={22} color={Colors.blue} />
                <Text style={styles.joinAffiliateBtnText}>Unirme a nuevos programas</Text>
              </LinearGradient>
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm,
  },
  headerTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.textPrimary, flex: 1, textAlign: 'center' },
  createBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },

  tabsScroll: { maxHeight: 46, marginBottom: Spacing.xs },
  tabsContent: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: 2 },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: Radius.full, backgroundColor: Colors.surfaceElevated,
    borderWidth: 1, borderColor: Colors.border,
  },
  tabActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabLabel: { color: Colors.textSubtle, fontSize: FontSize.xs, fontWeight: FontWeight.medium },
  tabLabelActive: { color: '#fff', fontWeight: FontWeight.semibold },

  scroll: { paddingHorizontal: Spacing.md, paddingTop: 4, gap: Spacing.md },
  sectionTitle: {
    fontSize: FontSize.xs, fontWeight: FontWeight.semibold,
    color: Colors.textSubtle, textTransform: 'uppercase', letterSpacing: 0.8,
  },

  // Tier
  tierCard: {
    borderRadius: Radius.xl, padding: Spacing.md,
    borderWidth: 1, borderColor: 'rgba(124,92,255,0.25)',
    gap: Spacing.md,
  },
  tierLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  tierIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  tierEmoji: { fontSize: 22 },
  tierName: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  tierDesc: { color: Colors.textSubtle, fontSize: FontSize.xs },
  tierProgress: { gap: 6 },
  tierProgressLabel: { color: Colors.textSubtle, fontSize: FontSize.xs },
  tierProgressBar: { height: 6, backgroundColor: Colors.border, borderRadius: 3, overflow: 'hidden' },
  tierProgressFill: { height: '100%', borderRadius: 3 },
  tierProgressSub: { color: Colors.primary, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },

  // Metrics
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  metricCard: {
    width: (SCREEN_W - Spacing.md * 2 - Spacing.sm) / 2,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.lg, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.border,
    gap: 4, alignItems: 'flex-start',
  },
  metricIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  metricValue: { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.bold },
  metricLabel: { color: Colors.textSubtle, fontSize: FontSize.xs },
  metricChange: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderRadius: Radius.full, paddingHorizontal: 6, paddingVertical: 2, marginTop: 2,
  },
  metricChangeText: { fontSize: 10, fontWeight: FontWeight.semibold },

  // Quick actions
  quickActionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  quickAction: {
    width: (SCREEN_W - Spacing.md * 2 - Spacing.md) / 2,
    alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.xl, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.border,
  },
  quickActionIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  quickActionLabel: { color: Colors.textSecondary, fontSize: FontSize.xs, fontWeight: FontWeight.medium, textAlign: 'center' },

  // Campaign
  campaignCard: {
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.xl,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.border, gap: Spacing.sm,
  },
  campaignHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  campaignTitle: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.semibold, flex: 1 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, fontWeight: FontWeight.semibold },
  campaignStats: { flexDirection: 'row', justifyContent: 'space-between' },
  campaignStat: { alignItems: 'center', gap: 2 },
  campaignStatVal: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  campaignStatLbl: { color: Colors.textSubtle, fontSize: 10 },
  progressBarWrap: { gap: 5 },
  progressBar: { height: 5, backgroundColor: Colors.border, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  progressLabel: { color: Colors.textSubtle, fontSize: 10 },
  newCampaignBtn: { borderRadius: Radius.xl, overflow: 'hidden', borderWidth: 1, borderStyle: 'dashed', borderColor: Colors.primary + '66' },
  newCampaignBtnInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, padding: Spacing.lg },
  newCampaignBtnText: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },

  // Analytics
  analyticsCard: {
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.xl,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.border, gap: Spacing.md,
  },
  analyticsCardTitle: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  analyticsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  analyticsMetric: {
    width: (SCREEN_W - Spacing.md * 4 - Spacing.md * 2) / 3,
    alignItems: 'center', gap: 4,
  },
  analyticsMetricVal: { fontSize: FontSize.md, fontWeight: FontWeight.bold },
  analyticsMetricLbl: { color: Colors.textSubtle, fontSize: 10, textAlign: 'center' },
  topContentRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle,
  },
  topContentRank: { color: Colors.textSubtle, fontSize: FontSize.sm, width: 24 },
  topContentCaption: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  topContentStats: { color: Colors.textSubtle, fontSize: FontSize.xs },
  topContentDag: { color: Colors.primary, fontSize: FontSize.xs, fontWeight: FontWeight.bold },
  emptyNote: { color: Colors.textSubtle, fontSize: FontSize.sm, textAlign: 'center', paddingVertical: Spacing.md },

  // Affiliate
  affiliateBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    padding: Spacing.md, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: 'rgba(45,158,255,0.25)',
  },
  affiliateBannerTitle: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  affiliateBannerDesc: { color: Colors.textSubtle, fontSize: FontSize.xs, marginTop: 2 },
  affiliateSummary: {
    flexDirection: 'row', backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.xl, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.border,
  },
  affiliateSummaryItem: { flex: 1, alignItems: 'center', gap: 3 },
  affiliateSummaryVal: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  affiliateSummaryLbl: { color: Colors.textSubtle, fontSize: 10, textAlign: 'center' },
  affiliateSummaryDivider: { width: 1, backgroundColor: Colors.border, marginHorizontal: 8 },
  affiliateCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.lg,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.border,
  },
  affiliateCardLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  affiliateCardIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  affiliateCardName: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  affiliateCardComm: { color: Colors.textSubtle, fontSize: FontSize.xs },
  affiliateCardRight: { alignItems: 'flex-end', gap: 5 },
  affiliateEarnings: { color: Colors.accent, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  affiliateStatus: { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  affiliateStatusText: { fontSize: 10, fontWeight: FontWeight.semibold },
  joinAffiliateBtn: { borderRadius: Radius.xl, overflow: 'hidden', borderWidth: 1, borderStyle: 'dashed', borderColor: Colors.blue + '66' },
  joinAffiliateBtnInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, padding: Spacing.lg },
  joinAffiliateBtnText: { color: Colors.blue, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
});
