const KEYS = ["title_configured", "price_configured", "category_configured"];

export function parseMarketplaceProductEditorFlags(editorState, publishedAt) {
  const state =
    editorState && typeof editorState === "object" && !Array.isArray(editorState)
      ? editorState
      : {};
  const legacyPublished = typeof publishedAt === "string" && publishedAt.length > 0;
  const read = (key) => {
    if (typeof state[key] === "boolean") return state[key];
    if (Object.prototype.hasOwnProperty.call(state, key))
      throw new Error("marketplace_draft_editor_state_invalid");
    return legacyPublished;
  };
  return {
    titleConfigured: read(KEYS[0]),
    priceConfigured: read(KEYS[1]),
    categoryConfigured: read(KEYS[2]),
  };
}
