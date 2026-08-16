import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { Image } from "expo-image";
import { MaterialIcons } from "@expo/vector-icons";
import {
  Colors,
  FontSize,
  FontWeight,
  Radius,
  Spacing,
} from "@/constants/theme";
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

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("es", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));

function Stars({
  rating,
  interactive = false,
  disabled = false,
  onSelect,
}: {
  rating: number;
  interactive?: boolean;
  disabled?: boolean;
  onSelect?: (rating: number) => void;
}) {
  return (
    <View
      style={styles.stars}
      accessibilityRole={interactive ? "radiogroup" : undefined}
      accessibilityLabel={
        interactive
          ? "Selecciona una calificación de una a cinco estrellas"
          : `${rating} de 5 estrellas`
      }
    >
      {[1, 2, 3, 4, 5].map((value) =>
        interactive ? (
          <Pressable
            key={value}
            style={styles.starTarget}
            onPress={() => onSelect?.(value)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityLabel={`${value} ${value === 1 ? "estrella" : "estrellas"}`}
            accessibilityState={{ selected: rating === value, disabled }}
          >
            <MaterialIcons
              name={value <= rating ? "star" : "star-border"}
              size={28}
              color={value <= rating ? Colors.warning : Colors.textSubtle}
            />
          </Pressable>
        ) : (
          <MaterialIcons
            key={value}
            name={value <= Math.round(rating) ? "star" : "star-border"}
            size={16}
            color={Colors.warning}
          />
        ),
      )}
    </View>
  );
}

export function ProductRatingSummary({
  reputation,
}: {
  reputation: MarketplaceProductReputation | null;
}) {
  const aggregate = reputation?.productAggregate;
  if (!aggregate?.reviewCount || aggregate.averageRating === null)
    return <Text style={styles.noSummary}>Sin reseñas todavía</Text>;
  return (
    <View style={styles.summaryLine}>
      {[1, 2, 3, 4, 5].map((value) => (
        <MaterialIcons
          key={value}
          name={
            value <= Math.round(aggregate.averageRating ?? 0)
              ? "star"
              : "star-border"
          }
          size={17}
          color={Colors.warning}
        />
      ))}
      <Text style={styles.summaryScore}>
        {aggregate.averageRating.toFixed(1)}
      </Text>
      <Text style={styles.summaryCount}>
        ({aggregate.reviewCount}{" "}
        {aggregate.reviewCount === 1 ? "reseña" : "reseñas"})
      </Text>
    </View>
  );
}

export function ProductReviewsSection({
  productId,
  reputation,
  onReputationRefresh,
}: Props) {
  const { width } = useWindowDimensions(),
    wide = width >= 700;
  const [kind, setKind] = useState<ReviewKind>("product"),
    [items, setItems] = useState<MarketplaceReview[]>([]),
    [cursor, setCursor] = useState<MarketplaceReviewCursor | null>(null),
    [loading, setLoading] = useState(true),
    [loadingMore, setLoadingMore] = useState(false),
    [error, setError] = useState<string | null>(null),
    [editing, setEditing] = useState(false),
    [rating, setRating] = useState(0),
    [comment, setComment] = useState(""),
    [submitting, setSubmitting] = useState(false);
  const eligibility =
    kind === "product"
      ? reputation.productEligibility
      : reputation.sellerEligibility;
  const aggregate =
    kind === "product"
      ? reputation.productAggregate
      : reputation.sellerAggregate;
  const productEligible = reputation.productEligibility.eligible;
  const sellerEligible = reputation.sellerEligibility.eligible;

  const load = useCallback(
    async (next: MarketplaceReviewCursor | null = null) => {
      next ? setLoadingMore(true) : setLoading(true);
      setError(null);
      try {
        const page =
          kind === "product"
            ? await fetchMarketplaceProductReviews(productId, next, 10)
            : await fetchMarketplaceStoreReviews(reputation.store.id, next, 10);
        setItems((current) =>
          next
            ? [
                ...new Map(
                  [...current, ...page.items].map((item) => [item.id, item]),
                ).values(),
              ]
            : page.items,
        );
        setCursor(page.nextCursor);
      } catch {
        setError("No se pudieron cargar las reseñas.");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [kind, productId, reputation.store.id],
  );
  useEffect(() => {
    setItems([]);
    setCursor(null);
    setEditing(false);
    void load();
  }, [load]);
  useEffect(() => {
    setRating(eligibility.review?.rating ?? 0);
    setComment(eligibility.review?.comment ?? "");
  }, [
    eligibility.review?.id,
    eligibility.review?.rating,
    eligibility.review?.comment,
    kind,
  ]);

  const submit = async () => {
    if (
      !eligibility.eligible ||
      !eligibility.targetId ||
      rating < 1 ||
      rating > 5 ||
      submitting
    )
      return;
    setSubmitting(true);
    setError(null);
    try {
      if (kind === "product")
        await submitMarketplaceProductReview(
          eligibility.targetId,
          rating,
          comment,
        );
      else
        await submitMarketplaceSellerReview(
          eligibility.targetId,
          rating,
          comment,
        );
      await onReputationRefresh();
      await load();
      setEditing(false);
    } catch {
      setError("No se pudo guardar tu reseña. Inténtalo de nuevo.");
    } finally {
      setSubmitting(false);
    }
  };
  const openEditor = (nextKind: ReviewKind) => {
    setKind(nextKind);
    setEditing(true);
  };

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.title}>Reseñas</Text>
        {aggregate.reviewCount > 0 ? (
          <Pressable
            style={styles.seeAll}
            onPress={() => (cursor ? void load(cursor) : undefined)}
            disabled={!cursor}
            accessibilityRole="button"
            accessibilityLabel={`Ver todas las reseñas, ${aggregate.reviewCount}`}
            accessibilityState={{ disabled: !cursor }}
          >
            <Text style={styles.seeAllText}>
              Ver todas ({aggregate.reviewCount})
            </Text>
          </Pressable>
        ) : null}
      </View>
      <View
        style={styles.tabs}
        accessibilityRole="tablist"
        accessibilityLabel="Tipo de reseña"
      >
        {(["product", "seller"] as const).map((value) => {
          const selected = value === kind;
          const count =
            value === "product"
              ? reputation.productAggregate.reviewCount
              : reputation.sellerAggregate.reviewCount;
          return (
            <Pressable
              key={value}
              style={[styles.tab, selected && styles.tabSelected]}
              onPress={() => setKind(value)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={
                value === "product"
                  ? "Reseñas del producto"
                  : "Valoración del vendedor"
              }
            >
              <Text
                style={[styles.tabText, selected && styles.tabTextSelected]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.72}
              >
                {value === "product"
                  ? "Reseñas del producto"
                  : "Valoración del vendedor"}
              </Text>
              {count > 0 ? (
                <View
                  style={[styles.tabCount, selected && styles.tabCountSelected]}
                >
                  <Text style={styles.tabCountText}>{count}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      <View style={[styles.reviewContent, wide && styles.reviewContentWide]}>
        <View style={[styles.aggregate, wide && styles.aggregateWide]}>
          <Text style={styles.aggregateScore}>
            {aggregate.averageRating === null
              ? "—"
              : aggregate.averageRating.toFixed(1)}
          </Text>
          <Stars rating={aggregate.averageRating ?? 0} />
          <Text style={styles.aggregateCount}>
            {aggregate.reviewCount
              ? `Basado en ${aggregate.reviewCount} ${aggregate.reviewCount === 1 ? "reseña" : "reseñas"}`
              : "Sin reseñas todavía"}
          </Text>
        </View>
        <View style={styles.reviewListArea}>
          {error ? (
            <View style={styles.error}>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable onPress={() => void load()} accessibilityRole="button">
                <Text style={styles.retry}>Reintentar</Text>
              </Pressable>
            </View>
          ) : null}
          {loading ? (
            <ActivityIndicator
              color={Colors.primary}
              style={{ marginVertical: Spacing.lg }}
            />
          ) : items.length ? (
            <View style={styles.list}>
              {items.slice(0, 3).map((review) => (
                <View key={review.id} style={styles.review}>
                  <View style={styles.reviewHeader}>
                    {review.reviewer.avatarUrl ? (
                      <Image
                        source={{ uri: review.reviewer.avatarUrl }}
                        style={styles.reviewerAvatar}
                        contentFit="cover"
                      />
                    ) : (
                      <View style={styles.reviewerAvatar}>
                        <Text style={styles.reviewerInitial}>
                          {review.reviewer.displayName.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                    )}
                    <View style={styles.reviewerCopy}>
                      <View style={styles.reviewerIdentity}>
                        <Text style={styles.reviewerName} numberOfLines={1}>
                          {review.reviewer.displayName}
                        </Text>
                        <View style={styles.verified}>
                          <MaterialIcons
                            name="verified"
                            size={14}
                            color={Colors.success}
                          />
                          <Text style={styles.verifiedText}>
                            Compra verificada
                          </Text>
                        </View>
                      </View>
                      <View style={styles.reviewMeta}>
                        <Stars rating={review.rating} />
                        <Text style={styles.date}>
                          {formatDate(review.createdAt)}
                        </Text>
                      </View>
                      {review.comment ? (
                        <Text style={styles.comment}>{review.comment}</Text>
                      ) : null}
                    </View>
                  </View>
                </View>
              ))}
            </View>
          ) : !error ? (
            <Text style={styles.empty}>Todavía no hay reseñas publicadas.</Text>
          ) : null}
        </View>
      </View>

      {editing && eligibility.eligible ? (
        <View style={styles.editor}>
          <Text style={styles.editorTitle}>
            {kind === "product"
              ? "Califica este producto"
              : "Califica al vendedor"}
          </Text>
          <Stars
            rating={rating}
            interactive
            disabled={submitting}
            onSelect={setRating}
          />
          <TextInput
            value={comment}
            onChangeText={setComment}
            maxLength={1000}
            multiline
            placeholder="Cuéntanos tu experiencia (opcional)"
            placeholderTextColor={Colors.textSubtle}
            style={styles.input}
            editable={!submitting}
            accessibilityLabel="Comentario de la reseña"
          />
          <View style={styles.editorActions}>
            <Pressable
              style={styles.cancel}
              onPress={() => setEditing(false)}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityState={{ disabled: submitting }}
            >
              <Text style={styles.cancelText}>Cancelar</Text>
            </Pressable>
            <Pressable
              style={[
                styles.submit,
                (rating === 0 || submitting) && styles.disabled,
              ]}
              onPress={() => void submit()}
              disabled={rating === 0 || submitting}
              accessibilityRole="button"
              accessibilityLabel="Guardar reseña"
              accessibilityState={{ disabled: rating === 0 || submitting }}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitText}>
                  {eligibility.review ? "Actualizar reseña" : "Publicar reseña"}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      ) : null}
      {!editing && (productEligible || sellerEligible) ? (
        <View style={styles.reviewActions}>
          <Pressable
            style={styles.writeButton}
            onPress={() => openEditor(productEligible ? "product" : "seller")}
            accessibilityRole="button"
            accessibilityLabel="Escribe tu reseña"
          >
            <MaterialIcons
              name="rate-review"
              size={19}
              color={Colors.textPrimary}
            />
            <Text style={styles.writeText}>Escribe tu reseña</Text>
          </Pressable>
          {productEligible ? (
            <Pressable
              style={styles.quickRate}
              onPress={() => openEditor("product")}
              accessibilityRole="button"
              accessibilityLabel="Califica este producto"
            >
              <Text style={styles.quickRateLabel}>Califica este producto</Text>
              <View style={styles.quickStars}>
                {[1, 2, 3, 4, 5].map((value) => (
                  <MaterialIcons
                    key={value}
                    name="star"
                    size={18}
                    color={Colors.primaryLight}
                  />
                ))}
              </View>
            </Pressable>
          ) : null}
          {sellerEligible ? (
            <Pressable
              style={styles.quickRate}
              onPress={() => openEditor("seller")}
              accessibilityRole="button"
              accessibilityLabel="Califica al vendedor"
            >
              <Text style={styles.quickRateLabel}>Califica al vendedor</Text>
              <View style={styles.quickStars}>
                {[1, 2, 3, 4, 5].map((value) => (
                  <MaterialIcons
                    key={value}
                    name="star"
                    size={18}
                    color={Colors.primaryLight}
                  />
                ))}
              </View>
            </Pressable>
          ) : null}
        </View>
      ) : !editing ? (
        <Text style={styles.eligibilityCopy}>
          Las reseñas están disponibles para compradores verificados después de
          la entrega.
        </Text>
      ) : null}
      {cursor && !loading ? (
        <Pressable
          style={styles.more}
          onPress={() => void load(cursor)}
          disabled={loadingMore}
          accessibilityRole="button"
          accessibilityState={{ disabled: loadingMore }}
        >
          {loadingMore ? (
            <ActivityIndicator color={Colors.primary} />
          ) : (
            <Text style={styles.moreText}>Ver más reseñas</Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginHorizontal: Spacing.md, marginTop: 2, gap: Spacing.sm },
  sectionHeader: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
  },
  title: {
    color: Colors.textPrimary,
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
  },
  seeAll: { minHeight: 44, maxWidth: "60%", justifyContent: "center" },
  seeAllText: {
    color: Colors.primaryLight,
    fontWeight: FontWeight.semibold,
    fontSize: 13,
  },
  tabs: { flexDirection: "row", gap: 8 },
  tab: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: Radius.md,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  tabSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryDim,
  },
  tabText: {
    flexShrink: 1,
    color: Colors.textSecondary,
    fontWeight: FontWeight.semibold,
    fontSize: 12,
  },
  tabTextSelected: { color: Colors.primaryLight },
  tabCount: {
    minWidth: 24,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.surfaceHighlight,
  },
  tabCountSelected: { backgroundColor: Colors.primary },
  tabCountText: { color: "#fff", fontSize: 10, fontWeight: FontWeight.bold },
  reviewContent: { gap: Spacing.sm },
  reviewContentWide: { flexDirection: "row", alignItems: "stretch" },
  aggregate: {
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  aggregateWide: { width: 220 },
  aggregateScore: {
    color: Colors.textPrimary,
    fontSize: 42,
    lineHeight: 48,
    fontWeight: FontWeight.extrabold,
  },
  stars: { flexDirection: "row", alignItems: "center" },
  aggregateCount: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginTop: 5,
    textAlign: "center",
  },
  reviewListArea: { flex: 1, minWidth: 0 },
  summaryLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 8,
  },
  summaryScore: { color: Colors.textPrimary, fontWeight: FontWeight.bold },
  summaryCount: { color: Colors.textSecondary, fontSize: 13 },
  noSummary: { color: Colors.textSecondary, fontSize: 13, marginTop: 8 },
  reviewActions: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  writeButton: {
    minWidth: 150,
    minHeight: 54,
    flexGrow: 1,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.borderHighlight,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.surface,
  },
  writeText: { color: Colors.textPrimary, fontWeight: FontWeight.semibold },
  quickRate: {
    minWidth: 160,
    minHeight: 54,
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  quickRateLabel: { color: Colors.textSecondary, fontSize: 11 },
  quickStars: { flexDirection: "row", marginTop: 3 },
  eligibilityCopy: {
    color: Colors.textSecondary,
    lineHeight: 19,
    marginVertical: Spacing.sm,
    textAlign: "center",
  },
  editor: {
    backgroundColor: Colors.bg,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
    marginVertical: Spacing.md,
  },
  editorTitle: { color: Colors.textPrimary, fontWeight: FontWeight.bold },
  starTarget: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    minHeight: 92,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.textPrimary,
    padding: Spacing.md,
    textAlignVertical: "top",
  },
  editorActions: { flexDirection: "row", gap: Spacing.sm },
  cancel: {
    minHeight: 44,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: { color: Colors.textSecondary, fontWeight: FontWeight.semibold },
  submit: {
    minHeight: 44,
    flex: 1.4,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radius.md,
    backgroundColor: Colors.primary,
  },
  disabled: { opacity: 0.5 },
  submitText: { color: "#fff", fontWeight: FontWeight.bold },
  error: { paddingVertical: Spacing.md, alignItems: "center", gap: 8 },
  errorText: { color: Colors.error, textAlign: "center" },
  retry: { color: Colors.primaryLight, fontWeight: FontWeight.bold },
  list: { gap: 7 },
  review: {
    padding: 10,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
  },
  reviewHeader: { flexDirection: "row", alignItems: "flex-start", gap: 9 },
  reviewerAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    overflow: "hidden",
    backgroundColor: Colors.primaryDim,
    alignItems: "center",
    justifyContent: "center",
  },
  reviewerInitial: { color: Colors.primaryLight, fontWeight: FontWeight.bold },
  reviewerCopy: { flex: 1, minWidth: 0, gap: 3 },
  reviewerIdentity: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
  },
  reviewerName: {
    maxWidth: "58%",
    color: Colors.textPrimary,
    fontWeight: FontWeight.semibold,
  },
  verified: { flexDirection: "row", gap: 3, alignItems: "center" },
  verifiedText: { color: Colors.textSecondary, fontSize: 10 },
  reviewMeta: { flexDirection: "row", alignItems: "center", gap: 7 },
  date: { color: Colors.textSubtle, fontSize: 10 },
  comment: { color: Colors.textSecondary, lineHeight: 18, fontSize: 12 },
  empty: {
    color: Colors.textSecondary,
    textAlign: "center",
    paddingVertical: Spacing.lg,
  },
  more: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  moreText: { color: Colors.primaryLight, fontWeight: FontWeight.bold },
});
