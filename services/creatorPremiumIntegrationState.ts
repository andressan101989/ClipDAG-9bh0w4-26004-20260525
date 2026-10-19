import { creatorPremiumPolicyBlocksRetry } from './creatorPremiumPresentation.mjs';

export type SettledCreatorPremiumValue<T> = {
  value: T | null;
  error: unknown | null;
};

export type CreatorPremiumHubLoaders<TContent, TPlans, TSummary> = {
  content: () => Promise<TContent>;
  plans: () => Promise<TPlans>;
  summary: () => Promise<TSummary>;
};

export type CreatorPremiumHubLoadResult<TContent, TPlans, TSummary> = {
  content: SettledCreatorPremiumValue<TContent>;
  plans: SettledCreatorPremiumValue<TPlans>;
  summary: SettledCreatorPremiumValue<TSummary>;
};

function settledValue<T>(result: PromiseSettledResult<T>): SettledCreatorPremiumValue<T> {
  return result.status === 'fulfilled'
    ? { value: result.value, error: null }
    : { value: null, error: result.reason };
}

export async function settleCreatorPremiumHubLoad<TContent, TPlans, TSummary>(
  loaders: CreatorPremiumHubLoaders<TContent, TPlans, TSummary>,
): Promise<CreatorPremiumHubLoadResult<TContent, TPlans, TSummary>> {
  const [content, plans, summary] = await Promise.allSettled([
    loaders.content(),
    loaders.plans(),
    loaders.summary(),
  ]);

  return {
    content: settledValue(content),
    plans: settledValue(plans),
    summary: settledValue(summary),
  };
}

export const CREATOR_PREMIUM_BLOCKER_COPY: Readonly<Record<string, string>> = Object.freeze({
  creator_premium_image_media_not_ready: 'Falta completar la vista previa y la imagen privada.',
  creator_premium_video_media_not_ready: 'Falta completar la vista previa o el video todavía se está procesando.',
  creator_premium_active_offer_required: 'Configura un precio de compra activo.',
  creator_premium_active_plan_required: 'Necesitas asociar y activar por lo menos un plan antes de solicitar la publicación.',
  creator_premium_plan_mapping_required: 'Asocia el contenido a por lo menos un plan.',
  creator_premium_content_has_financial_history: 'Este contenido tiene compras o suscripciones. No puede retirarse automáticamente sin definir cómo se conservará el acceso adquirido.',
  creator_premium_plan_has_dependencies: 'Quita primero el contenido asociado a este borrador. Los planes con dependencias no se eliminan.',
  creator_premium_plan_draft_only: 'Solo se puede eliminar un plan que todavía sea borrador.',
  creator_premium_legacy_reverification_required: 'Este contenido pendiente necesita iniciar la verificación B7 una vez.',
  content_safety_policy_not_configured: 'La verificación de seguridad todavía no está disponible. Tu contenido sigue privado.',
  content_safety_audio_policy_not_configured: 'La verificación de audio todavía no está disponible. Tu video sigue privado.',
  creator_premium_safety_provider_failed: 'La verificación tuvo un error temporal. Puedes reintentar sin volver a subir el contenido.',
  creator_premium_visual_proof_invalid: 'No pudimos validar el original privado. Reintenta la verificación.',
  stream_provider_temporarily_unavailable: 'El servicio de video no respondió a tiempo. Inténtalo de nuevo en unos minutos.',
  stream_provider_credentials_rejected: 'No pudimos autorizar la carga con el servicio de video. El contenido sigue privado; inténtalo más tarde.',
  stream_provider_size_rejected: 'El servicio de video rechazó el tamaño del archivo. Elige un video de hasta 200 MB.',
  stream_provider_invalid_response: 'No pudimos obtener un enlace de carga válido. No se inició la subida; inténtalo de nuevo.',
  stream_provider_rejected: 'El servicio de video rechazó la solicitud. El contenido sigue privado; inténtalo más tarde.',
});

function errorField(error: unknown, field: 'code' | 'message'): string | null {
  if (!error || typeof error !== 'object' || !(field in error)) return null;
  const value = (error as Record<string, unknown>)[field];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function creatorPremiumErrorMessage(error: unknown): string {
  const message = errorField(error, 'message');
  if (!message) return 'No pudimos completar la operación. Inténtalo de nuevo.';

  const known = CREATOR_PREMIUM_BLOCKER_COPY[message];
  if (known) return known;

  const code = errorField(error, 'code');
  if (/^[a-z0-9]+(?:_[a-z0-9]+)+$/i.test(message)
      || Boolean(code && (/^PGRST/i.test(code) || /^[0-9A-Z]{5}$/.test(code)))
      || /schema cache|could not find the function|relation .+ does not exist/i.test(message)) {
    return 'No pudimos completar la operación. Inténtalo de nuevo.';
  }

  return message;
}

export function creatorPremiumSubmissionBlockerMessage(
  blocker: string,
  item?: { mapped_plan_count?: number | null; active_plan_count?: number | null } | null,
): string {
  if (blocker === 'creator_premium_active_plan_required') {
    if ((item?.mapped_plan_count ?? 0) > 0 && (item?.active_plan_count ?? 0) === 0) {
      return 'El plan asociado sigue en borrador o fue retirado. Ve a Planes y actívalo antes de solicitar la publicación.';
    }
    return 'Asocia el contenido a un plan y actívalo desde Planes antes de solicitar la publicación.';
  }
  return CREATOR_PREMIUM_BLOCKER_COPY[blocker]
    ?? 'No pudimos confirmar los requisitos de publicación. Revisa el contenido e inténtalo de nuevo.';
}

export function creatorPremiumCommercialSummaryErrorMessage(error: unknown): string {
  const code = errorField(error, 'code');
  const message = errorField(error, 'message') ?? '';
  if (code === 'PGRST202' || message.includes('get_my_creator_premium_commercial_summary_v1')) {
    return 'Ingresos todavía no está disponible en este backend. Contenido y planes siguen disponibles.';
  }
  return 'No pudimos obtener los ingresos canónicos. Contenido y planes siguen disponibles.';
}

export function creatorPremiumSubmissionMediaBlocker(input: {
  contentKind: 'image' | 'video';
  mediaReady: boolean;
  hasPendingTeaser: boolean;
  hasPendingPrivate: boolean;
  verificationRetryable: boolean;
}): string | null {
  if (input.verificationRetryable) return null;

  if (input.hasPendingTeaser || input.hasPendingPrivate) {
    if (!input.hasPendingTeaser) {
      return 'Selecciona también una vista previa pública y usa “Subir/Reemplazar medios” antes de publicar.';
    }
    if (!input.hasPendingPrivate) {
      return `Selecciona también ${input.contentKind === 'image' ? 'la imagen' : 'el video'} privado y usa “Subir/Reemplazar medios” antes de publicar.`;
    }
    return 'Has seleccionado medios nuevos. Usa “Subir/Reemplazar medios” antes de publicar.';
  }

  if (input.mediaReady) return null;
  return CREATOR_PREMIUM_BLOCKER_COPY[
    input.contentKind === 'image'
      ? 'creator_premium_image_media_not_ready'
      : 'creator_premium_video_media_not_ready'
  ];
}

export function creatorPremiumVerificationCanRetry(input: {
  lifecycle_status?: string | null;
  verification_status?: string | null;
  verification_error_code?: string | null;
} | null | undefined): boolean {
  return input?.lifecycle_status === 'pending_review' && (
    (input.verification_status === 'failed'
      && !creatorPremiumPolicyBlocksRetry(input.verification_error_code))
    || (input.verification_status === 'not_requested'
      && input.verification_error_code === 'creator_premium_legacy_reverification_required')
  );
}

export type CreatorPremiumSubmissionNotice = Readonly<{
  title: string;
  message: string;
}>;

export function creatorPremiumSubmissionNotice(input: {
  contentId: string;
  rpcResult: {
    content_id?: string;
    lifecycle_status?: string;
    submission_ready?: boolean;
  } | null | undefined;
  refreshed: {
    id?: string;
    lifecycle_status?: string;
    verification_status?: string | null;
  } | null | undefined;
}): CreatorPremiumSubmissionNotice | null {
  const { contentId, rpcResult, refreshed } = input;
  if (!rpcResult || rpcResult.content_id !== contentId
      || rpcResult.lifecycle_status !== 'pending_review'
      || rpcResult.submission_ready !== true
      || !refreshed || refreshed.id !== contentId) return null;

  if (refreshed.lifecycle_status === 'published') {
    return {
      title: 'Contenido publicado',
      message: 'El servidor confirmó la publicación del contenido Premium.',
    };
  }
  if (refreshed.lifecycle_status !== 'pending_review') return null;
  if (refreshed.verification_status === 'pending') {
    return {
      title: 'Verificación iniciada',
      message: 'El sistema está verificando el contenido. Se publicará automáticamente solo si supera todos los controles.',
    };
  }
  if (refreshed.verification_status === 'commercial_pending') {
    return {
      title: 'Requisito comercial pendiente',
      message: 'La seguridad fue aprobada. La publicación se completará cuando exista un plan activo asociado.',
    };
  }
  if (refreshed.verification_status === undefined || refreshed.verification_status === null) {
    return {
      title: 'Contenido pendiente',
      message: 'El backend actual guardó el contenido como pendiente, pero la verificación automática B7 todavía no está disponible.',
    };
  }
  return null;
}
