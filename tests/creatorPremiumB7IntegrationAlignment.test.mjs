import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

let contracts = null;
let loadError = null;

try {
  contracts = await import('../services/creatorPremiumIntegrationState.ts');
} catch (error) {
  loadError = error;
}

function api() {
  assert.ifError(loadError);
  assert.ok(contracts, 'Creator Premium integration state helpers must be available');
  return contracts;
}

const root = new URL('../', import.meta.url);
const hubSource = readFileSync(new URL('app/creator-monetization.tsx', root), 'utf8');
const editorSource = readFileSync(new URL('app/creator-premium-editor.tsx', root), 'utf8');

test('commercial summary failure is isolated from Content and Plans data', async () => {
  const { settleCreatorPremiumHubLoad } = api();
  const contentPage = { items: [{ id: 'content-1' }], nextCursor: null };
  const planPage = { items: [{ id: 'plan-1' }], nextCursor: null };
  const missingRpc = Object.assign(new Error('Could not find the function public.get_my_creator_premium_commercial_summary_v1'), {
    code: 'PGRST202',
  });

  const result = await settleCreatorPremiumHubLoad({
    content: async () => contentPage,
    plans: async () => planPage,
    summary: async () => { throw missingRpc; },
  });

  assert.equal(result.content.value, contentPage);
  assert.equal(result.content.error, null);
  assert.equal(result.plans.value, planPage);
  assert.equal(result.plans.error, null);
  assert.equal(result.summary.value, null, 'an unavailable summary must never be fabricated as zero');
  assert.equal(result.summary.error, missingRpc);
});

test('Content or Plans failures remain core load failures', async () => {
  const { settleCreatorPremiumHubLoad } = api();
  const contentFailure = new Error('content_failed');

  const result = await settleCreatorPremiumHubLoad({
    content: async () => { throw contentFailure; },
    plans: async () => ({ items: [], nextCursor: null }),
    summary: async () => ({ gross: '0' }),
  });

  assert.equal(result.content.value, null);
  assert.equal(result.content.error, contentFailure);
  assert.deepEqual(result.plans.value, { items: [], nextCursor: null });
  assert.deepEqual(result.summary.value, { gross: '0' });
});

test('editor blocks publication until selected image media is canonically uploaded and bound', () => {
  const { creatorPremiumSubmissionMediaBlocker } = api();

  assert.match(creatorPremiumSubmissionMediaBlocker({
    contentKind: 'image',
    mediaReady: false,
    hasPendingTeaser: true,
    hasPendingPrivate: true,
    verificationRetryable: false,
  }) ?? '', /Subir\/Reemplazar medios/i);

  assert.match(creatorPremiumSubmissionMediaBlocker({
    contentKind: 'image',
    mediaReady: true,
    hasPendingTeaser: false,
    hasPendingPrivate: true,
    verificationRetryable: false,
  }) ?? '', /vista previa/i, 'a partial replacement must not publish the previously bound pair');

  assert.equal(creatorPremiumSubmissionMediaBlocker({
    contentKind: 'image',
    mediaReady: true,
    hasPendingTeaser: false,
    hasPendingPrivate: false,
    verificationRetryable: false,
  }), null);

  const cases = [
    {
      name: 'video pending pair',
      input: { contentKind: 'video', mediaReady: false, hasPendingTeaser: true, hasPendingPrivate: true, verificationRetryable: false },
      expected: /Subir\/Reemplazar medios/i,
    },
    {
      name: 'video teaser without private original',
      input: { contentKind: 'video', mediaReady: true, hasPendingTeaser: true, hasPendingPrivate: false, verificationRetryable: false },
      expected: /video privado/i,
    },
    {
      name: 'video private original without teaser',
      input: { contentKind: 'video', mediaReady: true, hasPendingTeaser: false, hasPendingPrivate: true, verificationRetryable: false },
      expected: /vista previa/i,
    },
    {
      name: 'video without canonical media',
      input: { contentKind: 'video', mediaReady: false, hasPendingTeaser: false, hasPendingPrivate: false, verificationRetryable: false },
      expected: /video todavía se está procesando/i,
    },
  ];

  for (const { name, input, expected } of cases) {
    assert.match(creatorPremiumSubmissionMediaBlocker(input) ?? '', expected, name);
  }

  assert.equal(creatorPremiumSubmissionMediaBlocker({
    contentKind: 'video',
    mediaReady: true,
    hasPendingTeaser: false,
    hasPendingPrivate: false,
    verificationRetryable: false,
  }), null, 'canonically ready video may proceed without reupload');

  assert.equal(creatorPremiumSubmissionMediaBlocker({
    contentKind: 'video',
    mediaReady: false,
    hasPendingTeaser: false,
    hasPendingPrivate: false,
    verificationRetryable: true,
  }), null, 'verification retry delegates current-evidence validation to the canonical server RPC');
});

test('known server blockers and unavailable income use safe actionable copy', () => {
  const {
    creatorPremiumErrorMessage,
    creatorPremiumCommercialSummaryErrorMessage,
  } = api();

  assert.equal(
    creatorPremiumErrorMessage(new Error('creator_premium_image_media_not_ready')),
    'Falta completar la vista previa y la imagen privada.',
  );
  assert.doesNotMatch(
    creatorPremiumErrorMessage(new Error('creator_premium_unknown_internal_code')),
    /creator_premium_unknown_internal_code/,
  );
  assert.doesNotMatch(
    creatorPremiumErrorMessage({
      code: 'PGRST202',
      message: 'Could not find the function public.example_rpc in the schema cache',
    }),
    /function|schema cache|PGRST202/i,
    'PostgREST diagnostics must not be rendered as end-user copy',
  );
  assert.match(
    creatorPremiumCommercialSummaryErrorMessage({
      code: 'PGRST202',
      message: 'Could not find the function public.get_my_creator_premium_commercial_summary_v1',
    }),
    /Ingresos todavía no está disponible en este backend/i,
  );
});

test('Hub and editor call the tested alignment contracts in their real execution paths', () => {
  const loadBody = hubSource.slice(
    hubSource.indexOf('const load = useCallback'),
    hubSource.indexOf('const loadMoreContents'),
  );
  assert.match(loadBody, /settleCreatorPremiumHubLoad/);
  assert.match(loadBody, /creatorPremiumCommercialSummaryErrorMessage/);
  assert.doesNotMatch(loadBody, /Promise\.all\([\s\S]*fetchMyCreatorPremiumCommercialSummary/);

  const submitBody = editorSource.slice(
    editorSource.indexOf('const submit = useCallback'),
    editorSource.indexOf('const confirmDelete'),
  );
  const blockerIndex = submitBody.indexOf('creatorPremiumSubmissionMediaBlocker');
  const publishIndex = submitBody.indexOf('publishMyCreatorPremiumContent');
  assert.ok(blockerIndex >= 0 && publishIndex > blockerIndex, 'canonical media gate must run before publication');
});

test('Premium private video uses an icon supported by the installed MaterialCommunityIcons contract', () => {
  assert.doesNotMatch(editorSource, /video-lock-outline/);
  assert.match(editorSource, /file-lock-outline/);
});
