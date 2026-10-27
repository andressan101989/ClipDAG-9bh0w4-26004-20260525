import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Colors, Radius, Spacing } from '@/constants/theme';
import type { StoryInteractiveDefinition } from './storyInteractiveTypes';

export function StoryInteractiveElement({ definition }: { definition: StoryInteractiveDefinition }) {
  return (
    <View pointerEvents="none" style={styles.card} accessible={false}>
      <Text numberOfLines={3} style={styles.prompt}>{definition.prompt}</Text>
      {definition.type === 'poll' || definition.type === 'quiz' ? (
        <View style={styles.options}>
          {definition.options.slice(0, 6).map(option => (
            <View key={option.id} style={styles.option}>
              <Text numberOfLines={1} style={styles.optionText}>{option.label}</Text>
            </View>
          ))}
        </View>
      ) : definition.type === 'slider' ? (
        <View style={styles.slider}><View style={styles.sliderTrack} /><Text style={styles.emoji}>{definition.emoji}</Text></View>
      ) : definition.type === 'reaction' ? (
        <Text style={styles.reaction}>{definition.emoji}</Text>
      ) : (
        <View style={styles.answer}><Text style={styles.answerText}>Escribe tu respuesta…</Text></View>
      )}
      {definition.type === 'quiz' ? <Text style={styles.kind}>QUIZ</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 260,
    minHeight: 104,
    padding: Spacing.sm,
    borderRadius: Radius.xl,
    backgroundColor: 'rgba(255,255,255,0.96)',
    alignItems: 'stretch',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.24,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  prompt: { color: '#111119', fontSize: 16, lineHeight: 20, fontWeight: '800', textAlign: 'center' },
  options: { gap: 6, marginTop: 9 },
  option: { minHeight: 32, borderRadius: Radius.md, backgroundColor: '#ECEAFB', justifyContent: 'center', paddingHorizontal: 10 },
  optionText: { color: '#242231', textAlign: 'center', fontSize: 13, fontWeight: '700' },
  slider: { height: 42, justifyContent: 'center', marginTop: 8 },
  sliderTrack: { height: 5, borderRadius: 3, backgroundColor: Colors.primary },
  emoji: { position: 'absolute', left: '48%', fontSize: 28 },
  reaction: { marginTop: 6, fontSize: 42, textAlign: 'center' },
  answer: { marginTop: 9, minHeight: 36, borderRadius: 18, borderWidth: 1, borderColor: '#C7C3DB', justifyContent: 'center', paddingHorizontal: 14 },
  answerText: { color: '#777383', fontSize: 13 },
  kind: { position: 'absolute', top: 7, right: 9, color: Colors.primary, fontSize: 9, fontWeight: '900' },
});
