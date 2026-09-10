import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from '@/components/ui/SafeImage';
import { Avatar } from '@/components/ui/Avatar';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Radius, Spacing } from '@/constants/theme';
import type { StorySharedContent } from '@/contexts/StoriesContext';

export function StorySharedContentCard({
  storyId, load, onReadyChange, onOpen,
}: {
  storyId: string;
  load: (storyId: string) => Promise<StorySharedContent>;
  onReadyChange: (ready: boolean) => void;
  onOpen: (videoId: string) => void;
}) {
  const [content, setContent] = useState<StorySharedContent | null>(null);
  const [failed, setFailed] = useState(false);
  const requestGenerationRef = useRef(0);
  const request = useCallback(() => {
    const generation = ++requestGenerationRef.current;
    setFailed(false);
    setContent(null);
    onReadyChange(false);
    load(storyId).then(value => {
      if (generation !== requestGenerationRef.current) return;
      setContent(value);
      onReadyChange(true);
    }).catch(() => {
      if (generation !== requestGenerationRef.current) return;
      setFailed(true);
      onReadyChange(false);
    });
  }, [load, onReadyChange, storyId]);
  useEffect(() => {
    request();
    return () => { requestGenerationRef.current += 1; };
  }, [request]);

  if (failed) return (
    <View style={styles.center} pointerEvents="box-none">
      <Text style={styles.unavailable}>No pudimos comprobar este contenido.</Text>
      <Pressable onPress={request} style={styles.retry}><Text style={styles.retryText}>Reintentar</Text></Pressable>
    </View>
  );
  if (!content) return <View style={styles.center} pointerEvents="box-none"><ActivityIndicator color="#fff" /></View>;
  if (content.status === 'unavailable') return (
    <View style={styles.center} pointerEvents="box-none"><MaterialIcons name="hide-source" color="#fff" size={44} /><Text style={styles.unavailable}>Contenido no disponible</Text></View>
  );
  return (
    <View style={styles.center} pointerEvents="box-none">
      <Pressable accessibilityRole="button" accessibilityLabel="Abrir contenido original" onPress={() => onOpen(content.sourceVideoId)} style={styles.card}>
        {content.previewUrl ? <Image source={{ uri: content.previewUrl }} style={styles.image} contentFit="cover" /> : <View style={styles.image}><MaterialIcons name="play-circle-outline" color="#fff" size={54} /></View>}
        <View style={styles.copy}>
          <Text style={styles.type}>{content.contentType === 'reel' ? 'REEL' : 'POST'} · CONTENIDO ORIGINAL</Text>
          <View style={styles.creator}>
            <Avatar uri={content.avatarUrl || ''} username={content.username} size={30} />
            <Text style={styles.user}>@{content.username}</Text>
          </View>
          {content.caption ? <Text numberOfLines={2} style={styles.caption}>{content.caption}</Text> : null}
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b0b10' },
  card: { width: '82%', maxWidth: 430, borderRadius: 24, overflow: 'hidden', backgroundColor: '#202027', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', zIndex: 4 },
  image: { width: '100%', height: 320, backgroundColor: '#292933', alignItems: 'center', justifyContent: 'center' },
  copy: { padding: Spacing.md },
  type: { color: Colors.primary, fontSize: 11, fontWeight: '900' },
  creator: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 7 },
  user: { color: '#fff', fontWeight: '800', fontSize: 16 },
  caption: { color: '#ddd', marginTop: 6, lineHeight: 19 },
  unavailable: { color: '#fff', marginTop: 12, fontSize: 15 },
  retry: { marginTop: 14, borderRadius: Radius.full, backgroundColor: Colors.primary, paddingHorizontal: 18, paddingVertical: 9 },
  retryText: { color: '#fff', fontWeight: '800' },
});
