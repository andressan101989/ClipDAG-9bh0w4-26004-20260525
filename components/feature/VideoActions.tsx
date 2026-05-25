import React, { useState, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, Animated } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/Avatar';
import { Colors, FontSize, FontWeight, Spacing } from '@/constants/theme';
import { Video, formatNumber } from '@/services/mockData';

interface VideoActionsProps {
  video: Video;
  isLiked: boolean;
  onLike: () => void;
  onComment: () => void;
  onShare: () => void;
  onProfilePress: () => void;
}

export function VideoActions({
  video,
  isLiked,
  onLike,
  onComment,
  onShare,
  onProfilePress,
}: VideoActionsProps) {
  const heartScale = useRef(new Animated.Value(1)).current;

  const handleLike = () => {
    Animated.sequence([
      Animated.spring(heartScale, { toValue: 1.4, useNativeDriver: true, speed: 40 }),
      Animated.spring(heartScale, { toValue: 1, useNativeDriver: true, speed: 40 }),
    ]).start();
    onLike();
  };

  return (
    <View style={styles.container}>
      {/* Avatar with follow button */}
      <View style={styles.avatarWrap}>
        <Pressable onPress={onProfilePress}>
          <Avatar uri={video.userAvatar} username={video.username} size={48} showBorder />
        </Pressable>
        <View style={styles.followDot}>
          <MaterialIcons name="add" size={12} color="#fff" />
        </View>
      </View>

      {/* Like */}
      <Pressable style={styles.action} onPress={handleLike} hitSlop={8}>
        <Animated.View style={{ transform: [{ scale: heartScale }] }}>
          <MaterialIcons
            name={isLiked ? 'favorite' : 'favorite-border'}
            size={32}
            color={isLiked ? Colors.secondary : '#ffffff'}
          />
        </Animated.View>
        <Text style={styles.actionCount}>{formatNumber(video.likes)}</Text>
      </Pressable>

      {/* Comment */}
      <Pressable style={styles.action} onPress={onComment} hitSlop={8}>
        <MaterialIcons name="chat-bubble-outline" size={30} color="#ffffff" />
        <Text style={styles.actionCount}>{formatNumber(video.comments)}</Text>
      </Pressable>

      {/* Share */}
      <Pressable style={styles.action} onPress={onShare} hitSlop={8}>
        <MaterialIcons name="share" size={30} color="#ffffff" />
        <Text style={styles.actionCount}>{formatNumber(video.shares)}</Text>
      </Pressable>

      {/* DAG Reward Indicator */}
      <View style={styles.dagIndicator}>
        <Text style={styles.dagIcon}>◈</Text>
        <Text style={styles.dagText}>0.01</Text>
      </View>

      {/* Music disc */}
      <View style={styles.musicDisc}>
        <Text style={styles.musicNote}>♪</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  avatarWrap: {
    position: 'relative',
  },
  followDot: {
    position: 'absolute',
    bottom: -6,
    left: '50%',
    marginLeft: -8,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  action: {
    alignItems: 'center',
    gap: Spacing.xs,
  },
  actionCount: {
    color: '#FFFFFF',
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  dagIndicator: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 212, 255, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 255, 0.5)',
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  dagIcon: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: FontWeight.bold,
  },
  dagText: {
    color: Colors.primary,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
  musicDisc: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  musicNote: {
    fontSize: FontSize.lg,
    color: Colors.textPrimary,
  },
});
