import React, { useState, useEffect } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, TextInput, ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { getSupabaseClient } from '@/template';
import { useAuth } from '@/hooks/useAuth';
import { Avatar } from '@/components/ui/Avatar';
import { Colors, FontSize, FontWeight, Spacing } from '@/constants/theme';

interface UserResult {
  id: string;
  username: string;
  avatar_url: string;
  bio: string;
}

export default function NewMessageScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const supabase = getSupabaseClient();

  const [search, setSearch] = useState('');
  const [results, setResults] = useState<UserResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    if (!search.trim()) { setResults([]); return; }
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const { data, error } = await supabase
          .from('user_profiles')
          .select('id, username, avatar_url, bio')
          .ilike('username', `%${search.trim()}%`)
          .neq('id', user?.id || '')
          .limit(20);
        if (!error && data) setResults(data as UserResult[]);
      } catch (_) {}
      setIsSearching(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <MaterialIcons name="close" size={22} color={Colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Nuevo mensaje</Text>
        <View style={{ width: 30 }} />
      </View>

      <View style={styles.searchWrap}>
        <MaterialIcons name="search" size={18} color={Colors.textSubtle} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Buscar usuario..."
          placeholderTextColor={Colors.textSubtle}
          autoFocus
        />
        {isSearching ? <ActivityIndicator size="small" color={Colors.primary} /> : null}
      </View>

      {results.length === 0 && search ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>
            {isSearching ? 'Buscando...' : 'Sin resultados'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.userItem, pressed && { backgroundColor: Colors.surfaceElevated }]}
              onPress={() => {
                router.replace(`/chat/${item.id}`);
              }}
            >
              <Avatar uri={item.avatar_url} username={item.username} size={46} />
              <View style={styles.userInfo}>
                <Text style={styles.username}>@{item.username}</Text>
                {item.bio ? <Text style={styles.userBio} numberOfLines={1}>{item.bio}</Text> : null}
              </View>
              <MaterialIcons name="chevron-right" size={20} color={Colors.textSubtle} />
            </Pressable>
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm,
  },
  backBtn: { padding: 4 },
  headerTitle: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceElevated, borderRadius: 12,
    paddingHorizontal: Spacing.md, paddingVertical: 12,
    marginHorizontal: Spacing.md, marginBottom: Spacing.sm,
    borderWidth: 1, borderColor: Colors.border,
  },
  searchInput: { flex: 1, color: Colors.textPrimary, fontSize: FontSize.sm },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: Colors.textSubtle, fontSize: FontSize.md },
  userItem: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.md, paddingVertical: 12,
  },
  userInfo: { flex: 1 },
  username: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  userBio: { color: Colors.textSubtle, fontSize: FontSize.xs, marginTop: 2 },
  separator: { height: 1, backgroundColor: Colors.borderSubtle, marginLeft: 74 },
});
