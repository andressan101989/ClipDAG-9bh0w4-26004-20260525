import React from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors, FontSize, FontWeight, Spacing, Radius } from '@/constants/theme';

const AVATAR_SIZE = 58;
const RING_PAD = 3;
const RING_SIZE = AVATAR_SIZE + RING_PAD * 2 + 4;

export interface StoryGroup {
  userId: string;
  username: string;
  avatar: string;
  hasUnseen: boolean;
  stories: StoryItem[];
}

export interface StoryItem {
  id: string;
  userId: string;
  mediaUrl: string;
  mediaType: 'photo' | 'video';
  createdAt: string;
  expiresAt: string;
}

interface StoriesBarProps {
  currentUserId: string;
  currentUserAvatar?: string;
  currentUsername?: string;
  storyGroups: StoryGroup[];
  onAddStory: () => void;
  onViewStory: (group: StoryGroup) => void;
}

function AvatarImage({ uri, username, size }: { uri?: string; username: string; size: number }) {
  const isRemote = uri && (uri.startsWith('http://') || uri.startsWith('https://'));
  const src = isRemote
    ? { uri }
    : { uri: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(username)}` };

  return (
    <Image
      source={src}
      style={{ width: size, height: size, borderRadius: size / 2 }}
      contentFit="cover"
      transition={150}
    />
  );
}

export function StoriesBar({
  currentUserId,
  currentUserAvatar,
  currentUsername,
  storyGroups,
  onAddStory,
  onViewStory,
}: StoriesBarProps) {
  return (
    <View style={styles.wrapper}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        decelerationRate="fast"
      >
        {/* ── My story / Add story ───────────────────────────────────────── */}
        <Pressable
          onPress={onAddStory}
          style={({ pressed }) => [styles.item, pressed && { opacity: 0.75 }]}
        >
          <View style={styles.addRingOuter}>
            {/* Dashed gradient border */}
            <LinearGradient
              colors={['#7C5CFF', '#FF2D78']}
              style={styles.addRingGrad}
            >
              <View style={styles.addRingBg}>
                <AvatarImage
                  uri={currentUserAvatar}
                  username={currentUsername || 'me'}
                  size={AVATAR_SIZE - 4}
                />
              </View>
            </LinearGradient>
            {/* Plus badge */}
            <View style={styles.addBadge}>
              <LinearGradient
                colors={['#7C5CFF', '#FF2D78']}
                style={styles.addBadgeGrad}
              >
                <MaterialCommunityIcons name="plus" size={12} color="#fff" />
              </LinearGradient>
            </View>
          </View>
          <Text style={styles.label} numberOfLines={1}>Tu historia</Text>
        </Pressable>

        {/* ── Other users' stories ───────────────────────────────────────── */}
        {storyGroups.map(group => (
          <Pressable
            key={group.userId}
            onPress={() => onViewStory(group)}
            style={({ pressed }) => [styles.item, pressed && { opacity: 0.75 }]}
          >
            <View style={styles.storyRingOuter}>
              {group.hasUnseen ? (
                <LinearGradient
                  colors={['#7C5CFF', '#FF2D78', '#FF9F0A']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.storyRingGrad}
                >
                  <View style={styles.storyRingBg}>
                    <AvatarImage
                      uri={group.avatar}
                      username={group.username}
                      size={AVATAR_SIZE - 4}
                    />
                  </View>
                </LinearGradient>
              ) : (
                <View style={styles.storyRingGradSeen}>
                  <View style={styles.storyRingBg}>
                    <AvatarImage
                      uri={group.avatar}
                      username={group.username}
                      size={AVATAR_SIZE - 4}
                    />
                  </View>
                </View>
              )}

              {/* Unseen dot indicator */}
              {group.hasUnseen ? (
                <View style={styles.unseenDot} />
              ) : null}
            </View>

            <Text
              style={[styles.label, group.hasUnseen && styles.labelUnseen]}
              numberOfLines={1}
            >
              {group.username.length > 8
                ? group.username.substring(0, 8) + '…'
                : group.username}
            </Text>
          </Pressable>
        ))}

        {/* ── Empty hint ────────────────────────────────────────────────── */}
        {storyGroups.length === 0 ? (
          <View style={styles.emptyHint}>
            <MaterialCommunityIcons name="account-group-outline" size={15} color={Colors.textSubtle} />
            <Text style={styles.emptyHintText}>Sigue creadores para ver sus historias</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: 'rgba(10,10,15,0.9)',
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSubtle,
    paddingVertical: 10,
  },
  scrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    gap: Spacing.md,
    minHeight: RING_SIZE + 26,
  },
  item: {
    alignItems: 'center',
    gap: 6,
    width: RING_SIZE,
  },

  // ── Add story ring ─────────────────────────────────────────────────────────
  addRingOuter: {
    position: 'relative',
    width: RING_SIZE,
    height: RING_SIZE,
  },
  addRingGrad: {
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    padding: RING_PAD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addRingBg: {
    flex: 1,
    borderRadius: (RING_SIZE - RING_PAD * 2) / 2,
    overflow: 'hidden',
    backgroundColor: Colors.surface,
    borderWidth: 2,
    borderColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    zIndex: 10,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: Colors.bg,
    overflow: 'hidden',
  },
  addBadgeGrad: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Story ring ─────────────────────────────────────────────────────────────
  storyRingOuter: {
    position: 'relative',
    width: RING_SIZE,
    height: RING_SIZE,
  },
  storyRingGrad: {
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    padding: RING_PAD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyRingGradSeen: {
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    padding: RING_PAD,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.border,
  },
  storyRingBg: {
    flex: 1,
    borderRadius: (RING_SIZE - RING_PAD * 2) / 2,
    overflow: 'hidden',
    backgroundColor: Colors.surface,
    borderWidth: 2,
    borderColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unseenDot: {
    position: 'absolute',
    bottom: 1,
    right: 1,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.primary,
    borderWidth: 2,
    borderColor: Colors.bg,
    zIndex: 10,
  },

  // ── Labels ─────────────────────────────────────────────────────────────────
  label: {
    color: Colors.textSubtle,
    fontSize: 10,
    fontWeight: FontWeight.medium,
    maxWidth: RING_SIZE,
    textAlign: 'center',
    letterSpacing: 0.1,
  },
  labelUnseen: {
    color: Colors.textSecondary,
    fontWeight: FontWeight.semibold,
  },
  emptyHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.sm,
  },
  emptyHintText: {
    color: Colors.textSubtle,
    fontSize: FontSize.xs,
  },
});
