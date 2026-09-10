import React, { useRef, useState } from 'react';
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
import { createChatClientMessageId } from '@/services/chatService';
import { STORY_REACTIONS, type StoryReactionKey } from './storyReactions';

interface StoryInteractionsProps {
  username: string;
  selectedReaction: StoryReactionKey | null;
  reactionPending: boolean;
  onReaction: (reaction: StoryReactionKey | null) => Promise<void>;
  onReactionEffect: (reaction: StoryReactionKey) => void;
  onReply: (text: string, clientMessageId: string) => Promise<void>;
  onFocusChange: (focused: boolean) => void;
}

export function StoryInteractions({
  username,
  selectedReaction,
  reactionPending,
  onReaction,
  onReactionEffect,
  onReply,
  onFocusChange,
}: StoryInteractionsProps) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const [sent, setSent] = useState(false);
  const sendingRef = useRef(false);
  const replyAttemptRef = useRef<{ text: string; clientMessageId: string } | null>(null);

  const submit = async () => {
    const text = draft.trim();
    if (!text || sendingRef.current) return;
    const attempt = replyAttemptRef.current?.text === text
      ? replyAttemptRef.current
      : { text, clientMessageId: createChatClientMessageId() };
    replyAttemptRef.current = attempt;
    sendingRef.current = true;
    setSending(true);
    setSendError(false);
    setSent(false);
    try {
      await onReply(text, attempt.clientMessageId);
      replyAttemptRef.current = null;
      setDraft('');
      setSent(true);
    } catch {
      setSendError(true);
    } finally {
      sendingRef.current = false;
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
            // Any user edit starts a new logical payload, even if they later
            // type the previous text again.
            replyAttemptRef.current = null;
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
          accessibilityHint="Envía un mensaje privado sobre esta historia"
          editable={!sending}
          style={styles.input}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Enviar respuesta"
          accessibilityHint="Envía la respuesta por mensaje privado"
          disabled={!draft.trim() || sending}
          onPress={() => void submit()}
          style={({ pressed }) => [
            styles.sendButton,
            (!draft.trim() || sending) && styles.disabled,
            pressed && styles.pressed,
          ]}
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
              accessibilityHint={selected ? 'Toca para quitar tu reacción' : 'Toca para reaccionar a la historia'}
              accessibilityState={{ checked: selected, disabled: reactionPending }}
              disabled={reactionPending}
              onPressIn={() => onReactionEffect(item.key)}
              onPress={() => void onReaction(selected ? null : item.key)}
              style={({ pressed }) => [
                styles.reactionButton,
                selected && styles.reactionSelected,
                pressed && styles.reactionPressed,
              ]}
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
    gap: 12,
    paddingHorizontal: 15,
  },
  replyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: 46,
    height: 48,
    paddingHorizontal: Spacing.md,
    color: '#fff',
    fontSize: FontSize.sm,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: '#343541',
    backgroundColor: 'rgba(24,24,32,0.88)',
  },
  sendButton: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
    backgroundColor: Colors.primary,
    shadowColor: Colors.primary,
    shadowOpacity: 0.32,
    shadowRadius: 9,
    elevation: 4,
  },
  pressed: { opacity: 0.78, transform: [{ scale: 0.96 }] },
  disabled: { opacity: 0.45 },
  reactions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  reactionButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: 'rgba(24,24,32,0.88)',
  },
  reactionSelected: {
    borderColor: Colors.primaryLight,
    backgroundColor: 'rgba(124,92,255,0.38)',
    transform: [{ scale: 1.06 }],
  },
  reactionPressed: { opacity: 0.72, transform: [{ scale: 0.92 }] },
  emoji: { fontSize: 22 },
  feedbackError: { color: '#ffb4b4', fontSize: FontSize.xs },
  feedbackSuccess: { color: '#b8ffd2', fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
});
