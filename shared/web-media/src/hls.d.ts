declare module "hls.js" {
  export type HlsErrorData = { fatal: boolean };
  export default class Hls {
    static isSupported(): boolean;
    static Events: { ERROR: string };
    constructor(config?: { enableWorker?: boolean });
    loadSource(url: string): void;
    attachMedia(media: HTMLMediaElement): void;
    on(event: string, callback: (event: string, data: HlsErrorData) => void): void;
    destroy(): void;
  }
}
