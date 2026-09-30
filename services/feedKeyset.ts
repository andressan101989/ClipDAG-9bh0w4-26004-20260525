export interface VideoKeysetCursor {
  createdAt: string;
  id: string;
}

export interface VideoKeysetRow {
  created_at: string;
  id: string;
}

export function cursorFromVideoRows(rows: readonly VideoKeysetRow[]): VideoKeysetCursor | null {
  const last = rows.at(-1);
  return last ? { createdAt: last.created_at, id: last.id } : null;
}

export function videoKeysetOrFilter(cursor: VideoKeysetCursor): string {
  return `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`;
}

export function isVideoOlderThanCursor(
  row: VideoKeysetRow,
  cursor: VideoKeysetCursor,
): boolean {
  const rowTime = Date.parse(row.created_at);
  const cursorTime = Date.parse(cursor.createdAt);
  if (rowTime !== cursorTime) return rowTime < cursorTime;
  return row.id < cursor.id;
}
