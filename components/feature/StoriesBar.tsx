import React from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from '@/components/ui/SafeImage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors, FontSize, FontWeight, Spacing } from '@/constants/theme';
import type { StoryReactionKey } from './storyReactions';
import type { StoryComposition } from './storyComposition';

const AVATAR_SIZE = 60;
const RING_PAD = 4;
const RING_SIZE = 68;
// Figma visual authority: ClipDAG Stories V2 Final, node 2:178.

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
  mediaAssetId?: string;
  mediaUrl?: string | null;
  mediaType: 'photo' | 'video';
  storyKind: 'media' | 'shared';
  composition: StoryComposition;
  createdAt: string;
  expiresAt: string;
  viewerReaction?: StoryReactionKey | null;
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

export function StoryAvatarRing({
  uri,
  username,
  hasUnseen,
  ringSize = RING_SIZE,
  avatarSize = AVATAR_SIZE,
  ringPadding = RING_PAD,
}: {
  uri?: string;
  username: string;
  hasUnseen: boolean;
  ringSize?: number;
  avatarSize?: number;
  ringPadding?: number;
}) {
  const ringShape = {
    width: ringSize,
    height: ringSize,
    borderRadius: ringSize / 2,
    padding: ringPadding,
  };
  return (
    <View style={[styles.storyRingOuter, { width: ringSize, height: ringSize }]}>
      {hasUnseen ? (
        <LinearGradient
          colors={['#7C5CFF', '#5B4DE8']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.storyRingGrad, ringShape]}
        >
          <View style={styles.storyRingBg}>
            <AvatarImage uri={uri} username={username} size={avatarSize} />
          </View>
        </LinearGradient>
      ) : (
        <View style={[styles.storyRingGradSeen, ringShape]}>
          <View style={styles.storyRingBg}>
            <AvatarImage uri={uri} username={username} size={avatarSize} />
          </View>
        </View>
      )}
    </View>
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
  const ownStoryGroup = storyGroups.find(group => group.userId === currentUserId) ?? null;
  const otherStoryGroups = storyGroups.filter(group => group.userId !== currentUserId);

  return (
    <View style={styles.wrapper}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        decelerationRate="fast"
      >
        {/* ── My story / Add story ───────────────────────────────────────── */}
        <View style={styles.item}>
          <View style={styles.storyPrimary}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={ownStoryGroup ? 'Ver tu historia' : 'Añadir historia'}
              onPress={() => ownStoryGroup ? onViewStory(ownStoryGroup) : onAddStory()}
              style={({ pressed }) => pressed && styles.pressed}
            >
              {ownStoryGroup ? (
                <StoryAvatarRing
                  uri={currentUserAvatar}
                  username={currentUsername || 'me'}
                  hasUnseen={ownStoryGroup.hasUnseen}
                />
              ) : (
                <View style={styles.addRingOuter}>
                  <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={styles.addRingGrad}>
                    <View style={styles.addRingBg}>
                      <AvatarImage
                        uri={currentUserAvatar}
                        username={currentUsername || 'me'}
                        size={AVATAR_SIZE}
                      />
                    </View>
                  </LinearGradient>
                </View>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={ownStoryGroup ? 'Añadir otra historia' : 'Añadir historia'}
              hitSlop={6}
              onPress={onAddStory}
              style={({ pressed }) => [styles.addBadge, pressed && styles.pressed]}
            >
              <LinearGradient
                colors={['#7C5CFF', '#FF2D78']}
                style={styles.addBadgeGrad}
              >
                <MaterialCommunityIcons name="plus" size={12} color="#fff" />
              </LinearGradient>
            </Pressable>
          </View>
          <Text style={[styles.label, ownStoryGroup?.hasUnseen && styles.labelUnseen]} numberOfLines={1}>Tu historia</Text>
        </View>

        {/* ── Other users' stories ───────────────────────────────────────── */}
        {otherStoryGroups.map(group => (
          <Pressable
            key={group.userId}
            accessibilityRole="button"
            accessibilityLabel={`Ver historias de ${group.username}`}
            onPress={() => onViewStory(group)}
            style={({ pressed }) => [styles.item, pressed && styles.pressed]}
          >
            <StoryAvatarRing
              uri={group.avatar}
              username={group.username}
              hasUnseen={group.hasUnseen}
            />

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
        {otherStoryGroups.length === 0 && !ownStoryGroup ? (
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
    backgroundColor: '#0B0B10',
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSubtle,
    paddingVertical: 20,
  },
  scrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 19,
    gap: 24,
    minHeight: RING_SIZE + 26,
  },
  item: {
    alignItems: 'center',
    gap: 8,
    width: RING_SIZE,
  },
  storyPrimary: {
    position: 'relative',
    width: RING_SIZE,
    height: RING_SIZE,
  },
  pressed: { opacity: 0.72, transform: [{ scale: 0.97 }] },

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
    borderColor: '#2A2B36',
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
  // ── Labels ─────────────────────────────────────────────────────────────────
  label: {
    color: Colors.textSubtle,
    fontSize: 11,
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
