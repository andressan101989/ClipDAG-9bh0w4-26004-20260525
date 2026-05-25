import React, { useState, useEffect } from 'react';
import {
  View, Text, Modal, Pressable, StyleSheet,
  ScrollView, ActivityIndicator, Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import type { VideoAnalytics } from '@/contexts/FeedContext';

const { height: H } = Dimensions.get('window');

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

interface StatRowProps {
  icon: string;
  label: string;
  value: string;
  color?: string;
  subValue?: string;
}

function StatRow({ icon, label, value, color = Colors.textPrimary, subValue }: StatRowProps) {
  return (
    <View style={styles.statRow}>
      <MaterialIcons name={icon as any} size={20} color={color} />
      <View style={styles.statRowContent}>
        <Text style={styles.statRowLabel}>{label}</Text>
        {subValue ? <Text style={styles.statRowSub}>{subValue}</Text> : null}
      </View>
      <Text style={[styles.statRowValue, { color }]}>{value}</Text>
    </View>
  );
}

interface AnalyticsSheetProps {
  visible: boolean;
  videoCaption: string;
  onClose: () => void;
  fetchAnalytics: () => Promise<VideoAnalytics>;
}

export function AnalyticsSheet({ visible, videoCaption, onClose, fetchAnalytics }: AnalyticsSheetProps) {
  const insets = useSafeAreaInsets();
  const [analytics, setAnalytics] = useState<VideoAnalytics | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (visible) {
      setIsLoading(true);
      fetchAnalytics().then(data => {
        setAnalytics(data);
        setIsLoading(false);
      });
    }
  }, [visible]);

  const engagementRate = analytics && analytics.views > 0
    ? Math.round(((analytics.likes + analytics.comments + analytics.saves) / analytics.views) * 100)
    : 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
        {/* Handle */}
        <View style={styles.handleWrap}>
          <View style={styles.handleBar} />
        </View>

        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Estadisticas</Text>
            <Text style={styles.sub} numberOfLines={1}>{videoCaption}</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={8}>
            <MaterialIcons name="close" size={22} color={Colors.textSecondary} />
          </Pressable>
        </View>

        {isLoading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={Colors.primary} size="large" />
            <Text style={styles.loadingText}>Cargando estadisticas...</Text>
          </View>
        ) : analytics ? (
          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: H * 0.6 }}>
            {/* Hero metrics */}
            <View style={styles.heroRow}>
              <LinearGradient colors={['rgba(0,212,255,0.15)', 'rgba(0,212,255,0.05)']} style={styles.heroCard}>
                <MaterialIcons name="visibility" size={22} color={Colors.primary} />
                <Text style={styles.heroValue}>{analytics.views.toLocaleString()}</Text>
                <Text style={styles.heroLabel}>Vistas totales</Text>
              </LinearGradient>
              <LinearGradient colors={['rgba(0,255,136,0.15)', 'rgba(0,255,136,0.05)']} style={styles.heroCard}>
                <Text style={styles.dagHeroIcon}>◈</Text>
                <Text style={[styles.heroValue, { color: Colors.accent }]}>
                  {analytics.dagEarned.toFixed(2)}
                </Text>
                <Text style={styles.heroLabel}>$DAG ganados</Text>
              </LinearGradient>
            </View>

            {/* Engagement rate bar */}
            <View style={styles.engagementCard}>
              <View style={styles.engagementHeader}>
                <Text style={styles.engagementTitle}>Tasa de Engagement</Text>
                <Text style={[styles.engagementPct, engagementRate > 5 ? styles.engagementHigh : null]}>
                  {engagementRate}%
                </Text>
              </View>
              <View style={styles.barBg}>
                <LinearGradient
                  colors={['#00D4FF', '#00FF88']}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={[styles.barFill, { width: `${Math.min(engagementRate, 100)}%` }]}
                />
              </View>
              <Text style={styles.engagementSub}>
                {engagementRate >= 10 ? 'Excelente' : engagementRate >= 5 ? 'Bueno' : engagementRate >= 2 ? 'Promedio' : 'Bajo'} engagement
              </Text>
            </View>

            {/* Detailed stats */}
            <View style={styles.statsBlock}>
              <Text style={styles.blockTitle}>Alcance</Text>
              <StatRow icon="people" label="Vistas unicas" value={analytics.uniqueViews.toLocaleString()} color={Colors.primary} />
              <StatRow icon="visibility" label="Impresiones totales" value={analytics.views.toLocaleString()} />
            </View>

            <View style={styles.statsBlock}>
              <Text style={styles.blockTitle}>Interacciones</Text>
              <StatRow icon="favorite" label="Likes" value={analytics.likes.toLocaleString()} color={Colors.secondary} />
              <StatRow icon="chat-bubble-outline" label="Comentarios" value={analytics.comments.toLocaleString()} color={Colors.primary} />
              <StatRow icon="share" label="Compartidos" value={analytics.shares.toLocaleString()} />
              <StatRow icon="bookmark" label="Guardados" value={analytics.saves.toLocaleString()} color="#8B5CF6" />
            </View>

            <View style={styles.statsBlock}>
              <Text style={styles.blockTitle}>Reproduccion</Text>
              <StatRow
                icon="timer"
                label="Tiempo promedio"
                value={formatMs(analytics.avgWatchMs)}
                color={Colors.primary}
                subValue="por vista"
              />
              <StatRow
                icon="done-all"
                label="Tasa de completado"
                value={`${analytics.completionRate}%`}
                color={analytics.completionRate >= 70 ? Colors.accent : Colors.warning}
              />
            </View>

            {/* Monetization */}
            <LinearGradient
              colors={['rgba(0,255,136,0.08)', 'rgba(0,212,255,0.06)']}
              style={styles.monetizeCard}
            >
              <View style={styles.monetizeRow}>
                <Text style={styles.monetizeIcon}>◈</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.monetizeTitle}>Ingresos por DAG</Text>
                  <Text style={styles.monetizeSub}>Cada like = 0.01 $DAG para ti</Text>
                </View>
                <Text style={styles.monetizeValue}>{analytics.dagEarned.toFixed(4)} $DAG</Text>
              </View>
            </LinearGradient>
          </ScrollView>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    backgroundColor: Colors.surfaceElevated,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: Spacing.lg, gap: Spacing.md,
  },
  handleWrap: { alignItems: 'center', marginBottom: -Spacing.xs },
  handleBar: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  title: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  sub: { color: Colors.textSecondary, fontSize: FontSize.xs, marginTop: 1 },
  loadingWrap: { alignItems: 'center', paddingVertical: Spacing.xxl, gap: Spacing.md },
  loadingText: { color: Colors.textSubtle, fontSize: FontSize.sm },
  heroRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm },
  heroCard: {
    flex: 1, alignItems: 'center', gap: 4,
    borderRadius: Radius.md, padding: Spacing.md,
    borderWidth: 1, borderColor: 'rgba(0,212,255,0.2)',
  },
  heroValue: { color: Colors.primary, fontSize: FontSize.xxl, fontWeight: FontWeight.bold },
  heroLabel: { color: Colors.textSecondary, fontSize: FontSize.xs, textAlign: 'center' },
  dagHeroIcon: { fontSize: 22, color: Colors.accent },
  engagementCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    padding: Spacing.md, gap: Spacing.sm, marginBottom: Spacing.sm,
    borderWidth: 1, borderColor: Colors.border,
  },
  engagementHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  engagementTitle: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  engagementPct: { color: Colors.primary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  engagementHigh: { color: Colors.accent },
  barBg: { height: 6, backgroundColor: Colors.border, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3 },
  engagementSub: { color: Colors.textSubtle, fontSize: FontSize.xs },
  statsBlock: {
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    padding: Spacing.md, gap: Spacing.sm, marginBottom: Spacing.sm,
    borderWidth: 1, borderColor: Colors.border,
  },
  blockTitle: { color: Colors.textSecondary, fontSize: FontSize.xs, fontWeight: FontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 4 },
  statRowContent: { flex: 1 },
  statRowLabel: { color: Colors.textPrimary, fontSize: FontSize.sm },
  statRowSub: { color: Colors.textSubtle, fontSize: FontSize.xs },
  statRowValue: { fontSize: FontSize.md, fontWeight: FontWeight.bold },
  monetizeCard: {
    borderRadius: Radius.md, padding: Spacing.md,
    borderWidth: 1, borderColor: 'rgba(0,255,136,0.2)',
  },
  monetizeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  monetizeIcon: { fontSize: 22, color: Colors.accent },
  monetizeTitle: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  monetizeSub: { color: Colors.textSubtle, fontSize: FontSize.xs },
  monetizeValue: { color: Colors.accent, fontSize: FontSize.md, fontWeight: FontWeight.bold },
});
