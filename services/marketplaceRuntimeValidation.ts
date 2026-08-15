export class MarketplacePayloadError extends Error {
  constructor(public readonly path: string) {
    super(`marketplace_payload_invalid:${path}`);
    this.name = 'MarketplacePayloadError';
  }
}

const fail = (path: string): never => { throw new MarketplacePayloadError(path); };
export const rpcObject = (value: unknown, path = 'payload'): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : fail(path);
export const rpcArray = (value: unknown, path = 'payload'): unknown[] =>
  Array.isArray(value) ? value : fail(path);
export const rpcString = (value: unknown, path: string): string =>
  typeof value === 'string' && value.length > 0 && value !== 'undefined' && value !== 'null'
    ? value : fail(path);
export const rpcNullableString = (value: unknown, path: string): string | null =>
  value === null ? null : rpcString(value, path);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const rpcUuid = (value: unknown, path: string): string => {
  const result = rpcString(value, path);
  return UUID.test(result) ? result : fail(path);
};
export const rpcNullableUuid = (value: unknown, path: string): string | null =>
  value === null ? null : rpcUuid(value, path);
export const rpcFinite = (value: unknown, path: string): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fail(path);
export const rpcNonnegative = (value: unknown, path: string): number => {
  const result = rpcFinite(value, path);
  return result >= 0 ? result : fail(path);
};
export const rpcNonnegativeInteger = (value: unknown, path: string): number => {
  const result = rpcNonnegative(value, path);
  return Number.isInteger(result) ? result : fail(path);
};
export const rpcNullableNonnegative = (value: unknown, path: string): number | null =>
  value === null ? null : rpcNonnegative(value, path);
export const rpcTimestamp = (value: unknown, path: string): string => {
  const result = rpcString(value, path);
  return Number.isFinite(Date.parse(result)) ? result : fail(path);
};
export const rpcNullableTimestamp = (value: unknown, path: string): string | null =>
  value === null ? null : rpcTimestamp(value, path);
export const rpcBoolean = (value: unknown, path: string): boolean =>
  typeof value === 'boolean' ? value : fail(path);
export const rpcEnum = <T extends string>(value: unknown, allowed: readonly T[], path: string): T =>
  typeof value === 'string' && allowed.includes(value as T) ? value as T : fail(path);
export const rpcStringArray = (value: unknown, path: string): string[] =>
  rpcArray(value, path).map((entry, index) => rpcString(entry, `${path}[${index}]`));

export interface RpcCursorPage {
  items: unknown[];
  pageSize: number;
  nextCursor: Record<string, unknown> | null;
}
export const rpcCursorPage = (value: unknown, path = 'page'): RpcCursorPage => {
  const row = rpcObject(value, path);
  const items = rpcArray(row.items, `${path}.items`);
  const pageSize = rpcNonnegativeInteger(row.page_size, `${path}.page_size`);
  if (pageSize !== items.length || pageSize > 100) fail(`${path}.page_size`);
  const nextCursor = row.next_cursor === null ? null : rpcObject(row.next_cursor, `${path}.next_cursor`);
  return { items, pageSize, nextCursor };
};
