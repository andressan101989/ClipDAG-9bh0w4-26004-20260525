import React from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Avatar } from '@/components/ui/Avatar';
import { useMessages } from '@/hooks/useMessages';
import { useAuth } from '@/hooks/useAuth';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { timeAgo } from '@/services/mockData';
import type { Conversation } from '@/contexts/MessagesContext';

function ConversationItem({ conv, currentUserId, onPress }: {
  conv: Conversation; currentUserId: string; onPress: () => void;
}) {
  const isLastMine = conv.lastMessage?.senderId === currentUserId;
  const hasUnread = (conv.unreadCount || 0) > 0;

  return (
    <Pressable
      style={({ pressed }) => [styles.convItem, pressed && { opacity: 0.85 }]}
      onPress={onPress}
    >
      <View style={styles.convAvatar}>
        <Avatar uri={conv.otherUserAvatar} username={conv.otherUsername} size={50} showBorder={hasUnread} />
        {hasUnread ? (
          <View style={styles.onlineDot} />
        ) : null}
      </View>
      <View style={styles.convContent}>
        <View style={styles.convRow}>
          <Text style={[styles.convName, hasUnread && styles.convNameUnread]} numberOfLines={1}>
            @{conv.otherUsername}
          </Text>
          <Text style={styles.convTime}>
            {conv.lastMessage?.createdAt ? timeAgo(conv.lastMessage.createdAt) : ''}
          </Text>
        </View>
        <View style={styles.convPreviewRow}>
          {isLastMine ? <Text style={styles.convMine}>Tú: </Text> : null}
          <Text
            style={[styles.convPreview, hasUnread && styles.convPreviewUnread]}
            numberOfLines={1}
          >
            {conv.lastMessage?.text || (conv.lastMessage?.mediaType !== 'text' ? '📷 Media' : 'Sin mensajes')}
          </Text>
          {hasUnread ? (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadBadgeText}>{conv.unreadCount > 9 ? '9+' : conv.unreadCount}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export default function MessagesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { conversations, isLoading } = useMessages();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={24} color={Colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Mensajes</Text>
        <Pressable
          style={styles.newMsgBtn}
          onPress={() => router.push('/new-message')}
          hitSlop={8}
        >
          <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={styles.newMsgGrad}>
            <MaterialCommunityIcons name="pencil-plus-outline" size={18} color="#fff" />
          </LinearGradient>
        </Pressable>
      </View>

      {isLoading && conversations.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.primary} size="large" />
        </View>
      ) : conversations.length === 0 ? (
        <View style={styles.centered}>
          <LinearGradient colors={['#7C5CFF22', '#FF2D7811']} style={styles.emptyIconGrad}>
            <MaterialCommunityIcons name="message-text-outline" size={40} color={Colors.primary} />
          </LinearGradient>
          <Text style={styles.emptyTitle}>Sin mensajes</Text>
          <Text style={styles.emptySub}>Inicia una conversación con un creador</Text>
          <Pressable style={styles.newChatBtn} onPress={() => router.push('/new-message')}>
            <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={styles.newChatBtnGrad}>
              <Text style={styles.newChatBtnText}>Nuevo mensaje</Text>
            </LinearGradient>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <ConversationItem
              conv={item}
              currentUserId={user?.id || ''}
              onPress={() => router.push(`/chat/${item.otherUserId}`)}
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.bold },
  newMsgBtn: { borderRadius: Radius.lg, overflow: 'hidden' },
  newMsgGrad: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  emptyIconGrad: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { color: Colors.textSecondary, fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  emptySub: { color: Colors.textSubtle, fontSize: FontSize.sm, textAlign: 'center' },
  newChatBtn: { borderRadius: Radius.full, overflow: 'hidden', marginTop: Spacing.sm },
  newChatBtnGrad: { paddingHorizontal: 28, paddingVertical: 12 },
  newChatBtnText: { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },

  convItem: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.md, paddingVertical: 12,
  },
  convAvatar: { position: 'relative' },
  onlineDot: {
    position: 'absolute', bottom: 1, right: 1,
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: Colors.accent, borderWidth: 2, borderColor: Colors.bg,
  },
  convContent: { flex: 1 },
  convRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 },
  convName: { color: Colors.textSecondary, fontSize: FontSize.md, fontWeight: FontWeight.medium, flex: 1 },
  convNameUnread: { color: Colors.textPrimary, fontWeight: FontWeight.bold },
  convTime: { color: Colors.textSubtle, fontSize: FontSize.xs },
  convPreviewRow: { flexDirection: 'row', alignItems: 'center', gap: 2, flex: 1 },
  convMine: { color: Colors.textSubtle, fontSize: FontSize.sm },
  convPreview: { color: Colors.textSubtle, fontSize: FontSize.sm, flex: 1 },
  convPreviewUnread: { color: Colors.textSecondary, fontWeight: FontWeight.medium },
  unreadBadge: {
    backgroundColor: Colors.primary, borderRadius: Radius.full,
    minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
  },
  unreadBadgeText: { color: '#fff', fontSize: 10, fontWeight: FontWeight.bold },
  separator: { height: 1, backgroundColor: Colors.borderSubtle, marginLeft: 74 },
});
