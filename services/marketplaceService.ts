/**
 * Read-only marketplace catalog and product-save helpers.
 *
 * Checkout remains disabled until an authoritative BDAG order RPC exists.
 */
import { getSupabaseClient } from '@/template';

export type MarketplaceCategory =
  | 'digital'
  | 'physical'
  | 'art'
  | 'music'
  | 'clothing'
  | 'other';

export interface Product {
  id: string;
  seller_id: string;
  title: string;
  description: string;
  price: number;
  currency: 'BDAG';
  category: MarketplaceCategory;
  images: string[];
  stock: number;
  status: string;
  tags: string[];
  total_sales: number;
  created_at: string;
  updated_at: string;
  seller?: { username: string; avatar_url: string | null; display_name: string | null };
}

export const PRODUCT_CATEGORIES: { key: '' | MarketplaceCategory; label: string }[] = [
  { key: '', label: 'Todo' },
  { key: 'digital', label: 'Digital' },
  { key: 'physical', label: 'Físico' },
  { key: 'art', label: 'Arte' },
  { key: 'music', label: 'Música' },
  { key: 'clothing', label: 'Ropa' },
  { key: 'other', label: 'Otros' },
];

const db = () => getSupabaseClient();

export async function fetchProducts(opts?: {
  category?: MarketplaceCategory | '';
  sellerId?: string;
  limit?: number;
  search?: string;
}): Promise<Product[]> {
  let query = db()
    .from('products')
    .select('*, seller:user_profiles!products_seller_id_fkey(username, avatar_url, display_name)')
    .eq('status', 'active')
    .eq('currency', 'BDAG')
    .order('total_sales', { ascending: false })
    .limit(opts?.limit ?? 30);

  if (opts?.category) query = query.eq('category', opts.category);
  if (opts?.sellerId) query = query.eq('seller_id', opts.sellerId);
  if (opts?.search) query = query.ilike('title', `%${opts.search}%`);

  const { data, error } = await query;
  if (error) throw error;
  return (data as Product[]) ?? [];
}

export async function fetchProduct(productId: string): Promise<Product | null> {
  const { data, error } = await db()
    .from('products')
    .select('*, seller:user_profiles!products_seller_id_fkey(username, avatar_url, display_name)')
    .eq('id', productId)
    .eq('currency', 'BDAG')
    .single();
  if (error) return null;
  return (data as Product) ?? null;
}

export async function toggleProductSave(
  userId: string,
  productId: string,
  saved: boolean,
): Promise<boolean> {
  if (saved) {
    const { error } = await db()
      .from('product_saves')
      .insert({ user_id: userId, product_id: productId });
    return !error;
  }
  const { error } = await db()
    .from('product_saves')
    .delete()
    .eq('user_id', userId)
    .eq('product_id', productId);
  return !error;
}

export async function fetchSavedProductIds(userId: string): Promise<Set<string>> {
  const { data, error } = await db()
    .from('product_saves')
    .select('product_id')
    .eq('user_id', userId);
  if (error) return new Set();
  return new Set((data ?? []).map((row: { product_id: string }) => row.product_id));
}
