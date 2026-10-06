import { createContext, useContext } from 'react';

export interface PersonalizationRevalidationResult {
  completed: boolean;
  failedOpen: boolean;
  revision: string | null;
  stale: boolean;
}

export interface PersonalizationRuntimeContextValue {
  feedReady: boolean;
  personalizationRevision: string | null;
  invalidatePersonalization: () => void;
  revalidatePersonalization: (
    revisionHint?: string | null,
  ) => Promise<PersonalizationRevalidationResult>;
}

export const PersonalizationRuntimeContext = createContext<
  PersonalizationRuntimeContextValue | undefined
>(undefined);

export function usePersonalizationRuntime(): PersonalizationRuntimeContextValue {
  const value = useContext(PersonalizationRuntimeContext);
  if (!value) {
    throw new Error('usePersonalizationRuntime must be used within PersonalizationGate');
  }
  return value;
}
