import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView, Switch,
  TextInput, Modal, FlatList, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useAuth } from '@/hooks/useAuth';
import { useAlert } from '@/template';
import { getSupabaseClient } from '@/template';
import { Avatar } from '@/components/ui/Avatar';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { useI18n, AVAILABLE_LANGUAGES, type Language } from '@/contexts/I18nContext';

interface BlockedUser {
  id: string;
  blocked_id: string;
  created_at: string;
  profile: { username: string; avatar_url: string };
}

interface FollowRequest {
  id: string;
  requester_id: string;
  created_at: string;
  profile: { username: string; avatar_url: string };
}

// ── Section component ──────────────────────────────────────────────────────────
function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

// ── Row component ──────────────────────────────────────────────────────────────
function SettingsRow({
  icon, iconColor = Colors.primary, label, sublabel, onPress, value, isToggle, toggleValue, onToggle, danger, last,
}: {
  icon: string; iconColor?: string; label: string; sublabel?: string;
  onPress?: () => void; value?: string; isToggle?: boolean;
  toggleValue?: boolean; onToggle?: (v: boolean) => void; danger?: boolean; last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, last && styles.rowLast, pressed && !isToggle && { opacity: 0.7 }]}
      disabled={isToggle && !onPress}
    >
      <View style={[styles.rowIconWrap, { backgroundColor: iconColor + '22' }]}>
        <MaterialCommunityIcons name={icon as any} size={18} color={iconColor} />
      </View>
      <View style={styles.rowContent}>
        <Text style={[styles.rowLabel, danger && { color: Colors.error }]}>{label}</Text>
        {sublabel ? <Text style={styles.rowSublabel}>{sublabel}</Text> : null}
      </View>
      {isToggle ? (
        <Switch
          value={toggleValue}
          onValueChange={onToggle}
          trackColor={{ false: Colors.border, true: Colors.primary + '88' }}
          thumbColor={toggleValue ? Colors.primary : Colors.textSubtle}
        />
      ) : value ? (
        <Text style={styles.rowValue}>{value}</Text>
      ) : (
        <MaterialIcons name="chevron-right" size={20} color={Colors.textSubtle} />
      )}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout, updateProfile } = useAuth();
  const { showAlert } = useAlert();
  const supabase = getSupabaseClient();
  const { language, setLanguage } = useI18n();
  const [langModal, setLangModal] = useState(false);

  // ── Privacy state ──────────────────────────────────────────────────────────
  const [isPrivate, setIsPrivate] = useState(false);
  const [hideActivity, setHideActivity] = useState(false);
  const [allowComments, setAllowComments] = useState('everyone');
  const [allowMessages, setAllowMessages] = useState('everyone');
  const [isLoadingPrivacy, setIsLoadingPrivacy] = useState(true);

  // ── Blocked users ──────────────────────────────────────────────────────────
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [blockedModalVisible, setBlockedModalVisible] = useState(false);
  const [isLoadingBlocked, setIsLoadingBlocked] = useState(false);

  // ── Follow requests ────────────────────────────────────────────────────────
  const [followRequests, setFollowRequests] = useState<FollowRequest[]>([]);
  const [requestsModalVisible, setRequestsModalVisible] = useState(false);
  const [isLoadingRequests, setIsLoadingRequests] = useState(false);

  // ── Password change ────────────────────────────────────────────────────────
  const [pwModalVisible, setPwModalVisible] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwLoading, setPwLoading] = useState(false);

  // Load privacy settings
  useEffect(() => {
    if (!user) return;
    (async () => {
      setIsLoadingPrivacy(true);
      const { data } = await supabase
        .from('user_profiles')
        .select('is_private, hide_activity, allow_comments_from, allow_messages_from')
        .eq('id', user.id)
        .single();
      if (data) {
        setIsPrivate(!!data.is_private);
        setHideActivity(!!data.hide_activity);
        setAllowComments(data.allow_comments_from || 'everyone');
        setAllowMessages(data.allow_messages_from || 'everyone');
      }
      setIsLoadingPrivacy(false);
    })();
  }, [user?.id]);

  const savePrivacySetting = useCallback(async (field: string, value: unknown) => {
    if (!user) return;
    await supabase.from('user_profiles').update({ [field]: value }).eq('id', user.id);
  }, [user, supabase]);

  const handleTogglePrivate = useCallback(async (v: boolean) => {
    setIsPrivate(v);
    await savePrivacySetting('is_private', v);
    showAlert(
      v ? 'Cuenta privada activada' : 'Cuenta publica',
      v ? 'Solo seguidores aprobados podran ver tu contenido' : 'Cualquiera puede ver tu perfil y contenido',
    );
  }, [savePrivacySetting, showAlert]);

  const handleToggleActivity = useCallback(async (v: boolean) => {
    setHideActivity(v);
    await savePrivacySetting('hide_activity', v);
  }, [savePrivacySetting]);

  // Blocked users
  const loadBlockedUsers = useCallback(async () => {
    if (!user) return;
    setIsLoadingBlocked(true);
    const { data } = await supabase
      .from('blocked_users')
      .select('id, blocked_id, created_at, user_profiles!blocked_users_blocked_id_fkey(username, avatar_url)')
      .eq('blocker_id', user.id)
      .order('created_at', { ascending: false });

    if (data) {
      setBlockedUsers(data.map((r: any) => ({
        id: r.id,
        blocked_id: r.blocked_id,
        created_at: r.created_at,
        profile: r.user_profiles || { username: 'Unknown', avatar_url: '' },
      })));
    }
    setIsLoadingBlocked(false);
  }, [user, supabase]);

  const handleUnblock = useCallback(async (blockedId: string) => {
    if (!user) return;
    await supabase.from('blocked_users').delete().eq('blocker_id', user.id).eq('blocked_id', blockedId);
    setBlockedUsers(prev => prev.filter(b => b.blocked_id !== blockedId));
    showAlert('Desbloqueado', 'El usuario ha sido desbloqueado');
  }, [user, supabase, showAlert]);

  // Follow requests
  const loadFollowRequests = useCallback(async () => {
    if (!user) return;
    setIsLoadingRequests(true);
    const { data } = await supabase
      .from('follow_requests')
      .select('id, requester_id, created_at, user_profiles!follow_requests_requester_id_fkey(username, avatar_url)')
      .eq('target_id', user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (data) {
      setFollowRequests(data.map((r: any) => ({
        id: r.id,
        requester_id: r.requester_id,
        created_at: r.created_at,
        profile: r.user_profiles || { username: 'Unknown', avatar_url: '' },
      })));
    }
    setIsLoadingRequests(false);
  }, [user, supabase]);

  const handleAcceptRequest = useCallback(async (requestId: string, requesterId: string) => {
    if (!user) return;
    // Accept: update status + create follow
    await supabase.from('follow_requests').update({ status: 'accepted' }).eq('id', requestId);
    await supabase.from('follows').insert({ follower_id: requesterId, following_id: user.id }).select();
    setFollowRequests(prev => prev.filter(r => r.id !== requestId));
    showAlert('Solicitud aceptada', 'Ahora te siguen');
  }, [user, supabase, showAlert]);

  const handleRejectRequest = useCallback(async (requestId: string) => {
    await supabase.from('follow_requests').update({ status: 'rejected' }).eq('id', requestId);
    setFollowRequests(prev => prev.filter(r => r.id !== requestId));
  }, [supabase]);

  // Password change
  const handleChangePassword = useCallback(async () => {
    if (!newPw || !confirmPw) { showAlert('Error', 'Completa todos los campos'); return; }
    if (newPw !== confirmPw) { showAlert('Error', 'Las contrasenas no coinciden'); return; }
    if (newPw.length < 6) { showAlert('Error', 'La contrasena debe tener al menos 6 caracteres'); return; }
    setPwLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPw });
    setPwLoading(false);
    if (error) { showAlert('Error', error.message); return; }
    setPwModalVisible(false);
    setCurrentPw(''); setNewPw(''); setConfirmPw('');
    showAlert('Contrasena actualizada', 'Tu contrasena ha sido cambiada exitosamente');
  }, [newPw, confirmPw, supabase, showAlert]);

  // Delete account
  const handleDeleteAccount = useCallback(() => {
    showAlert(
      'Eliminar cuenta',
      'Esta accion es permanente e irreversible. Todos tus datos, videos y balance DAG seran eliminados.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar', style: 'destructive',
          onPress: () => showAlert('Contacta soporte', 'Para eliminar tu cuenta escribe a: support@clipdag.io'),
        },
      ]
    );
  }, [showAlert]);

  const handleLogout = useCallback(() => {
    showAlert('Cerrar sesion', 'Estas seguro que quieres salir?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Salir', style: 'destructive', onPress: async () => { await logout(); router.replace('/login'); } },
    ]);
  }, [logout, router, showAlert]);

  const AUDIENCE_OPTIONS = [
    { key: 'everyone', label: 'Todos' },
    { key: 'followers', label: 'Seguidores' },
    { key: 'nobody', label: 'Nadie' },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={24} color={Colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Ajustes</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 60 + insets.bottom }]}
      >
        {/* Profile summary */}
        {user ? (
          <View style={styles.profileCard}>
            <LinearGradient colors={['rgba(124,92,255,0.12)', 'rgba(255,45,120,0.08)']} style={styles.profileCardGrad}>
              <Avatar uri={user.avatar} username={user.username} size={52} showBorder />
              <View style={styles.profileCardMeta}>
                <Text style={styles.profileCardName}>{(user as any).displayName || user.username}</Text>
                <Text style={styles.profileCardEmail}>{user.email}</Text>
              </View>
              <Pressable onPress={() => router.push('/(tabs)/profile')} style={styles.profileCardBtn} hitSlop={6}>
                <Text style={styles.profileCardBtnText}>Ver perfil</Text>
              </Pressable>
            </LinearGradient>
          </View>
        ) : null}

        {/* Privacy */}
        <SettingsSection title="Privacidad">
          <SettingsRow
            icon="lock-outline"
            iconColor={Colors.primary}
            label="Cuenta privada"
            sublabel={isPrivate ? 'Solo seguidores aprobados' : 'Cualquiera puede seguirte'}
            isToggle
            toggleValue={isPrivate}
            onToggle={handleTogglePrivate}
          />
          <SettingsRow
            icon="eye-off-outline"
            iconColor={Colors.blue}
            label="Ocultar actividad"
            sublabel="Tu estado activo no sera visible"
            isToggle
            toggleValue={hideActivity}
            onToggle={handleToggleActivity}
          />
          <SettingsRow
            icon="comment-outline"
            iconColor={Colors.accent}
            label="Quien puede comentar"
            value={AUDIENCE_OPTIONS.find(o => o.key === allowComments)?.label || 'Todos'}
            onPress={() => {
              showAlert('Quien puede comentar', 'Selecciona una opcion', [
                ...AUDIENCE_OPTIONS.map(o => ({
                  text: o.label,
                  onPress: async () => { setAllowComments(o.key); await savePrivacySetting('allow_comments_from', o.key); },
                })),
                { text: 'Cancelar', style: 'cancel' as const },
              ]);
            }}
          />
          <SettingsRow
            icon="message-outline"
            iconColor={Colors.secondary}
            label="Quien puede escribirte"
            value={AUDIENCE_OPTIONS.find(o => o.key === allowMessages)?.label || 'Todos'}
            last
            onPress={() => {
              showAlert('Quien puede escribirte', 'Selecciona una opcion', [
                ...AUDIENCE_OPTIONS.map(o => ({
                  text: o.label,
                  onPress: async () => { setAllowMessages(o.key); await savePrivacySetting('allow_messages_from', o.key); },
                })),
                { text: 'Cancelar', style: 'cancel' as const },
              ]);
            }}
          />
        </SettingsSection>

        {/* Follow Requests */}
        {isPrivate ? (
          <SettingsSection title="Solicitudes de seguimiento">
            <SettingsRow
              icon="account-clock-outline"
              iconColor={Colors.warning}
              label="Solicitudes pendientes"
              value={followRequests.length > 0 ? `${followRequests.length}` : 'Ver'}
              last
              onPress={() => {
                loadFollowRequests();
                setRequestsModalVisible(true);
              }}
            />
          </SettingsSection>
        ) : null}

        {/* Account Security */}
        <SettingsSection title="Seguridad de la cuenta">
          <SettingsRow
            icon="lock-reset"
            iconColor={Colors.primary}
            label="Cambiar contrasena"
            sublabel="Actualiza tu contrasena de acceso"
            onPress={() => setPwModalVisible(true)}
          />
          <SettingsRow
            icon="shield-account-outline"
            iconColor={Colors.accent}
            label="Verificacion en dos pasos"
            sublabel="Proximamente disponible"
            last
          />
        </SettingsSection>

        {/* Blocked users */}
        <SettingsSection title="Usuarios bloqueados">
          <SettingsRow
            icon="account-cancel-outline"
            iconColor={Colors.error}
            label="Gestionar bloqueados"
            sublabel="Ver y desbloquear usuarios"
            last
            onPress={() => {
              loadBlockedUsers();
              setBlockedModalVisible(true);
            }}
          />
        </SettingsSection>

        {/* Notifications */}
        <SettingsSection title="Notificaciones">
          <SettingsRow icon="bell-outline" iconColor={Colors.primary} label="Likes en mis posts" isToggle toggleValue={true} onToggle={() => {}} />
          <SettingsRow icon="account-plus-outline" iconColor={Colors.blue} label="Nuevos seguidores" isToggle toggleValue={true} onToggle={() => {}} />
          <SettingsRow icon="comment-outline" iconColor={Colors.accent} label="Comentarios" isToggle toggleValue={true} onToggle={() => {}} />
          <SettingsRow icon="currency-usd" iconColor={Colors.warning} label="Transacciones DAG" isToggle toggleValue={true} onToggle={() => {}} last />
        </SettingsSection>

        {/* Monetization */}
        <SettingsSection title="Monetizacion & Wallet">
          <SettingsRow
            icon="wallet-outline"
            iconColor={Colors.primaryLight}
            label="Billetera BlockDAG"
            sublabel={user?.walletAddress ? `${user.walletAddress.slice(0, 10)}...` : 'Sin wallet conectada'}
            onPress={() => router.push('/(tabs)/wallet')}
          />
          <SettingsRow
            icon="chart-bar"
            iconColor={Colors.accent}
            label="Analiticas de creador"
            sublabel="Estadisticas de tu contenido"
            last
            onPress={() => router.push('/(tabs)/profile')}
          />
        </SettingsSection>

        {/* Language */}
        <SettingsSection title="Idioma / Language">
          <SettingsRow
            icon="translate"
            iconColor="#00E5A0"
            label="Idioma de la app"
            sublabel={AVAILABLE_LANGUAGES.find(l => l.key === language)?.label ?? 'Español'}
            last
            onPress={() => setLangModal(true)}
          />
        </SettingsSection>

        {/* About */}
        <SettingsSection title="Informacion">
          <SettingsRow icon="information-outline" iconColor={Colors.blue} label="Acerca de ClipDAG" value="v1.0.0" />
          <SettingsRow icon="file-document-outline" iconColor={Colors.textSubtle} label="Terminos de servicio" onPress={() => {}} />
          <SettingsRow icon="shield-check-outline" iconColor={Colors.textSubtle} label="Politica de privacidad" last onPress={() => {}} />
        </SettingsSection>

        {/* Dev tools — only in __DEV__ builds */}
        {__DEV__ ? (
          <SettingsSection title="Herramientas de Desarrollo">
            <SettingsRow
              icon="monitor-dashboard"
              iconColor="#00E5A0"
              label="Debug Dashboard"
              sublabel="FPS, GPU, RTC, streams, memoria"
              onPress={() => router.push('/debug')}
            />
            <SettingsRow
              icon="bug-outline"
              iconColor="#FFB800"
              label="Boot Test"
              sublabel="Verificar inicio de la app"
              last
              onPress={() => router.push('/boot-test')}
            />
          </SettingsSection>
        ) : null}

        {/* Session */}
        <SettingsSection title="Sesion">
          <SettingsRow
            icon="logout-variant"
            iconColor={Colors.error}
            label="Cerrar sesion"
            danger
            onPress={handleLogout}
          />
          <SettingsRow
            icon="delete-forever-outline"
            iconColor={Colors.error}
            label="Eliminar cuenta"
            sublabel="Accion permanente e irreversible"
            danger
            last
            onPress={handleDeleteAccount}
          />
        </SettingsSection>
      </ScrollView>

      {/* ── Language Modal ─────────────────────────────────────────────────── */}
      <Modal visible={langModal} animationType="slide" transparent presentationStyle="overFullScreen">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Idioma / Language</Text>
            <Text style={{ color: Colors.textSubtle, fontSize: FontSize.sm, textAlign: 'center', marginBottom: 4 }}>
              Selecciona el idioma de la aplicación
            </Text>
            <View style={{ gap: 8 }}>
              {AVAILABLE_LANGUAGES.map(lang => {
                const isSelected = language === lang.key;
                return (
                  <Pressable
                    key={lang.key}
                    style={[{
                      flexDirection: 'row', alignItems: 'center', gap: 14,
                      backgroundColor: isSelected ? 'rgba(124,92,255,0.10)' : Colors.surface,
                      borderRadius: Radius.lg, paddingHorizontal: 16, paddingVertical: 14,
                      borderWidth: 1, borderColor: isSelected ? '#7C5CFF' : Colors.border,
                    }]}
                    onPress={async () => { await setLanguage(lang.key as Language); setLangModal(false); }}
                  >
                    <Text style={{ fontSize: 26 }}>{lang.flag}</Text>
                    <Text style={[{
                      flex: 1, fontSize: FontSize.md,
                      color: isSelected ? Colors.textPrimary : Colors.textSubtle,
                      fontWeight: isSelected ? FontWeight.bold : FontWeight.medium,
                    }]}>{lang.label}</Text>
                    {isSelected ? (
                      <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: '#7C5CFF', alignItems: 'center', justifyContent: 'center' }}>
                        <MaterialCommunityIcons name="check" size={14} color="#fff" />
                      </View>
                    ) : (
                      <View style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: Colors.border }} />
                    )}
                  </Pressable>
                );
              })}
            </View>
            <Pressable style={styles.modalCloseBtn} onPress={() => setLangModal(false)}>
              <Text style={styles.modalCloseBtnText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── Blocked Users Modal ────────────────────────────────────────────── */}
      <Modal visible={blockedModalVisible} animationType="slide" transparent presentationStyle="overFullScreen">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Usuarios bloqueados</Text>
            {isLoadingBlocked ? (
              <ActivityIndicator color={Colors.primary} style={{ marginTop: 24 }} />
            ) : blockedUsers.length === 0 ? (
              <View style={styles.emptyState}>
                <MaterialCommunityIcons name="account-check-outline" size={48} color={Colors.textSubtle} />
                <Text style={styles.emptyStateText}>No tienes usuarios bloqueados</Text>
              </View>
            ) : (
              <FlatList
                data={blockedUsers}
                keyExtractor={item => item.id}
                style={{ maxHeight: 400 }}
                renderItem={({ item }) => (
                  <View style={styles.userRow}>
                    <Avatar uri={item.profile.avatar_url} username={item.profile.username} size={40} />
                    <Text style={styles.userRowName}>@{item.profile.username}</Text>
                    <Pressable
                      style={styles.unblockBtn}
                      onPress={() => handleUnblock(item.blocked_id)}
                    >
                      <Text style={styles.unblockBtnText}>Desbloquear</Text>
                    </Pressable>
                  </View>
                )}
              />
            )}
            <Pressable style={styles.modalCloseBtn} onPress={() => setBlockedModalVisible(false)}>
              <Text style={styles.modalCloseBtnText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── Follow Requests Modal ──────────────────────────────────────────── */}
      <Modal visible={requestsModalVisible} animationType="slide" transparent presentationStyle="overFullScreen">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Solicitudes de seguimiento</Text>
            {isLoadingRequests ? (
              <ActivityIndicator color={Colors.primary} style={{ marginTop: 24 }} />
            ) : followRequests.length === 0 ? (
              <View style={styles.emptyState}>
                <MaterialCommunityIcons name="account-clock-outline" size={48} color={Colors.textSubtle} />
                <Text style={styles.emptyStateText}>No tienes solicitudes pendientes</Text>
              </View>
            ) : (
              <FlatList
                data={followRequests}
                keyExtractor={item => item.id}
                style={{ maxHeight: 400 }}
                renderItem={({ item }) => (
                  <View style={styles.userRow}>
                    <Avatar uri={item.profile.avatar_url} username={item.profile.username} size={40} />
                    <Text style={[styles.userRowName, { flex: 1 }]}>@{item.profile.username}</Text>
                    <View style={styles.requestBtns}>
                      <Pressable
                        style={styles.acceptBtn}
                        onPress={() => handleAcceptRequest(item.id, item.requester_id)}
                      >
                        <MaterialIcons name="check" size={16} color="#fff" />
                      </Pressable>
                      <Pressable
                        style={styles.rejectBtn}
                        onPress={() => handleRejectRequest(item.id)}
                      >
                        <MaterialIcons name="close" size={16} color={Colors.textSubtle} />
                      </Pressable>
                    </View>
                  </View>
                )}
              />
            )}
            <Pressable style={styles.modalCloseBtn} onPress={() => setRequestsModalVisible(false)}>
              <Text style={styles.modalCloseBtnText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── Change Password Modal ──────────────────────────────────────────── */}
      <Modal visible={pwModalVisible} animationType="slide" transparent presentationStyle="overFullScreen">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Cambiar contrasena</Text>
            <View style={styles.pwForm}>
              <TextInput
                style={styles.pwInput}
                value={newPw}
                onChangeText={setNewPw}
                placeholder="Nueva contrasena"
                placeholderTextColor={Colors.textSubtle}
                secureTextEntry
              />
              <TextInput
                style={styles.pwInput}
                value={confirmPw}
                onChangeText={setConfirmPw}
                placeholder="Confirmar nueva contrasena"
                placeholderTextColor={Colors.textSubtle}
                secureTextEntry
              />
              <Pressable
                style={[styles.pwSaveBtn, pwLoading && { opacity: 0.6 }]}
                onPress={handleChangePassword}
                disabled={pwLoading}
              >
                <LinearGradient colors={['#7C5CFF', '#FF2D78']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.pwSaveBtnGrad}>
                  {pwLoading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.pwSaveBtnText}>Actualizar contrasena</Text>
                  )}
                </LinearGradient>
              </Pressable>
            </View>
            <Pressable style={styles.modalCloseBtn} onPress={() => setPwModalVisible(false)}>
              <Text style={styles.modalCloseBtnText}>Cancelar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingBottom: Spacing.md,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.textPrimary },

  scrollContent: { paddingHorizontal: Spacing.md, gap: Spacing.md, paddingTop: 4 },

  // Profile card
  profileCard: { borderRadius: Radius.xl, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  profileCardGrad: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md },
  profileCardMeta: { flex: 1 },
  profileCardName: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  profileCardEmail: { color: Colors.textSubtle, fontSize: FontSize.xs, marginTop: 1 },
  profileCardBtn: {
    backgroundColor: Colors.primaryDim, borderRadius: Radius.full,
    paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: Colors.primary + '44',
  },
  profileCardBtnText: { color: Colors.primary, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },

  // Settings sections
  section: { gap: 6 },
  sectionTitle: {
    fontSize: FontSize.xs, fontWeight: FontWeight.semibold,
    color: Colors.textSubtle, textTransform: 'uppercase',
    letterSpacing: 0.8, marginLeft: 4,
  },
  sectionCard: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.md, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle,
  },
  rowLast: { borderBottomWidth: 0 },
  rowIconWrap: {
    width: 34, height: 34, borderRadius: Radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  rowContent: { flex: 1, gap: 1 },
  rowLabel: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  rowSublabel: { color: Colors.textSubtle, fontSize: FontSize.xs },
  rowValue: { color: Colors.textSubtle, fontSize: FontSize.sm },

  // Modals
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: Colors.surfaceElevated,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: Spacing.lg, gap: Spacing.md,
  },
  modalHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 4,
  },
  modalTitle: {
    color: Colors.textPrimary, fontSize: FontSize.lg,
    fontWeight: FontWeight.bold, textAlign: 'center',
  },
  emptyState: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xl },
  emptyStateText: { color: Colors.textSubtle, fontSize: FontSize.sm },

  userRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle,
  },
  userRowName: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.medium },

  unblockBtn: {
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.full,
    paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: Colors.border,
  },
  unblockBtnText: { color: Colors.textSecondary, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },

  requestBtns: { flexDirection: 'row', gap: Spacing.sm },
  acceptBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  rejectBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },

  modalCloseBtn: {
    alignItems: 'center', paddingVertical: 14,
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border,
  },
  modalCloseBtnText: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },

  // Password form
  pwForm: { gap: Spacing.md },
  pwInput: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 14,
    color: Colors.textPrimary, fontSize: FontSize.md,
  },
  pwSaveBtn: { borderRadius: Radius.md, overflow: 'hidden' },
  pwSaveBtnGrad: { paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  pwSaveBtnText: { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
});
