import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { STORY_REACTIONS, type StoryReactionKey } from './storyReactions';

interface StoryInteractionsProps {
  username: string;
  selectedReaction: StoryReactionKey | null;
  reactionPending: boolean;
  onReaction: (reaction: StoryReactionKey | null) => Promise<void>;
  onReply: (text: string) => Promise<void>;
  onFocusChange: (focused: boolean) => void;
}

export function StoryInteractions({
  username,
  selectedReaction,
  reactionPending,
  onReaction,
  onReply,
  onFocusChange,
}: StoryInteractionsProps) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(false);
    setSent(false);
    try {
      await onReply(text);
      setDraft('');
      setSent(true);
    } catch {
      setSendError(true);
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.root} onStartShouldSetResponder={() => true}>
      <View style={styles.replyRow}>
        <TextInput
          accessibilityLabel={`Responder a ${username}`}
          value={draft}
          onChangeText={value => {
            setDraft(value);
            setSendError(false);
            setSent(false);
          }}
          onFocus={() => onFocusChange(true)}
          onBlur={() => onFocusChange(false)}
          onSubmitEditing={() => void submit()}
          placeholder={`Responder a @${username}…`}
          placeholderTextColor="rgba(255,255,255,0.62)"
          maxLength={4975}
          returnKeyType="send"
          editable={!sending}
          style={styles.input}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Enviar respuesta"
          disabled={!draft.trim() || sending}
          onPress={() => void submit()}
          style={[styles.sendButton, (!draft.trim() || sending) && styles.disabled]}
        >
          {sending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <MaterialIcons name="send" size={20} color="#fff" />
          )}
        </Pressable>
      </View>
      {sendError ? <Text style={styles.feedbackError}>No se pudo enviar. Inténtalo de nuevo.</Text> : null}
      {sent ? <Text style={styles.feedbackSuccess}>Respuesta enviada</Text> : null}
      <View accessibilityRole="radiogroup" style={styles.reactions}>
        {STORY_REACTIONS.map(item => {
          const selected = selectedReaction === item.key;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="radio"
              accessibilityLabel={item.label}
              accessibilityState={{ checked: selected, disabled: reactionPending }}
              disabled={reactionPending}
              onPress={() => void onReaction(selected ? null : item.key)}
              style={[styles.reactionButton, selected && styles.reactionSelected]}
            >
              <Text style={styles.emoji}>{item.emoji}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
  },
  replyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: 42,
    paddingHorizontal: Spacing.md,
    color: '#fff',
    fontSize: FontSize.sm,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.48)',
    backgroundColor: 'rgba(0,0,0,0.38)',
  },
  sendButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
    backgroundColor: Colors.primary,
  },
  disabled: { opacity: 0.45 },
  reactions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  reactionButton: {
    width: 42,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  reactionSelected: {
    borderColor: '#fff',
    backgroundColor: 'rgba(124,92,255,0.62)',
    transform: [{ scale: 1.06 }],
  },
  emoji: { fontSize: 22 },
  feedbackError: { color: '#ffb4b4', fontSize: FontSize.xs },
  feedbackSuccess: { color: '#b8ffd2', fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
});
