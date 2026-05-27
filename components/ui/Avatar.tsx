import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image } from '@/components/ui/SafeImage';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, Radius } from '@/constants/theme';

interface AvatarProps {
  uri?: string;
  username?: string;
  size?: number;
  showBorder?: boolean;
  borderColor?: string;
}

// Generate a consistent fallback avatar URL from username
function getAvatarFallback(username?: string, size?: number): string {
  const seed = encodeURIComponent(username || 'user');
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}`;
}

// Validate that a URI is a real remote URL (not local temp path)
function isRemoteUri(uri?: string): boolean {
  if (!uri) return false;
  return uri.startsWith('http://') || uri.startsWith('https://');
}

export function Avatar({ uri, username, size = 44, showBorder = false }: AvatarProps) {
  const borderW = showBorder ? 2 : 0;
  const innerSize = size - borderW * 2 - (showBorder ? 4 : 0);

  // Determine the actual source: prefer remote URI, fall back to dicebear
  const source = isRemoteUri(uri)
    ? { uri }
    : { uri: getAvatarFallback(username, size) };

  if (showBorder) {
    return (
      <LinearGradient
        colors={['#00D4FF', '#8B5CF6']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.borderWrap, { width: size, height: size, borderRadius: size / 2 }]}
      >
        <View style={[styles.innerWrap, { width: innerSize + 4, height: innerSize + 4, borderRadius: (innerSize + 4) / 2 }]}>
          <Image
            source={source}
            style={{ width: innerSize, height: innerSize, borderRadius: innerSize / 2 }}
            contentFit="cover"
            transition={200}
            // On error, dicebear will show initials-style avatar
          />
        </View>
      </LinearGradient>
    );
  }

  // Check if it's a local file URI (camera/gallery temp file) — render directly
  if (uri && (uri.startsWith('file://') || uri.startsWith('/var/') || uri.startsWith('/data/'))) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        contentFit="cover"
        transition={200}
      />
    );
  }

  return (
    <Image
      source={source}
      style={{ width: size, height: size, borderRadius: size / 2 }}
      contentFit="cover"
      transition={200}
    />
  );
}

const styles = StyleSheet.create({
  borderWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  innerWrap: {
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
