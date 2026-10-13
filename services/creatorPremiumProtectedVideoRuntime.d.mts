export interface ProtectedPremiumVideoSource {
  uri: string;
  contentId: string;
  expiresAt: string;
}

export interface ProtectedPremiumNativePlayer {
  replaceAsync(source: { uri: string; contentType: 'hls'; useCaching: false } | null): Promise<void>;
  play(): void | Promise<void>;
  pause(): void | Promise<void>;
}

export interface ProtectedVideoCommandController {
  load(source: ProtectedPremiumVideoSource, generation: number): Promise<boolean>;
  play(generation: number): Promise<boolean>;
  pause(): Promise<void>;
  invalidate(reason: string): Promise<void>;
  dispose(): Promise<void>;
}

export function createProtectedVideoCommandController(
  player: ProtectedPremiumNativePlayer,
): ProtectedVideoCommandController;
