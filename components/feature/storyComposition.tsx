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
        <View
          key={element.id}
          style={[
            styles.element,
            {
              left: element.x * width,
              top: element.y * height,
              transform: [
                { translateX: -60 },
                { translateY: -30 },
                { scale: element.scale },
                { rotate: `${element.rotation}deg` },
              ],
            },
          ]}
        >
          {element.type === 'text' ? (
            <Text style={{
              color: element.color,
              fontSize: TEXT_SIZE[element.size],
              fontWeight: '800',
              textAlign: element.align,
              textShadowColor: 'rgba(0,0,0,0.65)',
              textShadowRadius: 4,
              textShadowOffset: { width: 0, height: 1 },
            }}>
              {element.text}
            </Text>
          ) : <Text style={styles.sticker}>{element.value}</Text>}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { zIndex: 7 },
  element: { position: 'absolute', width: 120, minHeight: 60, alignItems: 'center', justifyContent: 'center' },
  sticker: { fontSize: 48 },
});
