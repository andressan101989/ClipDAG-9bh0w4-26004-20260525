import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { Image } from "expo-image";
import { MaterialCommunityIcons, MaterialIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors, FontSize, FontWeight, Radius, Spacing } from "@/constants/theme";
import {
  fetchMyCreatorEligibleProducts,
  fetchMyCreatorShowcase,
  type MarketplaceCreatorShowcaseProduct,
} from "@/services/marketplaceCreatorShowcaseService";

interface Props {
  visible: boolean;
  selected: MarketplaceCreatorShowcaseProduct[];
  onChange: (products: MarketplaceCreatorShowcaseProduct[]) => void;
  onClose: () => void;
}

export function CreatorContentProductSelector({ visible, selected, onChange, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [products, setProducts] = useState<MarketplaceCreatorShowcaseProduct[]>([]);
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<{ updatedAt: string; id: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!visible) return;
    setLoading(true);
    setFailed(false);
    try {
      const [showcase, eligible] = await Promise.all([
        fetchMyCreatorShowcase(),
        fetchMyCreatorEligibleProducts({ search, limit: 20 }),
      ]);
      const preferred = showcase
        .filter((item) => item.status === "active" && item.currentEligible)
        .map((item) => ({ ...item, selected: true }));
      setProducts([...preferred, ...eligible.items.filter((item) => !preferred.some((value) => value.productId === item.productId))]);
      setCursor(eligible.nextCursor as { updatedAt: string; id: string } | null);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [search, visible]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  const selectedIds = useMemo(() => new Set(selected.map((item) => item.productId)), [selected]);
  const toggle = useCallback((product: MarketplaceCreatorShowcaseProduct) => {
    if (selectedIds.has(product.productId)) {
      onChange(selected.filter((item) => item.productId !== product.productId));
    } else if (selected.length < 5) {
      onChange([...selected, product]);
    }
  }, [onChange, selected, selectedIds]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchMyCreatorEligibleProducts({ search, limit: 20, cursor });
      setProducts((current) => [...current, ...page.items.filter((item) => !current.some((value) => value.productId === item.productId))]);
      setCursor(page.nextCursor as { updatedAt: string; id: string } | null);
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore, search]);

  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
        <View><Text style={styles.title}>Productos</Text><Text style={styles.subtitle}>{selected.length} / 5 seleccionados</Text></View>
        <Pressable style={styles.close} onPress={onClose} accessibilityLabel="Cerrar selector de productos"><MaterialIcons name="close" size={24} color={Colors.textPrimary} /></Pressable>
      </View>
      <View style={styles.searchWrap}><MaterialIcons name="search" size={20} color={Colors.textSubtle} /><TextInput value={search} onChangeText={setSearch} placeholder="Buscar productos elegibles" placeholderTextColor={Colors.textSubtle} style={styles.search} /></View>
      {selected.length ? <View style={styles.selectedBar}><MaterialCommunityIcons name="shopping-outline" size={18} color={Colors.primaryLight} /><Text style={styles.selectedText} numberOfLines={1}>{selected.map((item) => item.title).join(" · ")}</Text></View> : null}
      {loading && !products.length ? <View style={styles.center}><ActivityIndicator color={Colors.primary} /><Text style={styles.muted}>Cargando productos...</Text></View>
        : failed ? <View style={styles.center}><MaterialIcons name="cloud-off" size={38} color={Colors.textSubtle} /><Text style={styles.emptyTitle}>No pudimos cargar los productos</Text><Pressable style={styles.retry} onPress={() => void load()}><Text style={styles.retryText}>Reintentar</Text></Pressable></View>
          : <FlatList data={products} keyExtractor={(item) => item.productId} contentContainerStyle={[styles.list, !products.length && styles.emptyList, { paddingBottom: insets.bottom + 80 }]}
              onEndReached={() => void loadMore()} onEndReachedThreshold={0.35}
              ListEmptyComponent={<View style={styles.center}><MaterialCommunityIcons name="shopping-search" size={44} color={Colors.borderHighlight} /><Text style={styles.emptyTitle}>No hay productos elegibles</Text><Text style={styles.muted}>Los productos necesitan una oferta aprobada por el vendedor.</Text></View>}
              ListFooterComponent={loadingMore ? <ActivityIndicator color={Colors.primary} /> : null}
              renderItem={({ item }) => {
                const checked = selectedIds.has(item.productId);
                const disabled = !checked && selected.length >= 5;
                return <Pressable style={[styles.card, disabled && styles.disabled]} disabled={disabled} onPress={() => toggle(item)} accessibilityRole="checkbox" accessibilityState={{ checked, disabled }}>
                  {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={styles.image} contentFit="cover" /> : <View style={[styles.image, styles.fallback]}><MaterialIcons name="image" size={24} color={Colors.textSubtle} /></View>}
                  <View style={styles.copy}><Text style={styles.productTitle} numberOfLines={2}>{item.title}</Text><Text style={styles.store} numberOfLines={1}>{item.storeName}</Text><Text style={styles.price}>{item.minPrice.toFixed(2)} BDAG</Text>{item.commissionBps ? <Text style={styles.commission}>{(item.commissionBps / 100).toFixed(2)}% comisión</Text> : null}</View>
                  <MaterialCommunityIcons name={checked ? "checkbox-marked-circle" : "checkbox-blank-circle-outline"} size={26} color={checked ? Colors.primary : Colors.textSubtle} />
                </Pressable>;
              }} />}
      <Pressable style={styles.done} onPress={onClose} accessibilityRole="button"><Text style={styles.doneText}>Listo</Text></Pressable>
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({
  root:{flex:1,backgroundColor:Colors.bg},header:{minHeight:76,paddingHorizontal:Spacing.lg,paddingBottom:Spacing.sm,flexDirection:"row",alignItems:"center",justifyContent:"space-between",borderBottomWidth:1,borderBottomColor:Colors.border},title:{color:Colors.textPrimary,fontSize:FontSize.xl,fontWeight:FontWeight.extrabold},subtitle:{color:Colors.textSubtle,fontSize:FontSize.xs},close:{width:44,height:44,alignItems:"center",justifyContent:"center"},searchWrap:{margin:Spacing.md,minHeight:46,borderRadius:Radius.md,backgroundColor:Colors.surfaceElevated,borderWidth:1,borderColor:Colors.border,flexDirection:"row",alignItems:"center",paddingHorizontal:Spacing.md,gap:Spacing.sm},search:{flex:1,color:Colors.textPrimary},selectedBar:{marginHorizontal:Spacing.md,marginBottom:Spacing.sm,flexDirection:"row",alignItems:"center",gap:Spacing.xs},selectedText:{flex:1,color:Colors.textSecondary,fontSize:FontSize.xs},list:{paddingHorizontal:Spacing.md,gap:Spacing.sm},emptyList:{flexGrow:1},card:{minHeight:92,backgroundColor:Colors.surfaceElevated,borderRadius:Radius.lg,borderWidth:1,borderColor:Colors.border,padding:Spacing.sm,flexDirection:"row",alignItems:"center",gap:Spacing.md},disabled:{opacity:.45},image:{width:70,height:70,borderRadius:Radius.md},fallback:{backgroundColor:Colors.surface,alignItems:"center",justifyContent:"center"},copy:{flex:1,gap:2},productTitle:{color:Colors.textPrimary,fontWeight:FontWeight.bold},store:{color:Colors.textSubtle,fontSize:FontSize.xs},price:{color:Colors.primaryLight,fontWeight:FontWeight.bold},commission:{color:Colors.accent,fontSize:FontSize.xs},center:{flex:1,minHeight:240,alignItems:"center",justifyContent:"center",gap:Spacing.md,padding:Spacing.xl},emptyTitle:{color:Colors.textPrimary,fontWeight:FontWeight.bold},muted:{color:Colors.textSecondary,textAlign:"center"},retry:{backgroundColor:Colors.primary,paddingHorizontal:Spacing.lg,paddingVertical:Spacing.sm,borderRadius:Radius.full},retryText:{color:"#fff",fontWeight:FontWeight.bold},done:{position:"absolute",left:Spacing.lg,right:Spacing.lg,bottom:Spacing.lg,minHeight:50,borderRadius:Radius.full,backgroundColor:Colors.primary,alignItems:"center",justifyContent:"center"},doneText:{color:"#fff",fontWeight:FontWeight.extrabold},
});
