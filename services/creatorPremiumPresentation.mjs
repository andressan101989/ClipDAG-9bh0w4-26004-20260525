export const CREATOR_PREMIUM_VIDEO_MIME_TYPES = Object.freeze([
  'video/mp4',
  'video/quicktime',
  'video/webm',
]);

export const CREATOR_PREMIUM_VIDEO_MAX_BYTES = 200_000_000;
export const CREATOR_PREMIUM_VIDEO_MAX_DURATION_MS = 60_000;

const POLICY_ERROR_CODES = new Set([
  'content_safety_policy_not_configured',
  'content_safety_audio_policy_not_configured',
]);

function groupedWhole(value) {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function formatCreatorPremiumBdag(value, options = {}) {
  const empty = typeof options.empty === 'string' ? options.empty : 'Sin precio';
  if (value === null || value === undefined) return empty;
  if (typeof value !== 'string') return '— BDAG';
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return '— BDAG';

  const negative = match[1] === '-';
  const whole = match[2].replace(/^0+(?=\d)/, '');
  const fraction = match[3] ?? '';
  let minorUnits = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
  if ((fraction[2] ?? '0') >= '5') minorUnits += 1n;

  const displayWhole = (minorUnits / 100n).toString();
  const displayFraction = (minorUnits % 100n).toString().padStart(2, '0');
  const sign = negative && minorUnits !== 0n ? '-' : '';
  return `${sign}${groupedWhole(displayWhole)},${displayFraction} BDAG`;
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

function creatorPremiumVideoSelectionFailure(reason) {
  const raw = reason && typeof reason === 'object'
    ? [reason.code, reason.message, reason.exception].filter(value => typeof value === 'string').join(' ')
    : String(reason ?? '');
  if (/PHPhotosErrorDomain[\s\S]*3164|3164[\s\S]*PHPhotosErrorDomain/i.test(raw)) {
    return {
      code: 'creator_premium_video_photos_export_failed',
      message: 'Photos no pudo preparar este video. Ábrelo en Photos, espera a que termine la descarga desde iCloud y vuelve a intentarlo; también puedes elegirlo desde Files.',
    };
  }
  const code = reason instanceof Error ? reason.message : '';
  if (code === 'creator_premium_video_mime_invalid') {
    return { code, message: 'Usa MP4, QuickTime o WebM.' };
  }
  if (code === 'creator_premium_video_size_invalid') {
    return { code, message: 'El video debe pesar menos de 200 MB.' };
  }
  if (code === 'creator_premium_video_duration_invalid') {
    return { code, message: 'El video debe durar como máximo 60 segundos.' };
  }
  if (code === 'creator_premium_video_asset_unreadable') {
    return {
      code,
      message: 'Photos todavía no entregó un archivo local legible. Descarga el video por completo y vuelve a intentarlo; también puedes elegirlo desde Files.',
    };
  }
  return {
    code: 'creator_premium_video_picker_failed',
    message: 'No se pudo preparar el video seleccionado. Inténtalo de nuevo o elígelo desde Files.',
  };
}

export async function selectCreatorPremiumVideoFromPhotos({
  requestPermission,
  launchPicker,
  prepareAsset,
}) {
  try {
    const permission = await requestPermission();
    if (!permission?.granted) return { status: 'permission_required' };
    const result = await launchPicker();
    const asset = result?.assets?.[0];
    if (result?.canceled || !asset) return { status: 'cancelled' };
    return { status: 'selected', file: await prepareAsset(asset) };
  } catch (reason) {
    return { status: 'failed', ...creatorPremiumVideoSelectionFailure(reason) };
  }
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
    return base('rejected', 'No aprobado', input.review_reason || 'La verificación bloqueó la publicación. Corrige el borrador antes de reenviarlo.');
  }
  if (lifecycle === 'quarantined' || verification === 'restricted') {
    return base('restricted', 'Restringido', input.review_reason || 'El contenido permanece privado mientras se revisa la restricción.');
  }
  if (lifecycle === 'removed') {
    return base('removed', 'Retirado', input.removal_reason || 'El contenido fue retirado y permanece en el historial.');
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
      { polling: true, canCancel: true, tone: 'amber' },
    );
  }
  if (verification === 'commercial_pending' || verification === 'passed') {
    return base(
      'approved',
      verification === 'commercial_pending' ? 'Activación comercial pendiente' : 'Verificación aprobada',
      verification === 'commercial_pending'
        ? 'Seguridad aprobada; falta un plan activo antes de publicar.'
        : 'La verificación fue aprobada y el servidor está finalizando el estado.',
      { canCancel: true, tone: 'green' },
    );
  }
  if (verification === 'failed' && POLICY_ERROR_CODES.has(errorCode)) {
    return base(
      'awaiting_policy',
      'Política de seguridad pendiente',
      'El contenido seguirá privado hasta que exista una política aprobada. No es necesario reintentar ahora.',
      { canCancel: true, tone: 'amber' },
    );
  }
  if (verification === 'failed') {
    return base(
      'failed',
      'Verificación fallida',
      errorCode === 'creator_premium_safety_provider_failed'
        ? 'El proveedor no devolvió una respuesta válida. Puedes reintentar sin volver a subir el contenido.'
        : 'La verificación no terminó. Puedes reintentar de forma segura.',
      { canRetry: true, canCancel: true, tone: 'amber' },
    );
  }
  return base('not_requested', 'Verificación no iniciada', 'La verificación todavía no está en ejecución.', { canCancel: true });
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
    canDelete: lifecycle === 'draft',
    canCancel: presentation.canCancel,
    canRetry: presentation.canRetry,
    canReopen: lifecycle === 'rejected',
  });
}

