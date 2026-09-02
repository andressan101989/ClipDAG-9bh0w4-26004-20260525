import { clampGiftDuration, type LiveGiftPresentationEvent } from './giftPresentationContract';

export type GiftVisualTier = 'micro' | 'standard' | 'featured' | 'premium' | 'epic' | 'legendary';
export type GiftAnimationFamily =
  | 'floating'
  | 'sparkle_burst'
  | 'heart_wave'
  | 'celebration'
  | 'orbit'
  | 'spotlight'
  | 'premium_scene'
  | 'legendary_scene';

export type ResolvedGiftAnimation = Readonly<{
  family: GiftAnimationFamily;
  tier: GiftVisualTier;
  durationMs: number;
  particleCount: number;
  colors: readonly [string, string, string];
  exclusive: boolean;
  compact: boolean;
}>;

const FAMILIES = new Set<GiftAnimationFamily>([
  'floating', 'sparkle_burst', 'heart_wave', 'celebration',
  'orbit', 'spotlight', 'premium_scene', 'legendary_scene',
]);

const CATEGORY_FALLBACKS: Record<string, GiftAnimationFamily> = {
  basic: 'floating',
  love: 'heart_wave',
  celebration: 'celebration',
  fun: 'sparkle_burst',
  nature: 'orbit',
  lifestyle: 'spotlight',
  premium: 'premium_scene',
  legendary: 'legendary_scene',
};

const PALETTE: readonly (readonly [string, string, string])[] = [
  ['#FFD54A', '#FF8A3D', '#FFF4B0'],
  ['#7DEBFF', '#7C5CFF', '#E7E2FF'],
  ['#FF6FAE', '#FF4D6D', '#FFE1EC'],
  ['#7FFFD4', '#18C79C', '#E0FFF5'],
];

export function getGiftVisualTier(costCoins: number): GiftVisualTier {
  if (costCoins <= 20) return 'micro';
  if (costCoins <= 99) return 'standard';
  if (costCoins <= 499) return 'featured';
  if (costCoins <= 1_999) return 'premium';
  if (costCoins <= 9_999) return 'epic';
  return 'legendary';
}

function hashGiftId(giftId: string): number {
  let value = 0;
  for (let index = 0; index < giftId.length; index += 1) value = (value * 31 + giftId.charCodeAt(index)) >>> 0;
  return value;
}

function legacyFamily(animationType: string | null, tier: GiftVisualTier): GiftAnimationFamily | null {
  switch (animationType) {
    case 'center': return tier === 'featured' ? 'sparkle_burst' : 'spotlight';
    case 'entrance': return tier === 'epic' ? 'premium_scene' : 'orbit';
    case 'fullscreen': return tier === 'legendary' ? 'legendary_scene' : 'premium_scene';
    default: return null;
  }
}

function tierFallback(tier: GiftVisualTier): GiftAnimationFamily {
  switch (tier) {
    case 'micro': return 'floating';
    case 'standard': return 'sparkle_burst';
    case 'featured': return 'orbit';
    case 'premium': return 'spotlight';
    case 'epic': return 'premium_scene';
    case 'legendary': return 'legendary_scene';
  }
}

function particleBudget(tier: GiftVisualTier): number {
  switch (tier) {
    case 'micro': return 8;
    case 'standard': return 8;
    case 'featured': return 12;
    case 'premium': return 18;
    case 'epic': return 24;
    case 'legendary': return 32;
  }
}

export function resolveGiftAnimation(event: LiveGiftPresentationEvent): ResolvedGiftAnimation {
  const tier = getGiftVisualTier(event.costCoins);
  const explicit = FAMILIES.has(event.animationType as GiftAnimationFamily)
    ? event.animationType as GiftAnimationFamily
    : null;
  const family = explicit
    ?? legacyFamily(event.animationType, tier)
    ?? CATEGORY_FALLBACKS[event.category.toLowerCase()]
    ?? tierFallback(tier);
  const colors = PALETTE[hashGiftId(event.giftId) % PALETTE.length];

  return Object.freeze({
    family,
    tier,
    durationMs: clampGiftDuration(event.durationMs),
    particleCount: particleBudget(tier),
    colors,
    exclusive: tier === 'legendary',
    compact: tier === 'micro' || tier === 'standard',
  });
}

export const KNOWN_GIFT_ANIMATION_FAMILIES = Object.freeze([...FAMILIES]);
