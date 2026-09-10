import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from '@/components/ui/SafeImage';
import { Avatar } from '@/components/ui/Avatar';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
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
      <View style={styles.unavailableCard}>
        <MaterialIcons name="cloud-off" color={Colors.textSecondary} size={38} />
        <Text style={styles.unavailable}>No pudimos comprobar este contenido.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Reintentar contenido" onPress={request} style={styles.retry}><Text style={styles.retryText}>Reintentar</Text></Pressable>
      </View>
    </View>
  );
  if (!content) return <View style={styles.center} pointerEvents="box-none"><ActivityIndicator color="#fff" /></View>;
  if (content.status === 'unavailable') return (
    <View style={styles.center} pointerEvents="box-none"><View style={styles.unavailableCard}><MaterialIcons name="hide-source" color={Colors.textSecondary} size={42} /><Text style={styles.unavailable}>Contenido no disponible</Text></View></View>
  );
  const cta = content.contentType === 'reel' ? 'Ver reel' : 'Ver publicación';
  return (
    <View style={styles.center} pointerEvents="box-none">
      <Pressable accessibilityRole="button" accessibilityLabel="Abrir contenido original" accessibilityHint={`${cta} de @${content.username}`} onPress={() => onOpen(content.sourceVideoId)} style={styles.card}>
        {content.previewUrl ? <Image source={{ uri: content.previewUrl }} style={styles.image} contentFit="cover" /> : <View style={styles.image}><MaterialIcons name="play-circle-outline" color="#fff" size={54} /></View>}
        <LinearGradient colors={['transparent', 'rgba(10,10,15,0.94)']} style={styles.imageShade} pointerEvents="none" />
        <View style={styles.copy}>
          <Text style={styles.type}>{content.contentType === 'reel' ? 'REEL' : 'POST'}</Text>
          <View style={styles.creator}>
            <Avatar uri={content.avatarUrl || ''} username={content.username} size={30} />
            <Text style={styles.user}>@{content.username}</Text>
          </View>
          {content.caption ? <Text numberOfLines={2} style={styles.caption}>{content.caption}</Text> : null}
          <View style={styles.ctaRow}>
            <Text style={styles.cta}>{cta}</Text>
            <MaterialIcons name="arrow-forward" color={Colors.textPrimary} size={16} />
          </View>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bg },
  card: { width: '84%', maxWidth: 430, borderRadius: Radius.xl, overflow: 'hidden', backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.borderHighlight, zIndex: 4, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 18, elevation: 9 },
  image: { width: '100%', aspectRatio: 4 / 3, backgroundColor: Colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center' },
  imageShade: { position: 'absolute', top: 80, left: 0, right: 0, height: 170 },
  copy: { padding: Spacing.md },
  type: { alignSelf: 'flex-start', color: Colors.primaryLight, fontSize: FontSize.xs, fontWeight: FontWeight.extrabold, letterSpacing: 0.8 },
  creator: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 7 },
  user: { color: Colors.textPrimary, fontWeight: FontWeight.extrabold, fontSize: FontSize.md },
  caption: { color: Colors.textSecondary, marginTop: Spacing.sm, lineHeight: 19 },
  ctaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: Spacing.xs, marginTop: Spacing.md },
  cta: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  unavailableCard: { width: '80%', maxWidth: 360, minHeight: 180, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surfaceElevated, padding: Spacing.lg },
  unavailable: { color: Colors.textPrimary, marginTop: Spacing.sm, fontSize: FontSize.md, textAlign: 'center' },
  retry: { marginTop: 14, borderRadius: Radius.full, backgroundColor: Colors.primary, paddingHorizontal: 18, paddingVertical: 9 },
  retryText: { color: '#fff', fontWeight: '800' },
});
