import { getSupabaseClient } from '@/template';

export type PublicationScheduleState = 'scheduled' | 'claimed' | 'materializing' | 'publishing'
  | 'published' | 'retryable_failed' | 'terminal_failed' | 'cancelled';
export interface PublicationSchedule {
  id: string; draftId: string; draftRevision: number; state: PublicationScheduleState;
  revision: number; generation: number; scheduledFor: string; timezoneName: string;
  localScheduledAt: string; utcOffsetMinutes: number | null; attemptCount: number;
  maxAttempts: number; nextAttemptAt: string; retryable: boolean; lastErrorCode: string | null;
  postId: string | null; createdAt: string; updatedAt: string;
}
export interface PublicationSchedulePage {
  items: PublicationSchedule[];
  nextCursor: { createdAt: string; id: string } | null;
}
export interface PublicationScheduleTime {
  localScheduledAt: string; timezoneName: string; utcOffsetMinutes?: number | null;
}
export interface PublicationScheduleCommand {
  scheduleId: string; expectedRevision: number; clientCommandId: string; signal?: AbortSignal;
}
export type SchedulePublicationDraftInput = PublicationScheduleTime & {
  draftId: string; expectedRevision: number; clientCommandId: string; signal?: AbortSignal;
};
export type ReschedulePublicationInput = PublicationScheduleCommand & PublicationScheduleTime;
export interface ListPublicationSchedulesInput {
  limit?: number; cursor?: PublicationSchedulePage['nextCursor']; signal?: AbortSignal;
}
export type PublicationScheduleErrorCode = 'invalid_input' | 'invalid_response' | 'auth' | 'forbidden'
  | 'conflict' | 'invalid_time' | 'stale_revision' | 'retry_forbidden' | 'aborted' | 'unknown';
const messages: Record<PublicationScheduleErrorCode, string> = {
  invalid_input: 'Revisa los datos de programación.', invalid_response: 'No se pudo confirmar la respuesta. Reintenta la misma acción.',
  auth: 'Inicia sesión para gestionar tus publicaciones.', forbidden: 'Esta publicación no está disponible en tu cuenta.',
  conflict: 'La acción entra en conflicto con otra programación. Actualiza la lista.',
  invalid_time: 'La fecha, zona o desfase no son válidos o están fuera del plazo permitido.',
  stale_revision: 'La publicación cambió. Actualiza la lista antes de continuar.',
  retry_forbidden: 'El servidor no permite reintentar esta publicación.',
  aborted: 'La solicitud se interrumpió. Reintenta la misma acción.', unknown: 'No se pudo confirmar la acción. Reintenta la misma acción.',
};
export class PublicationScheduleError extends Error {
  constructor(public readonly code: PublicationScheduleErrorCode, public readonly outcomeKnown = true) {
    super(messages[code]); this.name = 'PublicationScheduleError';
  }
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const wallPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?$/;
const utcPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const states: PublicationScheduleState[] = ['scheduled','claimed','materializing','publishing','published','retryable_failed','terminal_failed','cancelled'];
const fields = ['id','draft_id','draft_revision','state','revision','generation','scheduled_for','timezone_name',
  'local_scheduled_at','utc_offset_minutes','attempt_count','max_attempts','next_attempt_at','retryable',
  'last_error_code','post_id','created_at','updated_at'];
function invalid(): never { throw new PublicationScheduleError('invalid_input'); }
function uuid(value: unknown): string { if (typeof value !== 'string' || !uuidPattern.test(value)) invalid(); return value; }
function positive(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) invalid(); return value; }
function wall(value: unknown): string {
  if (typeof value !== 'string') invalid();
  const match = wallPattern.exec(value); if (!match) invalid();
  const [,y,m,d,h,minute,s = '0'] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31,leap ? 29 : 28,31,30,31,30,31,31,30,31,30,31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]
    || Number(h) > 23 || Number(minute) > 59 || Number(s) > 59) invalid();
  return value;
}
function zone(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 128 || /^[+-]/.test(value)) invalid();
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); } catch { invalid(); }
  return value;
}
function offset(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < -840 || value > 840) invalid();
  return value;
}
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !utcPattern.test(value) || !Number.isFinite(Date.parse(value))) invalid();
  wall(value.slice(0,-1)); return value;
}
function parseSchedule(value: unknown): PublicationSchedule {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
    const r = value as Record<string, unknown>;
    if (Object.keys(r).length !== fields.length || fields.some(key => !Object.hasOwn(r,key))) invalid();
    if (!states.includes(r.state as PublicationScheduleState) || typeof r.retryable !== 'boolean'
      || r.utc_offset_minutes === undefined) invalid();
    const attempts = r.attempt_count, max = positive(r.max_attempts);
    if (typeof attempts !== 'number' || !Number.isInteger(attempts) || attempts < 0 || attempts > max || max > 5) invalid();
    if (r.last_error_code !== null && (typeof r.last_error_code !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(r.last_error_code))) invalid();
    if ((r.state === 'published') !== (r.post_id !== null)
      || (r.retryable && (r.state !== 'retryable_failed' || attempts >= max))) invalid();
    return {
      id: uuid(r.id), draftId: uuid(r.draft_id), draftRevision: positive(r.draft_revision),
      state: r.state as PublicationScheduleState, revision: positive(r.revision), generation: positive(r.generation),
      scheduledFor: timestamp(r.scheduled_for), timezoneName: zone(r.timezone_name), localScheduledAt: wall(r.local_scheduled_at),
      utcOffsetMinutes: offset(r.utc_offset_minutes), attemptCount: attempts, maxAttempts: max,
      nextAttemptAt: timestamp(r.next_attempt_at), retryable: r.retryable,
      lastErrorCode: r.last_error_code as string | null, postId: r.post_id === null ? null : uuid(r.post_id),
      createdAt: timestamp(r.created_at), updatedAt: timestamp(r.updated_at),
    };
  } catch { throw new PublicationScheduleError('invalid_response', false); }
}
function sanitized(error: unknown): PublicationScheduleError {
  if (error instanceof PublicationScheduleError) return error;
  const e = error && typeof error === 'object' ? error as { message?: unknown; code?: unknown; name?: unknown } : {};
  if (e.name === 'AbortError') return new PublicationScheduleError('aborted',false);
  const known: Record<string, PublicationScheduleErrorCode> = {
    publication_auth_required: 'auth', publication_schedule_not_found: 'forbidden', publication_draft_not_found: 'forbidden',
    publication_asset_set_invalid: 'invalid_input', publication_asset_not_ready_or_owned: 'forbidden',
    publication_schedule_conflict: 'stale_revision', publication_draft_conflict: 'stale_revision',
    publication_draft_revision_conflict: 'stale_revision', publication_schedule_command_conflict: 'conflict',
    publication_schedule_exists: 'conflict', publication_schedule_time_invalid: 'invalid_time',
    publication_schedule_time_invalid_or_ambiguous: 'invalid_time', publication_schedule_time_bounds: 'invalid_time',
    publication_schedule_retry_forbidden: 'retry_forbidden', publication_schedule_input_invalid: 'invalid_input',
    publication_schedule_cursor_invalid: 'invalid_input',
  };
  const code = typeof e.message === 'string' && Object.hasOwn(known,e.message) ? known[e.message] : undefined;
  if (code) return new PublicationScheduleError(code);
  if (e.code === 'PGRST301' || e.code === 'PGRST302') return new PublicationScheduleError('auth');
  return new PublicationScheduleError('unknown',false);
}
function checkAbort(signal?: AbortSignal): void { if (signal?.aborted) throw new PublicationScheduleError('aborted',false); }
async function rpc(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  checkAbort(signal);
  try {
    const request = getSupabaseClient().rpc(name,args);
    const { data, error } = await (signal ? request.abortSignal(signal) : request);
    checkAbort(signal);
    if (error) throw error;
    return data;
  } catch (error) { checkAbort(signal); throw sanitized(error); }
}
function commandArgs(input: { expectedRevision: number; clientCommandId: string }): Record<string,unknown> {
  return { p_expected_revision: positive(input.expectedRevision), p_client_command_id: uuid(input.clientCommandId) };
}
function timeArgs(input: PublicationScheduleTime): Record<string,unknown> {
  return { p_local_scheduled_at: wall(input.localScheduledAt), p_timezone_name: zone(input.timezoneName),
    p_utc_offset_minutes: offset(input.utcOffsetMinutes) };
}
export async function schedulePublicationDraft(input: SchedulePublicationDraftInput): Promise<PublicationSchedule> {
  return parseSchedule(await rpc('schedule_my_publication_draft_v1', {
    p_draft_id: uuid(input.draftId), ...commandArgs(input), ...timeArgs(input),
  },input.signal));
}
export async function reschedulePublication(input: ReschedulePublicationInput): Promise<PublicationSchedule> {
  return parseSchedule(await rpc('reschedule_my_publication_v1', {
    p_schedule_id: uuid(input.scheduleId), ...commandArgs(input), ...timeArgs(input),
  },input.signal));
}
export async function cancelPublicationSchedule(input: PublicationScheduleCommand): Promise<PublicationSchedule> {
  return parseSchedule(await rpc('cancel_my_publication_schedule_v1', {
    p_schedule_id: uuid(input.scheduleId), ...commandArgs(input),
  },input.signal));
}
export async function retryPublicationSchedule(input: PublicationScheduleCommand): Promise<PublicationSchedule> {
  return parseSchedule(await rpc('retry_my_publication_schedule_v1', {
    p_schedule_id: uuid(input.scheduleId), ...commandArgs(input),
  },input.signal));
}
export async function listPublicationSchedules(input: ListPublicationSchedulesInput = {}): Promise<PublicationSchedulePage> {
  const limit = input.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) invalid();
  const cursor = input.cursor;
  const args = { p_limit: limit, p_before_created_at: cursor ? timestamp(cursor.createdAt) : null,
    p_before_id: cursor ? uuid(cursor.id) : null };
  const data = await rpc('list_my_publication_schedules_v1',args,input.signal);
  if (!Array.isArray(data) || data.length > limit) throw new PublicationScheduleError('invalid_response',false);
  const items = data.map(parseSchedule), last = items.at(-1);
  return { items, nextCursor: items.length === limit && last ? { createdAt: last.createdAt, id: last.id } : null };
}
