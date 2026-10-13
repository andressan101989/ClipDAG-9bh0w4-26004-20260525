export type WalletConnectProjectResolution =
  | { enabled: true; projectId: string }
  | { enabled: false; code: 'PROJECT_ID_MISSING' | 'PROJECT_ID_INVALID' };

const PROJECT_ID_PATTERN = /^[a-f0-9]{32}$/i;

export function resolveWalletConnectProjectId(
  rawProjectId: string | null | undefined,
): WalletConnectProjectResolution {
  const projectId = rawProjectId?.trim() ?? '';
  if (!projectId) return { enabled: false, code: 'PROJECT_ID_MISSING' };
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    return { enabled: false, code: 'PROJECT_ID_INVALID' };
  }
  return { enabled: true, projectId };
}

export function createWalletConnectInitializer<T>(
  rawProjectId: string | null | undefined,
  factory: (projectId: string) => T,
) {
  const resolution = resolveWalletConnectProjectId(rawProjectId);
  let attempted = false;
  let instance: T | null = null;
  let failureCode: 'INITIALIZATION_FAILED' | null = null;

  return {
    get isEnabled() {
      return resolution.enabled;
    },
    get configuration() {
      return resolution;
    },
    get failureCode() {
      return failureCode;
    },
    getInstance(): T | null {
      if (!resolution.enabled || attempted) return instance;
      attempted = true;
      try {
        instance = factory(resolution.projectId);
      } catch {
        failureCode = 'INITIALIZATION_FAILED';
        instance = null;
      }
      return instance;
    },
  };
}
