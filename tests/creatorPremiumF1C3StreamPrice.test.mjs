import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  canonicalCloudflareTusLocation,
  classifyCloudflareTusFailure,
} from '../supabase/functions/create-stream-upload/premiumTusContract.mjs';
import * as presentation from '../services/creatorPremiumPresentation.mjs';
import { creatorPremiumErrorMessage } from '../services/creatorPremiumIntegrationState.ts';

const root = new URL('../', import.meta.url);
const read = relative => readFileSync(new URL(relative, root), 'utf8');
const uid = '0123456789abcdef0123456789abcdef';

test('Cloudflare current and legacy direct-creator TUS hosts are accepted exactly', () => {
  for (const host of ['upload.cloudflarestream.com', 'upload.videodelivery.net']) {
    const location = `https://${host}/tus/${uid}?tusv2=true`;
    assert.equal(canonicalCloudflareTusLocation(location, uid), location);
  }

  for (const location of [
    `http://upload.cloudflarestream.com/tus/${uid}?tusv2=true`,
    `https://upload.cloudflarestream.com.evil.example/tus/${uid}?tusv2=true`,
    `https://upload.cloudflarestream.com:444/tus/${uid}?tusv2=true`,
    `https://user:pass@upload.cloudflarestream.com/tus/${uid}?tusv2=true`,
    `https://upload.cloudflarestream.com/tus/not-${uid}?tusv2=true`,
    `https://upload.cloudflarestream.com/tus/${uid}?token=secret`,
    `https://upload.cloudflarestream.com/tus/${uid}?tusv2=true#fragment`,
  ]) {
    assert.equal(canonicalCloudflareTusLocation(location, uid), null);
  }
  assert.equal(
    canonicalCloudflareTusLocation('https://upload.cloudflarestream.com/tus/short?tusv2=true', 'short'),
    null,
  );
});

test('provider failures preserve a safe retry/domain classification', () => {
  assert.deepEqual(classifyCloudflareTusFailure(401), {
    code: 'stream_provider_credentials_rejected', httpStatus: 502, transient: false,
  });
  assert.deepEqual(classifyCloudflareTusFailure(403), {
    code: 'stream_provider_credentials_rejected', httpStatus: 502, transient: false,
  });
  assert.deepEqual(classifyCloudflareTusFailure(413), {
    code: 'stream_provider_size_rejected', httpStatus: 400, transient: false,
  });
  for (const status of [408, 425, 429, 500, 502, 503]) {
    assert.deepEqual(classifyCloudflareTusFailure(status), {
      code: 'stream_provider_temporarily_unavailable', httpStatus: 503, transient: true,
    });
  }
});

test('provider domains render actionable copy without exposing infrastructure details', () => {
  assert.match(
    creatorPremiumErrorMessage(new Error('stream_provider_temporarily_unavailable')),
    /temporal|inténtalo/i,
  );
  assert.match(
    creatorPremiumErrorMessage(new Error('stream_provider_credentials_rejected')),
    /servicio de video/i,
  );
  assert.match(
    creatorPremiumErrorMessage(new Error('stream_provider_size_rejected')),
    /tamaño/i,
  );
  assert.doesNotMatch(
    creatorPremiumErrorMessage(new Error('stream_provider_invalid_response')),
    /stream_provider|Cloudflare|TUS/i,
  );
});

test('price input shows two Spanish decimals while untouched exact values round-trip unchanged', () => {
  assert.equal(presentation.formatCreatorPremiumPriceInput('2000.00000000'), '2000,00');
  assert.equal(presentation.formatCreatorPremiumPriceInput('2000.5'), '2000,50');
  assert.equal(presentation.formatCreatorPremiumPriceInput('1500'), '1500,00');
  assert.equal(presentation.formatCreatorPremiumPriceInput('1.23456789'), '1,23');

  assert.equal(presentation.resolveCreatorPremiumPriceSubmission({
    displayValue: '1,23', originalCanonical: '1.23456789', edited: false,
  }), '1.23456789');
  assert.equal(presentation.resolveCreatorPremiumPriceSubmission({
    displayValue: '2000,50', originalCanonical: '2000.00000000', edited: true,
  }), '2000.5');
  assert.equal(presentation.resolveCreatorPremiumPriceSubmission({
    displayValue: '2000', originalCanonical: null, edited: true,
  }), '2000');
  assert.throws(() => presentation.resolveCreatorPremiumPriceSubmission({
    displayValue: '0', originalCanonical: null, edited: true,
  }), /creator_premium_price_invalid/);
});

test('Edge and mobile share the current TUS host contract and log only safe provider metadata', () => {
  const edge = read('supabase/functions/create-stream-upload/index.ts');
  const client = read('services/streamService.ts');
  assert.match(edge, /premiumTusContract\.mjs/);
  assert.match(edge, /premium_stream_tus_provision_failed/);
  assert.doesNotMatch(edge, /console\.(?:log|error)\([^\n]*(?:uploadUrl|rawUploadUrl|Authorization)/);
  assert.match(client, /upload\.cloudflarestream\.com/);
  assert.match(client, /upload\.videodelivery\.net/);
});

test('editor never exposes numeric(20,8) storage text and preserves exact untouched price', () => {
  const editor = read('app/creator-premium-editor.tsx');
  assert.match(editor, /formatCreatorPremiumPriceInput/);
  assert.match(editor, /resolveCreatorPremiumPriceSubmission/);
  assert.doesNotMatch(editor, /setPrice\(found\.price_bdag === null \? '' : String\(found\.price_bdag\)\)/);
  assert.doesNotMatch(editor, /Number\([^\n]*(?:price|BDAG|bdag)/);
});
