import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, Modal, FlatList, TextInput, Pressable,
  StyleSheet, KeyboardAvoidingView, Platform, ScrollView,
  ActivityIndicator, Alert,
} from 'react-native';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui/Avatar';
import { getSupabaseClient } from '@/template';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { timeAgo } from '@/services/mockData';

// ── Loaded comment shape (from the real `comments` table, not the client-side
// FeedContext cache) ──────────────────────────────────────────────────────────
interface LoadedComment {
  id: string;
  userId: string;
  username: string;
  avatar: string;
  text: string;
  likes: number;
  createdAt: string;
}

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
  videoId: string | null;
  onSubmit: (text: string) => void;
  userAvatar?: string;
  username?: string;
  userId?: string;
}

export function CommentSheet({ visible, onClose, videoId, onSubmit, userAvatar, username, userId }: CommentSheetProps) {
  const [text, setText] = useState('');
  const [comments, setComments] = useState<LoadedComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [likedComments, setLikedComments] = useState<Set<string>>(new Set());
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const insets = useSafeAreaInsets();

  // ── Load comments (with commenter avatar/username) + my likes ─────────────
  const loadComments = useCallback(async () => {
    if (!videoId) return;
    setLoading(true);
    try {
      const supabase = getSupabaseClient();
      const { data: rows } = await supabase
        .from('comments')
        .select('id, user_id, text, created_at, likes_count')
        .eq('video_id', videoId)
        .order('created_at', { ascending: false });

      if (!rows || rows.length === 0) {
        setComments([]);
        setLikedComments(new Set());
        return;
      }

      const userIds = Array.from(new Set(rows.map((r: any) => r.user_id)));
      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('id, username, avatar_url')
        .in('id', userIds);
      const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));

      let liked = new Set<string>();
      if (userId) {
        const { data: likeRows } = await supabase
          .from('comment_likes')
          .select('comment_id')
          .eq('user_id', userId)
          .in('comment_id', rows.map((r: any) => r.id));
        liked = new Set((likeRows || []).map((l: any) => l.comment_id));
      }

      setComments(rows.map((r: any) => {
        const p = profileMap.get(r.user_id) as any;
        return {
          id: r.id,
          userId: r.user_id,
          username: p?.username || 'Usuario',
          avatar: p?.avatar_url || '',
          text: r.text || '',
          likes: Number(r.likes_count) || 0,
          createdAt: r.created_at,
        };
      }));
      setLikedComments(liked);
    } catch (_) {
      /* non-critical — sheet just shows whatever loaded so far */
    } finally {
      setLoading(false);
    }
  }, [videoId, userId]);

  useEffect(() => {
    if (visible && videoId) loadComments();
  }, [visible, videoId, loadComments]);

  // ── Realtime: new / deleted comments while the sheet is open ──────────────
  useEffect(() => {
    if (!visible || !videoId) return;
    const supabase = getSupabaseClient();
    const channel = supabase.channel(`comments:${videoId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'comments', filter: `video_id=eq.${videoId}`,
      }, async (payload: any) => {
        const row = payload.new;
        let profile: any = null;
        try {
          const { data } = await supabase.from('user_profiles')
            .select('username, avatar_url').eq('id', row.user_id).single();
          profile = data;
        } catch (_) { /* ignore */ }

        setComments(prev => {
          // Drop the optimistic temp entry this real row replaces, if present.
          const withoutTemp = prev.filter(c =>
            !(c.id.startsWith('temp_') && c.userId === row.user_id && c.text === row.text));
          if (withoutTemp.some(c => c.id === row.id)) return withoutTemp;
          return [{
            id: row.id,
            userId: row.user_id,
            username: profile?.username || 'Usuario',
            avatar: profile?.avatar_url || '',
            text: row.text || '',
            likes: Number(row.likes_count) || 0,
            createdAt: row.created_at,
          }, ...withoutTemp];
        });
      })
      .on('postgres_changes', {
        event: 'DELETE', schema: 'public', table: 'comments', filter: `video_id=eq.${videoId}`,
      }, (payload: any) => {
        setComments(prev => prev.filter(c => c.id !== payload.old?.id));
      })
      .subscribe();

    return () => { channel.unsubscribe(); };
  }, [visible, videoId]);

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (userId) {
      // Optimistic local entry — the realtime INSERT above will reconcile it
      // with the real row (and real id) once the write round-trips.
      setComments(prev => [{
        id: `temp_${Date.now()}`,
        userId,
        username: username || 'Tú',
        avatar: userAvatar || '',
        text: trimmed,
        likes: 0,
        createdAt: new Date().toISOString(),
      }, ...prev]);
    }
    onSubmit(trimmed);
    setText('');
    setShowEmojiPicker(false);
  };

  const handleEmojiSelect = useCallback((emoji: string) => {
    setText(prev => prev + emoji);
    inputRef.current?.focus();
  }, []);

  // ── Like / unlike a comment ─────────────────────────────────────────────
  const toggleCommentLike = useCallback(async (commentId: string) => {
    if (!userId || commentId.startsWith('temp_')) return;
    const wasLiked = likedComments.has(commentId);

    setLikedComments(prev => {
      const next = new Set(prev);
      wasLiked ? next.delete(commentId) : next.add(commentId);
      return next;
    });
    setComments(prev => prev.map(c =>
      c.id === commentId ? { ...c, likes: Math.max(0, c.likes + (wasLiked ? -1 : 1)) } : c));

    try {
      const supabase = getSupabaseClient();
      if (wasLiked) {
        await supabase.from('comment_likes').delete().eq('comment_id', commentId).eq('user_id', userId);
      } else {
        await supabase.from('comment_likes').insert({ comment_id: commentId, user_id: userId });
      }
      // Atomic increment via RPC instead of read-then-write — two concurrent
      // likers both reading the same stale count and writing count+1 would
      // otherwise silently lose one like.
      await supabase.rpc('increment_comment_likes', {
        p_comment_id: commentId,
        p_delta: wasLiked ? -1 : 1,
      });
    } catch (_) {
      // Non-critical — leave the optimistic state; next load will resync.
    }
  }, [likedComments, userId]);

  // ── Delete own comment ───────────────────────────────────────────────────
  const handleDeleteComment = useCallback((commentId: string) => {
    Alert.alert('Eliminar comentario', '¿Seguro que quieres eliminar este comentario?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar', style: 'destructive',
        onPress: async () => {
          if (!userId) return;
          const prevComments = comments;
          setComments(prev => prev.filter(c => c.id !== commentId));
          try {
            const supabase = getSupabaseClient();
            await supabase.from('comments').delete().eq('id', commentId).eq('user_id', userId);
            if (videoId) {
              const { data } = await supabase.from('videos').select('comments_count').eq('id', videoId).single();
              if (data) {
                await supabase.from('videos')
                  .update({ comments_count: Math.max(0, (data.comments_count || 0) - 1) })
                  .eq('id', videoId);
              }
            }
          } catch (_) {
            setComments(prevComments);
          }
        },
      },
    ]);
  }, [comments, userId, videoId]);

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
        {loading && comments.length === 0 ? (
          <View style={styles.loadingState}>
            <ActivityIndicator color={Colors.primary} />
          </View>
        ) : (
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
              const isOwn = !!userId && item.userId === userId;
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
                          {item.likes}
                        </Text>
                      </Pressable>
                      {isOwn ? (
                        <Pressable onPress={() => handleDeleteComment(item.id)} hitSlop={10}>
                          <Text style={[styles.commentReply, { color: Colors.secondary }]}>Eliminar</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                </View>
              );
            }}
          />
        )}

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
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.xxl },

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
