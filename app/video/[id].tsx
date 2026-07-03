/**
 * app/video/[id].tsx
 *
 * Deep-link target for onspaceapp://video/[id] (shared video links, push
 * notification taps, etc). There's no dedicated single-video player screen —
 * every video already renders via VideoCard in the main feed — so this just
 * hands off there. Before this file existed, that deep link had no matching
 * route and fell through to app/+not-found.tsx.
 */
import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors } from '@/constants/theme';

export default function VideoDeepLinkRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/(tabs)');
  }, [router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator color={Colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' },
});
