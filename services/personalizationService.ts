import { getSupabaseClient } from '@/template';

export const SUPPORTED_CONTENT_LANGUAGES = ['es', 'en', 'pt', 'fr'] as const;
export type ContentLanguage = typeof SUPPORTED_CONTENT_LANGUAGES[number];

export interface PersonalizationTopic {
  slug: string;
  parentSlug: string | null;
  level: 1 | 2;
  labels: Record<ContentLanguage, string>;
  minorSafe: boolean;
}

export interface PersonalizationCatalog {
  contractVersion: string;
  languages: ContentLanguage[];
  accountRegionContract: string;
  contentRegionContract: string;
  minimumParentInterests: number;
  maximumParentInterests: number;
  maximumCreatorFollows: number;
  topics: PersonalizationTopic[];
}

export interface PersonalizationOnboarding {
  contractVersion: string;
  completed: boolean;
  onboardingCompletedAt: string | null;
  primaryLanguageTag: ContentLanguage | null;
  additionalLanguageTags: ContentLanguage[];
  accountRegionCode: string | null;
  contentRegionCode: string | null;
  personalizationEnabled: boolean;
  adsPersonalizationConsent: boolean;
  preferencesUpdatedAt: string | null;
  interestSlugs: string[];
}

export interface PersonalizationPreferencesInput {
  primaryLanguageTag: ContentLanguage;
  additionalLanguageTags: ContentLanguage[];
  accountRegionCode: string;
  contentRegionCode: string;
  interestSlugs: string[];
  personalizationEnabled: boolean;
  adsPersonalizationConsent: boolean;
}

export interface OnboardingCreatorRecommendation {
  creatorId: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  followerCount: number;
  semanticRelevance: number;
  languageMatch: number;
  regionMatch: number;
  qualityScore: number;
  recommendationScore: number;
  alreadyFollowing: boolean;
}

const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

function assertNoRpcError(error: { message?: string } | null, fallback: string): void {
  if (error) throw new Error(error.message || fallback);
}

export async function getPersonalizationCatalog(): Promise<PersonalizationCatalog> {
  const { data, error } = await getSupabaseClient().rpc('get_personalization_onboarding_catalog_v2');
  assertNoRpcError(error, 'personalization_catalog_failed');
  const value = asRecord(data);
  const topics = Array.isArray(value.topics) ? value.topics.map(entry => {
    const topic = asRecord(entry);
    return {
      slug: String(topic.slug ?? ''),
      parentSlug: topic.parent_slug == null ? null : String(topic.parent_slug),
      level: Number(topic.level) === 1 ? 1 : 2,
      labels: asRecord(topic.labels) as Record<ContentLanguage, string>,
      minorSafe: topic.minor_safe !== false,
    } satisfies PersonalizationTopic;
  }).filter(topic => topic.slug) : [];
  return {
    contractVersion: String(value.contract_version ?? ''),
    languages: asStringArray(value.languages) as ContentLanguage[],
    accountRegionContract: String(value.account_region_contract ?? ''),
    contentRegionContract: String(value.content_region_contract ?? ''),
    minimumParentInterests: Number(value.minimum_parent_interests ?? 3),
    maximumParentInterests: Number(value.maximum_parent_interests ?? 8),
    maximumCreatorFollows: Number(value.maximum_creator_follows ?? 5),
    topics,
  };
}

export async function getPersonalizationOnboarding(): Promise<PersonalizationOnboarding> {
  const { data, error } = await getSupabaseClient().rpc('get_my_personalization_onboarding_v2');
  assertNoRpcError(error, 'personalization_status_failed');
  const value = asRecord(data);
  return {
    contractVersion: String(value.contract_version ?? ''),
    completed: value.completed === true,
    onboardingCompletedAt: typeof value.onboarding_completed_at === 'string'
      ? value.onboarding_completed_at : null,
    primaryLanguageTag: SUPPORTED_CONTENT_LANGUAGES.includes(value.primary_language_tag)
      ? value.primary_language_tag : null,
    additionalLanguageTags: asStringArray(value.additional_language_tags)
      .filter(tag => SUPPORTED_CONTENT_LANGUAGES.includes(tag as ContentLanguage)) as ContentLanguage[],
    accountRegionCode: typeof value.account_region_code === 'string' ? value.account_region_code : null,
    contentRegionCode: typeof value.content_region_code === 'string' ? value.content_region_code : null,
    personalizationEnabled: value.personalization_enabled !== false,
    adsPersonalizationConsent: value.ads_personalization_consent === true,
    preferencesUpdatedAt: typeof value.preferences_updated_at === 'string'
      ? value.preferences_updated_at : null,
    interestSlugs: asStringArray(value.interest_slugs),
  };
}

export async function savePersonalizationPreferences(
  input: PersonalizationPreferencesInput,
): Promise<{ saved: boolean; preferencesUpdatedAt: string | null }> {
  const { data, error } = await getSupabaseClient().rpc('save_my_personalization_preferences_v2', {
    p_primary_language_tag: input.primaryLanguageTag,
    p_additional_language_tags: input.additionalLanguageTags,
    p_account_region_code: input.accountRegionCode,
    p_content_region_code: input.contentRegionCode,
    p_interest_slugs: input.interestSlugs,
    p_personalization_enabled: input.personalizationEnabled,
    p_ads_personalization_consent: input.adsPersonalizationConsent,
  });
  assertNoRpcError(error, 'personalization_save_failed');
  const value = asRecord(data);
  return {
    saved: value.saved === true,
    preferencesUpdatedAt: typeof value.preferences_updated_at === 'string'
      ? value.preferences_updated_at : null,
  };
}

export async function getOnboardingCreatorRecommendations(
  limit = 12,
): Promise<OnboardingCreatorRecommendation[]> {
  const { data, error } = await getSupabaseClient().rpc(
    'get_my_onboarding_creator_recommendations_v1',
    { p_limit: limit },
  );
  assertNoRpcError(error, 'personalization_creators_failed');
  return (Array.isArray(data) ? data : []).map(entry => {
    const value = asRecord(entry);
    return {
      creatorId: String(value.creator_id ?? ''),
      username: String(value.username ?? ''),
      displayName: String(value.display_name ?? value.username ?? ''),
      avatarUrl: String(value.avatar_url ?? ''),
      followerCount: Number(value.follower_count ?? 0),
      semanticRelevance: Number(value.semantic_relevance ?? 0),
      languageMatch: Number(value.language_match ?? 0),
      regionMatch: Number(value.region_match ?? 0),
      qualityScore: Number(value.quality_score ?? 0),
      recommendationScore: Number(value.recommendation_score ?? 0),
      alreadyFollowing: value.already_following === true,
    };
  }).filter(creator => creator.creatorId);
}

export async function completePersonalizationOnboarding(): Promise<{
  completed: boolean;
  requiredCreatorFollows: number;
}> {
  const { data, error } = await getSupabaseClient().rpc('complete_my_personalization_onboarding_v1');
  assertNoRpcError(error, 'personalization_completion_failed');
  const value = asRecord(data);
  return {
    completed: value.completed === true,
    requiredCreatorFollows: Number(value.required_creator_follows ?? 0),
  };
}
