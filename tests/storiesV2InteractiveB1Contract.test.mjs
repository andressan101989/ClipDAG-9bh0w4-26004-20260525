import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const contractPath = new URL('../components/feature/storyInteractiveTypes.ts', import.meta.url);
// Absence is an assertion failure naming the missing behavior, not a module-load error.
const contract = existsSync(contractPath)
  ? await import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(readFileSync(contractPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText).toString('base64')}`)
  : {};
const parseDefinition = value => {
  assert.equal(typeof contract.parseStoryInteractiveDefinition, 'function', 'shared public definition parser must exist');
  return contract.parseStoryInteractiveDefinition(value);
};
const parseComposition = value => {
  assert.equal(typeof contract.parseStoryComposition, 'function', 'shared versioned composition parser must exist');
  return contract.parseStoryComposition(value);
};
const elementId = '12345678-1234-4123-8123-123456789abc';
const otherId = '12345678-1234-4123-8123-123456789abd';
const placement = { id: otherId, type: 'interactive', element_id: elementId, x: 0.25, y: 0.75, scale: 1, rotation: 0 };
const options = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }];
const definition = type => ({ version: 1, element_id: elementId, type, prompt: 'Pick one', ...(type === 'poll' || type === 'quiz' ? { options } : {}), ...(type === 'slider' || type === 'reaction' ? { emoji: '🔥' } : {}) });

for (const type of ['poll', 'slider', 'quiz', 'question', 'reaction']) {
  test(`public ${type} configuration round-trips without response data`, () => {
    assert.deepEqual(parseDefinition(definition(type)), definition(type));
  });
}

test('poll supports more than two options with stable unique IDs', () => {
  const input = { ...definition('poll'), options: [...options, { id: 'c', label: 'C' }] };
  assert.deepEqual(parseDefinition(input), input);
  for (const bad of [[], [options[0]], [...options, options[0]], Array.from({ length: 7 }, (_, i) => ({ id: `${i}`, label: `${i}` }))]) {
    assert.equal(parseDefinition({ ...input, options: bad }), null);
  }
});

test('text is trimmed and bounded before it can become public configuration', () => {
  assert.equal(parseDefinition({ ...definition('poll'), prompt: '  Choose  ' }).prompt, 'Choose');
  assert.equal(parseDefinition({ ...definition('poll'), options: [{ id: 'a', label: ' A ' }, options[1]] }).options[0].label, 'A');
  for (const prompt of ['', '  ', 'x'.repeat(201), '<script>', 'https://example.test', 'www.example.test', 'javascript:alert(1)']) {
    assert.equal(parseDefinition({ ...definition('question'), prompt }), null, prompt);
  }
  for (const label of ['', ' ', 'x'.repeat(81), '<b>', 'https://example.test']) {
    assert.equal(parseDefinition({ ...definition('quiz'), options: [{ id: 'a', label }, options[1]] }), null, label);
  }
  assert.ok(parseDefinition({ ...definition('question'), prompt: 'x'.repeat(200) }));
  assert.ok(parseDefinition({ ...definition('poll'), options: [{ id: 'a', label: 'x'.repeat(80) }, options[1]] }));
});

test('public definitions fail closed on private answers, identities, totals and arbitrary keys at every level', () => {
  for (const key of ['correct_option_id', 'correctOptionId', 'answer', 'answers', 'respondent_id', 'responses', 'counts', 'total', 'url', 'config', '__proto__']) {
    const input = JSON.parse(JSON.stringify(definition('quiz')));
    Object.defineProperty(input, key, { value: 'private', enumerable: true });
    assert.equal(parseDefinition(input), null, key);
    assert.equal(parseDefinition({ ...definition('quiz'), options: [{ ...options[0], [key]: 'private' }, options[1]] }), null, `option ${key}`);
  }
  assert.equal(parseDefinition({ ...definition('poll'), multiple: true }), null);
});

test('definition version, kind, IDs, required fields and finite JSON shapes are strict', () => {
  for (const input of [null, [], 'poll', {}, { ...definition('poll'), version: 2 }, { ...definition('poll'), version: '1' }, { ...definition('poll'), type: 'link' }, { ...definition('poll'), element_id: 'bad' }, { ...definition('poll'), options: 'A,B' }, { ...definition('poll'), options: [{ id: '', label: 'A' }, options[1]] }, { ...definition('poll'), options: [{ id: 'https://x.test', label: 'A' }, options[1]] }, { ...definition('slider'), emoji: 'https://x.test' }, { ...definition('reaction'), emoji: 'arbitrary text' }]) {
    assert.equal(parseDefinition(input), null);
  }
  const missing = definition('poll');
  delete missing.prompt;
  assert.equal(parseDefinition(missing), null);
});

const text = { id: elementId, type: 'text', text: 'Hello', color: '#FFFFFF', align: 'center', size: 'medium', x: 0.5, y: 0.5, scale: 1, rotation: 0 };
const sticker = { id: otherId, type: 'sticker', value: '🔥', x: 0.2, y: 0.3, scale: 0.5, rotation: -180 };

test('legacy static v1 and v2 composition share normalized geometry without changing version', () => {
  for (const version of [1, 2]) {
    assert.deepEqual(parseComposition({ version, elements: [text, sticker] }), { version, elements: [text, sticker] });
    assert.deepEqual(parseComposition({ version, elements: [] }), { version, elements: [] });
  }
  assert.deepEqual(parseComposition({ version: 2, elements: [placement] }), { version: 2, elements: [placement] });
  assert.equal(parseComposition({ version: 1, elements: [placement] }), null);
});

test('composition contains stable references only, never definitions, answers or authoritative results', () => {
  for (const key of ['prompt', 'options', 'correct_option_id', 'respondent_id', 'counts', 'total', 'url', 'unknown']) {
    assert.equal(parseComposition({ version: 2, elements: [{ ...placement, [key]: 'private' }] }), null, key);
    assert.equal(parseComposition({ version: 2, elements: [placement], [key]: 'private' }), null, `root ${key}`);
  }
  assert.equal(parseComposition({ version: 2, elements: [definition('poll')] }), null);
  assert.equal(parseComposition({ version: 2, elements: [{ ...placement, element_id: 'bad' }] }), null);
});

test('invalid placement fails closed instead of coercing nonfinite or out-of-frame geometry', () => {
  for (const [key, values] of Object.entries({ x: [-0.01, 1.01, NaN, Infinity, '0.5'], y: [-1, 2, null], scale: [0, 0.49, 4.01], rotation: [-181, 181] })) {
    for (const value of values) assert.equal(parseComposition({ version: 2, elements: [{ ...placement, [key]: value }] }), null, `${key}:${value}`);
  }
  assert.ok(parseComposition({ version: 2, elements: [{ ...placement, x: 0, y: 1, scale: 4, rotation: 180 }] }));
});

test('malformed, duplicate or excessive elements invalidate the whole composition', () => {
  for (const input of [null, [], {}, { version: 3, elements: [] }, { version: '2', elements: [] }, { version: 2, elements: {} }, { version: 2, elements: [null] }, { version: 2, elements: [{ ...text, type: 'link' }] }, { version: 2, elements: [text, text] }, { version: 2, elements: [placement, { ...placement, id: elementId }] }]) {
    assert.equal(parseComposition(input), null);
  }
  const unique = (element, i) => ({ ...element, id: `12345678-1234-4123-8123-${i.toString(16).padStart(12, '0')}` });
  assert.equal(parseComposition({ version: 1, elements: Array.from({ length: 11 }, (_, i) => unique(text, i)) }), null);
  assert.equal(parseComposition({ version: 1, elements: Array.from({ length: 25 }, (_, i) => unique(sticker, i)) }), null);
  assert.equal(parseComposition({ version: 1, elements: [...Array.from({ length: 10 }, (_, i) => unique(text, i)), ...Array.from({ length: 23 }, (_, i) => unique(sticker, i + 10))] }), null);
});

test('static layers retain the legacy allowlist and bounded text', () => {
  assert.equal(parseComposition({ version: 1, elements: [{ ...text, text: '  Hello  ' }] }).elements[0].text, 'Hello');
  for (const change of [{ text: '' }, { text: 'x'.repeat(201) }, { text: '<script>' }, { color: 'red' }, { align: 'justify' }, { size: 'huge' }, { url: 'https://x.test' }]) {
    assert.equal(parseComposition({ version: 1, elements: [{ ...text, ...change }] }), null);
  }
  assert.equal(parseComposition({ version: 1, elements: [{ ...sticker, value: 'https://x.test' }] }), null);
});

test('static enum fields reject coercible arrays instead of emitting invalid JSON types', () => {
  assert.equal(parseComposition({ version: 1, elements: [{ ...text, align: ['center'] }] }), null);
  assert.equal(parseComposition({ version: 1, elements: [{ ...text, size: ['medium'] }] }), null);
});
