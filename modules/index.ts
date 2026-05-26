/**
 * modules/index.ts — Top-level module barrel
 *
 * Import from here when you need multiple modules:
 *   import { EventBus, PollingManager, UploadQueue } from '@/modules';
 *
 * Or import directly from a module for tree-shaking:
 *   import { CameraController } from '@/modules/creator';
 */

// Core infrastructure
export * from './core';

// Realtime layer
export * from './realtime';

// Media pipeline
export { UploadQueue }   from './media/UploadQueue';
export { CacheManager }  from './media/CacheManager';

// Feature modules (lazy — only import what you use)
export * from './calls';
export * from './streaming';
export * from './battle';
export * from './gaming';
export * from './creator';
