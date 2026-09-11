import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui/Avatar';
import { Colors, FontSize, FontWeight, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import { useMessages } from '@/hooks/useMessages';
import { getSupabaseClient } from '@/template';
import { createChatClientMessageId } from '@/services/chatService';

type UserRow = { id: string; username: string; avatar_url: string | null };

export default function CreateChatGroupScreen() {
  const router = useRouter(); const insets = useSafeAreaInsets(); const { user } = useAuth(); const { createGroup } = useMessages();
  const [name, setName] = useState(''); const [search, setSearch] = useState(''); const [rows, setRows] = useState<UserRow[]>([]);
  const [selected, setSelected] = useState(new Set<string>()); const [busy, setBusy] = useState(false);
  const groupIdRef = useRef(createChatClientMessageId());
  useEffect(() => {
    const query = search.trim(); if (!query) { setRows([]); return; }
    const timer = setTimeout(() => { void getSupabaseClient().from('public_user_profiles').select('id,username,avatar_url')
      .ilike('username', `%${query}%`).neq('id', user?.id || '').limit(30).then(({ data }) => setRows((data || []) as UserRow[])); }, 300);
    return () => clearTimeout(timer);
  }, [search, user?.id]);
  const submit = async () => {
    if (busy || !name.trim() || selected.size < 1) return; setBusy(true);
    try { const id = await createGroup(name.trim(), [...selected], groupIdRef.current); router.replace(`/chat/group/${id}` as any); }
    finally { setBusy(false); }
  };
  return <View style={[styles.root, { paddingTop: insets.top }]}>
    <View style={styles.header}><Pressable onPress={() => router.back()}><MaterialIcons name="close" size={24} color={Colors.textPrimary} /></Pressable><Text style={styles.title}>Nuevo grupo</Text><Pressable onPress={submit} disabled={busy || !name.trim() || selected.size < 1}>{busy ? <ActivityIndicator /> : <Text style={styles.action}>Crear</Text>}</Pressable></View>
    <TextInput style={styles.input} value={name} onChangeText={setName} maxLength={120} placeholder="Nombre del grupo" placeholderTextColor={Colors.textSubtle} />
    <TextInput style={styles.input} value={search} onChangeText={setSearch} placeholder="Buscar participantes" placeholderTextColor={Colors.textSubtle} />
    <Text style={styles.count}>{selected.size} seleccionados · máximo 255</Text>
    <FlatList data={rows} keyExtractor={item => item.id} renderItem={({ item }) => <Pressable style={styles.row} onPress={() => setSelected(current => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else if (next.size < 255) next.add(item.id); return next; })}>
      <Avatar uri={item.avatar_url || ''} username={item.username} size={42} /><Text style={styles.name}>@{item.username}</Text><MaterialIcons name={selected.has(item.id) ? 'check-circle' : 'radio-button-unchecked'} size={22} color={Colors.primary} />
    </Pressable>} />
  </View>;
}
const styles = StyleSheet.create({ root:{flex:1,backgroundColor:Colors.bg},header:{height:56,paddingHorizontal:Spacing.md,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},title:{color:Colors.textPrimary,fontSize:FontSize.lg,fontWeight:FontWeight.bold},action:{color:Colors.primary,fontWeight:FontWeight.bold},input:{marginHorizontal:Spacing.md,marginBottom:Spacing.sm,borderWidth:1,borderColor:Colors.border,borderRadius:12,color:Colors.textPrimary,padding:12},count:{color:Colors.textSubtle,paddingHorizontal:Spacing.md,paddingBottom:8},row:{flexDirection:'row',alignItems:'center',gap:12,padding:Spacing.md},name:{flex:1,color:Colors.textPrimary,fontSize:FontSize.md} });
