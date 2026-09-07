import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VoiceMessageBubble } from '@/components/chat/VoiceMessageBubble';
import { VoiceRecorderBar } from '@/components/chat/VoiceRecorderBar';
import { MessageReceiptSheet } from '@/components/chat/MessageReceiptSheet';
import { PrivateChatImage } from '@/components/chat/PrivateChatImage';
import { Colors, FontSize, FontWeight, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import { useMessages } from '@/hooks/useMessages';
import { uploadPrivateChatImage } from '@/services/chatMediaService';
import { ChatVoiceDraftSender } from '@/services/chatVoiceService';
import { generateUUID } from '@/services/agoraService';
import {
  getActiveGroupCall,
  startGroupCall,
  type CallType,
  type GroupCallSession,
} from '@/services/callSessionService';
import { getSupabaseClient } from '@/template';
import { sendCallNotification } from '@/services/callNotificationService';

export default function GroupChatScreen() {
  const { conversationId = '' } = useLocalSearchParams<{ conversationId: string }>(); const router = useRouter(); const insets = useSafeAreaInsets(); const { user } = useAuth();
  const ctx = useMessages(); const { activateConversationById, deactivateConversationById } = ctx; const conversation = ctx.conversations.find(item => item.id === conversationId);
  const [text, setText] = useState(''); const [activeVoice, setActiveVoice] = useState<string | null>(null); const [receiptId, setReceiptId] = useState<string | null>(null);
  const [activeCall, setActiveCall] = useState<GroupCallSession | null>(null);
  const callStartRef = useRef(false);
  const voiceDraftSenderRef = useRef(new ChatVoiceDraftSender());
  useEffect(() => { void activateConversationById(conversationId); return () => deactivateConversationById(conversationId); }, [activateConversationById, conversationId, deactivateConversationById]);
  useEffect(() => () => voiceDraftSenderRef.current.clear(), [conversationId, user?.id]);
  useEffect(() => {
    let stale = false;
    const refresh = () => void getActiveGroupCall(conversationId).then(call => {
      if (!stale) setActiveCall(call);
    }).catch(() => { if (!stale) setActiveCall(null); });
    refresh();
    const channel = getSupabaseClient().channel(`chat-group-call-entry:${conversationId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'calls', filter: `conversation_id=eq.${conversationId}`,
      }, refresh).subscribe();
    return () => { stale = true; void channel.unsubscribe(); };
  }, [conversationId]);
  const openGroupCall = useCallback((call: GroupCallSession) => router.push({
    pathname: '/group-call/[roomId]',
    params: {
      roomId: call.callId,
      conversationId,
      callType: call.callType,
      creatorId: call.callerId,
    },
  } as any), [conversationId, router]);
  const startCall = useCallback(async (callType: CallType) => {
    if (callStartRef.current) return;
    callStartRef.current = true;
    try {
      const existing = await getActiveGroupCall(conversationId);
      const call = existing ?? await startGroupCall({
        conversationId,
        callType,
        idempotencyKey: generateUUID(),
      });
      setActiveCall(call);
      if (!existing) void sendCallNotification(call.callId, 'incoming_call').catch(() => {});
      openGroupCall(call);
    } catch (error) {
      Alert.alert('Llamada no iniciada', error instanceof Error ? error.message : 'No se pudo iniciar.');
    } finally {
      callStartRef.current = false;
    }
  }, [conversationId, openGroupCall]);
  const send = useCallback(async () => { const value=text.trim(); if(!value)return; setText(''); try{await ctx.sendConversationMessage(conversationId,value);}catch(error){setText(value);Alert.alert('Mensaje no enviado',error instanceof Error?error.message:'No se pudo enviar.');} },[conversationId,ctx,text]);
  const pickImage = async () => { try { const permission=await ImagePicker.requestMediaLibraryPermissionsAsync(); if(!permission.granted)return; const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:ImagePicker.MediaTypeOptions.Images,quality:.7}); if(result.canceled)return; const asset=result.assets[0]; const mediaAssetId=await uploadPrivateChatImage({uri:asset.uri,mimeType:asset.mimeType||'image/jpeg',fileName:asset.fileName||undefined,sizeBytes:asset.fileSize}); await ctx.sendConversationMessage(conversationId,'Foto',{mediaType:'image',mediaAssetId}); } catch (error) { Alert.alert('Imagen no enviada', error instanceof Error ? error.message : 'No se pudo enviar.'); } };
  const data=useMemo(()=>ctx.messages[conversationId] || [],[conversationId,ctx.messages]);
  return <View style={[styles.root,{paddingTop:insets.top}]}><View style={styles.header}><Pressable onPress={()=>router.back()}><MaterialCommunityIcons name="arrow-left" size={24} color={Colors.textPrimary}/></Pressable><Pressable style={{flex:1}} onPress={()=>router.push(`/chat/group/${conversationId}/info` as any)}><Text style={styles.title}>{conversation?.displayName||'Grupo'}</Text><Text style={styles.sub}>{activeCall?'Llamada en curso':`${conversation?.memberCount||0} miembros`}</Text></Pressable><Pressable accessibilityLabel="Iniciar llamada de audio grupal" onPress={()=>void startCall('audio')}><MaterialCommunityIcons name="phone-outline" size={22} color={Colors.textPrimary}/></Pressable><Pressable accessibilityLabel="Iniciar videollamada grupal" onPress={()=>void startCall('video')}><MaterialCommunityIcons name="video-outline" size={23} color={Colors.textPrimary}/></Pressable></View>
    {activeCall?<Pressable style={styles.callBanner} onPress={()=>openGroupCall(activeCall)}><MaterialCommunityIcons name={activeCall.callType==='audio'?'phone':'video'} size={18} color="#fff"/><Text style={styles.callBannerText}>Llamada grupal en curso · Unirme</Text></Pressable>:null}
    <FlatList data={data} keyExtractor={item=>item.id} onStartReached={()=>ctx.loadOlderConversationMessages(conversationId)} renderItem={({item})=>{const mine=item.senderId===user?.id;return <Pressable onPress={()=>mine&&item.deliveryStatus==='failed'&&item.clientMessageId&&void ctx.retryConversationMessage(conversationId,item.clientMessageId)} onLongPress={()=>mine&&!item.id.startsWith('opt_')&&setReceiptId(item.id)} style={[styles.bubble,mine?styles.mine:styles.theirs]}>{!mine?<Text style={styles.sender}>@{item.senderUsername||'usuario'}</Text>:null}{item.mediaType==='voice'&&item.mediaAssetId?<VoiceMessageBubble messageId={item.id} assetId={item.mediaAssetId} durationMs={item.audioDurationMs||1} waveform={item.audioWaveform||Array(48).fill(0)} isMine={mine} activeMessageId={activeVoice} onActivate={setActiveVoice}/>:item.mediaType==='image'?<PrivateChatImage assetId={item.mediaAssetId} legacyUrl={item.mediaUrl}/>:<Text style={styles.body}>{item.text}</Text>}{mine?<Text style={styles.status}>{item.deliveryStatus==='failed'?'Error · toca para reintentar':`${item.deliveryStatus} · ${item.readCount||0}/${item.recipientCount||0}`}</Text>:null}</Pressable>}} contentContainerStyle={styles.list}/>
    <VoiceRecorderBar identityKey={`${user?.id||''}:${conversationId}`} onError={message=>Alert.alert('Nota de voz',message)} onSend={draft=>voiceDraftSenderRef.current.handoff(draft,input=>ctx.sendConversationVoiceMessage(conversationId,input)).then(()=>undefined)} />
    <View style={[styles.composer,{paddingBottom:Math.max(insets.bottom,8)}]}><Pressable onPress={()=>void pickImage()}><MaterialCommunityIcons name="image-outline" size={24} color={Colors.primary}/></Pressable><TextInput style={styles.input} value={text} onChangeText={setText} placeholder="Mensaje" placeholderTextColor={Colors.textSubtle}/><Pressable onPress={()=>void send()}><MaterialCommunityIcons name="send" size={24} color={Colors.primary}/></Pressable></View>
    <MessageReceiptSheet messageId={receiptId} visible={Boolean(receiptId)} onClose={()=>setReceiptId(null)}/></View>;
}
const styles=StyleSheet.create({root:{flex:1,backgroundColor:Colors.bg},header:{height:58,flexDirection:'row',alignItems:'center',gap:14,paddingHorizontal:Spacing.md,borderBottomWidth:1,borderColor:Colors.border},title:{color:Colors.textPrimary,fontWeight:FontWeight.bold,fontSize:FontSize.md},sub:{color:Colors.textSubtle,fontSize:11},callBanner:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,padding:9,backgroundColor:Colors.primary},callBannerText:{color:'#fff',fontWeight:FontWeight.semibold,fontSize:12},list:{padding:Spacing.md,gap:8},bubble:{maxWidth:'82%',padding:10,borderRadius:14},mine:{alignSelf:'flex-end',backgroundColor:Colors.primary},theirs:{alignSelf:'flex-start',backgroundColor:Colors.surfaceElevated},sender:{color:Colors.primary,fontSize:11,fontWeight:FontWeight.bold},body:{color:Colors.textPrimary},status:{color:'#ddd',fontSize:9,textAlign:'right',marginTop:4},composer:{flexDirection:'row',alignItems:'center',gap:10,padding:8,borderTopWidth:1,borderColor:Colors.border},input:{flex:1,color:Colors.textPrimary,backgroundColor:Colors.surfaceElevated,borderRadius:18,paddingHorizontal:14,paddingVertical:8}});
