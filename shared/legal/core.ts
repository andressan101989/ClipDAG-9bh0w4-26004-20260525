// Renderer-neutral legal contract. Do not import Node, React, Astro or Expo here.
export type LegalId = 'privacy' | 'terms';
export type LegalLocale = 'en' | 'es' | 'fr' | 'pt';
export type LegalStatus = 'pending_approval' | 'approved' | 'retired';
export type ContactId = 'support' | 'privacy' | 'legal' | 'copyright';

export type LegalBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'contact'; contactId: ContactId };
export type LegalSection = { id: string; title: string; blocks: LegalBlock[] };
export type LegalDocument = {
  id: LegalId;
  locale: LegalLocale;
  version: string;
  title: string;
  sections: LegalSection[];
};
export type LegalManifest = {
  brand: 'Nelyon';
  legalEntity: string | null;
  jurisdiction: string | null;
  address: string | null;
  contacts: Record<ContactId, { status: 'unverified' | 'verified'; value: string | null }>;
  documents: Record<LegalId, {
    status: LegalStatus;
    version: string | null;
    effectiveDate: string | null;
    lastUpdated: string | null;
    availableLocales: LegalLocale[];
  }>;
  routes: Record<LegalId, { mobile: string; web: string }>;
  legacyHub: { route: '/legal'; reviewRequired: string[] };
};

const ids: LegalId[] = ['privacy', 'terms'];
const locales: LegalLocale[] = ['en', 'es', 'fr', 'pt'];
const contacts: ContactId[] = ['support', 'privacy', 'legal', 'copyright'];
const statuses: LegalStatus[] = ['pending_approval', 'approved', 'retired'];
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
function fail(reason: string): never { throw new Error(`legal_${reason}`); }
const exactKeys = (value: Record<string, unknown>, expected: string[], name: string): void => {
  for (const key of expected) if (!(key in value)) fail(`${name}_${key}_missing`);
  for (const key of Object.keys(value)) if (!expected.includes(key)) fail(`${name}_unexpected_${key}`);
};
const text = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) fail(`${name}_invalid`);
  // Content is plain text. Renderers must also escape it normally.
  if (/[<>]/.test(value)) fail('unsafe_html');
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value)) fail('inline_contact');
  if (/\b(?:ClipDAG|OnSpace)\b/i.test(value)) fail('legacy_brand');
  return value;
};
const nullableText = (value: unknown, name: string): void => {
  if (value !== null) text(value, name);
};
const date = (value: unknown): void => {
  if (value === null) return;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('date_invalid');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail('date_invalid');
};

export function validateLegalManifest(value: unknown): asserts value is LegalManifest {
  if (!isObject(value)) fail('manifest_invalid');
  exactKeys(value, ['brand', 'legalEntity', 'jurisdiction', 'address', 'contacts', 'documents', 'routes', 'legacyHub'], 'manifest');
  if (value.brand !== 'Nelyon') fail('brand_invalid');
  for (const field of ['legalEntity', 'jurisdiction', 'address']) nullableText(value[field], field);
  if (!isObject(value.contacts)) fail('contacts_invalid');
  exactKeys(value.contacts, contacts, 'contacts');
  for (const id of contacts) {
    const item = value.contacts[id];
    if (!isObject(item)) fail(`contact_${id}_invalid`);
    exactKeys(item, ['status', 'value'], `contact_${id}`);
    if (!['verified', 'unverified'].includes(String(item.status))) fail('contact_status_invalid');
    if (item.status === 'verified') {
      if (typeof item.value !== 'string' || item.value !== item.value.trim() || !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(item.value)) fail('contact_value_invalid');
      if (/@(?:onspace\.ai|clipdag\.io)$/i.test(item.value as string)) fail('legacy_contact');
    } else if (item.value !== null) fail('contact_unverified_value');
  }
  if (!isObject(value.documents)) fail('documents_invalid');
  exactKeys(value.documents, ids, 'documents');
  for (const id of ids) {
    const doc = value.documents[id];
    if (!isObject(doc)) fail(`document_${id}_invalid`);
    exactKeys(doc, ['status', 'version', 'effectiveDate', 'lastUpdated', 'availableLocales'], `document_${id}`);
    if (!statuses.includes(doc.status as LegalStatus)) fail('status_invalid');
    nullableText(doc.version, 'version');
    date(doc.effectiveDate);
    date(doc.lastUpdated);
    if (!Array.isArray(doc.availableLocales) || doc.availableLocales.some((locale) => !locales.includes(locale as LegalLocale)) || new Set(doc.availableLocales).size !== doc.availableLocales.length) fail('locale_invalid');
    if (doc.status === 'approved' && (doc.version === null || doc.effectiveDate === null || doc.lastUpdated === null || doc.availableLocales.length === 0)) fail('approved_metadata_missing');
    if (doc.status === 'approved' && /^draft-/i.test(doc.version as string)) fail('draft_unapproved');
    if (doc.status === 'approved' && (value.legalEntity === null || value.jurisdiction === null || value.address === null)) fail('approved_identity_missing');
    if (typeof doc.effectiveDate === 'string' && typeof doc.lastUpdated === 'string' && doc.lastUpdated < doc.effectiveDate) fail('date_order_invalid');
  }
  if (!isObject(value.routes)) fail('routes_invalid');
  exactKeys(value.routes, ids, 'routes');
  const routeValues: string[] = [];
  for (const id of ids) {
    const route = value.routes[id];
    if (!isObject(route)) fail('route_invalid');
    exactKeys(route, ['mobile', 'web'], `route_${id}`);
    for (const platform of ['mobile', 'web']) {
      const path = route[platform];
      if (typeof path !== 'string' || !/^\/[a-z]+(?:-[a-z]+)*$/.test(path)) fail('route_invalid');
      routeValues.push(path);
    }
  }
  if (new Set(routeValues).size !== routeValues.length) fail('duplicate_route');
  const hub = value.legacyHub;
  if (!isObject(hub) || hub.route !== '/legal' || !Array.isArray(hub.reviewRequired)) fail('legacy_hub_invalid');
  const reviewRequired: unknown[] = hub.reviewRequired;
  const required = ['community', 'copyright', 'monetization', 'cookies'];
  if (reviewRequired.length !== required.length || !required.every((id) => reviewRequired.includes(id))) fail('legacy_hub_invalid');
}

export function validateLegalDocument(value: unknown): asserts value is LegalDocument {
  if (!isObject(value)) fail('document_invalid');
  exactKeys(value, ['id', 'locale', 'version', 'title', 'sections'], 'document');
  if (!ids.includes(value.id as LegalId)) fail('id_invalid');
  if (!locales.includes(value.locale as LegalLocale)) fail('locale_invalid');
  text(value.version, 'version');
  text(value.title, 'title');
  if (!Array.isArray(value.sections) || value.sections.length === 0) fail('sections_invalid');
  const seen = new Set<string>();
  for (const section of value.sections) {
    if (!isObject(section)) fail('section_invalid');
    exactKeys(section, ['id', 'title', 'blocks'], 'section');
    if (typeof section.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(section.id)) fail('section_id_invalid');
    if (seen.has(section.id)) fail('duplicate_section');
    seen.add(section.id);
    text(section.title, 'section_title');
    if (!Array.isArray(section.blocks) || section.blocks.length === 0) fail('blocks_invalid');
    for (const block of section.blocks) {
      if (!isObject(block)) fail('block_invalid');
      if (block.type === 'paragraph') {
        exactKeys(block, ['type', 'text'], 'block');
        text(block.text, 'paragraph');
      } else if (block.type === 'list') {
        exactKeys(block, ['type', 'items'], 'block');
        if (!Array.isArray(block.items) || block.items.length === 0) fail('list_invalid');
        block.items.forEach((item: unknown) => text(item, 'list_item'));
      } else if (block.type === 'contact') {
        exactKeys(block, ['type', 'contactId'], 'block');
        if (!contacts.includes(block.contactId as ContactId)) fail('contact_id_invalid');
      } else fail('block_type_invalid');
    }
  }
}

export function resolveLegalContact(manifest: unknown, id: ContactId): string | null {
  validateLegalManifest(manifest);
  if (!contacts.includes(id)) fail('contact_id_invalid');
  const contact = manifest.contacts[id];
  return contact.status === 'verified' ? contact.value : null;
}

export function resolveLegalDocument(manifest: unknown, content: readonly unknown[], id: LegalId, locale: string) {
  validateLegalManifest(manifest);
  if (!ids.includes(id)) fail('id_invalid');
  const meta = manifest.documents[id];
  if (meta.status !== 'approved') fail('not_approved');
  if (!locales.includes(locale as LegalLocale) || !meta.availableLocales.includes(locale as LegalLocale)) fail('locale_unavailable');
  const matches = content.filter((item) => isObject(item) && item.id === id && item.locale === locale);
  if (matches.length !== 1) fail('content_missing_or_duplicate');
  const document = matches[0];
  validateLegalDocument(document);
  if (document.version !== meta.version) fail('version_mismatch');
  const sections = document.sections.map((section) => {
    const blocks: (Exclude<LegalBlock, { type: 'contact' }> | { type: 'contact'; contactId: ContactId; value: string })[] = [];
    for (const block of section.blocks) {
      if (block.type === 'contact') {
        const value = resolveLegalContact(manifest, block.contactId);
        if (value === null) fail('contact_unverified');
        blocks.push({ ...block, value });
      } else blocks.push(block);
    }
    return { ...section, blocks };
  });
  return { id, locale: document.locale, title: document.title, version: document.version,
    effectiveDate: meta.effectiveDate, lastUpdated: meta.lastUpdated, sections,
    toc: sections.map(({ id: anchor, title }) => ({ id: anchor, title })),
    fingerprint: fingerprintLegalDocument(document) };
}

// A safe presentation boundary for both web and mobile. Pending or retired text is never returned.
export function getLegalPresentationState(manifest: unknown, content: readonly unknown[], id: LegalId, locale: string) {
  validateLegalManifest(manifest);
  if (!ids.includes(id)) fail('id_invalid');
  const status = manifest.documents[id].status;
  if (status === 'pending_approval') return { state: 'pending' } as const;
  if (status === 'retired') return { state: 'retired' } as const;
  return { state: 'approved', document: resolveLegalDocument(manifest, content, id, locale) } as const;
}

// Portable, deterministic change fingerprint (not a cryptographic signature).
// Includes document identity, locale, version, title and every content block.
export function fingerprintLegalDocument(value: unknown): string {
  validateLegalDocument(value);
  const stable = (item: unknown): string => Array.isArray(item)
    ? `[${item.map(stable).join(',')}]`
    : isObject(item)
      ? `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${stable(item[key])}`).join(',')}}`
      : JSON.stringify(item);
  const source = stable(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i += 1) hash = Math.imul(hash ^ source.charCodeAt(i), 0x01000193);
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
