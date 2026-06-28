import React, { useCallback, useContext, useEffect, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, FlatList,
  ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthContext } from '@/contexts/AuthContext';
import { getSupabaseClient } from '@/template';
import { Avatar } from '@/components/ui/Avatar';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';

// ── Types ─────────────────────────────────────────────────────────────────────

type ReportStatus = 'pending' | 'reviewed' | 'dismissed';
type ContentType  = 'video' | 'comment' | 'user';
type FilterTab    = 'all' | ReportStatus;

interface Report {
  id:                    string;
  reporter_user_id:      string;
  reported_content_id:   string;
  reported_content_type: ContentType;
  reason:                string;
  details:               string | null;
  status:                ReportStatus;
  created_at:            string;
  reporter_username?:    string;
  reporter_avatar?:      string;
  content_thumbnail?:    string | null;
  content_text?:         string | null;
  content_username?:     string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const REASON_LABELS: Record<string, string> = {
  spam:            'Spam',
  inappropriate:   'Contenido inapropiado',
  harassment:      'Acoso',
  violence:        'Violencia',
  hate_speech:     'Discurso de odio',
  misinformation:  'Desinformación',
  other:           'Otro',
};

const STATUS_LABELS: Record<ReportStatus, string> = {
  pending:   'Pendiente',
  reviewed:  'Revisado',
  dismissed: 'Desestimado',
};

const STATUS_COLORS: Record<ReportStatus, string> = {
  pending:   Colors.warning,
  reviewed:  Colors.accent,
  dismissed: Colors.textSubtle,
};

const TYPE_LABELS: Record<ContentType, string> = {
  video:   'Video',
  comment: 'Comentario',
  user:    'Usuario',
};

const TYPE_ICONS: Record<ContentType, string> = {
  video:   'video-outline',
  comment: 'comment-outline',
  user:    'account-outline',
};

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'all',       label: 'Todos'        },
  { key: 'pending',   label: 'Pendientes'   },
  { key: 'reviewed',  label: 'Revisados'    },
  { key: 'dismissed', label: 'Desestimados' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Report Card ───────────────────────────────────────────────────────────────

function ReportCard({
  report,
  onReview,
  onDismiss,
  onDelete,
  actionLoading,
}: {
  report:        Report;
  onReview:      (id: string) => void;
  onDismiss:     (id: string) => void;
  onDelete:      (id: string, type: ContentType, contentId: string) => void;
  actionLoading: string | null;
}) {
  const isPending = report.status === 'pending';
  const isLoading = actionLoading === report.id;

  return (
    <View style={styles.card}>
      {/* Reporter row */}
      <View style={styles.cardHeader}>
        <Avatar
          uri={report.reporter_avatar || ''}
          username={report.reporter_username || '?'}
          size={32}
        />
        <View style={styles.cardHeaderMeta}>
          <Text style={styles.reporterName}>
            @{report.reporter_username || 'Desconocido'}
          </Text>
          <Text style={styles.reportDate}>{formatDate(report.created_at)}</Text>
        </View>
        {/* Status badge */}
        <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[report.status] + '22' }]}>
          <Text style={[styles.statusText, { color: STATUS_COLORS[report.status] }]}>
            {STATUS_LABELS[report.status]}
          </Text>
        </View>
      </View>

      {/* Content type + reason */}
      <View style={styles.tagsRow}>
        <View style={styles.tag}>
          <MaterialCommunityIcons
            name={TYPE_ICONS[report.reported_content_type] as any}
            size={12}
            color={Colors.primary}
          />
          <Text style={styles.tagText}>{TYPE_LABELS[report.reported_content_type]}</Text>
        </View>
        <View style={[styles.tag, { backgroundColor: Colors.error + '18' }]}>
          <Text style={[styles.tagText, { color: Colors.error }]}>
            {REASON_LABELS[report.reason] ?? report.reason}
          </Text>
        </View>
      </View>

      {/* Details note */}
      {report.details ? (
        <Text style={styles.details} numberOfLines={2}>{report.details}</Text>
      ) : null}

      {/* Content preview */}
      <View style={styles.previewBox}>
        {report.reported_content_type === 'video' && report.content_thumbnail ? (
          <View style={styles.previewVideoRow}>
            <Image
              source={{ uri: report.content_thumbnail }}
              style={styles.previewThumb}
              contentFit="cover"
            />
            {report.content_text ? (
              <Text style={styles.previewCaption} numberOfLines={2}>
                {report.content_text}
              </Text>
            ) : null}
          </View>
        ) : report.reported_content_type === 'comment' && report.content_text ? (
          <Text style={styles.previewText} numberOfLines={3}>
            "{report.content_text}"
          </Text>
        ) : report.reported_content_type === 'user' && report.content_username ? (
          <Text style={styles.previewText}>
            Usuario: @{report.content_username}
          </Text>
        ) : (
          <Text style={styles.previewMissing}>
            Contenido ID: {report.reported_content_id.slice(0, 16)}…
          </Text>
        )}
      </View>

      {/* Action buttons — only for pending reports */}
      {isPending ? (
        <View style={styles.actions}>
          {isLoading ? (
            <ActivityIndicator size="small" color={Colors.primary} style={{ flex: 1 }} />
          ) : (
            <>
              <Pressable
                style={[styles.actionBtn, styles.actionReview]}
                onPress={() => onReview(report.id)}
              >
                <MaterialCommunityIcons name="check-circle-outline" size={14} color={Colors.accent} />
                <Text style={[styles.actionBtnText, { color: Colors.accent }]}>Revisar</Text>
              </Pressable>

              <Pressable
                style={[styles.actionBtn, styles.actionDismiss]}
                onPress={() => onDismiss(report.id)}
              >
                <MaterialCommunityIcons name="close-circle-outline" size={14} color={Colors.textSubtle} />
                <Text style={[styles.actionBtnText, { color: Colors.textSubtle }]}>Desestimar</Text>
              </Pressable>

              {report.reported_content_type !== 'user' ? (
                <Pressable
                  style={[styles.actionBtn, styles.actionDelete]}
                  onPress={() => onDelete(report.id, report.reported_content_type, report.reported_content_id)}
                >
                  <MaterialCommunityIcons name="delete-outline" size={14} color={Colors.error} />
                  <Text style={[styles.actionBtnText, { color: Colors.error }]}>Eliminar</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

// ── Admin Panel Screen ────────────────────────────────────────────────────────

export default function AdminPanelScreen() {
  const router   = useRouter();
  const insets   = useSafeAreaInsets();
  const authCtx  = useContext(AuthContext);
  const user     = authCtx?.user;
  const isAuthReady = authCtx?.isAuthReady ?? false;

  const [reports,       setReports]       = useState<Report[]>([]);
  const [filter,        setFilter]        = useState<FilterTab>('pending');
  const [loading,       setLoading]       = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [counts,        setCounts]        = useState<Record<FilterTab, number>>({
    all: 0, pending: 0, reviewed: 0, dismissed: 0,
  });

  // ── Access guard ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthReady) return;
    if (!user?.isAdmin) {
      router.replace('/(tabs)');
    }
  }, [isAuthReady, user?.isAdmin]);

  // ── Load reports ────────────────────────────────────────────────────────────
  const loadReports = useCallback(async () => {
    if (!user?.isAdmin) return;
    setLoading(true);
    try {
      const supabase = getSupabaseClient();

      // 1. Fetch all reports
      const { data: rawReports, error } = await supabase
        .from('reports')
        .select('*')
        .order('created_at', { ascending: false });

      if (error || !rawReports) {
        console.warn('[Admin] failed to load reports:', error?.message);
        setLoading(false);
        return;
      }

      // 2. Update counts
      const newCounts = { all: rawReports.length, pending: 0, reviewed: 0, dismissed: 0 };
      for (const r of rawReports) {
        if (r.status in newCounts) newCounts[r.status as ReportStatus]++;
      }
      setCounts(newCounts);

      // 3. Batch-load reporter profiles
      const reporterIds = [...new Set(rawReports.map((r: any) => r.reporter_user_id))];
      const { data: reporters } = reporterIds.length
        ? await supabase.from('user_profiles').select('id, username, avatar_url').in('id', reporterIds)
        : { data: [] };
      const reporterMap: Record<string, { username: string; avatar_url: string }> =
        Object.fromEntries((reporters ?? []).map((p: any) => [p.id, p]));

      // 4. Batch-load video previews
      const videoIds = rawReports.filter((r: any) => r.reported_content_type === 'video').map((r: any) => r.reported_content_id);
      const { data: videos } = videoIds.length
        ? await supabase.from('videos').select('id, thumbnail_url, caption').in('id', videoIds)
        : { data: [] };
      const videoMap: Record<string, { thumbnail_url: string; caption: string }> =
        Object.fromEntries((videos ?? []).map((v: any) => [v.id, v]));

      // 5. Batch-load comment texts
      const commentIds = rawReports.filter((r: any) => r.reported_content_type === 'comment').map((r: any) => r.reported_content_id);
      const { data: comments } = commentIds.length
        ? await supabase.from('comments').select('id, text').in('id', commentIds)
        : { data: [] };
      const commentMap: Record<string, { text: string }> =
        Object.fromEntries((comments ?? []).map((c: any) => [c.id, c]));

      // 6. Batch-load reported user profiles
      const reportedUserIds = rawReports.filter((r: any) => r.reported_content_type === 'user').map((r: any) => r.reported_content_id);
      const { data: reportedUsers } = reportedUserIds.length
        ? await supabase.from('user_profiles').select('id, username').in('id', reportedUserIds)
        : { data: [] };
      const reportedUserMap: Record<string, { username: string }> =
        Object.fromEntries((reportedUsers ?? []).map((u: any) => [u.id, u]));

      // 7. Merge everything
      const merged: Report[] = rawReports.map((r: any) => ({
        ...r,
        reporter_username: reporterMap[r.reporter_user_id]?.username,
        reporter_avatar:   reporterMap[r.reporter_user_id]?.avatar_url,
        content_thumbnail: videoMap[r.reported_content_id]?.thumbnail_url ?? null,
        content_text:
          r.reported_content_type === 'video'
            ? videoMap[r.reported_content_id]?.caption ?? null
            : commentMap[r.reported_content_id]?.text ?? null,
        content_username: reportedUserMap[r.reported_content_id]?.username ?? null,
      }));

      setReports(merged);
    } catch (e: any) {
      console.warn('[Admin] loadReports error:', e?.message);
    }
    setLoading(false);
  }, [user?.isAdmin]);

  useEffect(() => {
    if (user?.isAdmin) loadReports();
  }, [user?.isAdmin]);

  // ── Actions ─────────────────────────────────────────────────────────────────

  const updateStatus = useCallback(async (reportId: string, status: ReportStatus) => {
    setActionLoading(reportId);
    try {
      const supabase = getSupabaseClient();
      await supabase.from('reports').update({ status }).eq('id', reportId);
      setReports(prev => prev.map(r => r.id === reportId ? { ...r, status } : r));
      setCounts(prev => {
        const old = reports.find(r => r.id === reportId)?.status;
        if (!old || old === status) return prev;
        return {
          ...prev,
          [old]:   Math.max(0, prev[old] - 1),
          [status]: prev[status] + 1,
        };
      });
    } catch (e: any) {
      Alert.alert('Error', 'No se pudo actualizar el reporte');
    }
    setActionLoading(null);
  }, [reports]);

  const handleDelete = useCallback((reportId: string, type: ContentType, contentId: string) => {
    const typeLabel = TYPE_LABELS[type].toLowerCase();
    Alert.alert(
      'Eliminar contenido',
      `¿Confirmas que quieres eliminar este ${typeLabel}? Esta acción es irreversible.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            setActionLoading(reportId);
            try {
              const supabase = getSupabaseClient();
              const table = type === 'video' ? 'videos' : 'comments';
              const { error } = await supabase.from(table).delete().eq('id', contentId);
              if (error) throw error;
              // Mark report as reviewed after deletion
              await supabase.from('reports').update({ status: 'reviewed' }).eq('id', reportId);
              setReports(prev => prev.map(r =>
                r.id === reportId ? { ...r, status: 'reviewed', content_thumbnail: null, content_text: null } : r
              ));
            } catch (e: any) {
              Alert.alert('Error', `No se pudo eliminar el contenido: ${e?.message}`);
            }
            setActionLoading(null);
          },
        },
      ],
    );
  }, []);

  // ── Filtered list ───────────────────────────────────────────────────────────
  const filtered = filter === 'all' ? reports : reports.filter(r => r.status === filter);

  // ── Render ───────────────────────────────────────────────────────────────────

  // Still loading auth — show nothing to avoid flash
  if (!isAuthReady || (isAuthReady && !user?.isAdmin)) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={10}>
          <MaterialIcons name="arrow-back" size={24} color={Colors.textPrimary} />
        </Pressable>
        <View>
          <Text style={styles.headerTitle}>Moderación</Text>
          <Text style={styles.headerSub}>{counts.pending} pendientes</Text>
        </View>
        <Pressable onPress={loadReports} hitSlop={10} style={styles.refreshBtn}>
          <MaterialCommunityIcons name="refresh" size={22} color={Colors.primary} />
        </Pressable>
      </View>

      {/* Filter tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterRow}
      >
        {FILTER_TABS.map(tab => {
          const active = filter === tab.key;
          return (
            <Pressable
              key={tab.key}
              style={[styles.filterChip, active && styles.filterChipActive]}
              onPress={() => setFilter(tab.key)}
            >
              <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                {tab.label}
              </Text>
              {counts[tab.key] > 0 ? (
                <View style={[styles.filterBadge, active && styles.filterBadgeActive]}>
                  <Text style={[styles.filterBadgeText, active && { color: Colors.primary }]}>
                    {counts[tab.key]}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Reports list */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Cargando reportes…</Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.centered}>
          <MaterialCommunityIcons name="shield-check-outline" size={48} color={Colors.textSubtle} />
          <Text style={styles.emptyTitle}>Sin reportes</Text>
          <Text style={styles.emptySubtitle}>
            {filter === 'pending' ? 'No hay reportes pendientes.' : 'No hay reportes en esta categoría.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={r => r.id}
          renderItem={({ item }) => (
            <ReportCard
              report={item}
              onReview={id => updateStatus(id, 'reviewed')}
              onDismiss={id => updateStatus(id, 'dismissed')}
              onDelete={handleDelete}
              actionLoading={actionLoading}
            />
          )}
          contentContainerStyle={{ padding: Spacing.md, paddingBottom: 40 + insets.bottom }}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
        />
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn:    { padding: Spacing.xs },
  refreshBtn: { padding: Spacing.xs },
  headerTitle: {
    color: Colors.textPrimary,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    textAlign: 'center',
  },
  headerSub: {
    color: Colors.warning,
    fontSize: FontSize.xs,
    textAlign: 'center',
  },

  // Filter
  filterScroll: { maxHeight: 48, flexGrow: 0 },
  filterRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterChipActive: {
    backgroundColor: Colors.primaryDim,
    borderColor: Colors.primary,
  },
  filterChipText: {
    color: Colors.textSubtle,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium,
  },
  filterChipTextActive: { color: Colors.primary },
  filterBadge: {
    backgroundColor: Colors.surfaceHighlight,
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
    minWidth: 18,
    alignItems: 'center',
  },
  filterBadgeActive: { backgroundColor: Colors.primary + '33' },
  filterBadgeText: {
    color: Colors.textSubtle,
    fontSize: 10,
    fontWeight: FontWeight.bold,
  },

  // Report card
  card: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  cardHeaderMeta: { flex: 1 },
  reporterName: {
    color: Colors.textPrimary,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  reportDate: {
    color: Colors.textSubtle,
    fontSize: FontSize.xs,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.sm,
  },
  statusText: {
    fontSize: 11,
    fontWeight: FontWeight.semibold,
  },

  // Tags
  tagsRow: { flexDirection: 'row', gap: Spacing.xs, flexWrap: 'wrap' },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primaryDim,
    borderRadius: Radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tagText: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: FontWeight.medium,
  },

  // Details
  details: {
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
    fontStyle: 'italic',
    lineHeight: 16,
  },

  // Content preview
  previewBox: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
  },
  previewVideoRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
  },
  previewThumb: {
    width: 56,
    height: 80,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceHighlight,
  },
  previewCaption: {
    flex: 1,
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
    lineHeight: 16,
  },
  previewText: {
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
    lineHeight: 18,
  },
  previewMissing: {
    color: Colors.textSubtle,
    fontSize: FontSize.xs,
    fontStyle: 'italic',
  },

  // Actions
  actions: {
    flexDirection: 'row',
    gap: Spacing.xs,
    paddingTop: Spacing.xs,
    borderTopWidth: 1,
    borderTopColor: Colors.borderSubtle,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 7,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  actionBtnText: { fontSize: 12, fontWeight: FontWeight.semibold },
  actionReview:  { borderColor: Colors.accent,     backgroundColor: Colors.accent + '12' },
  actionDismiss: { borderColor: Colors.border,      backgroundColor: Colors.surface },
  actionDelete:  { borderColor: Colors.error,       backgroundColor: Colors.error  + '12' },

  // Empty / loading
  loadingText:   { color: Colors.textSubtle, fontSize: FontSize.sm },
  emptyTitle:    { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  emptySubtitle: { color: Colors.textSubtle, fontSize: FontSize.sm, textAlign: 'center' },
});
