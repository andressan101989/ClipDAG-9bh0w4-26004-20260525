export async function publishLinkedMedia({
  items,
  upload,
  createEntity,
  linkAsset,
  deleteAsset,
  deleteEntity,
  slot,
}) {
  const completed = new Array(items.length);
  let entityId;
  try {
    await Promise.all(items.map(async (item, index) => {
      const uploaded = await upload(item, index);
      if (!uploaded?.assetId || !uploaded?.url) throw new Error('UPLOAD_FAILED');
      completed[index] = { ...uploaded, index };
    }));
    const ordered = completed.filter(Boolean).sort((a, b) => a.index - b.index);
    if (ordered.length !== items.length) throw new Error('UPLOAD_FAILED');
    entityId = await createEntity(ordered.map(item => item.url));
    if (!entityId) throw new Error('ENTITY_CREATE_FAILED');
    await Promise.all(ordered.map((item, position) =>
      linkAsset(item.assetId, entityId, slot, position)
    ));
    completed.fill(undefined);
    return { entityId, ordered };
  } catch (error) {
    if (entityId) await deleteEntity(entityId);
    await Promise.all(completed.filter(Boolean).map(item => deleteAsset(item.assetId)));
    throw error;
  }
}
