import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, FlatList, Pressable, TextInput, StyleSheet,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useMessages } from '@/hooks/useMessages';
import { useAuth } from '@/hooks/useAuth';
import { getSupabaseClient } from '@/template';
import { Avatar } from '@/components/ui/Avatar';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { timeAgo } from '@/services/mockData';

// ── Main Messages Screen ──────────────────────────────────────────────────────
export default function MessagesScreen() {
  // Approved Figma: 01 — Messages Inbox (FmwCrxtAV5k8jpLFr3RTgy, node 1:3).
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { conversations, isLoading, refreshConversations, presenceByUser } = useMessages();
  const supabase = getSupabaseClient();

  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'direct' | 'group' | 'premium'>('all');

  // Premium DM payments for inbox (creator view)
  const [premiumDMs, setPremiumDMs] = useState<any[]>([]);

  const loadPremiumDMs = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from('premium_dm_payments')
      .select(`
        *,
        sender:user_profiles!sender_id(username, avatar_url)
      `)
      .eq('recipient_id', user.id)
      .eq('status', 'held')
      .order('created_at', { ascending: false })
      .limit(20);
    setPremiumDMs(data ?? []);
  }, [user?.id, supabase]);

  useEffect(() => { loadPremiumDMs(); }, [loadPremiumDMs]);

  // Filter conversations
  const filtered = conversations.filter(c => {
    if (search.trim() && !c.displayName.toLowerCase().includes(search.toLowerCase())) return false;
    if (activeTab === 'direct' && c.conversationType !== 'direct') return false;
    if (activeTab === 'group' && c.conversationType !== 'group') return false;
    if (activeTab === 'premium' && (c.conversationType !== 'direct' || !premiumDMs.some(p => p.sender_id === c.partnerId))) return false;
    return true;
  });

  // Sort: premium DMs at top
  const sortedConversations = [...filtered].sort((a, b) => {
    const aIsPremium = a.conversationType === 'direct' && premiumDMs.some(p => p.sender_id === a.partnerId);
    const bIsPremium = b.conversationType === 'direct' && premiumDMs.some(p => p.sender_id === b.partnerId);
    if (aIsPremium && !bIsPremium) return -1;
    if (!aIsPremium && bIsPremium) return 1;
    return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
  });

  const TABS = [
    { key: 'all' as const, label: 'Todos', icon: 'circle-outline' },
    { key: 'direct' as const, label: 'Directos', icon: 'account-outline' },
    { key: 'group' as const, label: 'Grupos', icon: 'account-group-outline' },
    { key: 'premium' as const, label: 'Premium', icon: 'crown-outline' },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <View style={styles.headerBrand}>
          <MaterialCommunityIcons name="chart-donut" size={25} color="#9B5CFF" />
          <View>
            <Text style={styles.headerTitle}>Mensajes</Text>
            <Text style={styles.headerSubtitle}>Conecta. Comparte. Sé tú.</Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          <Pressable accessibilityLabel="Crear grupo" onPress={() => router.push('/chat/group/create' as any)} hitSlop={8} style={styles.headerAction}>
            <MaterialCommunityIcons name="account-multiple-plus-outline" size={17} color="#9298AD" />
          </Pressable>
          <Pressable accessibilityLabel="Nuevo mensaje" onPress={() => router.push('/new-message')} hitSlop={8} style={styles.headerAction}>
            <MaterialCommunityIcons name="pencil-outline" size={17} color="#F6F7FB" />
          </Pressable>
          <Pressable accessibilityLabel="Notificaciones y opciones" onPress={() => router.push('/notifications')} hitSlop={8} style={styles.headerAction}>
            <MaterialCommunityIcons name="dots-vertical" size={18} color="#9298AD" />
          </Pressable>
        </View>
      </View>

      {/* ── Search ──────────────────────────────────────────────────────── */}
      <View style={styles.searchWrap}>
        <MaterialCommunityIcons name="magnify" size={18} color={Colors.textSubtle} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Buscar conversaciones..."
          placeholderTextColor={Colors.textSubtle}
          returnKeyType="search"
        />
        {search ? (
          <Pressable onPress={() => setSearch('')} hitSlop={8}>
            <MaterialCommunityIcons name="close-circle" size={16} color={Colors.textSubtle} />
          </Pressable>
        ) : <MaterialCommunityIcons name="filter-variant" size={18} color="#9298AD" />}
      </View>

      {/* ── Tab bar ─────────────────────────────────────────────────────── */}
      <View style={styles.tabBar}>
        {TABS.map(t => (
          <Pressable
            key={t.key}
            style={[styles.tabBtn, activeTab === t.key && styles.tabBtnActive]}
            onPress={() => setActiveTab(t.key)}
          >
            <MaterialCommunityIcons
              name={t.icon as any}
              size={13}
              color={activeTab === t.key ? '#FFFFFF' : '#9298AD'}
            />
            <Text style={[styles.tabText, activeTab === t.key && styles.tabTextActive]}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {conversations.length === 0 && !isLoading ? (
        <View style={styles.centered}>
          <View style={styles.emptyIconWrap}>
            <LinearGradient colors={['#7C5CFF22', '#FF2D7811']} style={styles.emptyIconGrad}>
              <MaterialCommunityIcons name="message-text-outline" size={40} color={Colors.primary} />
            </LinearGradient>
          </View>
          <Text style={styles.emptyTitle}>Sin mensajes aún</Text>
          <Text style={styles.emptySubtitle}>Toca el botón de edición para iniciar una conversación</Text>
          <Pressable style={styles.startChatBtn} onPress={() => router.push('/new-message')}>
            <LinearGradient colors={['#7C5CFF', '#FF2D78']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.startChatBtnGrad}>
              <Text style={styles.startChatBtnText}>Iniciar conversación</Text>
            </LinearGradient>
          </Pressable>
        </View>
      ) : isLoading && conversations.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.primary} size="large" />
        </View>
      ) : (
        <FlatList
          data={sortedConversations}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingBottom: 100 + insets.bottom }}
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={() => { refreshConversations(); loadPremiumDMs(); }}
              tintColor={Colors.primary}
              colors={[Colors.primary]}
            />
          }
          renderItem={({ item }) => {
            const hasUnread = item.unreadCount > 0;
            const isPremium = item.conversationType === 'direct'
              && premiumDMs.some(p => p.sender_id === item.partnerId || p.recipient_id === item.partnerId);
            return (
              <Pressable
                style={({ pressed }) => [
                  styles.convItem,
                  hasUnread && styles.convItemUnread,
                  pressed && { backgroundColor: Colors.surfaceHighlight },
                ]}
                onPress={() => router.push(item.conversationType === 'group' ? `/chat/group/${item.id}` as any : `/chat/${item.partnerId}`)}
              >
                {/* Avatar with online dot */}
                <View style={styles.avatarWrap}>
                  {item.conversationType === 'group' ? (
                    <View style={styles.groupAvatarStack}>
                      <View style={styles.groupAvatarBack}>
                        <MaterialCommunityIcons name="account-group" size={18} color="#9298AD" />
                      </View>
                      <View style={styles.groupAvatarFront}>
                        <Avatar uri={item.avatar} username={item.displayName} size={34} />
                      </View>
                    </View>
                  ) : <Avatar uri={item.avatar} username={item.displayName} size={42} />}
                  {item.conversationType === 'direct' && item.partnerId && presenceByUser[item.partnerId] === 'online' ? (
                    <View style={styles.onlineDot} />
                  ) : null}
                </View>

                {/* Conversation info */}
                <View style={styles.convInfo}>
                  <View style={styles.convTopRow}>
                    <View style={styles.convNameRow}>
                      <Text style={[styles.convName, hasUnread && styles.convNameBold]}>
                        {item.displayName}
                      </Text>
                      {isPremium ? (
                        <View style={styles.premiumChip}>
                          <MaterialCommunityIcons name="crown-outline" size={13} color="#FFFFFF" />
                        </View>
                      ) : null}
                    </View>
                    <Text style={[styles.convTime, hasUnread && { color: Colors.primary }]}>
                      {timeAgo(item.lastMessageAt)}
                    </Text>
                  </View>
                  <View style={styles.convBottomRow}>
                    <Text
                      style={[styles.convLastMsg, hasUnread && styles.convLastMsgBold]}
                      numberOfLines={1}
                    >
                      {item.lastMessage || 'Inicia la conversación'}
                    </Text>
                    {hasUnread ? (
                      <View style={styles.unreadBadge}>
                        <Text style={styles.unreadBadgeText}>{item.unreadCount > 9 ? '9+' : item.unreadCount}</Text>
                      </View>
                    ) : (
                      <MaterialCommunityIcons name="check-all" size={16} color="#5EDCFF" />
                    )}
                  </View>
                </View>
              </Pressable>
            );
          }}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            search ? (
              <View style={styles.centered}>
                <Text style={styles.emptyTitle}>Sin resultados</Text>
                <Text style={styles.emptySubtitle}>Intenta con otro nombre</Text>
              </View>
            ) : null
          }
        />
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Nuevo mensaje"
        onPress={() => router.push('/new-message')}
        style={[styles.fab, { bottom: 18 + insets.bottom }]}
      >
        <LinearGradient colors={['#9B5CFF', '#7C3AED']} style={styles.fabGradient}>
          <MaterialCommunityIcons name="pencil-outline" size={22} color="#FFFFFF" />
        </LinearGradient>
      </Pressable>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080A12' },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 14, paddingBottom: 16 },
  headerBrand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerTitle: { fontSize: 26, fontWeight: FontWeight.bold, color: '#F6F7FB' },
  headerSubtitle: { color: '#9298AD', fontSize: 11, marginTop: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerAction: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#141827', borderWidth: 1, borderColor: '#23283A',
  },

  searchWrap: { height: 46, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#141827', borderRadius: 14, paddingHorizontal: 14, marginHorizontal: 20, marginBottom: 12, borderWidth: 1, borderColor: '#23283A' },
  searchInput: { flex: 1, color: '#F6F7FB', fontSize: 14 },

  // Tab bar
  tabBar: { flexDirection: 'row', gap: 8, marginHorizontal: 20, marginBottom: 14 },
  tabBtn: { flex: 1, height: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 17, backgroundColor: '#141827', borderWidth: 1, borderColor: '#23283A' },
  tabBtnActive: { backgroundColor: '#381A7A', borderColor: '#9B5CFF' },
  tabText: { color: '#9298AD', fontSize: 11, fontWeight: FontWeight.regular },
  tabTextActive: { color: '#FFFFFF', fontWeight: FontWeight.semibold },

  // Empty state
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, paddingHorizontal: Spacing.xl, paddingTop: 60 },
  emptyIconWrap: { borderRadius: Radius.xl, overflow: 'hidden' },
  emptyIconGrad: { width: 88, height: 88, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.xl },
  emptyTitle: { color: Colors.textSecondary, fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  emptySubtitle: { color: Colors.textSubtle, fontSize: FontSize.sm, textAlign: 'center', lineHeight: 20 },
  startChatBtn: { borderRadius: Radius.full, overflow: 'hidden', marginTop: Spacing.xs },
  startChatBtnGrad: { paddingHorizontal: 24, paddingVertical: 12 },
  startChatBtnText: { color: '#fff', fontSize: FontSize.sm, fontWeight: FontWeight.bold },

  // Conversation item
  convItem: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 13, marginHorizontal: 16, marginBottom: 6, paddingHorizontal: 10, paddingVertical: 9, backgroundColor: '#0F121C', borderRadius: 14, borderWidth: 1, borderColor: '#23283A' },
  convItemUnread: { backgroundColor: '#101421' },
  avatarWrap: { position: 'relative' },
  groupAvatarStack: { width: 52, height: 42 },
  groupAvatarBack: { position: 'absolute', left: 0, top: 2, width: 38, height: 38, borderRadius: 19, backgroundColor: '#171B29', borderWidth: 1, borderColor: '#9298AD', alignItems: 'center', justifyContent: 'center' },
  groupAvatarFront: { position: 'absolute', left: 18, top: 4, width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, borderColor: '#9B5CFF', overflow: 'hidden' },
  onlineDot: { position: 'absolute', bottom: 0, right: 0, width: 12, height: 12, borderRadius: 6, backgroundColor: '#35E28A', borderWidth: 2, borderColor: '#0F121C', alignItems: 'center', justifyContent: 'center' },
  convInfo: { flex: 1, gap: 4 },
  convTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  convNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  convName: { color: '#F6F7FB', fontSize: 14, fontWeight: FontWeight.semibold },
  convNameBold: { color: Colors.textPrimary, fontWeight: FontWeight.bold },
  premiumChip: { width: 22, height: 22, borderRadius: 6, backgroundColor: '#3A1B78', alignItems: 'center', justifyContent: 'center' },
  convTime: { color: '#9298AD', fontSize: 10 },
  convBottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  convLastMsg: { color: '#9298AD', fontSize: 11, flex: 1 },
  convLastMsgBold: { color: Colors.textSecondary, fontWeight: FontWeight.medium },
  unreadBadge: { backgroundColor: '#7C3AED', borderRadius: Radius.full, minWidth: 24, height: 24, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  unreadBadgeText: { color: '#fff', fontSize: 10, fontWeight: FontWeight.bold },
  separator: { height: 0 },
  fab: { position: 'absolute', right: 24, width: 48, height: 48, borderRadius: 24, overflow: 'hidden', zIndex: 20, elevation: 8 },
  fabGradient: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
