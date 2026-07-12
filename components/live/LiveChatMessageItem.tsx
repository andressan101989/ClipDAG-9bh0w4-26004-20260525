import React, { memo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Colors, FontWeight } from '@/constants/theme';

type LiveChatMessageItemProps = {
  username: string;
  message: string;
  avatarUrl?: string | null;
  isHost?: boolean;
};

export const LiveChatMessageItem = memo(function LiveChatMessageItem({
  username,
  message,
  avatarUrl,
  isHost = false,
}: LiveChatMessageItemProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const safeUsername = username || 'user';
  const initial = safeUsername.trim().charAt(0).toUpperCase() || '?';

  return (
    <View style={styles.row}>
      {avatarUrl && !imageFailed ? (
        <Image
          source={{ uri: avatarUrl }}
          style={styles.avatar}
          contentFit="cover"
          transition={120}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <View style={styles.avatarFallback}>
          <Text style={styles.avatarInitial}>{initial}</Text>
        </View>
      )}
      <View style={styles.bubble}>
        <Text style={[styles.name, isHost && styles.hostName]} numberOfLines={1}>
          {isHost ? '\uD83C\uDFA5 ' : ''}{safeUsername}
        </Text>
        <Text style={styles.message}>{message}</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
  },
  avatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
  },
  avatarFallback: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(124,92,255,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
  },
  avatarInitial: {
    color: '#fff',
    fontSize: 11,
    fontWeight: FontWeight.bold,
  },
  bubble: {
    minWidth: 0,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  name: {
    color: '#fff',
    fontSize: 12,
    fontWeight: FontWeight.bold,
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  hostName: {
    color: Colors.primary,
  },
  message: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});
