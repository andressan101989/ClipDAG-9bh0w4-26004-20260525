import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet,
  TextInput, Modal, KeyboardAvoidingView, Platform,
  ActivityIndicator, RefreshControl, Dimensions, FlatList,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { useFeed } from '@/hooks/useFeed';
import { useNotifications } from '@/hooks/useNotifications';
import { useMessages } from '@/hooks/useMessages';
import { useWallet } from '@/hooks/useWallet';
import { useAlert } from '@/template';
import { getSupabaseClient } from '@/template';
import { CyberButton } from '@/components/ui/CyberButton';
import { Avatar } from '@/components/ui/Avatar';
import { AnalyticsSheet } from '@/components/feature/AnalyticsSheet';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { useI18n } from '@/contexts/I18nContext';
import { MOCK_CREATORS, formatNumber } from '@/services/mockData';
import { uploadFileFromUri, detectMimeType } from '@/contexts/FeedContext';
import type { VideoWithMeta } from '@/contexts/FeedContext';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_GAP = 2;
const THUMB_SIZE = (SCREEN_WIDTH - GRID_GAP * 2) / 3;

// ── Quick-action button ────────────────────────────────────────────────────────
function QuickAction({
  icon, label, gradient, onPress, badge,
}: {
  icon: string; label: string; gradient: string[];
  onPress: () => void; badge?: number;
}) {
  return (
    <Pressable style={styles.quickAction} onPress={onPress}>
      <View style={styles.quickActionIconWrap}>
        <LinearGradient colors={gradient} style={styles.quickActionIcon}>
          <MaterialCommunityIcons name={icon as any} size={20} color="#fff" />
        </LinearGradient>
        {badge && badge > 0 ? (
          <View style={styles.quickBadge}>
            <Text style={styles.quickBadgeText}>{badge > 9 ? '9+' : badge}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.quickActionLabel}>{label}</Text>
    </Pressable>
  );
}

// ── Settings row item ──────────────────────────────────────────────────────────
function SettingsItem({
  icon, label, sublabel, gradient, onPress, danger, rightText,
}: {
  icon: string; label: string; sublabel?: string; gradient: string[];
  onPress: () => void; danger?: boolean; rightText?: string;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.settingsItem, pressed && { opacity: 0.75 }]}
      onPress={onPress}
    >
      <LinearGradient colors={gradient} style={styles.settingsItemIcon}>
        <MaterialCommunityIcons name={icon as any} size={16} color="#fff" />
      </LinearGradient>
      <View style={styles.settingsItemText}>
        <Text style={[styles.settingsItemLabel, danger && styles.settingsItemDanger]}>{label}</Text>
        {sublabel ? <Text style={styles.settingsItemSub}>{sublabel}</Text> : null}
      </View>
      {rightText ? (
        <Text style={styles.settingsItemRight}>{rightText}</Text>
      ) : (
        <MaterialCommunityIcons name="chevron-right" size={18} color={danger ? Colors.error : Colors.textSubtle} />
      )}
    </Pressable>
  );
}

// ── Content tab type ───────────────────────────────────────────────────────────
type ContentTab = 'posts' | 'reels' | 'saved' | 'shared';

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const {
    user, logout, updateProfile, isFollowing, toggleFollow,
    followedUsers, refreshProfile,
  } = useAuth();
  const { videos, deleteVideo, updateVideo, getAnalytics } = useFeed();
  const { showAlert } = useAlert();
  const router = useRouter();
  const supabase = getSupabaseClient();
  const { unreadCount: notifCount } = useNotifications();
  const { unreadTotal: unreadDMs } = useMessages();
  const walletData = useWallet();
  const dagBalance = walletData?.balance ?? 0;
  const { t } = useI18n();

  // Profile edit state
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [profession, setProfession] = useState('');
  const [website, setWebsite] = useState('');
  const [location, setLocation] = useState('');

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [contentTab, setContentTab] = useState<ContentTab>('posts');

  // Analytics
  const [analyticsVideo, setAnalyticsVideo] = useState<VideoWithMeta | null>(null);
  const [analyticsVisible, setAnalyticsVisible] = useState(false);

  useEffect(() => {
    if (user) {
      setDisplayName((user as any).displayName || user.username || '');
      setBio(user.bio || '');
      setProfession((user as any).profession || '');
      setWebsite((user as any).website || '');
      setLocation((user as any).location || '');
    }
  }, [user?.id]);

  const openEditModal = useCallback(() => {
    setDisplayName((user as any)?.displayName || user?.username || '');
    setBio(user?.bio || '');
    setProfession((user as any)?.profession || '');
    setWebsite((user as any)?.website || '');
    setLocation((user as any)?.location || '');
    setEditModalVisible(true);
  }, [user]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try { await refreshProfile(); } catch (_) {}
    setIsRefreshing(false);
  }, [refreshProfile]);

  const handlePickAvatar = useCallback(() => {
    showAlert('Foto de perfil', 'Elige una opción', [
      {
        text: 'Cámara',
        onPress: async () => {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) { showAlert('Permiso denegado', 'Habilita la cámara en ajustes'); return; }
          const result = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.8, base64: true });
          if (!result.canceled && result.assets[0]) await uploadAvatar(result.assets[0]);
        },
      },
      {
        text: 'Galería',
        onPress: async () => {
          const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!perm.granted) { showAlert('Permiso denegado', 'Habilita la galería en ajustes'); return; }
          const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.8, base64: true });
          if (!result.canceled && result.assets[0]) await uploadAvatar(result.assets[0]);
        },
      },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  }, [user, showAlert]);

  const uploadAvatar = useCallback(async (asset: ImagePicker.ImagePickerAsset) => {
    if (!user) return;
    setIsUploadingAvatar(true);
    try {
      const mimeType = asset.mimeType || detectMimeType(asset.uri, 'image/jpeg');
      const ext = mimeType.includes('png') ? 'png' : 'jpg';
      const fileName = `${user.id}/avatar_${Date.now()}.${ext}`;
      const publicUrl = await uploadFileFromUri(supabase, asset.uri, 'avatars', fileName, mimeType, asset.base64);
      await updateProfile({ avatar: publicUrl || asset.uri } as any);
      showAlert('Foto actualizada', 'Tu foto de perfil fue actualizada');
    } catch (_) {
      showAlert('Error', 'No se pudo subir la foto');
    }
    setIsUploadingAvatar(false);
  }, [user, supabase, updateProfile, showAlert]);

  const handleSaveProfile = useCallback(async () => {
    if (!displayName.trim()) { showAlert('Nombre requerido', 'Ingresa un nombre'); return; }
    await updateProfile({
      displayName: displayName.trim(),
      bio: bio.trim(),
      profession: profession.trim(),
      website: website.trim(),
      location: location.trim(),
    } as any);
    setEditModalVisible(false);
    showAlert('Perfil actualizado', 'Tus cambios fueron guardados');
  }, [displayName, bio, profession, website, location, updateProfile, showAlert]);

  const handleLogout = useCallback(() => {
    showAlert(t('profile.logout'), t('profile.logoutConfirm'), [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Salir', style: 'destructive',
        onPress: async () => { await logout(); router.replace('/login'); },
      },
    ]);
  }, [logout, router, showAlert]);

  const handleDeletePost = useCallback((video: VideoWithMeta) => {
    showAlert('Eliminar publicación', 'Esta acción es permanente.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar', style: 'destructive',
        onPress: async () => {
          const result = await deleteVideo(video.id, video.videoUrl, video.thumbnailUrl);
          if (result.success) showAlert('Eliminado', 'Tu publicación fue eliminada');
          else showAlert('Error', result.error || 'No se pudo eliminar');
        },
      },
    ]);
  }, [deleteVideo, showAlert]);

  if (!user) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <StatusBar style="light" />
        <ActivityIndicator color={Colors.primary} size="large" />
      </View>
    );
  }

  const myVideos = videos.filter(v => v.userId === user.id);
  const totalLikes = myVideos.reduce((s, v) => s + (v.likes || 0), 0);
  const totalViews = myVideos.reduce((s, v) => s + (v.viewsCount || 0), 0);
  const dagEarned = (totalLikes * 0.01).toFixed(2);
  const avatarUri = user.avatar ||
    `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(user.username || user.email || 'user')}`;
  const userProfession = (user as any).profession || '';
  const userWebsite = (user as any).website || '';
  const balance = dagBalance || user.dagBalance || 0;

  // Content tab data
  const gridVideos = contentTab === 'posts' ? myVideos : myVideos;

  const CONTENT_TABS: { key: ContentTab; icon: string }[] = [
    { key: 'posts', icon: 'grid' },
    { key: 'reels', icon: 'play-box-multiple-outline' },
    { key: 'saved', icon: 'bookmark-outline' },
    { key: 'shared', icon: 'share-variant-outline' },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <View style={styles.topBar}>
        <Pressable onPress={() => router.push('/settings')} style={styles.topBarBtn} hitSlop={8}>
          <MaterialCommunityIcons name="cog-outline" size={22} color={Colors.textSecondary} />
        </Pressable>
        <Text style={styles.topBarTitle}>@{user.username || 'mi_perfil'}</Text>

        <Pressable onPress={openEditModal} style={styles.topBarBtn} hitSlop={8}>
          <MaterialCommunityIcons name="account-edit-outline" size={22} color={Colors.textSecondary} />
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={Colors.primary}
            colors={[Colors.primary]}
          />
        }
      >
        {/* ── Profile hero ────────────────────────────────────────────────── */}
        <View style={styles.hero}>
          {/* Avatar */}
          <Pressable onPress={handlePickAvatar} style={styles.avatarOuter} hitSlop={4}>
            <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={styles.avatarRing}>
              <View style={styles.avatarInner}>
                <Avatar uri={avatarUri} username={user.username} size={86} />
                {isUploadingAvatar ? (
                  <View style={styles.avatarLoadingOverlay}>
                    <ActivityIndicator color="#fff" size="small" />
                  </View>
                ) : null}
              </View>
            </LinearGradient>
            <View style={styles.cameraBadge}>
              <MaterialCommunityIcons name="camera" size={11} color="#fff" />
            </View>
          </Pressable>

          {/* Name + profession */}
          <Text style={styles.displayName}>
            {(user as any).displayName || user.username || 'Usuario'}
          </Text>
          {userProfession ? (
            <Text style={styles.profession}>{userProfession}</Text>
          ) : null}
          {user.bio ? (
            <Text style={styles.bio}>{user.bio}</Text>
          ) : null}
          {userWebsite ? (
            <View style={styles.websiteRow}>
              <MaterialCommunityIcons name="link-variant" size={12} color={Colors.blue} />
              <Text style={styles.websiteText} numberOfLines={1}>
                {userWebsite.replace(/^https?:\/\//, '')}
              </Text>
            </View>
          ) : null}

          {/* ── Stats row ──────────────────────────────────────────────── */}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{formatNumber(myVideos.length)}</Text>
              <Text style={styles.statLabel}>{t('profile.posts')}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{formatNumber(user.followers || 0)}</Text>
              <Text style={styles.statLabel}>{t('profile.followers')}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{formatNumber(user.following || 0)}</Text>
              <Text style={styles.statLabel}>{t('profile.following')}</Text>
            </View>
          </View>

          {/* Edit + share buttons */}
          <View style={styles.profileBtns}>
            <Pressable style={styles.editBtn} onPress={openEditModal}>
              <Text style={styles.editBtnText}>{t('profile.editProfile')}</Text>
            </Pressable>
            <Pressable style={styles.shareBtn} onPress={() => router.push('/(tabs)/wallet')}>
              <MaterialCommunityIcons name="share-variant-outline" size={18} color={Colors.textSecondary} />
            </Pressable>
            <Pressable style={styles.shareBtn} onPress={() => router.push('/messages')}>
              <MaterialCommunityIcons name="message-text-outline" size={18} color={Colors.textSecondary} />
            </Pressable>
          </View>
        </View>

        {/* ── DAG balance strip ─────────────────────────────────────────────── */}
        <Pressable onPress={() => router.push('/(tabs)/wallet')} style={{ marginHorizontal: Spacing.md, marginBottom: Spacing.sm }}>
          <LinearGradient
            colors={['rgba(124,92,255,0.22)', 'rgba(255,157,0,0.12)']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={styles.dagStrip}
          >
            <LinearGradient colors={['#FF9D00', '#7C5CFF']} style={styles.dagStripIcon}>
              <MaterialCommunityIcons name="hexagon-multiple" size={18} color="#fff" />
            </LinearGradient>
            <View style={{ flex: 1 }}>
              <Text style={styles.dagStripTitle}>{t('profile.economyBDAG')}</Text>
              <Text style={styles.dagStripSub}>{t('profile.economyBDAGSub')}</Text>
            </View>
            <View style={styles.dagStripRight}>
              <Text style={styles.dagStripBalance}>{balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
              <Text style={styles.dagStripUnit}>BDAG</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={18} color={Colors.textSubtle} />
          </LinearGradient>
        </Pressable>

        {/* ── Quick actions ─────────────────────────────────────────────────── */}
        <View style={styles.quickActionsRow}>
          <QuickAction
            icon="chart-bar"
            label={t('profile.analytics')}
            gradient={['#FFB800', '#FF6B00']}
            onPress={() => {
              if (myVideos[0]) { setAnalyticsVideo(myVideos[0]); setAnalyticsVisible(true); }
              else showAlert('Sin videos', 'Sube contenido para ver analytics');
            }}
          />
          <QuickAction
            icon="wallet-outline"
            label={t('profile.wallet')}
            gradient={['#7C5CFF', '#B44FFF']}
            onPress={() => router.push('/(tabs)/wallet')}
          />
          <QuickAction
            icon="star-circle-outline"
            label={t('profile.monetize')}
            gradient={['#A855F7', '#7C5CFF']}
            onPress={() => router.push('/creator-monetization')}
          />
          <QuickAction
            icon="account-heart-outline"
            label={t('profile.subscriptions')}
            gradient={['#2D9EFF', '#00E5A0']}
            onPress={() => router.push('/my-subscriptions')}
          />
        </View>

        {/* ── Content tabs + grid ───────────────────────────────────────────── */}
        <View style={styles.contentTabsBar}>
          {CONTENT_TABS.map(t => (
            <Pressable
              key={t.key}
              style={[styles.contentTabBtn, contentTab === t.key && styles.contentTabBtnActive]}
              onPress={() => setContentTab(t.key)}
            >
              <MaterialCommunityIcons
                name={t.icon as any}
                size={22}
                color={contentTab === t.key ? Colors.textPrimary : Colors.textSubtle}
              />
            </Pressable>
          ))}
        </View>

        {/* Content grid */}
        {gridVideos.length === 0 ? (
          <View style={styles.emptyGrid}>
            <MaterialCommunityIcons name="video-plus-outline" size={44} color={Colors.textSubtle} />
            <Text style={styles.emptyGridTitle}>{t('profile.noPosts')}</Text>
            <Text style={styles.emptyGridSub}>{t('profile.noPostsSub')}</Text>
            <Pressable
              style={styles.uploadNowBtn}
              onPress={() => router.push('/(tabs)/upload')}
            >
              <LinearGradient
                colors={['#7C5CFF', '#FF2D78']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={styles.uploadNowBtnGrad}
              >
                <Text style={styles.uploadNowBtnText}>{t('profile.uploadNow')}</Text>
              </LinearGradient>
            </Pressable>
          </View>
        ) : (
          <View style={styles.grid}>
            {gridVideos.map(video => {
              const imgSrc = video.thumbnailUrl?.startsWith('http')
                ? { uri: video.thumbnailUrl }
                : video.videoUrl?.startsWith('http')
                  ? { uri: video.videoUrl }
                  : { uri: `https://api.dicebear.com/7.x/shapes/svg?seed=${video.id}` };
              return (
                <View key={video.id} style={styles.gridItem}>
                  <Pressable
                    style={styles.gridThumb}
                    onLongPress={() => {
                      showAlert('Opciones', '', [
                        { text: 'Analytics', onPress: () => { setAnalyticsVideo(video); setAnalyticsVisible(true); } },
                        { text: 'Eliminar', style: 'destructive', onPress: () => handleDeletePost(video) },
                        { text: 'Cancelar', style: 'cancel' },
                      ]);
                    }}
                  >
                    <Image
                      source={imgSrc}
                      style={StyleSheet.absoluteFillObject}
                      contentFit="cover"
                      transition={200}
                    />
                    <LinearGradient
                      colors={['transparent', 'rgba(10,10,15,0.75)']}
                      style={styles.gridOverlay}
                    >
                      <View style={styles.gridStats}>
                        <MaterialIcons name="favorite" size={10} color={Colors.secondary} />
                        <Text style={styles.gridStatText}>{formatNumber(video.likes || 0)}</Text>
                        {(video.viewsCount || 0) > 0 ? (
                          <>
                            <MaterialCommunityIcons name="eye" size={10} color="rgba(255,255,255,0.7)" style={{ marginLeft: 4 }} />
                            <Text style={[styles.gridStatText, { color: 'rgba(255,255,255,0.7)' }]}>
                              {formatNumber(video.viewsCount || 0)}
                            </Text>
                          </>
                        ) : null}
                      </View>
                    </LinearGradient>
                    {/* Type badge */}
                    {video.videoUrl?.match(/\.(mp4|mov|avi|mkv)$/i) ? (
                      <View style={styles.gridTypeBadge}>
                        <MaterialCommunityIcons name="play" size={9} color="#fff" />
                      </View>
                    ) : null}
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}

        {/* ── Creator settings hub ─────────────────────────────────────────── */}
        <View style={styles.settingsSection}>
          <Text style={styles.settingsSectionTitle}>{t('profile.myAccount')}</Text>

          <View style={styles.settingsCard}>
            <SettingsItem
              icon="account-outline"
              label={t('profile.myProfile')}
              sublabel="Editar perfil, foto, biografía"
              gradient={['#7C5CFF', '#B44FFF']}
              onPress={openEditModal}
            />
            <View style={styles.settingsDivider} />
            <SettingsItem
              icon="chart-line"
              label={t('profile.stats')}
              sublabel="Vistas, Me gusta, Seguidores, Rendimiento"
              gradient={['#FFB800', '#FF6B00']}
              onPress={() => {
                if (myVideos[0]) { setAnalyticsVideo(myVideos[0]); setAnalyticsVisible(true); }
                else showAlert('Sin videos', 'Sube contenido para ver estadísticas');
              }}
            />
            <View style={styles.settingsDivider} />
            <SettingsItem
              icon="hand-coin-outline"
              label={t('profile.monetize')}
              sublabel="Premium DM, Suscripciones, Ganancias"
              gradient={['#A855F7', '#7C5CFF']}
              onPress={() => router.push('/creator-monetization')}
              rightText={`${dagEarned} $DAG`}
            />
            <View style={styles.settingsDivider} />
            <SettingsItem
              icon="movie-edit-outline"
              label={t('profile.creatorStudio')}
              sublabel={t('profile.creatorStudioSub')}
              gradient={['#2D9EFF', '#7C5CFF']}
              onPress={() => router.push('/creator-studio')}
            />
            <View style={styles.settingsDivider} />
            <SettingsItem
              icon="storefront-outline"
              label={t('profile.myProducts')}
              sublabel={t('profile.myProductsSub')}
              gradient={['#00E5A0', '#2D9EFF']}
              onPress={() => router.push('/(tabs)/shop')}
            />
            <View style={styles.settingsDivider} />
            <SettingsItem
              icon="star-outline"
              label={t('profile.mySubscriptions')}
              sublabel={t('profile.mySubscriptionsSub')}
              gradient={['#A855F7', '#7C5CFF']}
              onPress={() => router.push('/my-subscriptions')}
            />
            <View style={styles.settingsDivider} />
            <SettingsItem
              icon="rocket-launch-outline"
              label={t('profile.boostProfile')}
              sublabel={t('profile.boostProfileSub')}
              gradient={['#FF9D00', '#FF5A00']}
              onPress={() => router.push('/boost-profile')}
            />
            <View style={styles.settingsDivider} />
            <SettingsItem
              icon="bullhorn-outline"
              label={t('profile.marketingCenter')}
              sublabel={t('profile.marketingCenterSub')}
              gradient={['#FF2D78', '#B44FFF']}
              onPress={() => router.push('/promotions')}
            />
          </View>
        </View>

        <View style={styles.settingsSection}>
          <Text style={styles.settingsSectionTitle}>{t('profile.configuration')}</Text>

          <View style={styles.settingsCard}>
            <SettingsItem
              icon="shield-lock-outline"
              label={t('profile.privacy')}
              sublabel={t('profile.privacySub')}
              gradient={['#7C5CFF', '#B44FFF']}
              onPress={() => router.push('/privacy-settings')}
            />
            <View style={styles.settingsDivider} />
            <SettingsItem
              icon="bell-outline"
              label={t('profile.notifications')}
              sublabel={t('profile.notificationsSub')}
              gradient={['#FFB800', '#FF6B00']}
              onPress={() => router.push('/notification-settings')}
              badge={notifCount > 0 ? notifCount : undefined}
            />
            <View style={styles.settingsDivider} />
            <SettingsItem
              icon="message-text-outline"
              label={t('profile.messages')}
              sublabel={t('profile.messagesSub')}
              gradient={['#00E5A0', '#2D9EFF']}
              onPress={() => router.push('/messages')}
              badge={unreadDMs > 0 ? unreadDMs : undefined}
            />
            <View style={styles.settingsDivider} />
            <SettingsItem
              icon="account-cog-outline"
              label={t('profile.accountSettings')}
              sublabel={t('profile.accountSettingsSub')}
              gradient={['#5A5A72', '#3D3D52']}
              onPress={() => router.push('/account-settings')}
            />
            <View style={styles.settingsDivider} />
            <SettingsItem
              icon="shield-key-outline"
              label={t('profile.twoFactor')}
              sublabel={t('profile.twoFactorSub')}
              gradient={['#2D9EFF', '#00E5A0']}
              onPress={() => router.push('/two-factor')}
            />
            <View style={styles.settingsDivider} />
            <SettingsItem
              icon="file-document-outline"
              label={t('profile.legal')}
              sublabel={t('profile.legalSub')}
              gradient={['#5A5A72', '#3D3D52']}
              onPress={() => router.push('/legal')}
            />
            <View style={styles.settingsDivider} />
            <SettingsItem
              icon="help-circle-outline"
              label={t('profile.help')}
              sublabel={t('profile.helpSub')}
              gradient={['#7C5CFF', '#2D9EFF']}
              onPress={() => showAlert(t('profile.support'), t('profile.supportContact'))}
            />
          </View>
        </View>

        {/* Logout */}
        <View style={styles.settingsSection}>
          <View style={styles.settingsCard}>
            <SettingsItem
              icon="logout-variant"
              label={t('profile.logout')}
              sublabel={t('profile.logoutSub')}
              gradient={['#FF3B5C', '#FF2D78']}
              onPress={handleLogout}
              danger
            />
          </View>
        </View>

      </ScrollView>

      {/* Analytics Sheet */}
      {analyticsVideo ? (
        <AnalyticsSheet
          visible={analyticsVisible}
          videoCaption={analyticsVideo.caption}
          onClose={() => { setAnalyticsVisible(false); setAnalyticsVideo(null); }}
          fetchAnalytics={() => getAnalytics(analyticsVideo.id)}
        />
      ) : null}

      {/* ── Edit Profile Modal ─────────────────────────────────────────────── */}
      <Modal
        visible={editModalVisible}
        transparent
        animationType="slide"
        presentationStyle="overFullScreen"
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setEditModalVisible(false)} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView
            style={styles.modalSheet}
            contentContainerStyle={{ padding: Spacing.lg, gap: Spacing.md, paddingBottom: insets.bottom + Spacing.lg }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.handleBarWrap}><View style={styles.handleBar} /></View>
            <Text style={styles.modalTitle}>Editar Perfil</Text>

            {[
              { label: 'Nombre visible', value: displayName, setter: setDisplayName, placeholder: 'Tu nombre' },
              { label: 'Profesión / Categoría', value: profession, setter: setProfession, placeholder: 'ej. Content Creator 🎥' },
              { label: 'Biografía', value: bio, setter: setBio, placeholder: 'Cuéntanos sobre ti...', multiline: true, maxLength: 150 },
              { label: 'Ubicación', value: location, setter: setLocation, placeholder: 'Ciudad, País' },
              { label: 'Sitio web', value: website, setter: setWebsite, placeholder: 'https://tu-sitio.com', keyboardType: 'url' as const },
            ].map(field => (
              <View key={field.label} style={styles.formField}>
                <Text style={styles.fieldLabel}>{field.label}</Text>
                <TextInput
                  style={[styles.fieldInput, field.multiline && { height: 80, textAlignVertical: 'top', paddingTop: 12 }]}
                  value={field.value}
                  onChangeText={field.setter}
                  placeholder={field.placeholder}
                  placeholderTextColor={Colors.textSubtle}
                  multiline={field.multiline}
                  maxLength={field.maxLength || 100}
                  keyboardType={field.keyboardType || 'default'}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            ))}

            <CyberButton label="Guardar Cambios" onPress={handleSaveProfile} size="lg" fullWidth />
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  centered: { alignItems: 'center', justifyContent: 'center' },

  // Top bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  topBarTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
  },
  topBarBtn: {
    width: 38, height: 38,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border,
  },

  // Hero
  hero: {
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
    gap: Spacing.sm,
  },
  avatarOuter: { position: 'relative', marginBottom: 2 },
  avatarRing: {
    width: 98, height: 98, borderRadius: 49,
    alignItems: 'center', justifyContent: 'center',
    padding: 2.5,
  },
  avatarInner: {
    width: '100%', height: '100%', borderRadius: 45,
    overflow: 'hidden',
    borderWidth: 2, borderColor: Colors.bg,
  },
  avatarLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10,10,15,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
  cameraBadge: {
    position: 'absolute', bottom: 2, right: 2,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.bg,
  },
  displayName: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  profession: {
    fontSize: FontSize.sm,
    color: Colors.primary,
    fontWeight: FontWeight.medium,
    textAlign: 'center',
  },
  bio: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 280,
  },
  websiteRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  websiteText: {
    color: Colors.blue,
    fontSize: FontSize.sm,
    maxWidth: 200,
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.xl,
    padding: Spacing.md,
    width: '100%',
    borderWidth: 1, borderColor: Colors.border,
    marginTop: Spacing.xs,
  },
  statItem: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: {
    color: Colors.textPrimary,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
  },
  statLabel: {
    color: Colors.textSubtle,
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  statDivider: { width: 1, height: 30, backgroundColor: Colors.border },

  // Profile buttons
  profileBtns: {
    flexDirection: 'row',
    gap: Spacing.sm,
    width: '100%',
  },
  editBtn: {
    flex: 1,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.md,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  editBtnText: {
    color: Colors.textPrimary,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  shareBtn: {
    width: 42, height: 42,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },

  // DAG strip
  dagStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(255,157,0,0.35)',
  },
  dagStripIcon: {
    width: 40, height: 40,
    borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  dagStripSymbol: { color: '#fff', fontSize: 18, fontWeight: FontWeight.bold },
  dagStripTitle: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  dagStripSub: { color: Colors.textSubtle, fontSize: FontSize.xs, marginTop: 1 },
  dagStripRight: { alignItems: 'flex-end' },
  dagStripBalance: { color: Colors.primaryLight, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  dagStripUnit: { color: Colors.primaryLight, fontSize: FontSize.xs },

  // Quick actions
  quickActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  quickAction: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  quickActionIconWrap: { position: 'relative' },
  quickActionIcon: {
    width: 52, height: 52,
    borderRadius: 26,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  quickBadge: {
    position: 'absolute', top: -4, right: -4,
    backgroundColor: Colors.secondary,
    borderRadius: Radius.full,
    minWidth: 16, height: 16,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 2,
    borderWidth: 1.5, borderColor: Colors.bg,
  },
  quickBadgeText: { color: '#fff', fontSize: 8, fontWeight: FontWeight.bold },
  quickActionLabel: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontWeight: FontWeight.medium,
    textAlign: 'center',
  },

  // Content tabs
  contentTabsBar: {
    flexDirection: 'row',
    borderTopWidth: 1, borderBottomWidth: 1,
    borderColor: Colors.border,
    marginBottom: 2,
  },
  contentTabBtn: {
    flex: 1, height: 44,
    alignItems: 'center', justifyContent: 'center',
  },
  contentTabBtnActive: {
    borderBottomWidth: 2,
    borderBottomColor: Colors.textPrimary,
  },

  // Grid
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
    marginBottom: Spacing.lg,
  },
  gridItem: { width: THUMB_SIZE },
  gridThumb: {
    width: THUMB_SIZE, height: THUMB_SIZE * 1.25,
    backgroundColor: Colors.surface,
    position: 'relative',
  },
  gridOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: 5, justifyContent: 'flex-end',
  },
  gridStats: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  gridStatText: { color: '#fff', fontSize: 10, fontWeight: FontWeight.semibold },
  gridTypeBadge: {
    position: 'absolute', top: 4, right: 4,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },

  // Empty grid
  emptyGrid: {
    alignItems: 'center',
    paddingVertical: Spacing.xxl,
    gap: Spacing.md,
    marginHorizontal: Spacing.md,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.border,
    marginBottom: Spacing.lg,
  },
  emptyGridTitle: { color: Colors.textSecondary, fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  emptyGridSub: { color: Colors.textSubtle, fontSize: FontSize.sm },
  uploadNowBtn: { borderRadius: Radius.full, overflow: 'hidden' },
  uploadNowBtnGrad: { paddingHorizontal: 24, paddingVertical: 10 },
  uploadNowBtnText: { color: '#fff', fontSize: FontSize.sm, fontWeight: FontWeight.bold },

  // Settings hub
  settingsSection: {
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  settingsSectionTitle: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.textSubtle,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  settingsCard: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  settingsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 13,
  },
  settingsItemIcon: {
    width: 34, height: 34,
    borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  settingsItemText: { flex: 1 },
  settingsItemLabel: {
    color: Colors.textPrimary,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
  },
  settingsItemDanger: { color: Colors.error },
  settingsItemSub: {
    color: Colors.textSubtle,
    fontSize: FontSize.xs,
    marginTop: 1,
  },
  settingsItemRight: {
    color: Colors.primaryLight,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
  settingsDivider: {
    height: 1,
    backgroundColor: Colors.borderSubtle,
    marginLeft: Spacing.md + 34 + Spacing.md,
  },

  // Edit modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  modalSheet: {
    backgroundColor: Colors.surfaceElevated,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '90%',
  },
  handleBarWrap: { alignItems: 'center', marginBottom: 4 },
  handleBar: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border },
  modalTitle: {
    color: Colors.textPrimary,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  formField: { gap: Spacing.xs },
  fieldLabel: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  fieldInput: {
    backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: 13,
    color: Colors.textPrimary,
    fontSize: FontSize.md,
  },
});
