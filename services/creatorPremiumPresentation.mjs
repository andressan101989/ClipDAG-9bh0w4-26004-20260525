export {
  formatCreatorPremiumBdag,
  formatCreatorPremiumPriceInput,
  resolveCreatorPremiumPriceSubmission,
} from './creatorPremiumMoney.mjs';

export const CREATOR_PREMIUM_VIDEO_MIME_TYPES = Object.freeze([
  'video/mp4',
  'video/quicktime',
  'video/webm',
]);

export const CREATOR_PREMIUM_VIDEO_MAX_BYTES = 200_000_000;
export const CREATOR_PREMIUM_VIDEO_MAX_DURATION_MS = 180_000;

export function visibleCreatorPremiumContents(items) {
  if (!Array.isArray(items)) return [];
  return items.filter(item => item?.lifecycle_status !== 'deleted');
}

const POLICY_ERROR_CODES = new Set([
  'content_safety_policy_not_configured',
  'content_safety_audio_policy_not_configured',
]);

export async function collectCreatorPremiumPlanPages(fetchPage, options = {}) {
  const pageSize = Number.isInteger(options.pageSize) ? options.pageSize : 100;
  const maxPages = Number.isInteger(options.maxPages) ? options.maxPages : 100;
  if (typeof fetchPage !== 'function' || pageSize < 1 || pageSize > 100 || maxPages < 1) {
    throw new Error('creator_premium_plan_snapshot_invalid');
  }

  const collected = [];
  const seenIds = new Set();
  const seenCursors = new Set();
  let cursor = null;
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const page = await fetchPage({ limit: pageSize, cursor });
    if (!page || !Array.isArray(page.items)) {
      throw new Error('creator_premium_plan_snapshot_invalid');
    }
    for (const item of page.items) {
      if (!item || typeof item.id !== 'string' || !item.id || seenIds.has(item.id)) continue;
      seenIds.add(item.id);
      collected.push(item);
    }
    if (!page.nextCursor) return collected;
    const cursorKey = `${page.nextCursor.timestamp ?? ''}:${page.nextCursor.id ?? ''}`;
    if (cursorKey === ':' || seenCursors.has(cursorKey)) {
      throw new Error('creator_premium_plan_snapshot_invalid');
    }
    seenCursors.add(cursorKey);
    cursor = page.nextCursor;
  }
  throw new Error('creator_premium_plan_snapshot_too_large');
}

export function resolveCreatorPremiumPlanSelection({
  plans,
  contentId,
  selectedPlanIds = [],
  preserveSelection = false,
} = {}) {
  if (!Array.isArray(plans)) return [];
  const activePlanIds = new Set(
    plans
      .filter(plan => plan?.status === 'active' && typeof plan.id === 'string' && plan.id)
      .map(plan => plan.id),
  );
  const resolved = new Set();
  if (preserveSelection && Array.isArray(selectedPlanIds)) {
    for (const planId of selectedPlanIds) {
      if (activePlanIds.has(planId)) resolved.add(planId);
    }
  } else {
    for (const plan of plans) {
      if (activePlanIds.has(plan?.id)
          && Array.isArray(plan.mapped_content_ids)
          && plan.mapped_content_ids.includes(contentId)) {
        resolved.add(plan.id);
      }
    }
  }
  return [...resolved].sort();
}

export function normalizeCreatorPremiumVideoPickerAsset(asset) {
  if (!asset) return null;
  const mimeType = asset.mimeType ?? '';
  if (!CREATOR_PREMIUM_VIDEO_MIME_TYPES.includes(mimeType)) {
    throw new Error('creator_premium_video_mime_invalid');
  }
  if (!Number.isInteger(asset.sizeBytes) || asset.sizeBytes <= 0
      || asset.sizeBytes > CREATOR_PREMIUM_VIDEO_MAX_BYTES) {
    throw new Error('creator_premium_video_size_invalid');
  }
  if (asset.durationMs !== null && asset.durationMs !== undefined
      && (!Number.isFinite(asset.durationMs) || asset.durationMs < 0
        || asset.durationMs > CREATOR_PREMIUM_VIDEO_MAX_DURATION_MS)) {
    throw new Error('creator_premium_video_duration_invalid');
  }
  if (typeof asset.uri !== 'string' || !asset.uri
      || typeof asset.fileName !== 'string' || !asset.fileName) {
    throw new Error('creator_premium_video_asset_invalid');
  }
  return { uri: asset.uri, mimeType, fileName: asset.fileName, sizeBytes: asset.sizeBytes };
}

export function prepareCreatorPremiumVideoPickerAsset(asset, options = {}) {
  if (!asset) return null;
  const fileName = asset.fileName ?? 'premium-video.mp4';
  const extension = fileName.toLowerCase().split('.').pop();
  const mimeType = asset.mimeType
    ?? (extension === 'mov' ? 'video/quicktime' : extension === 'webm' ? 'video/webm' : 'video/mp4');
  let sizeBytes = asset.sizeBytes ?? 0;
  if (!sizeBytes) {
    try {
      sizeBytes = Number(options.sizeForUri?.(asset.uri) ?? 0);
    } catch {
      throw new Error('creator_premium_video_asset_unreadable');
    }
  }
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    throw new Error('creator_premium_video_asset_unreadable');
  }
  return normalizeCreatorPremiumVideoPickerAsset({
    uri: asset.uri,
    mimeType,
    fileName,
    sizeBytes,
    durationMs: asset.durationMs,
  });
}

const base = (state, label, copy, options = {}) => ({
  state,
  label,
  tone: options.tone ?? 'purple',
  polling: options.polling ?? false,
  canRetry: options.canRetry ?? false,
  canCancel: options.canCancel ?? false,
  canDelete: options.canDelete ?? false,
  copy,
});

export function creatorPremiumLifecyclePresentation(input = {}) {
  const lifecycle = input.lifecycle_status;
  const verification = input.verification_status;
  const errorCode = input.verification_error_code;

  if (lifecycle === 'draft') {
    return base('draft', 'Borrador', 'Puedes editar, reemplazar medios o eliminar este borrador.', { canDelete: true });
  }
  if (lifecycle === 'deleted') {
    return base('deleted', 'Eliminado', 'Este contenido se conserva únicamente como histórico y no puede restaurarse.');
  }
  if (lifecycle === 'published') {
    return base('published', 'Publicado', 'El servidor confirmó la publicación después de todos los controles.', { tone: 'green' });
  }
  if (lifecycle === 'rejected' || verification === 'blocked') {
    return base(
      'rejected',
      'No aprobado',
      input.review_reason || 'La verificación bloqueó la publicación. Puedes corregirla o eliminarla.',
      { canDelete: true },
    );
  }
  if (lifecycle === 'quarantined' || verification === 'restricted') {
    return base('restricted', 'Restringido', input.review_reason || 'El contenido permanece privado mientras se revisa la restricción.');
  }
  if (lifecycle === 'removed') {
    return base(
      'removed',
      'Retirado',
      input.removal_reason || 'Ya no está publicado. Puedes conservarlo para gestionarlo o eliminarlo de tu panel.',
      { canDelete: true },
    );
  }
  if (lifecycle !== 'pending_review') {
    return base('not_requested', 'Sin verificación', 'La verificación todavía no se ha solicitado.');
  }

  if (verification === 'not_requested'
      && errorCode === 'creator_premium_legacy_reverification_required') {
    return base(
      'legacy_reverification_required',
      'Verificación requerida',
      'Este contenido anterior a B7 necesita iniciar una verificación una vez.',
      { canRetry: true, canCancel: true, tone: 'amber' },
    );
  }
  if (verification === 'pending') {
    return base(
      'processing',
      'Verificación pendiente',
      'Los controles automáticos están procesando el contenido; el original sigue privado.',
      { polling: true, canCancel: true, canDelete: true, tone: 'amber' },
    );
  }
  if (verification === 'commercial_pending' || verification === 'passed') {
    return base(
      'approved',
      verification === 'commercial_pending' ? 'Activación comercial pendiente' : 'Verificación aprobada',
      verification === 'commercial_pending'
        ? 'Seguridad aprobada; falta un plan activo antes de publicar.'
        : 'La verificación fue aprobada y el servidor está finalizando el estado.',
      { canCancel: true, canDelete: true, tone: 'green' },
    );
  }
  if (verification === 'failed' && POLICY_ERROR_CODES.has(errorCode)) {
    return base(
      'awaiting_policy',
      'Política de seguridad pendiente',
      'El contenido seguirá privado hasta que exista una política aprobada. No es necesario reintentar ahora.',
      { canCancel: true, canDelete: true, tone: 'amber' },
    );
  }
  if (verification === 'failed') {
    return base(
      'failed',
      'Verificación fallida',
      errorCode === 'creator_premium_safety_provider_failed'
        ? 'El proveedor no devolvió una respuesta válida. Puedes reintentar sin volver a subir el contenido.'
        : 'La verificación no terminó. Puedes reintentar de forma segura.',
      { canRetry: true, canCancel: true, canDelete: true, tone: 'amber' },
    );
  }
  return base(
    'not_requested',
    'Verificación no iniciada',
    'La verificación todavía no está en ejecución.',
    { canCancel: true, canDelete: true },
  );
}

export function creatorPremiumPolicyBlocksRetry(errorCode) {
  return POLICY_ERROR_CODES.has(errorCode);
}

export function creatorPremiumLifecycleActions(input = {}) {
  const lifecycle = input.lifecycle_status;
  const presentation = creatorPremiumLifecyclePresentation(input);
  const editable = lifecycle === undefined || lifecycle === null || lifecycle === 'draft';
  return Object.freeze({
    editable,
    canSubmit: editable,
    canDelete: ['draft', 'pending_review', 'rejected', 'removed'].includes(lifecycle),
    canCancel: presentation.canCancel,
    canRetry: presentation.canRetry,
    canReopen: lifecycle === 'rejected',
    canRetire: lifecycle === 'published',
  });
}

export function creatorPremiumEditorActionVisibility(actions = {}, { hasContentId = false } = {}) {
  const showDelete = Boolean(hasContentId && actions.canDelete);
  const showRetire = Boolean(hasContentId && actions.canRetire);
  return Object.freeze({
    showActionBar: Boolean(
      actions.editable
        || actions.canRetry
        || actions.canCancel
        || actions.canReopen
        || showDelete
        || showRetire
    ),
    showDelete,
    showRetire,
  });
}

