/**
 * modules/creator/index.ts — Creator Studio module barrel
 */
export { CameraController }       from './camera/CameraController';
export { EffectsController }      from './effects/EffectsController';
export { EditorController }       from './editor/EditorController';
export type { EditorState, EditOperation, TextOverlay, StickerOverlay } from './editor/EditorController';
export { DraftManager }           from './drafts/DraftManager';
export { RenderCompositor }       from './rendering/RenderCompositor';
export type { RenderJob, RenderStage } from './rendering/RenderCompositor';
export { FiltersController }      from './filters/FiltersController';
export type { Filter, AppliedFilter, FilterCategory } from './filters/FiltersController';
export { TimelineController }     from './timeline/TimelineController';
export type { TimelineClip, TimelineState, TrackType } from './timeline/TimelineController';
export { ExportManager }          from './exports/ExportManager';
export type { ExportJob, ExportOptions, ExportStage, VideoPrivacy } from './exports/ExportManager';
export { CreatorSessionManager }  from './sessions/CreatorSessionManager';
export type { CreatorSession, CreatorPhase } from './sessions/CreatorSessionManager';
