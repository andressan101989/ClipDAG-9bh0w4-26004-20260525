import React from 'react';
import { Text, View, StyleSheet } from 'react-native';

export const STORY_STICKERS = ['❤️', '😂', '😮', '😢', '🔥', '👏', '✨', '⭐', '💯', '🎉', '😍'] as const;
export const STORY_TEXT_COLORS = ['#FFFFFF', '#111111', '#FF2D78', '#7C5CFF', '#00D4FF', '#FFD60A'] as const;
export type StoryTextSize = 'small' | 'medium' | 'large';

interface StoryElementBase {
  id: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

export interface StoryTextElement extends StoryElementBase {
  type: 'text';
  text: string;
  color: typeof STORY_TEXT_COLORS[number];
  align: 'left' | 'center' | 'right';
  size: StoryTextSize;
}

export interface StoryStickerElement extends StoryElementBase {
  type: 'sticker';
  value: typeof STORY_STICKERS[number];
}

export type StoryCompositionElement = StoryTextElement | StoryStickerElement;
export interface StoryComposition { version: 1; elements: StoryCompositionElement[] }
export const EMPTY_STORY_COMPOSITION: StoryComposition = { version: 1, elements: [] };

const TEXT_SIZE: Record<StoryTextSize, number> = { small: 22, medium: 32, large: 44 };
export const STORY_ELEMENT_MIN_SCALE = 0.5;
export const STORY_ELEMENT_MAX_SCALE = 4;

export function storyElementFrame(element: StoryCompositionElement, canvasWidth: number) {
  if (element.type === 'sticker') return { width: 88, minHeight: 88 };
  return {
    width: Math.min(300, Math.max(220, canvasWidth - 48)),
    minHeight: 88,
  };
}

export function clampStoryScale(scale: number) {
  return Math.max(STORY_ELEMENT_MIN_SCALE, Math.min(STORY_ELEMENT_MAX_SCALE, scale));
}

export function clampStoryElementPosition(
  element: StoryCompositionElement,
  canvasWidth: number,
  canvasHeight: number,
  x: number,
  y: number,
) {
  const frame = storyElementFrame(element, canvasWidth);
  const halfWidth = Math.min(0.5, (frame.width * element.scale) / (2 * canvasWidth));
  const halfHeight = Math.min(0.5, (frame.minHeight * element.scale) / (2 * canvasHeight));
  return {
    x: Math.max(halfWidth, Math.min(1 - halfWidth, x)),
    y: Math.max(halfHeight, Math.min(1 - halfHeight, y)),
  };
}

export function StoryCompositionElementContent({
  element,
  canvasWidth,
}: {
  element: StoryCompositionElement;
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
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.overlay]}>
      {composition.elements.map(element => (
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
