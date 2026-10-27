import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import {
  clampStoryElementTransform,
} from './storyStageGeometry';
import type {
  StoryComposition,
  StoryCompositionElement,
  StoryStaticElement,
  StoryTextSize,
} from './storyInteractiveTypes';

export type {
  StoryComposition,
  StoryCompositionElement,
  StoryInteractivePlacement,
  StoryStaticElement,
  StoryStickerElement,
  StoryTextElement,
  StoryTextSize,
} from './storyInteractiveTypes';

export const STORY_STICKERS = ['❤️', '😂', '😮', '😢', '🔥', '👏', '✨', '⭐', '💯', '🎉', '😍'] as const;
export const STORY_TEXT_COLORS = ['#FFFFFF', '#111111', '#FF2D78', '#7C5CFF', '#00D4FF', '#FFD60A'] as const;
export const EMPTY_STORY_COMPOSITION: StoryComposition = { version: 1, elements: [] };

const TEXT_SIZE: Record<StoryTextSize, number> = { small: 22, medium: 32, large: 44 };
export function storyElementFrame(element: StoryStaticElement, canvasWidth: number) {
  if (element.type === 'sticker') return { width: 88, minHeight: 88 };
  return {
    width: Math.min(300, Math.max(220, canvasWidth - 48)),
    minHeight: 88,
  };
}

export { clampStoryScale } from './storyStageGeometry';

export function clampStoryElementPosition(
  element: StoryStaticElement,
  canvasWidth: number,
  canvasHeight: number,
  x: number,
  y: number,
) {
  const frame = storyElementFrame(element, canvasWidth);
  const clamped = clampStoryElementTransform(
    { x, y, scale: element.scale, rotation: element.rotation },
    { width: frame.width, height: frame.minHeight },
    { width: canvasWidth, height: canvasHeight },
  );
  return { x: clamped.x, y: clamped.y };
}

export function StoryCompositionElementContent({
  element,
  canvasWidth,
}: {
  element: StoryStaticElement;
  canvasWidth: number;
}) {
  const frame = storyElementFrame(element, canvasWidth);
  return (
    <View style={[styles.content, { width: frame.width, minHeight: frame.minHeight }]}>
      {element.type === 'text' ? (
        <Text style={[
          styles.text,
          {
            color: element.color,
            fontSize: TEXT_SIZE[element.size],
            lineHeight: Math.round(TEXT_SIZE[element.size] * 1.16),
            textAlign: element.align,
          },
        ]}>
          {element.text}
        </Text>
      ) : <Text style={styles.sticker}>{element.value}</Text>}
    </View>
  );
}

export function StoryCompositionOverlay({
  composition,
  width,
  height,
}: {
  composition: StoryComposition;
  width: number;
  height: number;
}) {
  const elements: StoryCompositionElement[] = composition.elements;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.overlay]}>
      {elements.filter((element): element is StoryStaticElement => element.type !== 'interactive').map(element => (
        <View key={element.id} style={[
          styles.element,
          {
            left: element.x * width - storyElementFrame(element, width).width / 2,
            top: element.y * height - storyElementFrame(element, width).minHeight / 2,
            transform: [{ scale: element.scale }, { rotate: `${element.rotation}deg` }],
          },
        ]}>
          <StoryCompositionElementContent element={element} canvasWidth={width} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { zIndex: 7 },
  element: { position: 'absolute' },
  content: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, paddingVertical: 6 },
  text: {
    width: '100%',
    flexShrink: 1,
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.65)',
    textShadowRadius: 4,
    textShadowOffset: { width: 0, height: 1 },
  },
  sticker: { fontSize: 48 },
});
