export const classifyHeadError = error => {
  const status = error?.$metadata?.httpStatusCode ?? error?.statusCode;
  if (status === 404 || error?.name === 'NoSuchKey' || error?.name === 'NotFound') return 'missing';
  if ([429, 500, 502, 503, 504].includes(status) || ['TimeoutError', 'AbortError'].includes(error?.name)) {
    return 'transient';
  }
  return 'transient';
};

export async function headWithRetry(head, wait = async () => {}, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await head();
    } catch (error) {
      if (classifyHeadError(error) === 'missing') throw error;
      lastError = error;
      if (attempt + 1 < attempts) await wait(150 * (2 ** attempt));
    }
  }
  throw lastError;
}

export class CleanupQueue {
  constructor() {
    this.rows = new Map();
  }
  add(row) {
    this.rows.set(row.id, { cleanupAttempts: 0, status: 'delete_pending', ...row });
  }
  async cycle(remove) {
    for (const row of this.rows.values()) {
      if (row.status !== 'delete_pending') continue;
      row.cleanupAttempts += 1;
      try {
        await remove(row);
        row.status = 'deleted';
      } catch {
        row.errorCode = 'delete_retry_required';
      }
    }
  }
}

export const findOrphans = (assets, linkedIds, now) => assets.filter(asset =>
  asset.status === 'ready'
  && now - asset.createdAt >= 24 * 60 * 60 * 1000
  && !linkedIds.has(asset.id)
);

export const canLinkEntity = async ({ type, entityId, userId, lookup }) => {
  if (type === 'user_profile') return entityId === userId;
  const columns = {
    video_post: ['videos', 'user_id'],
    story: ['stories', 'user_id'],
    shop_product: ['products', 'seller_id'],
    exclusive_content: ['exclusive_content', 'creator_id'],
  };
  if (!columns[type]) return false;
  const [table, ownerColumn] = columns[type];
  const row = await lookup(table, entityId);
  return Boolean(row && row[ownerColumn] === userId);
};

export async function compensate(ids, remove) {
  await Promise.all(ids.map(id => remove(id).catch(() => undefined)));
}

export class DraftAssets {
  constructor(remove) {
    this.remove = remove;
    this.ids = new Set();
  }
  add(id) { this.ids.add(id); }
  linked(id) { this.ids.delete(id); }
  async abandon() {
    const ids = [...this.ids];
    this.ids.clear();
    await compensate(ids, this.remove);
  }
}
