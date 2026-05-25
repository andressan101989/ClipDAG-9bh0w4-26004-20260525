import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, Modal, FlatList, TextInput, Pressable,
  StyleSheet, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui/Avatar';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { Comment, timeAgo } from '@/services/mockData';

// ── Emoji picker data ─────────────────────────────────────────────────────────
const EMOJI_GROUPS = [
  { label: '😀', emojis: ['😀','😂','🤣','😍','🥰','😎','🤩','😭','😱','🔥','❤️','💯','👏','🙌','🫶','💪','🚀','✨','🎉','🎊'] },
  { label: '❤️', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','💕','💞','💓','💗','💖','💘','💝','❣️','💔','🫀','❤️‍🔥','💌'] },
  { label: '👍', emojis: ['👍','👎','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👋','🤚','🖐','✋','🖖','👊','✊','🤛','🤜','🫷'] },
  { label: '🌟', emojis: ['🌟','⭐','💫','✨','🎯','🎮','🎵','🎶','🎸','🎤','🎬','🏆','🥇','🎁','🎀','🎂','🍕','🍔','☕','🍓'] },
];

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
}

function EmojiPicker({ onSelect }: EmojiPickerProps) {
  const [activeGroup, setActiveGroup] = useState(0);

  return (
    <View style={emojiStyles.container}>
      {/* Group tabs */}
      <View style={emojiStyles.tabs}>
        {EMOJI_GROUPS.map((g, i) => (
          <Pressable
            key={i}
            style={[emojiStyles.tab, activeGroup === i && emojiStyles.tabActive]}
            onPress={() => setActiveGroup(i)}
            hitSlop={4}
          >
            <Text style={emojiStyles.tabEmoji}>{g.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* Emoji grid */}
      <View style={emojiStyles.grid}>
        {EMOJI_GROUPS[activeGroup].emojis.map((emoji, i) => (
          <Pressable
            key={i}
            style={({ pressed }) => [emojiStyles.emojiBtn, pressed && { opacity: 0.6 }]}
            onPress={() => onSelect(emoji)}
            hitSlop={2}
          >
            <Text style={emojiStyles.emoji}>{emoji}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const emojiStyles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingBottom: 4,
  },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.md,
    paddingTop: 8,
    paddingBottom: 4,
    gap: 4,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSubtle,
  },
  tab: {
    flex: 1,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.sm,
  },
  tabActive: {
    backgroundColor: Colors.primaryDim,
    borderWidth: 1,
    borderColor: Colors.primary + '44',
  },
  tabEmoji: { fontSize: 18 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    gap: 2,
  },
  emojiBtn: {
    width: '10%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: { fontSize: 22 },
});

// ── Main component ────────────────────────────────────────────────────────────
interface CommentSheetProps {
  visible: boolean;
  onClose: () => void;
  comments: Comment[];
  onSubmit: (text: string) => void;
  userAvatar?: string;
  username?: string;
}

export function CommentSheet({ visible, onClose, comments, onSubmit, userAvatar, username }: CommentSheetProps) {
  const [text, setText] = useState('');
  const [likedComments, setLikedComments] = useState<Set<string>>(new Set());
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const insets = useSafeAreaInsets();

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setText('');
    setShowEmojiPicker(false);
  };

  const handleEmojiSelect = useCallback((emoji: string) => {
    setText(prev => prev + emoji);
    inputRef.current?.focus();
  }, []);

  const toggleCommentLike = (commentId: string) => {
    setLikedComments(prev => {
      const next = new Set(prev);
      next.has(commentId) ? next.delete(commentId) : next.add(commentId);
      return next;
    });
  };

  const handleClose = () => {
    setShowEmojiPicker(false);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      presentationStyle="overFullScreen"
      onRequestClose={handleClose}
    >
      <Pressable style={styles.backdrop} onPress={handleClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={[styles.sheet, { paddingBottom: showEmojiPicker ? 0 : insets.bottom }]}
      >
        {/* Handle bar */}
        <View style={styles.handleWrap}>
          <View style={styles.handleBar} />
        </View>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Comentarios</Text>
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{comments.length}</Text>
          </View>
          <Pressable onPress={handleClose} hitSlop={10} style={styles.closeBtn}>
            <MaterialCommunityIcons name="close" size={20} color={Colors.textSecondary} />
          </Pressable>
        </View>

        {/* Comments list */}
        <FlatList
          data={comments}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={() => (
            <View style={styles.emptyState}>
              <LinearGradient
                colors={['#7C5CFF22', '#FF2D7811']}
                style={styles.emptyIconWrap}
              >
                <Text style={styles.emptyIcon}>💬</Text>
              </LinearGradient>
              <Text style={styles.emptyText}>Se el primero en comentar</Text>
              <Text style={styles.emptySubtext}>Comparte lo que piensas</Text>
            </View>
          )}
          renderItem={({ item }) => {
            const liked = likedComments.has(item.id);
            return (
              <View style={styles.commentItem}>
                <Avatar uri={item.avatar} username={item.username} size={38} />
                <View style={styles.commentContent}>
                  <View style={styles.commentBubble}>
                    <View style={styles.commentHeader}>
                      <Text style={styles.commentUsername}>@{item.username}</Text>
                      <Text style={styles.commentTime}>{timeAgo(item.createdAt)}</Text>
                    </View>
                    <Text style={styles.commentText}>{item.text}</Text>
                  </View>
                  <View style={styles.commentActions}>
                    <Pressable
                      onPress={() => toggleCommentLike(item.id)}
                      style={styles.commentLikeBtn}
                      hitSlop={10}
                    >
                      <MaterialIcons
                        name={liked ? 'favorite' : 'favorite-border'}
                        size={13}
                        color={liked ? Colors.secondary : Colors.textSubtle}
                      />
                      <Text style={[styles.commentLikeCount, liked && { color: Colors.secondary }]}>
                        {item.likes + (liked ? 1 : 0)}
                      </Text>
                    </Pressable>
                    <Pressable hitSlop={10}>
                      <Text style={styles.commentReply}>Responder</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            );
          }}
        />

        {/* Emoji picker */}
        {showEmojiPicker ? (
          <EmojiPicker onSelect={handleEmojiSelect} />
        ) : null}

        {/* Input area */}
        <View style={[styles.inputArea, showEmojiPicker && { paddingBottom: insets.bottom + Spacing.xs }]}>
          <Avatar uri={userAvatar} username={username || 'U'} size={34} />
          <View style={styles.inputRow}>
            <View style={styles.inputWrap}>
              <TextInput
                ref={inputRef}
                style={styles.input}
                value={text}
                onChangeText={setText}
                placeholder="Escribe un comentario..."
                placeholderTextColor={Colors.textSubtle}
                multiline
                maxLength={200}
                returnKeyType="send"
                onSubmitEditing={handleSubmit}
                onFocus={() => setShowEmojiPicker(false)}
              />
            </View>
            <Pressable
              onPress={() => {
                setShowEmojiPicker(v => !v);
                if (!showEmojiPicker) inputRef.current?.blur();
              }}
              style={[styles.emojiToggleBtn, showEmojiPicker && styles.emojiToggleBtnActive]}
              hitSlop={8}
            >
              <Text style={styles.emojiToggleText}>😊</Text>
            </Pressable>
          </View>
          <Pressable
            onPress={handleSubmit}
            style={[styles.sendBtn, !text.trim() && styles.sendBtnDisabled]}
            disabled={!text.trim()}
            hitSlop={8}
          >
            <LinearGradient
              colors={text.trim() ? ['#7C5CFF', '#FF2D78'] : [Colors.border, Colors.border]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={styles.sendBtnGrad}
            >
              <MaterialCommunityIcons name="send" size={18} color="#fff" />
            </LinearGradient>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)' },
  sheet: {
    backgroundColor: Colors.surfaceElevated,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '82%',
    minHeight: '45%',
  },
  handleWrap: { alignItems: 'center', paddingTop: 10, paddingBottom: 4 },
  handleBar: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: Spacing.sm,
  },
  headerTitle: {
    flex: 1,
    color: Colors.textPrimary,
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
  },
  countBadge: {
    backgroundColor: Colors.primaryDim,
    borderRadius: Radius.full,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: Colors.primary + '33',
  },
  countText: {
    color: Colors.primaryLight,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
  },
  closeBtn: { padding: 4 },

  // Comments
  listContent: { padding: Spacing.md, paddingBottom: Spacing.xl, flexGrow: 1, gap: 4 },

  commentItem: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
    alignItems: 'flex-start',
  },
  commentContent: { flex: 1, gap: 5 },
  commentBubble: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderBottomLeftRadius: Radius.xs,
    padding: 12,
    gap: 5,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
  },
  commentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  commentUsername: {
    color: Colors.primary,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
  },
  commentTime: { color: Colors.textSubtle, fontSize: 10 },
  commentText: {
    color: Colors.textPrimary,
    fontSize: FontSize.sm,
    lineHeight: 20,
  },
  commentActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingLeft: 4,
  },
  commentLikeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  commentLikeCount: { color: Colors.textSubtle, fontSize: FontSize.xs },
  commentReply: {
    color: Colors.textSubtle,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingVertical: Spacing.xxl,
    gap: Spacing.md,
    flex: 1,
  },
  emptyIconWrap: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIcon: { fontSize: 36 },
  emptyText: { color: Colors.textSecondary, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  emptySubtext: { color: Colors.textSubtle, fontSize: FontSize.sm },

  // Input area
  inputArea: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  inputRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    minHeight: 44,
  },
  inputWrap: { flex: 1 },
  input: {
    color: Colors.textPrimary,
    fontSize: FontSize.sm,
    maxHeight: 80,
    paddingVertical: 10,
  },
  emojiToggleBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
  emojiToggleBtnActive: {
    backgroundColor: Colors.primaryDim,
  },
  emojiToggleText: { fontSize: 20 },

  sendBtn: { borderRadius: Radius.full, overflow: 'hidden' },
  sendBtnGrad: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {},
});
