import React, { useCallback, useMemo, useState } from 'react';
import { LayoutChangeEvent, Text, View, StyleSheet } from 'react-native';
import {
  clampStoryElementTransform,
  fitStoryElementTransform,
  projectStoryElementTransform,
  type StoryMeasuredElementFrame,
  type StoryStageFrame,
  type StoryStageInsets,
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
  safeInsets,
}: {
  composition: StoryComposition;
  width: number;
  height: number;
  safeInsets: StoryStageInsets;
}) {
  const elements: StoryCompositionElement[] = composition.elements;
  const stage = useMemo<StoryStageFrame>(() => ({ width, height, safeInsets }), [height, safeInsets, width]);
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.overlay]}>
      {elements.filter((element): element is StoryStaticElement => element.type !== 'interactive').map(element => (
        <PositionedStoryCompositionElement
          key={element.id}
          element={element}
          stage={stage}
        />
      ))}
    </View>
  );
}

function PositionedStoryCompositionElement({
  element,
  stage,
}: {
  element: StoryStaticElement;
  stage: StoryStageFrame;
}) {
  const fallback = storyElementFrame(element, stage.width);
  const [measuredFrame, setMeasuredFrame] = useState<StoryMeasuredElementFrame>({
    width: fallback.width,
    height: fallback.minHeight,
  });
  const fitted = useMemo(
    () => fitStoryElementTransform(element, measuredFrame, stage),
    [element, measuredFrame, stage],
  );
  const projected = useMemo(
    () => projectStoryElementTransform(fitted, stage),
    [fitted, stage],
  );
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (!(width > 0) || !(height > 0)) return;
    setMeasuredFrame(current => current.width === width && current.height === height
      ? current
      : { width, height });
  }, []);

  return (
    <View
      onLayout={onLayout}
      style={[
        styles.element,
        {
          left: projected.x - measuredFrame.width / 2,
          top: projected.y - measuredFrame.height / 2,
          transform: [{ scale: projected.scale }, { rotate: `${projected.rotation}deg` }],
        },
      ]}
    >
      <StoryCompositionElementContent element={element} canvasWidth={stage.width} />
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
