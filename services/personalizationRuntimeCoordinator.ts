export interface PersonalizationFeedReadiness {
  viewerId: string | null;
  feedReady: boolean;
  personalizationRevision: string | null;
}

export interface PersonalizationRevisionSource {
  preferencesUpdatedAt: string | null;
  onboardingCompletedAt: string | null;
}

export interface EffectivePersonalizationRuntimeInput {
  authenticatedUserId: string | null;
  runtimeUserId: string | null;
  feedReady: boolean;
  personalizationRevision: string | null;
}

export function getPersonalizationRevision(source: PersonalizationRevisionSource): string | null {
  return source.preferencesUpdatedAt ?? source.onboardingCompletedAt;
}

export function getEffectivePersonalizationRuntime(
  input: EffectivePersonalizationRuntimeInput,
): Pick<PersonalizationFeedReadiness, 'feedReady' | 'personalizationRevision'> {
  if (!input.authenticatedUserId) {
    return { feedReady: true, personalizationRevision: null };
  }
  if (input.runtimeUserId !== input.authenticatedUserId) {
    return { feedReady: false, personalizationRevision: null };
  }
  return {
    feedReady: input.feedReady,
    personalizationRevision: input.personalizationRevision,
  };
}

function getFeedLoadKey(state: PersonalizationFeedReadiness): string | null {
  if (state.viewerId && !state.feedReady) return null;
  if (!state.viewerId) return 'anonymous';
  return `authenticated:${state.viewerId}:${state.personalizationRevision ?? 'fail-open'}`;
}

export class PersonalizationFeedLoadCoordinator {
  private lastClaimedKey: string | null = null;

  reset(): void {
    this.lastClaimedKey = null;
  }

  claim(state: PersonalizationFeedReadiness): boolean {
    const nextKey = getFeedLoadKey(state);
    if (!nextKey || nextKey === this.lastClaimedKey) return false;
    this.lastClaimedKey = nextKey;
    return true;
  }
}
