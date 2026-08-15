import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { Colors, FontSize, FontWeight, Radius, Spacing } from "@/constants/theme";
import {
  fetchMarketplaceProductReviews,
  fetchMarketplaceStoreReviews,
  submitMarketplaceProductReview,
  submitMarketplaceSellerReview,
  type MarketplaceProductReputation,
  type MarketplaceReview,
  type MarketplaceReviewCursor,
} from "@/services/marketplaceReviewService";

type ReviewKind = "product" | "seller";
type Props = {
  productId: string;
  reputation: MarketplaceProductReputation;
  onReputationRefresh: () => Promise<void>;
};

const formatDate = (value: string) => new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));

function Stars({ rating, interactive = false, disabled = false, onSelect }: { rating: number; interactive?: boolean; disabled?: boolean; onSelect?: (rating: number) => void }) {
  return (
    <View style={styles.stars} accessibilityRole={interactive ? "radiogroup" : undefined} accessibilityLabel={interactive ? "Selecciona una calificación de una a cinco estrellas" : `${rating} de 5 estrellas`}>
      {[1, 2, 3, 4, 5].map((value) => interactive ? (
        <Pressable key={value} style={styles.starTarget} onPress={() => onSelect?.(value)} disabled={disabled} accessibilityRole="radio" accessibilityLabel={`${value} ${value === 1 ? "estrella" : "estrellas"}`} accessibilityState={{ selected: rating === value, disabled }}>
          <MaterialIcons name={value <= rating ? "star" : "star-border"} size={28} color={value <= rating ? Colors.warning : Colors.textSubtle} />
        </Pressable>
      ) : <MaterialIcons key={value} name={value <= Math.round(rating) ? "star" : "star-border"} size={16} color={Colors.warning} />)}
    </View>
  );
}

export function ProductRatingSummary({ reputation }: { reputation: MarketplaceProductReputation | null }) {
  const aggregate = reputation?.productAggregate;
  if (!aggregate?.reviewCount || aggregate.averageRating === null) return <Text style={styles.noSummary}>Sin reseñas todavía</Text>;
  return <View style={styles.summaryLine}><MaterialIcons name="star" size={17} color={Colors.warning} /><Text style={styles.summaryScore}>{aggregate.averageRating.toFixed(1)}</Text><Text style={styles.summaryCount}>({aggregate.reviewCount} {aggregate.reviewCount === 1 ? "reseña" : "reseñas"})</Text></View>;
}

export function ProductReviewsSection({ productId, reputation, onReputationRefresh }: Props) {
  const [kind, setKind] = useState<ReviewKind>("product"), [items, setItems] = useState<MarketplaceReview[]>([]), [cursor, setCursor] = useState<MarketplaceReviewCursor | null>(null), [loading, setLoading] = useState(true), [loadingMore, setLoadingMore] = useState(false), [error, setError] = useState<string | null>(null), [editing, setEditing] = useState(false), [rating, setRating] = useState(0), [comment, setComment] = useState(""), [submitting, setSubmitting] = useState(false);
  const eligibility = kind === "product" ? reputation.productEligibility : reputation.sellerEligibility;
  const aggregate = kind === "product" ? reputation.productAggregate : reputation.sellerAggregate;

  const load = useCallback(async (next: MarketplaceReviewCursor | null = null) => {
    next ? setLoadingMore(true) : setLoading(true);
    setError(null);
    try {
      const page = kind === "product" ? await fetchMarketplaceProductReviews(productId, next, 10) : await fetchMarketplaceStoreReviews(reputation.store.id, next, 10);
      setItems((current) => next ? [...new Map([...current, ...page.items].map((item) => [item.id, item])).values()] : page.items);
      setCursor(page.nextCursor);
    } catch {
      setError("No se pudieron cargar las reseñas.");
    } finally {
      setLoading(false); setLoadingMore(false);
    }
  }, [kind, productId, reputation.store.id]);
  useEffect(() => { setItems([]); setCursor(null); setEditing(false); void load(); }, [load]);
  useEffect(() => {
    setRating(eligibility.review?.rating ?? 0);
    setComment(eligibility.review?.comment ?? "");
  }, [eligibility.review?.id, eligibility.review?.rating, eligibility.review?.comment, kind]);

  const submit = async () => {
    if (!eligibility.eligible || !eligibility.targetId || rating < 1 || rating > 5 || submitting) return;
    setSubmitting(true); setError(null);
    try {
      if (kind === "product") await submitMarketplaceProductReview(eligibility.targetId, rating, comment);
      else await submitMarketplaceSellerReview(eligibility.targetId, rating, comment);
      await onReputationRefresh();
      await load();
      setEditing(false);
    } catch {
      setError("No se pudo guardar tu reseña. Inténtalo de nuevo.");
    } finally { setSubmitting(false); }
  };

  return (
    <View style={styles.section}>
      <Text style={styles.eyebrow}>REPUTACIÓN VERIFICADA</Text>
      <Text style={styles.title}>Reseñas</Text>
      <View style={styles.tabs} accessibilityRole="tablist" accessibilityLabel="Tipo de reseña">
        {(["product", "seller"] as const).map((value) => {
          const selected = value === kind;
          return <Pressable key={value} style={[styles.tab, selected && styles.tabSelected]} onPress={() => setKind(value)} accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={value === "product" ? "Reseñas del producto" : "Valoración del vendedor"}><Text style={[styles.tabText, selected && styles.tabTextSelected]}>{value === "product" ? "Producto" : "Vendedor"}</Text></Pressable>;
        })}
      </View>
      <View style={styles.aggregate}>
        <Text style={styles.aggregateScore}>{aggregate.averageRating === null ? "—" : aggregate.averageRating.toFixed(1)}</Text>
        <View><Stars rating={aggregate.averageRating ?? 0} /><Text style={styles.aggregateCount}>{aggregate.reviewCount ? `${aggregate.reviewCount} ${aggregate.reviewCount === 1 ? "reseña" : "reseñas"}` : "Sin reseñas todavía"}</Text></View>
      </View>
      {kind === "product" && reputation.productAggregate.reviewCount > 0 ? <View style={styles.distribution}>{[5, 4, 3, 2, 1].map((star) => <View key={star} style={styles.distributionRow}><Text style={styles.distributionLabel}>{star} ★</Text><View style={styles.track}><View style={[styles.fill, { width: `${Math.round((reputation.productAggregate.distribution[star as 1 | 2 | 3 | 4 | 5] / reputation.productAggregate.reviewCount) * 100)}%` }]} /></View><Text style={styles.distributionValue}>{reputation.productAggregate.distribution[star as 1 | 2 | 3 | 4 | 5]}</Text></View>)}</View> : null}

      {eligibility.eligible ? (
        editing ? <View style={styles.editor}><Text style={styles.editorTitle}>{kind === "product" ? "Califica este producto" : "Califica al vendedor"}</Text><Stars rating={rating} interactive disabled={submitting} onSelect={setRating} /><TextInput value={comment} onChangeText={setComment} maxLength={1000} multiline placeholder="Cuéntanos tu experiencia (opcional)" placeholderTextColor={Colors.textSubtle} style={styles.input} editable={!submitting} accessibilityLabel="Comentario de la reseña" /><View style={styles.editorActions}><Pressable style={styles.cancel} onPress={() => setEditing(false)} disabled={submitting} accessibilityRole="button" accessibilityState={{ disabled: submitting }}><Text style={styles.cancelText}>Cancelar</Text></Pressable><Pressable style={[styles.submit, (rating === 0 || submitting) && styles.disabled]} onPress={() => void submit()} disabled={rating === 0 || submitting} accessibilityRole="button" accessibilityLabel="Guardar reseña" accessibilityState={{ disabled: rating === 0 || submitting }}>{submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>{eligibility.review ? "Actualizar reseña" : "Publicar reseña"}</Text>}</Pressable></View></View>
        : <Pressable style={styles.writeButton} onPress={() => setEditing(true)} accessibilityRole="button" accessibilityLabel={eligibility.review ? "Editar tu reseña" : "Escribe tu reseña"}><MaterialIcons name="rate-review" size={19} color={Colors.primaryLight} /><Text style={styles.writeText}>{eligibility.review ? "Editar tu reseña" : "Escribe tu reseña"}</Text></Pressable>
      ) : <Text style={styles.eligibilityCopy}>Las reseñas están disponibles para compradores verificados después de la entrega.</Text>}

      {error ? <View style={styles.error}><Text style={styles.errorText}>{error}</Text><Pressable onPress={() => void load()} accessibilityRole="button"><Text style={styles.retry}>Reintentar</Text></Pressable></View> : null}
      {loading ? <ActivityIndicator color={Colors.primary} style={{ marginVertical: Spacing.lg }} /> : items.length ? <View style={styles.list}>{items.map((review) => <View key={review.id} style={styles.review}><View style={styles.reviewHeader}><View style={styles.reviewerAvatar}><Text style={styles.reviewerInitial}>{review.reviewer.displayName.charAt(0).toUpperCase()}</Text></View><View style={{ flex: 1 }}><Text style={styles.reviewerName}>{review.reviewer.displayName}</Text><View style={styles.verified}><MaterialIcons name="verified" size={14} color={Colors.success} /><Text style={styles.verifiedText}>Compra verificada</Text></View></View><Text style={styles.date}>{formatDate(review.createdAt)}</Text></View><Stars rating={review.rating} />{review.comment ? <Text style={styles.comment}>{review.comment}</Text> : null}</View>)}</View> : !error ? <Text style={styles.empty}>Todavía no hay reseñas publicadas.</Text> : null}
      {cursor && !loading ? <Pressable style={styles.more} onPress={() => void load(cursor)} disabled={loadingMore} accessibilityRole="button" accessibilityState={{ disabled: loadingMore }}>{loadingMore ? <ActivityIndicator color={Colors.primary} /> : <Text style={styles.moreText}>Ver más reseñas</Text>}</Pressable> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginHorizontal: Spacing.md, marginTop: Spacing.md, padding: Spacing.lg, borderRadius: Radius.xl, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  eyebrow: { color: Colors.primaryLight, fontSize: 11, fontWeight: FontWeight.bold, letterSpacing: 1.2 }, title: { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.bold, marginTop: 4 },
  tabs: { flexDirection: "row", backgroundColor: Colors.bg, padding: 4, borderRadius: Radius.lg, marginTop: Spacing.md }, tab: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: Radius.md, paddingHorizontal: 6 }, tabSelected: { backgroundColor: Colors.primary }, tabText: { color: Colors.textSecondary, fontWeight: FontWeight.semibold, fontSize: 13 }, tabTextSelected: { color: "#fff" },
  aggregate: { flexDirection: "row", gap: Spacing.md, alignItems: "center", marginTop: Spacing.lg }, aggregateScore: { color: Colors.textPrimary, fontSize: 38, fontWeight: FontWeight.bold }, stars: { flexDirection: "row", alignItems: "center" }, aggregateCount: { color: Colors.textSecondary, fontSize: 12, marginTop: 3 },
  summaryLine: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8 }, summaryScore: { color: Colors.textPrimary, fontWeight: FontWeight.bold }, summaryCount: { color: Colors.textSecondary, fontSize: 13 }, noSummary: { color: Colors.textSecondary, fontSize: 13, marginTop: 8 },
  distribution: { gap: 6, marginVertical: Spacing.md }, distributionRow: { flexDirection: "row", alignItems: "center", gap: 8 }, distributionLabel: { color: Colors.textSecondary, width: 28, fontSize: 11 }, distributionValue: { color: Colors.textSecondary, width: 22, textAlign: "right", fontSize: 11 }, track: { flex: 1, height: 6, borderRadius: 3, backgroundColor: Colors.bg }, fill: { height: 6, borderRadius: 3, backgroundColor: Colors.warning },
  writeButton: { minHeight: 44, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.primary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginVertical: Spacing.md }, writeText: { color: Colors.primaryLight, fontWeight: FontWeight.bold }, eligibilityCopy: { color: Colors.textSecondary, lineHeight: 19, marginVertical: Spacing.md },
  editor: { backgroundColor: Colors.bg, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm, marginVertical: Spacing.md }, editorTitle: { color: Colors.textPrimary, fontWeight: FontWeight.bold }, starTarget: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, input: { minHeight: 92, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, color: Colors.textPrimary, padding: Spacing.md, textAlignVertical: "top" }, editorActions: { flexDirection: "row", gap: Spacing.sm }, cancel: { minHeight: 44, flex: 1, alignItems: "center", justifyContent: "center" }, cancelText: { color: Colors.textSecondary, fontWeight: FontWeight.semibold }, submit: { minHeight: 44, flex: 1.4, alignItems: "center", justifyContent: "center", borderRadius: Radius.md, backgroundColor: Colors.primary }, disabled: { opacity: 0.5 }, submitText: { color: "#fff", fontWeight: FontWeight.bold },
  error: { paddingVertical: Spacing.md, alignItems: "center", gap: 8 }, errorText: { color: Colors.error, textAlign: "center" }, retry: { color: Colors.primaryLight, fontWeight: FontWeight.bold }, list: { gap: Spacing.sm }, review: { borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: Spacing.md, gap: 7 }, reviewHeader: { flexDirection: "row", alignItems: "center", gap: 9 }, reviewerAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.primaryDim, alignItems: "center", justifyContent: "center" }, reviewerInitial: { color: Colors.primaryLight, fontWeight: FontWeight.bold }, reviewerName: { color: Colors.textPrimary, fontWeight: FontWeight.semibold }, verified: { flexDirection: "row", gap: 3, alignItems: "center" }, verifiedText: { color: Colors.success, fontSize: 11, fontWeight: FontWeight.semibold }, date: { color: Colors.textSubtle, fontSize: 11 }, comment: { color: Colors.textSecondary, lineHeight: 20 }, empty: { color: Colors.textSecondary, textAlign: "center", paddingVertical: Spacing.lg }, more: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: Spacing.sm }, moreText: { color: Colors.primaryLight, fontWeight: FontWeight.bold },
});
