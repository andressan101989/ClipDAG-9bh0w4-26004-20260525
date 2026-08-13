import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Image } from "expo-image";
import { randomUUID } from "expo-crypto";
import { MaterialCommunityIcons, MaterialIcons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors, FontSize, FontWeight, Radius, Spacing } from "@/constants/theme";
import {
  addMyCreatorShowcaseProduct,
  fetchMyCreatorEligibleProducts,
  fetchMyCreatorShowcase,
  removeMyCreatorShowcaseProduct,
  reorderMyCreatorShowcase,
  MarketplaceCreatorShowcaseError,
  type MarketplaceCreatorShowcaseManagementItem,
  type MarketplaceCreatorShowcaseProduct,
} from "@/services/marketplaceCreatorShowcaseService";

type Tab = "showcase" | "eligible";

export default function CreatorShowcaseScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>("showcase");
  const [showcase, setShowcase] = useState<MarketplaceCreatorShowcaseManagementItem[]>([]);
  const [eligible, setEligible] = useState<MarketplaceCreatorShowcaseProduct[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cursor, setCursor] = useState<{ updatedAt: string; id: string } | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    setError(false);
    try {
      const [current, products] = await Promise.all([
        fetchMyCreatorShowcase(),
        fetchMyCreatorEligibleProducts({ search, limit: 20 }),
      ]);
      setShowcase(current);
      setEligible(products.items);
      setCursor(products.nextCursor as { updatedAt: string; id: string } | null);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [search]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  const active = useMemo(
    () => showcase.filter((item) => item.status === "active").sort((a, b) => (a.sortPosition ?? 0) - (b.sortPosition ?? 0)),
    [showcase],
  );

  const add = useCallback(async (product: MarketplaceCreatorShowcaseProduct) => {
    if (busyId) return;
    setBusyId(product.productId);
    try {
      await addMyCreatorShowcaseProduct(product.productId, randomUUID());
      await load(true);
      setTab("showcase");
    } catch (error) {
      if (error instanceof MarketplaceCreatorShowcaseError && error.code === "marketplace_creator_showcase_limit_reached") {
        Alert.alert("Escaparate completo", "Tu escaparate admite hasta 100 productos. Elimina uno antes de agregar otro.");
      } else {
        Alert.alert("Product unavailable", "The seller offer is no longer eligible for your showcase.");
      }
    } finally {
      setBusyId(null);
    }
  }, [busyId, load]);

  const remove = useCallback(async (item: MarketplaceCreatorShowcaseManagementItem) => {
    if (busyId) return;
    setBusyId(item.showcaseItemId);
    try {
      await removeMyCreatorShowcaseProduct(item.showcaseItemId, randomUUID());
      await load(true);
    } catch {
      Alert.alert("Could not remove product", "Please try again.");
    } finally {
      setBusyId(null);
    }
  }, [busyId, load]);

  const move = useCallback(async (item: MarketplaceCreatorShowcaseManagementItem, delta: -1 | 1) => {
    const index = active.findIndex((value) => value.showcaseItemId === item.showcaseItemId);
    const target = index + delta;
    if (busyId || index < 0 || target < 0 || target >= active.length) return;
    const next = [...active];
    [next[index], next[target]] = [next[target], next[index]];
    setBusyId(item.showcaseItemId);
    try {
      await reorderMyCreatorShowcase(next.map((value) => value.showcaseItemId), randomUUID());
      await load(true);
    } catch {
      Alert.alert("Could not reorder showcase", "Refresh and try again.");
    } finally {
      setBusyId(null);
    }
  }, [active, busyId, load]);

  const loadMore = useCallback(async () => {
    if (tab !== "eligible" || !cursor || loading) return;
    setLoading(true);
    try {
      const page = await fetchMyCreatorEligibleProducts({ search, limit: 20, cursor });
      setEligible((current) => [...current, ...page.items.filter((item) => !current.some((value) => value.productId === item.productId))]);
      setCursor(page.nextCursor as { updatedAt: string; id: string } | null);
    } finally {
      setLoading(false);
    }
  }, [cursor, loading, search, tab]);

  const data = tab === "showcase" ? active : eligible;
  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <StatusBar style="light" />
      <View style={[styles.header, { paddingTop: insets.top }]}> 
        <Pressable style={styles.iconButton} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back">
          <MaterialIcons name="arrow-back-ios" size={20} color={Colors.textPrimary} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Creator Showcase</Text>
          <Text style={styles.subtitle}>Products backed by seller-approved offers · {active.length} / 100</Text>
        </View>
        <View style={styles.iconButton} />
      </View>
      <View style={styles.tabs}>
        <TabButton active={tab === "showcase"} label="My showcase" icon="storefront-outline" onPress={() => setTab("showcase")} />
        <TabButton active={tab === "eligible"} label="Available" icon="shopping-search" onPress={() => setTab("eligible")} />
      </View>
      {tab === "eligible" ? (
        <View style={styles.searchWrap}>
          <MaterialIcons name="search" size={20} color={Colors.textSubtle} />
          <TextInput value={search} onChangeText={setSearch} placeholder="Search products or stores" placeholderTextColor={Colors.textSubtle} style={styles.search} returnKeyType="search" accessibilityLabel="Search eligible products" />
        </View>
      ) : null}
      {loading && !data.length ? <View style={styles.center}><ActivityIndicator color={Colors.primary} /><Text style={styles.muted}>Loading products...</Text></View>
        : error ? <View style={styles.center}><MaterialIcons name="cloud-off" size={42} color={Colors.textSubtle} /><Text style={styles.emptyTitle}>Could not load your showcase</Text><Pressable style={styles.retry} onPress={() => void load()}><Text style={styles.retryText}>Try again</Text></Pressable></View>
          : <FlatList
              data={data}
              keyExtractor={(item) => tab === "showcase" ? (item as MarketplaceCreatorShowcaseManagementItem).showcaseItemId : item.productId}
              contentContainerStyle={[styles.list, !data.length && styles.emptyList, { paddingBottom: insets.bottom + Spacing.xl }]}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={Colors.primary} />}
              onEndReached={() => void loadMore()}
              onEndReachedThreshold={0.35}
              ListEmptyComponent={<View style={styles.center}><MaterialCommunityIcons name={tab === "showcase" ? "storefront-outline" : "shopping-search"} size={48} color={Colors.borderHighlight} /><Text style={styles.emptyTitle}>{tab === "showcase" ? "Your showcase is empty" : "No eligible products"}</Text><Text style={styles.muted}>{tab === "showcase" ? "Choose a seller-approved product to get started." : "Try another search or check back when sellers publish offers."}</Text>{tab === "showcase" ? <Pressable style={styles.retry} onPress={() => setTab("eligible")}><Text style={styles.retryText}>Browse available products</Text></Pressable> : null}</View>}
              renderItem={({ item, index }) => {
                const management = tab === "showcase" ? item as MarketplaceCreatorShowcaseManagementItem : null;
                const busy = busyId === (management?.showcaseItemId ?? item.productId);
                return <View style={styles.card}>
                  <Pressable style={styles.productTap} onPress={() => router.push({ pathname: "/product/[id]", params: { id: item.productId } } as never)} accessibilityRole="button" accessibilityLabel={`Open ${item.title}`}>
                    {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={styles.image} contentFit="cover" transition={150} /> : <View style={[styles.image, styles.imageFallback]}><MaterialIcons name="image" size={28} color={Colors.textSubtle} /></View>}
                    <View style={styles.copy}>
                      <Text style={styles.productTitle} numberOfLines={2}>{item.title}</Text>
                      <Text style={styles.store} numberOfLines={1}>{item.storeName}</Text>
                      <Text style={styles.price}>{item.minPrice.toFixed(2)} BDAG</Text>
                      {tab === "eligible" && item.commissionBps ? <View style={styles.commission}><MaterialCommunityIcons name="hand-coin-outline" size={14} color={Colors.accent} /><Text style={styles.commissionText}>{(item.commissionBps / 100).toFixed(2)}% commission</Text></View> : null}
                      {management && !management.currentEligible ? <Text style={styles.unavailable}>Offer ended - unavailable to buyers</Text> : null}
                    </View>
                  </Pressable>
                  {management ? <View style={styles.actions}>
                    <Pressable style={styles.action} disabled={index === 0 || busy} onPress={() => void move(management, -1)} accessibilityLabel={`Move ${item.title} up`}><MaterialIcons name="keyboard-arrow-up" size={24} color={index === 0 ? Colors.textSubtle : Colors.textPrimary} /></Pressable>
                    <Pressable style={styles.action} disabled={index === active.length - 1 || busy} onPress={() => void move(management, 1)} accessibilityLabel={`Move ${item.title} down`}><MaterialIcons name="keyboard-arrow-down" size={24} color={index === active.length - 1 ? Colors.textSubtle : Colors.textPrimary} /></Pressable>
                    <Pressable style={styles.action} disabled={busy} onPress={() => void remove(management)} accessibilityLabel={`Remove ${item.title}`}><MaterialIcons name="delete-outline" size={22} color={Colors.secondary} /></Pressable>
                  </View> : <Pressable style={[styles.add, (item.selected || busy) && styles.disabled]} disabled={item.selected || busy} onPress={() => void add(item)} accessibilityRole="button" accessibilityLabel={item.selected ? `${item.title} already selected` : `Add ${item.title} to showcase`}>
                    {busy ? <ActivityIndicator size="small" color="#fff" /> : <MaterialIcons name={item.selected ? "check" : "add"} size={20} color="#fff" />}
                  </Pressable>}
                </View>;
              }}
              ListFooterComponent={loading && data.length ? <ActivityIndicator color={Colors.primary} /> : null}
            />}
    </KeyboardAvoidingView>
  );
}

function TabButton({ active, label, icon, onPress }: { active: boolean; label: string; icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"]; onPress: () => void }) {
  return <Pressable style={[styles.tab, active && styles.tabActive]} onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: active }}><MaterialCommunityIcons name={icon} size={19} color={active ? Colors.textPrimary : Colors.textSubtle} /><Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  root:{flex:1,backgroundColor:Colors.bg},header:{minHeight:76,flexDirection:"row",alignItems:"flex-end",paddingHorizontal:Spacing.sm,paddingBottom:Spacing.sm,borderBottomWidth:1,borderBottomColor:Colors.border},iconButton:{width:44,height:44,alignItems:"center",justifyContent:"center"},headerCopy:{flex:1,alignItems:"center"},title:{color:Colors.textPrimary,fontSize:FontSize.xl,fontWeight:FontWeight.extrabold},subtitle:{color:Colors.textSubtle,fontSize:FontSize.xs},tabs:{flexDirection:"row",padding:Spacing.sm,gap:Spacing.sm},tab:{flex:1,minHeight:44,borderRadius:Radius.full,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:Spacing.xs,backgroundColor:Colors.surface,borderWidth:1,borderColor:Colors.border},tabActive:{backgroundColor:Colors.primaryDim,borderColor:Colors.primary},tabText:{color:Colors.textSubtle,fontWeight:FontWeight.semibold},tabTextActive:{color:Colors.textPrimary},searchWrap:{marginHorizontal:Spacing.md,marginBottom:Spacing.sm,minHeight:46,borderRadius:Radius.md,backgroundColor:Colors.surfaceElevated,borderWidth:1,borderColor:Colors.border,flexDirection:"row",alignItems:"center",paddingHorizontal:Spacing.md,gap:Spacing.sm},search:{flex:1,color:Colors.textPrimary,fontSize:FontSize.md},list:{padding:Spacing.md,gap:Spacing.md},emptyList:{flexGrow:1},center:{flex:1,minHeight:260,alignItems:"center",justifyContent:"center",gap:Spacing.md,padding:Spacing.xl},muted:{color:Colors.textSecondary,textAlign:"center",fontSize:FontSize.sm,lineHeight:20},emptyTitle:{color:Colors.textPrimary,fontSize:FontSize.lg,fontWeight:FontWeight.bold,textAlign:"center"},retry:{minHeight:44,paddingHorizontal:Spacing.lg,borderRadius:Radius.full,backgroundColor:Colors.primary,alignItems:"center",justifyContent:"center"},retryText:{color:"#fff",fontWeight:FontWeight.bold},card:{backgroundColor:Colors.surfaceElevated,borderRadius:Radius.lg,borderWidth:1,borderColor:Colors.border,padding:Spacing.sm,flexDirection:"row",alignItems:"center",gap:Spacing.sm},productTap:{flex:1,flexDirection:"row",alignItems:"center",gap:Spacing.md},image:{width:82,height:82,borderRadius:Radius.md},imageFallback:{backgroundColor:Colors.surface,alignItems:"center",justifyContent:"center"},copy:{flex:1,gap:3},productTitle:{color:Colors.textPrimary,fontSize:FontSize.md,fontWeight:FontWeight.bold},store:{color:Colors.textSubtle,fontSize:FontSize.xs},price:{color:Colors.primaryLight,fontWeight:FontWeight.extrabold},commission:{flexDirection:"row",alignItems:"center",gap:4},commissionText:{color:Colors.accent,fontSize:FontSize.xs,fontWeight:FontWeight.semibold},unavailable:{color:Colors.warning,fontSize:FontSize.xs},add:{width:44,height:44,borderRadius:22,backgroundColor:Colors.primary,alignItems:"center",justifyContent:"center"},disabled:{opacity:.45},actions:{gap:2},action:{width:40,height:36,alignItems:"center",justifyContent:"center"},
});
