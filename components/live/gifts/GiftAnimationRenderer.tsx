import React, { memo, useEffect, useMemo, useRef } from 'react';
import { Animated, Dimensions, StyleSheet, Text, View } from 'react-native';
import type { GiftPresentationEntry } from './giftPresentationQueue';
import { GiftComboBadge } from './GiftComboBadge';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

type Props = {
  entry: GiftPresentationEntry;
  reducedMotion: boolean;
};

function GiftCard({ entry, large = false }: { entry: GiftPresentationEntry; large?: boolean }) {
  const { event } = entry;
  return (
    <View
      style={[styles.card, large && styles.cardLarge]}
      accessible
      accessibilityLabel={`${event.senderDisplayName} envió ${event.label}`}
    >
      <Text style={[styles.cardIcon, large && styles.cardIconLarge]}>{event.icon}</Text>
      <View style={styles.cardCopy}>
        <Text style={styles.sender} numberOfLines={1}>{event.senderDisplayName}</Text>
        <Text style={styles.giftName} numberOfLines={1}>envió {event.label}</Text>
      </View>
      <GiftComboBadge count={entry.comboCount} />
    </View>
  );
}

function DecorativeParticles({ entry, progress }: { entry: GiftPresentationEntry; progress: Animated.Value }) {
  const particles = useMemo(
    () => Array.from({ length: entry.animation.particleCount }, (_, index) => index),
    [entry.animation.particleCount],
  );
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {particles.map(index => {
        const angle = (index / particles.length) * Math.PI * 2;
        const radius = entry.animation.exclusive ? Math.min(SCREEN_WIDTH, SCREEN_HEIGHT) * 0.42 : 105;
        const endX = Math.cos(angle) * radius;
        const endY = Math.sin(angle) * radius;
        return (
          <Animated.Text
            key={index}
            style={[
              styles.particle,
              {
                color: entry.animation.colors[index % entry.animation.colors.length],
                opacity: progress.interpolate({ inputRange: [0, 0.16, 0.78, 1], outputRange: [0, 0.9, 0.75, 0] }),
                transform: [
                  { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, endX] }) },
                  { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, endY] }) },
                  { scale: progress.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.35, 1, 0.7] }) },
                ],
              },
            ]}
          >
            {index % 3 === 0 ? '✦' : index % 3 === 1 ? '•' : '✧'}
          </Animated.Text>
        );
      })}
    </View>
  );
}

export const GiftAnimationRenderer = memo(function GiftAnimationRenderer({ entry, reducedMotion }: Props) {
  const progress = useRef(new Animated.Value(0)).current;
  const { event, animation } = entry;

  useEffect(() => {
    progress.setValue(0);
    if (reducedMotion) {
      progress.setValue(1);
      return undefined;
    }
    const running = Animated.timing(progress, {
      toValue: 1,
      duration: animation.durationMs,
      useNativeDriver: true,
    });
    running.start();
    return () => running.stop();
  }, [animation.durationMs, event.eventId, progress, reducedMotion]);

  if (reducedMotion) {
    return <View style={styles.reducedMotion}><GiftCard entry={entry} large={animation.exclusive} /></View>;
  }

  const opacity = progress.interpolate({ inputRange: [0, 0.1, 0.86, 1], outputRange: [0, 1, 1, 0] });
  const commonScale = progress.interpolate({ inputRange: [0, 0.18, 0.82, 1], outputRange: [0.65, 1.08, 1, 0.94] });

  if (animation.compact) {
    const compactTranslateX = animation.family === 'heart_wave'
      ? progress.interpolate({ inputRange: [0, 0.33, 0.66, 1], outputRange: [-12, 18, -10, 12] })
      : progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [-8, 18, -4] });
    return (
      <Animated.View style={[styles.floating, { opacity, transform: [
        { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [72, -145] }) },
        { translateX: compactTranslateX },
        { scale: commonScale },
      ] }]}>
        {animation.family === 'sparkle_burst' || animation.family === 'celebration' ? (
          <DecorativeParticles entry={entry} progress={progress} />
        ) : null}
        <GiftCard entry={entry} />
      </Animated.View>
    );
  }

  const isWideScene = animation.tier === 'epic' || animation.tier === 'legendary'
    || animation.family === 'premium_scene' || animation.family === 'legendary_scene';
  const hasDimmer = animation.family === 'spotlight' || isWideScene;
  const rotation = animation.family === 'orbit'
    ? progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '210deg'] })
    : '0deg';
  const waveX = animation.family === 'heart_wave'
    ? progress.interpolate({ inputRange: [0, 0.33, 0.66, 1], outputRange: [-24, 24, -18, 20] })
    : 0;

  return (
    <View style={styles.scene} pointerEvents="none">
      {hasDimmer ? (
        <Animated.View
          style={[styles.dimmer, animation.exclusive && styles.legendaryDimmer, { opacity: progress.interpolate({ inputRange: [0, 0.16, 0.84, 1], outputRange: [0, 0.42, 0.38, 0] }) }]}
          accessibilityElementsHidden
        />
      ) : null}
      <Animated.View style={[
        styles.hero,
        isWideScene && styles.heroWide,
        {
          opacity,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 0.2, 0.84, 1], outputRange: [58, 0, 0, -22] }) },
            { translateX: waveX },
            { rotate: rotation },
            { scale: commonScale },
          ],
        },
      ]}>
        <View style={[styles.aura, { backgroundColor: `${animation.colors[0]}33`, borderColor: animation.colors[1] }]} accessibilityElementsHidden />
        <Text style={[styles.heroIcon, isWideScene && styles.heroIconLarge]}>{event.icon}</Text>
        {animation.family === 'orbit' ? (
          <>
            <Text style={[styles.orbiter, styles.orbiterOne]} accessibilityElementsHidden>{event.icon}</Text>
            <Text style={[styles.orbiter, styles.orbiterTwo]} accessibilityElementsHidden>{event.icon}</Text>
            <Text style={[styles.orbiter, styles.orbiterThree]} accessibilityElementsHidden>{event.icon}</Text>
          </>
        ) : null}
        <DecorativeParticles entry={entry} progress={progress} />
      </Animated.View>
      <Animated.View style={[styles.caption, isWideScene && styles.captionWide, { opacity, transform: [{ scale: commonScale }] }]}>
        <GiftCard entry={entry} large={isWideScene} />
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  scene: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  dimmer: { ...StyleSheet.absoluteFillObject, backgroundColor: '#100A1E' },
  legendaryDimmer: { backgroundColor: '#030313' },
  reducedMotion: { position: 'absolute', top: '38%', left: 16, right: 16, alignItems: 'center' },
  floating: { position: 'absolute', left: 12, bottom: 130, maxWidth: SCREEN_WIDTH - 24 },
  hero: { width: 240, height: 240, alignItems: 'center', justifyContent: 'center' },
  heroWide: { width: Math.min(SCREEN_WIDTH - 24, 360), height: Math.min(SCREEN_HEIGHT * 0.48, 390) },
  aura: { position: 'absolute', width: 176, height: 176, borderRadius: 88, borderWidth: 2 },
  heroIcon: { fontSize: 96, textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 3 }, textShadowRadius: 10 },
  heroIconLarge: { fontSize: 132 },
  orbiter: { position: 'absolute', fontSize: 27 },
  orbiterOne: { top: 18, left: 52 },
  orbiterTwo: { right: 28, top: 96 },
  orbiterThree: { left: 38, bottom: 36 },
  particle: { position: 'absolute', left: '50%', top: '50%', fontSize: 17, fontWeight: '900', textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  caption: { position: 'absolute', top: '63%', left: 14, right: 14, alignItems: 'center' },
  captionWide: { top: '70%' },
  card: { maxWidth: SCREEN_WIDTH - 28, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 27, backgroundColor: 'rgba(8,8,15,0.82)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)' },
  cardLarge: { minHeight: 66, paddingHorizontal: 16, borderColor: '#FFD54A' },
  cardIcon: { fontSize: 30 },
  cardIconLarge: { fontSize: 42 },
  cardCopy: { minWidth: 0, flexShrink: 1 },
  sender: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  giftName: { color: '#F3F0FF', fontSize: 13, fontWeight: '700', marginTop: 2 },
});
