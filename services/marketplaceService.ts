/**
 * services/marketplaceService.ts
 *
 * Marketplace: browse products, create listings, manage orders.
 */
import { getSupabaseClient } from '@/template';

export interface Product {
  id: string;
  seller_id: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  category: string;
  images: string[];
  stock: number;
  status: string;
  tags: string[];
  total_sales: number;
  created_at: string;
  updated_at: string;
  seller?: { username: string; avatar_url: string | null; display_name: string | null };
}

export interface Order {
  id: string;
  buyer_id: string;
  seller_id: string;
  product_id: string;
  quantity: number;
  total_price: number;
  status: string;
  shipping_address: string;
  notes: string;
  created_at: string;
  product?: { title: string; images: string[] };
  seller?: { username: string };
  buyer?: { username: string };
}

export const PRODUCT_CATEGORIES = [
  { key: '',         label: 'Todo' },
  { key: 'digital',  label: 'Digital' },
  { key: 'service',  label: 'Servicios' },
  { key: 'art',      label: 'Arte' },
  { key: 'music',    label: 'Música' },
  { key: 'other',    label: 'Otros' },
];

const db = () => getSupabaseClient();

/** Fetch marketplace products */
export async function fetchProducts(opts?: {
  category?: string;
  sellerId?: string;
  limit?: number;
  search?: string;
}): Promise<Product[]> {
  let q = db()
    .from('products')
    .select('*, seller:user_profiles!seller_id(username, avatar_url, display_name)')
    .eq('status', 'active')
    .order('total_sales', { ascending: false })
    .limit(opts?.limit ?? 30);

  if (opts?.category) q = q.eq('category', opts.category);
  if (opts?.sellerId) q = q.eq('seller_id', opts.sellerId);
  if (opts?.search)   q = q.ilike('title', `%${opts.search}%`);

  const { data } = await q;
  return (data as Product[]) ?? [];
}

/** Fetch a single product by ID */
export async function fetchProduct(productId: string): Promise<Product | null> {
  const { data } = await db()
    .from('products')
    .select('*, seller:user_profiles!seller_id(username, avatar_url, display_name)')
    .eq('id', productId)
    .single();
  return (data as Product) ?? null;
}

/** Fetch my orders (as buyer or seller) */
export async function fetchMyOrders(userId: string, role: 'buyer' | 'seller' = 'buyer'): Promise<Order[]> {
  const field = role === 'buyer' ? 'buyer_id' : 'seller_id';
  const { data } = await db()
    .from('orders')
    .select(`
      *,
      product:products!product_id(title, images),
      seller:user_profiles!seller_id(username),
      buyer:user_profiles!buyer_id(username)
    `)
    .eq(field, userId)
    .order('created_at', { ascending: false });
  return (data as Order[]) ?? [];
}

/** Place an order */
export async function placeOrder(opts: {
  buyerId: string;
  sellerId: string;
  productId: string;
  quantity: number;
  totalPrice: number;
  shippingAddress?: string;
  notes?: string;
}): Promise<{ success: boolean; error?: string; orderId?: string }> {
  const { data, error } = await db()
    .from('orders')
    .insert({
      buyer_id:         opts.buyerId,
      seller_id:        opts.sellerId,
      product_id:       opts.productId,
      quantity:         opts.quantity,
      total_price:      opts.totalPrice,
      shipping_address: opts.shippingAddress ?? '',
      notes:            opts.notes ?? '',
      status:           'pending',
    })
    .select('id')
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, orderId: (data as any)?.id };
}

/** Update order status */
export async function updateOrderStatus(orderId: string, status: string): Promise<boolean> {
  const { error } = await db()
    .from('orders')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', orderId);
  return !error;
}

/** Save/unsave a product */
export async function toggleProductSave(userId: string, productId: string, saved: boolean): Promise<boolean> {
  if (saved) {
    const { error } = await db()
      .from('product_saves')
      .insert({ user_id: userId, product_id: productId });
    return !error;
  } else {
    const { error } = await db()
      .from('product_saves')
      .delete()
      .eq('user_id', userId)
      .eq('product_id', productId);
    return !error;
  }
}

/** Fetch saved product IDs for a user */
export async function fetchSavedProductIds(userId: string): Promise<Set<string>> {
  const { data } = await db()
    .from('product_saves')
    .select('product_id')
    .eq('user_id', userId);
  return new Set((data ?? []).map((r: any) => r.product_id));
}
