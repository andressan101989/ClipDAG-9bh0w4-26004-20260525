import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView, Switch,
  ActivityIndicator, FlatList, Modal,
} from 'react-native';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { useAlert } from '@/template';
import { getSupabaseClient } from '@/template';
import { Avatar } from '@/components/ui/Avatar';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';

interface BlockedUser {
  id: string;
  blocked_id: string;
  profile: { username: string; avatar_url: string };
}

interface FollowRequest {
  id: string;
  requester_id: string;
  profile: { username: string; avatar_url: string };
}

type AudienceKey = 'everyone' | 'followers' | 'nobody';
const AUDIENCE: { key: AudienceKey; label: string; desc: string }[] = [
  { key: 'everyone', label: 'Todos', desc: 'Cualquier persona puede realizar esta accion' },
  { key: 'followers', label: 'Seguidores', desc: 'Solo tus seguidores aprobados' },
  { key: 'nobody', label: 'Nadie', desc: 'Nadie puede realizar esta accion' },
];

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

function ToggleRow({
  icon, gradient, label, sublabel, value, onToggle, last,
}: {
  icon: string; gradient: string[]; label: string; sublabel?: string;
  value: boolean; onToggle: (v: boolean) => void; last?: boolean;
}) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <LinearGradient colors={gradient as [string, string, ...string[]]} style={styles.rowIcon}>
        <MaterialCommunityIcons name={icon as any} size={17} color="#fff" />
      </LinearGradient>
      <View style={styles.rowMeta}>
        <Text style={styles.rowLabel}>{label}</Text>
        {sublabel ? <Text style={styles.rowSub}>{sublabel}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: Colors.border, true: Colors.primary + '88' }}
        thumbColor={value ? Colors.primary : Colors.textSubtle}
      />
    </View>
  );
}

function SelectRow({
  icon, gradient, label, value, onPress, last,
}: {
  icon: string; gradient: string[]; label: string;
  value: string; onPress: () => void; last?: boolean;
}) {
  return (
    <Pressable style={[styles.row, last && styles.rowLast]} onPress={onPress}>
      <LinearGradient colors={gradient as [string, string, ...string[]]} style={styles.rowIcon}>
        <MaterialCommunityIcons name={icon as any} size={17} color="#fff" />
      </LinearGradient>
      <Text style={[styles.rowLabel, { flex: 1 }]}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
      <MaterialIcons name="chevron-right" size={18} color={Colors.textSubtle} />
    </Pressable>
  );
}

export default function PrivacySettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { showAlert } = useAlert();
  const supabase = getSupabaseClient();

  const [loading, setLoading] = useState(true);
  const [isPrivate, setIsPrivate] = useState(false);
  const [hideActivity, setHideActivity] = useState(false);
  const [allowComments, setAllowComments] = useState<AudienceKey>('everyone');
  const [allowMessages, setAllowMessages] = useState<AudienceKey>('everyone');
  const [allowDuet, setAllowDuet] = useState(true);
  const [allowDownload, setAllowDownload] = useState(true);
  const [allowMentions, setAllowMentions] = useState(true);
  const [allowTagging, setAllowTagging] = useState(true);

  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [blockedModal, setBlockedModal] = useState(false);
  const [loadingBlocked, setLoadingBlocked] = useState(false);

  const [followRequests, setFollowRequests] = useState<FollowRequest[]>([]);
  const [requestsModal, setRequestsModal] = useState(false);
  const [loadingRequests, setLoadingRequests] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('user_profiles')
        .select('is_private, hide_activity, allow_comments_from, allow_messages_from')
        .eq('id', user.id)
        .single();
      if (data) {
        setIsPrivate(!!data.is_private);
        setHideActivity(!!data.hide_activity);
        setAllowComments((data.allow_comments_from as AudienceKey) || 'everyone');
        setAllowMessages((data.allow_messages_from as AudienceKey) || 'everyone');
      }
      setLoading(false);
    })();
  }, [user?.id]);

  const save = useCallback(async (field: string, value: unknown) => {
    if (!user) return;
    await supabase.from('user_profiles').update({ [field]: value }).eq('id', user.id);
  }, [user, supabase]);

  const loadBlocked = useCallback(async () => {
    if (!user) return;
    setLoadingBlocked(true);
    const { data } = await supabase
      .from('blocked_users')
      .select('id, blocked_id, user_profiles!blocked_users_blocked_id_fkey(username, avatar_url)')
      .eq('blocker_id', user.id);
    if (data) {
      setBlockedUsers(data.map((r: any) => ({
        id: r.id,
        blocked_id: r.blocked_id,
        profile: r.user_profiles || { username: 'Unknown', avatar_url: '' },
      })));
    }
    setLoadingBlocked(false);
  }, [user, supabase]);

  const handleUnblock = useCallback(async (blockedId: string) => {
    if (!user) return;
    await supabase.from('blocked_users').delete().eq('blocker_id', user.id).eq('blocked_id', blockedId);
    setBlockedUsers(prev => prev.filter(b => b.blocked_id !== blockedId));
    showAlert('Desbloqueado', 'El usuario fue desbloqueado exitosamente');
  }, [user, supabase, showAlert]);

  const loadRequests = useCallback(async () => {
    if (!user) return;
    setLoadingRequests(true);
    const { data } = await supabase
      .from('follow_requests')
      .select('id, requester_id, user_profiles!follow_requests_requester_id_fkey(username, avatar_url)')
      .eq('target_id', user.id)
      .eq('status', 'pending');
    if (data) {
      setFollowRequests(data.map((r: any) => ({
        id: r.id,
        requester_id: r.requester_id,
        profile: r.user_profiles || { username: 'Unknown', avatar_url: '' },
      })));
    }
    setLoadingRequests(false);
  }, [user, supabase]);

  const handleAccept = useCallback(async (reqId: string, requesterId: string) => {
    if (!user) return;
    await supabase.from('follow_requests').update({ status: 'accepted' }).eq('id', reqId);
    await supabase.from('follows').insert({ follower_id: requesterId, following_id: user.id });
    setFollowRequests(prev => prev.filter(r => r.id !== reqId));
  }, [user, supabase]);

  const handleReject = useCallback(async (reqId: string) => {
    await supabase.from('follow_requests').update({ status: 'rejected' }).eq('id', reqId);
    setFollowRequests(prev => prev.filter(r => r.id !== reqId));
  }, [supabase]);

  const showAudiencePicker = useCallback((
    title: string,
    current: AudienceKey,
    onSelect: (k: AudienceKey) => void,
    dbField: string
  ) => {
    showAlert(title, 'Selecciona quien puede realizar esta accion', [
      ...AUDIENCE.map(a => ({
        text: `${a.label} — ${a.desc}`,
        onPress: async () => {
          onSelect(a.key);
          await save(dbField, a.key);
        },
      })),
      { text: 'Cancelar', style: 'cancel' as const },
    ]);
  }, [showAlert, save]);

  if (loading) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <StatusBar style="light" />
        <ActivityIndicator color={Colors.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={24} color={Colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Privacidad</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: 60 + insets.bottom }]}
      >
        {/* Account visibility */}
        <SectionHeader title="Visibilidad de la Cuenta" />
        <View style={styles.card}>
          <ToggleRow
            icon="lock-outline"
            gradient={['#7C5CFF', '#B44FFF']}
            label="Cuenta privada"
            sublabel={isPrivate ? 'Solo seguidores aprobados pueden ver tu contenido' : 'Cualquier persona puede seguirte y ver tu contenido'}
            value={isPrivate}
            onToggle={async (v) => { setIsPrivate(v); await save('is_private', v); showAlert(v ? 'Cuenta privada' : 'Cuenta publica', v ? 'Aprobaras manualmente cada solicitud de seguimiento' : 'Cualquiera puede seguirte'); }}
          />
          <ToggleRow
            icon="eye-off-outline"
            gradient={['#2D9EFF', '#7C5CFF']}
            label="Ocultar estado de actividad"
            sublabel="Otros usuarios no verán cuando estás activo"
            value={hideActivity}
            onToggle={async (v) => { setHideActivity(v); await save('hide_activity', v); }}
            last
          />
        </View>

        {/* Who can */}
        <SectionHeader title="Control de Interacciones" />
        <View style={styles.card}>
          <SelectRow
            icon="comment-outline"
            gradient={['#00E5A0', '#2D9EFF']}
            label="Quien puede comentar"
            value={AUDIENCE.find(a => a.key === allowComments)?.label || 'Todos'}
            onPress={() => showAudiencePicker('Quien puede comentar', allowComments, setAllowComments, 'allow_comments_from')}
          />
          <SelectRow
            icon="message-outline"
            gradient={['#FF2D78', '#FF6FA8']}
            label="Quien puede enviarte mensajes"
            value={AUDIENCE.find(a => a.key === allowMessages)?.label || 'Todos'}
            onPress={() => showAudiencePicker('Quien puede escribirte', allowMessages, setAllowMessages, 'allow_messages_from')}
          />
          <ToggleRow
            icon="at"
            gradient={['#FFB800', '#FF6B00']}
            label="Permitir menciones"
            sublabel="Otros pueden mencionarte en comentarios y posts"
            value={allowMentions}
            onToggle={setAllowMentions}
          />
          <ToggleRow
            icon="tag-outline"
            gradient={['#B44FFF', '#7C5CFF']}
            label="Permitir etiquetado"
            sublabel="Otros pueden etiquetarte en sus publicaciones"
            value={allowTagging}
            onToggle={setAllowTagging}
          />
          <ToggleRow
            icon="content-copy"
            gradient={['#00E5A0', '#2D9EFF']}
            label="Permitir Duet/Remix"
            sublabel="Otros creadores pueden usar tu contenido"
            value={allowDuet}
            onToggle={setAllowDuet}
          />
          <ToggleRow
            icon="download-outline"
            gradient={['#5A5A72', '#3D3D52']}
            label="Permitir descargar videos"
            sublabel="Otros pueden descargar tus publicaciones"
            value={allowDownload}
            onToggle={setAllowDownload}
            last
          />
        </View>

        {/* Follow management */}
        {isPrivate ? (
          <>
            <SectionHeader title="Solicitudes de Seguimiento" />
            <View style={styles.card}>
              <Pressable
                style={[styles.row, styles.rowLast]}
                onPress={() => { loadRequests(); setRequestsModal(true); }}
              >
                <LinearGradient colors={['#FFB800', '#FF6B00']} style={styles.rowIcon}>
                  <MaterialCommunityIcons name="account-clock-outline" size={17} color="#fff" />
                </LinearGradient>
                <Text style={[styles.rowLabel, { flex: 1 }]}>Solicitudes pendientes</Text>
                {followRequests.length > 0 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{followRequests.length}</Text>
                  </View>
                ) : null}
                <MaterialIcons name="chevron-right" size={18} color={Colors.textSubtle} />
              </Pressable>
            </View>
          </>
        ) : null}

        {/* Blocked users */}
        <SectionHeader title="Usuarios Bloqueados" />
        <View style={styles.card}>
          <Pressable
            style={[styles.row, styles.rowLast]}
            onPress={() => { loadBlocked(); setBlockedModal(true); }}
          >
            <LinearGradient colors={['#FF3B5C', '#FF6FA8']} style={styles.rowIcon}>
              <MaterialCommunityIcons name="account-cancel-outline" size={17} color="#fff" />
            </LinearGradient>
            <View style={styles.rowMeta}>
              <Text style={styles.rowLabel}>Usuarios bloqueados</Text>
              <Text style={styles.rowSub}>Ver y gestionar tu lista de bloqueados</Text>
            </View>
            <MaterialIcons name="chevron-right" size={18} color={Colors.textSubtle} />
          </Pressable>
        </View>

        {/* Data and ads */}
        <SectionHeader title="Datos y Publicidad" />
        <View style={styles.card}>
          <Pressable style={[styles.row]} onPress={() => showAlert('Datos de anuncios', 'ClipDAG no vende tus datos personales a terceros. Usamos datos anonimizados para mejorar la plataforma.')}>
            <LinearGradient colors={['#2D9EFF', '#7C5CFF']} style={styles.rowIcon}>
              <MaterialCommunityIcons name="chart-bar" size={17} color="#fff" />
            </LinearGradient>
            <Text style={[styles.rowLabel, { flex: 1 }]}>Politica de datos y anuncios</Text>
            <MaterialIcons name="chevron-right" size={18} color={Colors.textSubtle} />
          </Pressable>
          <Pressable style={[styles.row, styles.rowLast]} onPress={() => showAlert('Historial de actividad', 'Puedes solicitar la eliminacion de tu historial de actividad en cualquier momento desde ajustes de cuenta.')}>
            <LinearGradient colors={['#FFB800', '#FF6B00']} style={styles.rowIcon}>
              <MaterialCommunityIcons name="history" size={17} color="#fff" />
            </LinearGradient>
            <Text style={[styles.rowLabel, { flex: 1 }]}>Historial de actividad</Text>
            <MaterialIcons name="chevron-right" size={18} color={Colors.textSubtle} />
          </Pressable>
        </View>
      </ScrollView>

      {/* Blocked users modal */}
      <Modal visible={blockedModal} transparent animationType="slide" presentationStyle="overFullScreen">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Usuarios bloqueados</Text>
            {loadingBlocked ? (
              <ActivityIndicator color={Colors.primary} style={{ marginVertical: 24 }} />
            ) : blockedUsers.length === 0 ? (
              <View style={styles.emptyState}>
                <MaterialCommunityIcons name="account-check-outline" size={44} color={Colors.textSubtle} />
                <Text style={styles.emptyText}>No tienes usuarios bloqueados</Text>
              </View>
            ) : (
              <FlatList
                data={blockedUsers}
                keyExtractor={item => item.id}
                style={{ maxHeight: 360 }}
                renderItem={({ item }) => (
                  <View style={styles.userRow}>
                    <Avatar uri={item.profile.avatar_url} username={item.profile.username} size={40} />
                    <Text style={[styles.rowLabel, { flex: 1 }]}>@{item.profile.username}</Text>
                    <Pressable style={styles.unblockBtn} onPress={() => handleUnblock(item.blocked_id)}>
                      <Text style={styles.unblockText}>Desbloquear</Text>
                    </Pressable>
                  </View>
                )}
              />
            )}
            <Pressable style={styles.modalClose} onPress={() => setBlockedModal(false)}>
              <Text style={styles.modalCloseText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Follow requests modal */}
      <Modal visible={requestsModal} transparent animationType="slide" presentationStyle="overFullScreen">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Solicitudes pendientes</Text>
            {loadingRequests ? (
              <ActivityIndicator color={Colors.primary} style={{ marginVertical: 24 }} />
            ) : followRequests.length === 0 ? (
              <View style={styles.emptyState}>
                <MaterialCommunityIcons name="account-clock-outline" size={44} color={Colors.textSubtle} />
                <Text style={styles.emptyText}>No tienes solicitudes pendientes</Text>
              </View>
            ) : (
              <FlatList
                data={followRequests}
                keyExtractor={item => item.id}
                style={{ maxHeight: 360 }}
                renderItem={({ item }) => (
                  <View style={styles.userRow}>
                    <Avatar uri={item.profile.avatar_url} username={item.profile.username} size={40} />
                    <Text style={[styles.rowLabel, { flex: 1 }]}>@{item.profile.username}</Text>
                    <View style={styles.reqBtns}>
                      <Pressable style={styles.acceptBtn} onPress={() => handleAccept(item.id, item.requester_id)}>
                        <MaterialIcons name="check" size={16} color="#fff" />
                      </Pressable>
                      <Pressable style={styles.rejectBtn} onPress={() => handleReject(item.id)}>
                        <MaterialIcons name="close" size={16} color={Colors.textSubtle} />
                      </Pressable>
                    </View>
                  </View>
                )}
              />
            )}
            <Pressable style={styles.modalClose} onPress={() => setRequestsModal(false)}>
              <Text style={styles.modalCloseText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  centered: { alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm,
  },
  headerTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.textPrimary, flex: 1, textAlign: 'center' },
  scroll: { paddingHorizontal: Spacing.md, paddingTop: 4, gap: Spacing.sm },
  sectionTitle: {
    fontSize: FontSize.xs, fontWeight: FontWeight.semibold,
    color: Colors.textSubtle, textTransform: 'uppercase',
    letterSpacing: 0.8, marginLeft: 4, marginTop: Spacing.sm,
  },
  card: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.md, paddingVertical: 13,
    borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle,
  },
  rowLast: { borderBottomWidth: 0 },
  rowIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowMeta: { flex: 1, gap: 1 },
  rowLabel: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  rowSub: { color: Colors.textSubtle, fontSize: FontSize.xs },
  rowValue: { color: Colors.textSubtle, fontSize: FontSize.sm, marginRight: 4 },
  badge: {
    backgroundColor: Colors.primary, borderRadius: Radius.full,
    minWidth: 22, height: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: FontWeight.bold },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: Colors.surfaceElevated,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: Spacing.lg, gap: Spacing.md,
  },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center' },
  modalTitle: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold, textAlign: 'center' },
  emptyState: { alignItems: 'center', paddingVertical: Spacing.xl, gap: Spacing.sm },
  emptyText: { color: Colors.textSubtle, fontSize: FontSize.sm },
  userRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle,
  },
  unblockBtn: {
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.full,
    paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: Colors.border,
  },
  unblockText: { color: Colors.textSecondary, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  reqBtns: { flexDirection: 'row', gap: 8 },
  acceptBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  rejectBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },
  modalClose: { alignItems: 'center', paddingVertical: 13, backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border },
  modalCloseText: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
});
