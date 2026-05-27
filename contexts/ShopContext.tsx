import React, {
  createContext, useState, useCallback, useEffect, useContext, useRef, ReactNode,
} from 'react';
import { getSupabaseClient } from '@/template';
import { AuthContext } from './AuthContext';

export type ProductCategory = 'digital' | 'physical' | 'art' | 'music' | 'clothing' | 'other';

export interface Product {
  id: string;
  sellerId: string;
  sellerUsername: string;
  sellerAvatar: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  category: ProductCategory;
  images: string[];
  stock: number;
  status: 'active' | 'paused' | 'sold_out' | 'deleted';
  tags: string[];
  totalSales: number;
  createdAt: string;
}

export interface Order {
  id: string;
  buyerId: string;
  sellerId: string;
  productId: string;
  productTitle: string;
  productImage: string;
  quantity: number;
  totalPrice: number;
  status: 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';
  shippingAddress: string;
  createdAt: string;
}

interface ShopContextType {
  products: Product[];
  myProducts: Product[];
  myOrders: Order[];
  savedProductIds: Set<string>;
  isLoading: boolean;
  fetchProducts: (category?: string, search?: string) => Promise<void>;
  fetchMyProducts: () => Promise<void>;
  fetchMyOrders: () => Promise<void>;
  createProduct: (data: Omit<Product, 'id' | 'sellerId' | 'sellerUsername' | 'sellerAvatar' | 'totalSales' | 'createdAt' | 'status'>) => Promise<{ success: boolean; error?: string; product?: Product }>;
  updateProduct: (id: string, data: Partial<Pick<Product, 'title' | 'description' | 'price' | 'stock' | 'status'>>) => Promise<{ success: boolean; error?: string }>;
  deleteProduct: (id: string) => Promise<{ success: boolean; error?: string }>;
  placeOrder: (productId: string, quantity: number, shippingAddress: string) => Promise<{ success: boolean; error?: string; orderId?: string }>;
  updateOrderStatus: (orderId: string, status: Order['status']) => Promise<{ success: boolean; error?: string }>;
  toggleSaveProduct: (productId: string) => void;
  isSavedProduct: (productId: string) => boolean;
}

export const ShopContext = createContext<ShopContextType | undefined>(undefined);

function mapProduct(row: Record<string, unknown>): Product {
  const profile = row.user_profiles as Record<string, string> | null;
  return {
    id: row.id as string,
    sellerId: row.seller_id as string,
    sellerUsername: profile?.username || 'Vendedor',
    sellerAvatar: profile?.avatar_url || '',
    title: (row.title as string) || '',
    description: (row.description as string) || '',
    price: Number(row.price) || 0,
    currency: (row.currency as string) || 'USD',
    category: ((row.category as string) || 'other') as ProductCategory,
    images: (row.images as string[]) || [],
    stock: Number(row.stock) || 0,
    status: ((row.status as string) || 'active') as Product['status'],
    tags: (row.tags as string[]) || [],
    totalSales: Number(row.total_sales) || 0,
    createdAt: (row.created_at as string) || new Date().toISOString(),
  };
}

function mapOrder(row: Record<string, unknown>): Order {
  const product = row.products as Record<string, unknown> | null;
  return {
    id: row.id as string,
    buyerId: row.buyer_id as string,
    sellerId: row.seller_id as string,
    productId: row.product_id as string,
    productTitle: (product?.title as string) || '',
    productImage: ((product?.images as string[]) || [])[0] || '',
    quantity: Number(row.quantity) || 1,
    totalPrice: Number(row.total_price) || 0,
    status: ((row.status as string) || 'pending') as Order['status'],
    shippingAddress: (row.shipping_address as string) || '',
    createdAt: (row.created_at as string) || new Date().toISOString(),
  };
}

export function ShopProvider({ children }: { children: ReactNode }) {
  // Guard getSupabaseClient() in a ref — same pattern as FeedContext/AuthContext.
  const supabaseRef = useRef<ReturnType<typeof getSupabaseClient> | null>(null);
  const supabaseOk  = useRef(true);
  if (!supabaseRef.current) {
    try { supabaseRef.current = getSupabaseClient(); }
    catch (e) { console.warn('[ShopContext] getSupabaseClient failed:', e); supabaseOk.current = false; }
  }
  const authCtx = useContext(AuthContext);
  const user = authCtx?.user;

  const [products, setProducts] = useState<Product[]>([]);
  const [myProducts, setMyProducts] = useState<Product[]>([]);
  const [myOrders, setMyOrders] = useState<Order[]>([]);
  const [savedProductIds, setSavedProductIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);

  // ── Fetch public products ─────────────────────────────────────────────────
  const fetchProducts = useCallback(async (category?: string, search?: string) => {
    setIsLoading(true);
    const supabase = supabaseRef.current;
    if (!supabase || !supabaseOk.current) { setIsLoading(false); return; }
    try {
      let query = supabase
        .from('products')
        .select(`*, user_profiles!products_seller_id_fkey(username, avatar_url)`)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(40);
      if (category && category !== 'all') query = query.eq('category', category);
      if (search) query = query.ilike('title', `%${search}%`);
      const { data, error } = await query;
      if (!error && data) setProducts(data.map(r => mapProduct(r as Record<string, unknown>)));
    } catch (_) {}
    setIsLoading(false);
  }, []);

  // ── Fetch my products ─────────────────────────────────────────────────────
  const fetchMyProducts = useCallback(async () => {
    if (!user) return;
    const supabase = supabaseRef.current;
    if (!supabase || !supabaseOk.current) return;
    try {
      const { data, error } = await supabase
        .from('products')
        .select(`*, user_profiles!products_seller_id_fkey(username, avatar_url)`)
        .eq('seller_id', user.id)
        .neq('status', 'deleted')
        .order('created_at', { ascending: false });
      if (!error && data) setMyProducts(data.map(r => mapProduct(r as Record<string, unknown>)));
    } catch (_) {}
  }, [user]);

  // ── Fetch my orders ───────────────────────────────────────────────────────
  const fetchMyOrders = useCallback(async () => {
    if (!user) return;
    const supabase = supabaseRef.current;
    if (!supabase || !supabaseOk.current) return;
    try {
      const { data, error } = await supabase
        .from('orders')
        .select(`*, products(title, images)`)
        .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
        .order('created_at', { ascending: false });
      if (!error && data) setMyOrders(data.map(r => mapOrder(r as Record<string, unknown>)));
    } catch (_) {}
  }, [user]);

  // ── Fetch saved products ──────────────────────────────────────────────────
  const fetchSaved = useCallback(async () => {
    if (!user) return;
    const supabase = supabaseRef.current;
    if (!supabase || !supabaseOk.current) return;
    try {
      const { data } = await supabase.from('product_saves').select('product_id').eq('user_id', user.id);
      if (data) setSavedProductIds(new Set(data.map((r: { product_id: string }) => r.product_id)));
    } catch (_) {}
  }, [user]);

  useEffect(() => {
    fetchProducts();
    if (user) { fetchMyProducts(); fetchMyOrders(); fetchSaved(); }
  }, [user?.id]);

  // ── Create product ────────────────────────────────────────────────────────
  const createProduct = useCallback(async (
    data: Omit<Product, 'id' | 'sellerId' | 'sellerUsername' | 'sellerAvatar' | 'totalSales' | 'createdAt' | 'status'>
  ): Promise<{ success: boolean; error?: string; product?: Product }> => {
    if (!user) return { success: false, error: 'No autenticado' };
    const supabase = supabaseRef.current;
    if (!supabase || !supabaseOk.current) return { success: false, error: 'Backend no disponible' };
    try {
      const { data: row, error } = await supabase
        .from('products')
        .insert({
          seller_id: user.id,
          title: data.title,
          description: data.description,
          price: data.price,
          currency: data.currency || 'USD',
          category: data.category,
          images: data.images,
          stock: data.stock,
          tags: data.tags,
        })
        .select(`*, user_profiles!products_seller_id_fkey(username, avatar_url)`)
        .single();
      if (error) return { success: false, error: error.message };
      const product = mapProduct(row as Record<string, unknown>);
      setMyProducts(prev => [product, ...prev]);
      setProducts(prev => [product, ...prev]);
      return { success: true, product };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }, [user, supabase]);

  // ── Update product ────────────────────────────────────────────────────────
  const updateProduct = useCallback(async (
    id: string,
    data: Partial<Pick<Product, 'title' | 'description' | 'price' | 'stock' | 'status'>>
  ): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: 'No autenticado' };
    const supabase = supabaseRef.current;
    if (!supabase || !supabaseOk.current) return { success: false, error: 'Backend no disponible' };
    try {
      const { error } = await supabase
        .from('products')
        .update({ ...data, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('seller_id', user.id);
      if (error) return { success: false, error: error.message };
      setMyProducts(prev => prev.map(p => p.id === id ? { ...p, ...data } : p));
      setProducts(prev => prev.map(p => p.id === id ? { ...p, ...data } : p));
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }, [user, supabase]);

  // ── Delete product ────────────────────────────────────────────────────────
  const deleteProduct = useCallback(async (id: string): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: 'No autenticado' };
    const supabase = supabaseRef.current;
    if (!supabase || !supabaseOk.current) return { success: false, error: 'Backend no disponible' };
    try {
      const { error } = await supabase
        .from('products')
        .update({ status: 'deleted' })
        .eq('id', id)
        .eq('seller_id', user.id);
      if (error) return { success: false, error: error.message };
      setMyProducts(prev => prev.filter(p => p.id !== id));
      setProducts(prev => prev.filter(p => p.id !== id));
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }, [user, supabase]);

  // ── Place order ───────────────────────────────────────────────────────────
  const placeOrder = useCallback(async (
    productId: string, quantity: number, shippingAddress: string
  ): Promise<{ success: boolean; error?: string; orderId?: string }> => {
    if (!user) return { success: false, error: 'No autenticado' };
    const supabase = supabaseRef.current;
    if (!supabase || !supabaseOk.current) return { success: false, error: 'Backend no disponible' };
    const product = products.find(p => p.id === productId);
    if (!product) return { success: false, error: 'Producto no encontrado' };
    if (product.stock < quantity) return { success: false, error: 'Stock insuficiente' };
    const totalPrice = product.price * quantity;
    try {
      const { data, error } = await supabase
        .from('orders')
        .insert({
          buyer_id: user.id,
          seller_id: product.sellerId,
          product_id: productId,
          quantity,
          total_price: totalPrice,
          shipping_address: shippingAddress,
          status: 'pending',
        })
        .select()
        .single();
      if (error) return { success: false, error: error.message };
      // Decrement stock
      await supabase.from('products').update({ stock: product.stock - quantity, total_sales: product.totalSales + quantity }).eq('id', productId);
      setProducts(prev => prev.map(p => p.id === productId ? { ...p, stock: p.stock - quantity } : p));
      await fetchMyOrders();
      return { success: true, orderId: data.id };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }, [user, products, fetchMyOrders]);

  // ── Update order status ───────────────────────────────────────────────────
  const updateOrderStatus = useCallback(async (
    orderId: string, status: Order['status']
  ): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: 'No autenticado' };
    const supabase = supabaseRef.current;
    if (!supabase || !supabaseOk.current) return { success: false, error: 'Backend no disponible' };
    try {
      const { error } = await supabase
        .from('orders')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', orderId);
      if (error) return { success: false, error: error.message };
      setMyOrders(prev => prev.map(o => o.id === orderId ? { ...o, status } : o));
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }, [user]);

  // ── Toggle save product ───────────────────────────────────────────────────
  const toggleSaveProduct = useCallback(async (productId: string) => {
    if (!user) return;
    const supabase = supabaseRef.current;
    if (!supabase || !supabaseOk.current) return;
    const isSaved = savedProductIds.has(productId);
    setSavedProductIds(prev => {
      const n = new Set(prev);
      isSaved ? n.delete(productId) : n.add(productId);
      return n;
    });
    try {
      if (isSaved) {
        await supabase.from('product_saves').delete().eq('user_id', user.id).eq('product_id', productId);
      } else {
        await supabase.from('product_saves').insert({ user_id: user.id, product_id: productId });
      }
    } catch (_) {}
  }, [user, savedProductIds]);

  const isSavedProduct = useCallback((id: string) => savedProductIds.has(id), [savedProductIds]);

  return (
    <ShopContext.Provider value={{
      products, myProducts, myOrders, savedProductIds, isLoading,
      fetchProducts, fetchMyProducts, fetchMyOrders,
      createProduct, updateProduct, deleteProduct,
      placeOrder, updateOrderStatus,
      toggleSaveProduct, isSavedProduct,
    }}>
      {children}
    </ShopContext.Provider>
  );
}
