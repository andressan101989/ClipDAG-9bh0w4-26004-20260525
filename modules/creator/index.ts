/**
 * modules/creator/index.ts — Creator Studio module barrel
 *
 * Modular creator studio architecture. Each sub-module is independent
 * and lazy-loaded to prevent memory pressure until the user enters the studio.
 *
 * Sub-modules:
 *   camera/    Camera controller (lens, zoom, flash, front/back switching)
 *   effects/   AR effect pipeline (DeepAR, Skia filters, LUTs)
 *   editor/    Post-capture editing (trim, crop, text, stickers)
 *   audio/     Music picker, audio mixing, sound effects
 *   drafts/    Local draft persistence and cloud sync
 *   uploads/   Upload pipeline with progress tracking
 *   rendering/ Compositor — combines video + audio + effects tracks
 *
 * Design principles:
 *   - All modules communicate via EventBus (no direct imports between them)
 *   - Heavy modules (editor, rendering) are never initialized until needed
 *   - ResourceManager controls exclusive camera/GPU access
 *   - MediaStore tracks recording session state
 */

export { CameraController }            from './camera/CameraController';
export type { CameraConfig, CameraFacing } from './camera/CameraController';

export { EffectsController }           from './effects/EffectsController';
export type { EffectTrack, EffectType } from './effects/EffectsController';

export { DraftManager }                from './drafts/DraftManager';
export type { Draft, DraftStatus }     from './drafts/DraftManager';
