/**
 * shared/types.ts — Shared domain types
 *
 * Single source of truth for types shared across modules.
 * No React imports here — pure TypeScript types only.
 *
 * Import rules:
 *   - Any module may import from shared/types
 *   - shared/types MUST NOT import from any feature module
 */

// ── User / Auth ───────────────────────────────────────────────────────────────
export interface UserProfile {
  id:              string;
  username:        string;
  email:           string;
  avatar_url?:     string;
  display_name?:   string;
  bio?:            string;
  dag_balance?:    number;
  followers_count: number;
  following_count: number;
  is_private:      boolean;
}

// ── Video / Feed ──────────────────────────────────────────────────────────────
export interface VideoPost {
  id:            string;
  user_id:       string;
  video_url:     string;
  thumbnail_url?: string;
  caption:       string;
  music?:        string;
  likes_count:   number;
  comments_count:number;
  shares_count:  number;
  views_count:   number;
  saves_count:   number;
  created_at:    string;
  // joined fields
  username?:     string;
  user_avatar?:  string;
  is_liked?:     boolean;
  is_saved?:     boolean;
}

export interface VideoComment {
  id:         string;
  user_id:    string;
  video_id:   string;
  text:       string;
  likes_count:number;
  created_at: string;
  username?:  string;
  avatar_url?:string;
}

// ── Wallet / Economy ──────────────────────────────────────────────────────────
export interface BDAGBalance {
  available: number;
  locked:    number;
  total:     number;
  currency:  'BDAG';
}

export interface Transaction {
  id:          string;
  user_id:     string;
  amount:      number;
  type:        string;
  status:      'completed' | 'pending' | 'failed';
  description: string;
  created_at:  string;
  tx_hash?:    string;
}

// ── Creator / Monetization ────────────────────────────────────────────────────
export interface SubscriptionPlan {
  id:             string;
  creator_id:     string;
  name:           string;
  description:    string;
  perks:          string[];
  price_bdag:     number;
  billing_cycle:  'monthly' | 'yearly';
  status:         'active' | 'inactive';
  subscribers_count: number;
}

// ── Messages ──────────────────────────────────────────────────────────────────
export interface Message {
  id:          string;
  sender_id:   string;
  recipient_id:string;
  text:        string;
  media_url?:  string;
  media_type?: string;
  read:        boolean;
  created_at:  string;
}

// ── Notification ──────────────────────────────────────────────────────────────
export type NotificationType =
  | 'like' | 'comment' | 'follow' | 'mention' | 'gift'
  | 'subscription' | 'purchase' | 'system';

export interface Notification {
  id:              string;
  user_id:         string;
  type:            NotificationType;
  from_user_id?:   string;
  from_username?:  string;
  from_avatar?:    string;
  reference_id?:   string;
  reference_type?: string;
  message:         string;
  read:            boolean;
  created_at:      string;
}

// ── AR / Camera ───────────────────────────────────────────────────────────────
export type CameraFacing = 'front' | 'back';

export interface CaptureResult {
  uri:      string;
  type:     'photo' | 'video';
  width?:   number;
  height?:  number;
}

// ── Video Editor ──────────────────────────────────────────────────────────────
export type VideoColorFilter =
  | 'none' | 'vintage' | 'cine' | 'frio' | 'calido' | 'bn' | 'neon';

export type VideoSpeedPreset = 0.3 | 0.5 | 1.0 | 1.5 | 2.0 | 4.0;

// ── Music ─────────────────────────────────────────────────────────────────────
export interface MusicTrack {
  id:       number;
  title:    string;
  preview:  string;
  duration: number;
  artist:   { name: string };
  album:    { cover_medium: string; title: string };
}

// ── Products / Shop ───────────────────────────────────────────────────────────
export interface Product {
  id:          string;
  seller_id:   string;
  title:       string;
  description: string;
  price:       number;
  currency:    string;
  category:    string;
  images:      string[];
  stock:       number;
  status:      'active' | 'inactive' | 'deleted';
  tags:        string[];
  total_sales: number;
  created_at:  string;
}

// ── Result / Error ────────────────────────────────────────────────────────────
export interface ServiceResult<T> {
  data:   T | null;
  error:  string | null;
}

export type AsyncResult<T> = Promise<ServiceResult<T>>;
