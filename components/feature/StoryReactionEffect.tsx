import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  storyReactionDefinition,
  type StoryReactionKey,
} from './storyReactions';

export const STORY_REACTION_EFFECT_DURATION_MS = 980;
export const STORY_REACTION_REDUCED_MOTION_DURATION_MS = 700;

const PARTICLE_OFFSETS = [-0.34, -0.21, -0.1, 0.04, 0.16, 0.29, -0.26, 0.24] as const;

interface StoryReactionEffectProps {
  reaction: StoryReactionKey | null;
  effectToken: number;
}

/** Ephemeral, local-only feedback. Persistence remains owned by StoriesContext. */
export function StoryReactionEffect({ reaction, effectToken }: StoryReactionEffectProps) {
  const { width, height } = useWindowDimensions();
  const progress = useRef(new Animated.Value(0)).current;
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);
  const generationRef = useRef(0);
  const [visible, setVisible] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const generation = ++generationRef.current;
    animationRef.current?.stop();
    progress.stopAnimation();
    progress.setValue(0);
    if (!reaction || effectToken <= 0) {
      setVisible(false);
      return undefined;
    }

    setVisible(true);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: reduceMotion
        ? STORY_REACTION_REDUCED_MOTION_DURATION_MS
        : STORY_REACTION_EFFECT_DURATION_MS,
      useNativeDriver: true,
    });
    animationRef.current = animation;
    animation.start(({ finished }) => {
      if (finished && generationRef.current === generation) setVisible(false);
    });

    return () => {
      generationRef.current += 1;
      animation.stop();
    };
  }, [effectToken, progress, reaction, reduceMotion]);

  if (!visible || !reaction) return null;

  const definition = storyReactionDefinition(reaction);
  const opacity = progress.interpolate({
    inputRange: [0, 0.12, 0.74, 1],
    outputRange: [0, 1, 1, 0],
  });

  if (reduceMotion) {
    return (
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.layer}
      >
        <Animated.Text style={[styles.reducedEmoji, { opacity }]}>{definition.emoji}</Animated.Text>
      </View>
    );
  }

  if (definition.effect === 'pulse') {
    const scale = progress.interpolate({
      inputRange: [0, 0.35, 0.64, 1],
      outputRange: [0.6, 1.42, 1, 0.94],
    });
    const ringScale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.45, 2.2] });
    const ringOpacity = progress.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 0.55, 0] });
    return (
      <View pointerEvents="none" accessibilityElementsHidden style={styles.layer}>
        <Animated.View style={[styles.wowRing, { opacity: ringOpacity, transform: [{ scale: ringScale }] }]} />
        <Animated.View style={[styles.wowRing, styles.wowRingSecondary, {
          opacity: ringOpacity,
          transform: [{ scale: Animated.multiply(ringScale, 0.72) }],
        }]} />
        <Animated.Text style={[styles.heroEmoji, { opacity, transform: [{ scale }] }]}>
          {definition.emoji}
        </Animated.Text>
      </View>
    );
  }

  const particles = PARTICLE_OFFSETS.slice(0, definition.particleCount);
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.layer}
    >
      {reaction === 'sad' ? (
        <Animated.Text style={[styles.sadHero, { opacity }]}>{definition.emoji}</Animated.Text>
      ) : null}
      {particles.map((offset, index) => {
        const isFalling = definition.effect === 'fall';
        const isAlternating = definition.effect === 'alternate';
        const startY = isFalling ? height * 0.42 : height * (isAlternating ? 0.58 : 0.7);
        const translateY = progress.interpolate({
          inputRange: [0, 1],
          outputRange: isFalling ? [-18, height * 0.28] : [55 + index * 5, -height * (0.2 + (index % 3) * 0.05)],
        });
        const translateX = progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, offset * width * (isAlternating ? 0.16 : 0.12)],
        });
        const scale = progress.interpolate({
          inputRange: [0, 0.24, 0.72, 1],
          outputRange: [0.45, isAlternating ? 1.28 : 1.08, 0.95, 0.78],
        });
        return (
          <Animated.View
            key={`${reaction}-${index}`}
            style={[
              styles.particle,
              {
                left: width * (0.5 + offset) - 24,
                top: startY + (index % 2) * 24,
                opacity,
                transform: [{ translateX }, { translateY }, { scale }],
              },
            ]}
          >
            <Text style={styles.particleEmoji}>{definition.emoji}</Text>
            {isAlternating ? <View style={styles.clapBurst} /> : null}
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 35,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reducedEmoji: {
    fontSize: 82,
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 12,
  },
  heroEmoji: {
    fontSize: 104,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 5 },
    textShadowRadius: 14,
  },
  sadHero: {
    position: 'absolute',
    top: '32%',
    fontSize: 72,
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 10,
  },
  particle: {
    position: 'absolute',
    width: 48,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  particleEmoji: {
    fontSize: 40,
    textShadowColor: 'rgba(0,0,0,0.42)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  clapBurst: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: 'rgba(255,214,10,0.55)',
  },
  wowRing: {
    position: 'absolute',
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 3,
    borderColor: 'rgba(124,92,255,0.76)',
  },
  wowRingSecondary: {
    borderColor: 'rgba(255,45,120,0.56)',
  },
});
