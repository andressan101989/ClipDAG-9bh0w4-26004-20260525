import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AuthContext } from "./AuthContext";
import {
  fetchProducts as loadProducts,
  fetchMyProducts as loadMyProducts,
  fetchMyProductsPage,
  fetchSavedProductIds,
  toggleProductSave as persistSave,
  createProduct as createMarketplaceProduct,
  setProductPublished,
  softDeleteProduct,
  MarketplaceSellerProductsError,
  type MarketplaceCategory,
  type Product,
  type ProductMutation,
} from "@/services/marketplaceService";
import { mergeMarketplaceCursorPage } from "@/services/marketplaceCursorCollection";

export type ProductCategory = MarketplaceCategory;
export type { Product };
export type SellerProductsState = 'idle'
  | 'loading'
  | 'loaded'
  | 'empty'
  | 'error';

interface ShopContextType {
  products: Product[];
  myProducts: Product[];
  savedProductIds: Set<string>;
  isLoading: boolean;
  catalogError: "network" | "permission" | "request" | null;
  sellerProductsState: SellerProductsState;
  sellerProductsError: "session" | "permission" | "network" | "request" | null;
  fetchProducts: (category?: string, search?: string) => Promise<void>;
  fetchMyProducts: () => Promise<void>;
  fetchMoreMyProducts: () => Promise<void>;
  sellerProductsHasMore: boolean;
  sellerProductsLoadingMore: boolean;
  createProduct: (
    data: ProductMutation,
  ) => Promise<{ success: boolean; error?: string; product?: Product }>;
  setPublished: (
    id: string,
    published: boolean,
  ) => Promise<{ success: boolean; error?: string }>;
  deleteProduct: (id: string) => Promise<{ success: boolean; error?: string }>;
  toggleSaveProduct: (id: string) => void;
  isSavedProduct: (id: string) => boolean;
}
export const ShopContext = createContext<ShopContextType | undefined>(
  undefined,
);

function safeMessage(error: unknown): string {
  const message =
    error && typeof error === "object" && "message" in error
      ? (error as { message?: unknown }).message
      : null;
  return typeof message === "string" && message.length < 160
    ? message
    : "marketplace_request_failed";
}

export function ShopProvider({ children }: { children: ReactNode }) {
  const auth = useContext(AuthContext);
  const userId = auth?.user?.id ?? null;
  const [products, setProducts] = useState<Product[]>([]);
  const [myProducts, setMyProducts] = useState<Product[]>([]);
  const [savedProductIds, setSavedProductIds] = useState<Set<string>>(
    new Set(),
  );
  const [isLoading, setIsLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<
    "network" | "permission" | "request" | null
  >(null);
  const [sellerProductsState, setSellerProductsState] =
    useState<SellerProductsState>("idle");
  const [sellerProductsError, setSellerProductsError] = useState<
    "session" | "permission" | "network" | "request" | null
  >(null);
  const [sellerProductsCursor, setSellerProductsCursor] = useState<{
    updatedAt: string;
    productId: string;
  } | null>(null);
  const [sellerProductsLoadingMore, setSellerProductsLoadingMore] =
    useState(false);
  const sellerProductsRequest = useRef(false);

  const fetchProducts = useCallback(
    async (category?: string, search?: string) => {
      setIsLoading(true);
      try {
        const next = await loadProducts({
          category:
            category && category !== "all"
              ? (category as MarketplaceCategory)
              : "",
          search,
        });
        setProducts(next);setCatalogError(null);
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error
            ? (error as { code?: unknown }).code
            : null;
        const category =
          code === "marketplace_read_permission"
            ? "permission"
            : code === "marketplace_read_transport"
              ? "network"
              : "request";
        setCatalogError(category);
        if (__DEV__)
          console.warn("[MarketplaceRead]", {
            operation: "fetchProducts",
            postgresCode:
              error && typeof error === "object" && "postgresCode" in error
                ? (error as { postgresCode?: unknown }).postgresCode
                : null,
            category,
          });
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );
  const fetchMyProducts=useCallback(async () => {
    if (!userId) {
      setMyProducts([]);
      setSellerProductsCursor(null);
      setSellerProductsState("idle");
      setSellerProductsError(null);
      return;
    }
    if (sellerProductsRequest.current) return;
    setSellerProductsState((previous) =>
      previous === "loaded" ? previous : "loading",
    );
    try {
      sellerProductsRequest.current = true;
      const page = await fetchMyProductsPage(null, 50);
      const next=page.items;
      setMyProducts(next);
      setSellerProductsCursor(page.nextCursor);
      setSellerProductsError(null);
      setSellerProductsState(next.length===0?'empty':'loaded');
    } catch (error) {
      const code =
        error instanceof MarketplaceSellerProductsError ? error.code : null;
      const category =
        code === "marketplace_authentication_required"
          ? "session"
          : code === "marketplace_seller_products_permission"
            ? "permission"
            : code === "marketplace_seller_products_transport"
              ? "network"
              : "request";
      setSellerProductsError(category);
      setSellerProductsState("error");
    } finally {
      sellerProductsRequest.current = false;
    }
  }, [userId]);
  const fetchMoreMyProducts = useCallback(async () => {
    if (!userId || !sellerProductsCursor || sellerProductsRequest.current) return;
    sellerProductsRequest.current = true;
    setSellerProductsLoadingMore(true);
    try {
      const page = await fetchMyProductsPage(sellerProductsCursor, 50);
      setMyProducts(
        (current) =>
          mergeMarketplaceCursorPage(
            { items: current, nextCursor: sellerProductsCursor },
            page,
          ).items,
      );
      setSellerProductsCursor(page.nextCursor);
      setSellerProductsError(null);
    } catch (error) {
      const code =
        error instanceof MarketplaceSellerProductsError ? error.code : null;
      setSellerProductsError(
        code === "marketplace_authentication_required"
          ? "session"
          : code === "marketplace_seller_products_permission"
            ? "permission"
            : code === "marketplace_seller_products_transport"
              ? "network"
              : "request",
      );
    } finally {
      sellerProductsRequest.current = false;
      setSellerProductsLoadingMore(false);
    }
  }, [userId, sellerProductsCursor]);

  useEffect(()=>{void fetchProducts();
  }, [fetchProducts]);
  useEffect(() => {
    if (!userId) {
      setSavedProductIds(new Set());
      setMyProducts([]);
      setSellerProductsCursor(null);
      setSellerProductsState("idle");
      setSellerProductsError(null);
      return;
    }
    void fetchMyProducts();
    void fetchSavedProductIds(userId).then(setSavedProductIds);
  }, [userId, fetchMyProducts]);

  const createProduct = useCallback(
    async (input: ProductMutation) => {
      try {
        const id = await createMarketplaceProduct(input);
        const product = (await loadMyProducts()).find((item) => item.id === id);
        await Promise.all([fetchProducts(), fetchMyProducts()]);
        return product
          ? { success: true, product }
          : { success: false, error: "product_identity_missing" };
      } catch (error) {
        return { success: false, error: safeMessage(error) };
      }
    },
    [fetchProducts, fetchMyProducts],
  );
  const setPublished = useCallback(
    async (id: string, published: boolean) => {
      try {
        await setProductPublished(id, published);
        await Promise.all([fetchProducts(), fetchMyProducts()]);
        return { success: true };
      } catch (error) {
        return { success: false, error: safeMessage(error) };
      }
    },
    [fetchProducts, fetchMyProducts],
  );
  const deleteProduct = useCallback(
    async (id: string) => {
      try {
        await softDeleteProduct(id);
        await Promise.all([fetchProducts(), fetchMyProducts()]);
        return { success: true };
      } catch (error) {
        return { success: false, error: safeMessage(error) };
      }
    },
    [fetchProducts, fetchMyProducts],
  );
  const toggleSaveProduct = useCallback(
    (id: string) => {
      if (!userId) return;
      const saved = savedProductIds.has(id);
      setSavedProductIds((previous) => {
        const next = new Set(previous);
        if (saved) next.delete(id);
        else next.add(id);
        return next;
      });
      void persistSave(userId, id, !saved).then((ok) => {
        if (!ok)
          setSavedProductIds((previous) => {
            const next = new Set(previous);
            if (saved) next.add(id);
            else next.delete(id);
            return next;
          });
      });
    },
    [userId, savedProductIds],
  );
  const value = useMemo(
    () => ({
      products,
      myProducts,
      savedProductIds,
      isLoading,
      catalogError,
      sellerProductsState,
      sellerProductsError,
      fetchProducts,
      fetchMyProducts,
      fetchMoreMyProducts,
      sellerProductsHasMore: sellerProductsCursor !== null,
      sellerProductsLoadingMore,
      createProduct,
      setPublished,
      deleteProduct,
      toggleSaveProduct,
      isSavedProduct: (id: string) => savedProductIds.has(id),
    }),
    [
      products,
      myProducts,
      savedProductIds,
      isLoading,
      catalogError,
      sellerProductsState,
      sellerProductsError,
      fetchProducts,
      fetchMyProducts,
      fetchMoreMyProducts,
      sellerProductsCursor,
      sellerProductsLoadingMore,
      createProduct,
      setPublished,
      deleteProduct,
      toggleSaveProduct,
    ],
  );
  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}
