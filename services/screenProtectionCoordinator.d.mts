export interface AppSwitcherProtectionAdapter {
  enable(): Promise<void>;
  disable(): Promise<void>;
}

export interface AppSwitcherProtectionCoordinator {
  acquire(owner: string): Promise<void>;
  release(owner: string): Promise<void>;
  releaseAllForOwner(owner: string): Promise<void>;
  has(owner: string): boolean;
  claimCount(): number;
}

export interface ScreenCaptureAppSwitcherModule {
  enableAppSwitcherProtectionAsync(blurIntensity?: number): Promise<void>;
  disableAppSwitcherProtectionAsync(): Promise<void>;
}

export function createAppSwitcherProtectionCoordinator(
  adapter: AppSwitcherProtectionAdapter,
): AppSwitcherProtectionCoordinator;
export function configureAppSwitcherProtectionModule(module: ScreenCaptureAppSwitcherModule): void;
export const appSwitcherProtectionCoordinator: AppSwitcherProtectionCoordinator;
