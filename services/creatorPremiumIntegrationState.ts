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
  creator_premium_plan_content_unavailable: 'El plan contiene una publicación que ya no está disponible. Actualiza los planes y vuelve a intentarlo.',
  creator_premium_plan_selection_stale: 'La selección de planes cambió mientras publicabas. Actualiza los planes y vuelve a intentarlo.',
  creator_premium_content_has_financial_history: 'Este contenido tiene compras o suscripciones. No puede retirarse automáticamente sin definir cómo se conservará el acceso adquirido.',
  creator_premium_content_retire_first: 'Retira primero esta publicación. Después podrás eliminarla de tu panel sin afectar derechos adquiridos.',
  creator_premium_plan_has_dependencies: 'Quita primero el contenido asociado a este borrador. Los planes con dependencias no se eliminan.',
  creator_premium_plan_draft_only: 'Solo se puede eliminar un plan que todavía sea borrador.',
  creator_premium_plan_retire_first: 'Retira primero este plan activo. Después podrás eliminarlo de tu panel conservando su historial.',
  creator_premium_purchase_disabled: 'Las compras Premium siguen deshabilitadas por la política financiera del servidor.',
  creator_premium_subscription_disabled: 'Las suscripciones Premium siguen deshabilitadas por la política financiera del servidor.',
  creator_premium_refunds_disabled: 'Los reembolsos Premium siguen deshabilitados por la política financiera del servidor.',
  creator_premium_rate_limited: 'Hay demasiados intentos financieros recientes. Espera un momento y vuelve a intentarlo.',
  creator_premium_velocity_check_unavailable: 'No se ejecutó ningún movimiento porque el control financiero temporalmente no está disponible. Inténtalo más tarde.',
  creator_premium_active_offer_not_found: 'La oferta ya no está activa. Actualiza la publicación antes de intentar comprarla.',
  creator_premium_offer_changed: 'La oferta cambió. Revisa el precio actualizado y confirma de nuevo antes de comprar.',
  creator_premium_active_plan_not_found: 'El plan ya no está activo. Actualiza la oferta antes de continuar.',
  creator_premium_plan_family_access_active: 'Ya tienes un periodo vigente de este plan. Espera a que termine antes de cambiar a otra versión.',
  creator_premium_content_not_published: 'Este contenido ya no está publicado y no admite nuevas compras.',
  creator_premium_purchase_access_mode_invalid: 'Esta publicación no admite compra individual.',
  creator_premium_plan_has_no_valid_content: 'Este plan ya no contiene publicaciones Premium elegibles.',
  creator_premium_self_purchase_forbidden: 'No puedes comprar tu propia publicación.',
  creator_premium_self_subscription_forbidden: 'No puedes suscribirte a tu propio plan.',
  creator_premium_blocked_relationship: 'Esta operación no está disponible para esta relación entre cuentas.',
  creator_premium_buyer_account_restricted: 'Tu cuenta no puede realizar esta compra en este momento.',
  creator_premium_subscriber_account_restricted: 'Tu cuenta no puede iniciar o renovar esta suscripción.',
  creator_premium_creator_account_restricted: 'La cuenta del creador no puede recibir operaciones Premium en este momento.',
  creator_premium_already_owned: 'Ya tienes acceso vigente a este contenido.',
  creator_premium_already_subscribed: 'Este plan ya tiene un periodo pagado vigente.',
  creator_premium_subscription_period_active: 'El periodo actual sigue vigente. Podrás renovar cuando termine.',
  creator_premium_subscription_not_cancellable: 'Esta suscripción ya no admite cancelación.',
  creator_premium_subscription_plan_retired: 'Este plan fue retirado y no admite nuevas renovaciones.',
  creator_premium_subscription_renewal_not_available: 'La renovación manual no está disponible para este periodo.',
  creator_premium_subscription_financial_binding_invalid: 'No pudimos verificar el vínculo financiero de esta suscripción. No se movió BDAG.',
  creator_premium_purchase_financial_binding_invalid: 'No pudimos verificar el vínculo financiero de esta compra. No se movió BDAG.',
  creator_premium_purchase_idempotency_conflict: 'Este intento de compra ya está asociado a otra operación. Actualiza e inténtalo otra vez.',
  creator_premium_subscription_idempotency_conflict: 'Este intento de suscripción ya está asociado a otra operación. Actualiza e inténtalo otra vez.',
  creator_premium_subscription_idempotency_in_progress: 'La suscripción todavía se está confirmando. Espera y actualiza antes de reintentar.',
  creator_premium_financial_readback_stale: 'La pantalla cambió mientras confirmábamos la operación. Actualiza para ver el estado real.',
  creator_premium_purchase_readback_pending: 'La compra respondió, pero el acceso todavía no pudo confirmarse. Actualiza antes de reintentar.',
  creator_premium_subscription_readback_pending: 'La suscripción respondió, pero el periodo todavía no pudo confirmarse. Actualiza antes de reintentar.',
  creator_premium_cancellation_readback_pending: 'La cancelación respondió, pero el estado todavía no pudo confirmarse. Actualiza antes de reintentar.',
  creator_premium_auto_renewal_invalid_input: 'No pudimos validar los datos de renovación automática. Actualiza la suscripción antes de reintentar.',
  creator_premium_auto_renewal_snapshot_changed: 'El plan o el precio cambió. Revisa la información actualizada y confirma de nuevo la renovación automática.',
  creator_premium_auto_renewal_binding_invalid: 'No pudimos verificar el periodo pagado asociado. No se programó ningún cobro.',
  creator_premium_auto_renewal_idempotency_conflict: 'Este intento de renovación automática ya corresponde a otra configuración. Actualiza antes de reintentar.',
  creator_premium_auto_renewal_receipt_invalid: 'La respuesta de renovación automática no pudo verificarse. Conservamos el intento para evitar operaciones duplicadas.',
  creator_premium_auto_renewal_readback_pending: 'El servidor respondió, pero la app todavía no pudo confirmar el estado de renovación automática. Actualiza antes de reintentar.',
  creator_premium_auto_renewal_failed: 'No pudimos actualizar la renovación automática. No se movió BDAG.',
  creator_premium_subscription_not_found: 'La suscripción ya no está disponible. Actualiza antes de continuar.',
  creator_premium_refund_source_balance_insufficient: 'El reembolso no puede completarse hasta reconciliar los fondos de origen. No se aplicó una reversión parcial.',
  creator_premium_financial_history_integrity_failed: 'No pudimos verificar el historial financiero. No se modificó ningún saldo.',
  creator_premium_financial_integrity_failure: 'No pudimos verificar la integridad financiera. No se modificó ningún saldo.',
  creator_premium_purchase_receipt_invalid: 'La respuesta financiera de la compra no pudo verificarse. Conservamos el intento para comprobarlo sin duplicar el cobro.',
  creator_premium_subscription_receipt_invalid: 'La respuesta financiera de la suscripción no pudo verificarse. Conservamos el intento para comprobarlo sin duplicar el cobro.',
  creator_premium_renewal_receipt_invalid: 'La respuesta financiera de la renovación no pudo verificarse. Conservamos el intento para comprobarlo sin duplicar el cobro.',
  creator_premium_cancellation_receipt_invalid: 'La cancelación no pudo verificarse. Conservamos el intento para comprobarlo sin duplicar la operación.',
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

  return 'No pudimos completar la operación. Inténtalo de nuevo.';
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
  const known = CREATOR_PREMIUM_BLOCKER_COPY[message];
  if (known) return known;
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
