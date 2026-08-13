import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { MaterialCommunityIcons, MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors, FontSize, FontWeight, Radius, Spacing } from "@/constants/theme";
import {
  fetchMarketplaceContentProductTags,
  type MarketplaceCreatorContentTagProduct,
  type MarketplaceCreatorContentType,
} from "@/services/marketplaceCreatorContentTagService";

interface Props {
  visible: boolean;
  contentId: string | null;
  contentType: MarketplaceCreatorContentType;
  creatorDisplayName?: string;
  onClose: () => void;
}

export function CreatorContentProductSheet({ visible, contentId, contentType, creatorDisplayName, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<MarketplaceCreatorContentTagProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!visible || !contentId) return;
    setLoading(true);
    setFailed(false);
    try {
      const result = await fetchMarketplaceContentProductTags(contentType, contentId);
      setItems(result.visible ? result.items : []);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [contentId, contentType, visible]);

  useEffect(() => { void load(); }, [load]);
  const open = (item: MarketplaceCreatorContentTagProduct) => {
    onClose();
    router.push({ pathname: "/product/[id]", params: {
      id: item.productId,
      source: item.contentType,
      sourceId: item.tagId,
      contentProductTagId: item.tagId,
      ...(creatorDisplayName ? { creatorDisplayName } : {}),
    } } as never);
  };

  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Cerrar productos" />
    <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.md }]}>
      <View style={styles.handle} />
      <View style={styles.header}><View style={styles.headerCopy}><MaterialCommunityIcons name="shopping-outline" size={21} color={Colors.primaryLight} /><Text style={styles.title}>Productos</Text></View><Pressable style={styles.close} onPress={onClose}><MaterialIcons name="close" size={22} color={Colors.textPrimary} /></Pressable></View>
      {loading ? <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>
        : failed ? <View style={styles.center}><Text style={styles.muted}>No pudimos cargar estos productos.</Text><Pressable onPress={() => void load()}><Text style={styles.retry}>Reintentar</Text></Pressable></View>
          : <FlatList data={items} keyExtractor={(item) => item.tagId} contentContainerStyle={styles.list}
              ListEmptyComponent={<View style={styles.center}><Text style={styles.muted}>Estos productos ya no están disponibles.</Text></View>}
              renderItem={({ item }) => <Pressable style={styles.card} onPress={() => open(item)} accessibilityLabel={`Abrir ${item.title}`}>
                {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={styles.image} contentFit="cover" /> : <View style={[styles.image,styles.fallback]}><MaterialIcons name="image" size={24} color={Colors.textSubtle} /></View>}
                <View style={styles.copy}><Text style={styles.productTitle} numberOfLines={2}>{item.title}</Text><Text style={styles.store} numberOfLines={1}>{item.storeName}</Text><Text style={styles.price}>{item.minPrice.toFixed(2)} BDAG</Text><Text style={styles.stock}>{item.availableQuantity > 0 ? "Disponible" : "Agotado"}</Text></View>
                <MaterialIcons name="chevron-right" size={24} color={Colors.textSubtle} />
              </Pressable>} />}
    </View>
  </Modal>;
}

const styles=StyleSheet.create({
  backdrop:{...StyleSheet.absoluteFillObject,backgroundColor:"rgba(0,0,0,.62)"},sheet:{position:"absolute",left:0,right:0,bottom:0,maxHeight:"72%",minHeight:280,backgroundColor:Colors.surface,borderTopLeftRadius:Radius.xl,borderTopRightRadius:Radius.xl,borderWidth:1,borderColor:Colors.border},handle:{width:42,height:4,borderRadius:2,backgroundColor:Colors.borderHighlight,alignSelf:"center",marginTop:Spacing.sm},header:{minHeight:62,paddingHorizontal:Spacing.md,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},headerCopy:{flexDirection:"row",alignItems:"center",gap:Spacing.sm},title:{color:Colors.textPrimary,fontSize:FontSize.lg,fontWeight:FontWeight.extrabold},close:{width:42,height:42,alignItems:"center",justifyContent:"center"},list:{paddingHorizontal:Spacing.md,paddingBottom:Spacing.md,gap:Spacing.sm},card:{backgroundColor:Colors.surfaceElevated,borderRadius:Radius.lg,borderWidth:1,borderColor:Colors.border,padding:Spacing.sm,flexDirection:"row",alignItems:"center",gap:Spacing.md},image:{width:76,height:76,borderRadius:Radius.md},fallback:{backgroundColor:Colors.bg,alignItems:"center",justifyContent:"center"},copy:{flex:1,gap:2},productTitle:{color:Colors.textPrimary,fontWeight:FontWeight.bold},store:{color:Colors.textSubtle,fontSize:FontSize.xs},price:{color:Colors.primaryLight,fontWeight:FontWeight.bold},stock:{color:Colors.textSecondary,fontSize:FontSize.xs},center:{minHeight:170,alignItems:"center",justifyContent:"center",gap:Spacing.sm},muted:{color:Colors.textSecondary,textAlign:"center"},retry:{color:Colors.primaryLight,fontWeight:FontWeight.bold},
});
