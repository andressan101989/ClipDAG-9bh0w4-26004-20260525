import React from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useNotifications } from '@/hooks/useNotifications';
import { Avatar } from '@/components/ui/Avatar';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { timeAgo } from '@/services/mockData';
import type { AppNotification, NotificationType } from '@/contexts/NotificationsContext';

const NOTIF_CONFIG: Record<NotificationType, { icon: string; gradient: string[] }> = {
  like:         { icon: 'heart',           gradient: ['#FF2D78', '#FF6FA8'] },
  comment:      { icon: 'comment',         gradient: ['#7C5CFF', '#B44FFF'] },
  follow:       { icon: 'account-plus',    gradient: ['#00E5A0', '#2D9EFF'] },
  gift:         { icon: 'gift',            gradient: ['#FFB800', '#FF8800'] },
  message:      { icon: 'message-text',    gradient: ['#2D9EFF', '#7C5CFF'] },
  sale:         { icon: 'shopping',        gradient: ['#00E5A0', '#2D9EFF'] },
  order_update: { icon: 'truck-delivery',  gradient: ['#2D9EFF', '#7C5CFF'] },
};

function NotifItem({ notif, onPress }: { notif: AppNotification; onPress: () => void }) {
  const conf = NOTIF_CONFIG[notif.type] || NOTIF_CONFIG.like;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.notifItem,
        !notif.read && styles.notifItemUnread,
        pressed && { opacity: 0.88 },
      ]}
      onPress={onPress}
    >
      <View style={styles.notifLeft}>
        <View style={styles.avatarWrap}>
          <Avatar uri={notif.fromAvatar} username={notif.fromUsername} size={46} />
          <View style={styles.iconBadgeWrap}>
            <LinearGradient
              colors={conf.gradient}
              style={styles.iconBadge}
            >
              <MaterialCommunityIcons name={conf.icon as any} size={10} color="#fff" />
            </LinearGradient>
          </View>
        </View>

        <View style={styles.notifContent}>
          <Text style={styles.notifText}>
            <Text style={styles.notifUsername}>@{notif.fromUsername} </Text>
            <Text>{notif.message}</Text>
          </Text>
          <Text style={styles.notifTime}>{timeAgo(notif.createdAt)}</Text>
        </View>
      </View>

      {!notif.read ? (
        <LinearGradient
          colors={['#7C5CFF', '#FF2D78']}
          style={styles.unreadDot}
        />
      ) : null}
    </Pressable>
  );
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { notifications, unreadCount, isLoading, markAllRead, markRead } = useNotifications();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={Colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>
          Notificaciones{unreadCount > 0 ? ` (${unreadCount})` : ''}
        </Text>
        {unreadCount > 0 ? (
          <Pressable onPress={markAllRead} hitSlop={8}>
            <Text style={styles.markAllText}>Marcar todo</Text>
          </Pressable>
        ) : (
          <View style={{ width: 70 }} />
        )}
      </View>

      {isLoading && notifications.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.primary} size="large" />
        </View>
      ) : notifications.length === 0 ? (
        <View style={styles.centered}>
          <LinearGradient
            colors={['#7C5CFF22', '#FF2D7811']}
            style={styles.emptyIconGrad}
          >
            <MaterialCommunityIcons name="bell-outline" size={40} color={Colors.primary} />
          </LinearGradient>
          <Text style={styles.emptyTitle}>Sin notificaciones</Text>
          <Text style={styles.emptySub}>Las notificaciones aparecen aqui</Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}
          renderItem={({ item }) => (
            <NotifItem notif={item} onPress={() => markRead(item.id)} />
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
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: {
    flex: 1, color: Colors.textPrimary, fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold, textAlign: 'center',
  },
  markAllText: {
    color: Colors.primary, fontSize: FontSize.xs,
    fontWeight: FontWeight.medium, width: 70, textAlign: 'right',
  },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  emptyIconGrad: {
    width: 80, height: 80, borderRadius: Radius.xl,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { color: Colors.textSecondary, fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  emptySub: { color: Colors.textSubtle, fontSize: FontSize.sm },

  notifItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingVertical: 14,
  },
  notifItemUnread: { backgroundColor: Colors.primaryDim + '18' },
  notifLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flex: 1 },
  avatarWrap: { position: 'relative' },
  iconBadgeWrap: {
    position: 'absolute', bottom: -2, right: -2,
    borderRadius: 10, borderWidth: 1.5, borderColor: Colors.bg,
  },
  iconBadge: {
    width: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
  },
  notifContent: { flex: 1, gap: 3 },
  notifText: { color: Colors.textSecondary, fontSize: FontSize.sm, lineHeight: 19 },
  notifUsername: { color: Colors.textPrimary, fontWeight: FontWeight.bold },
  notifTime: { color: Colors.textSubtle, fontSize: FontSize.xs },
  unreadDot: { width: 8, height: 8, borderRadius: 4 },
  separator: { height: 1, backgroundColor: Colors.borderSubtle },
});
