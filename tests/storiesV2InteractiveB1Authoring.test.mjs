import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const contractPath = new URL('../components/feature/storyInteractiveTypes.ts', import.meta.url);
const contract = await import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(readFileSync(contractPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString('base64')}`);
const placementId = '12345678-1234-4123-8123-123456789aba';
const elementId = '12345678-1234-4123-8123-123456789abc';
const secondId = '12345678-1234-4123-8123-123456789abd';
const placement = { id: placementId, type: 'interactive', element_id: elementId, x: 0.5, y: 0.5, scale: 1, rotation: 0 };
const options = [{ id: 'option-a', label: 'A' }, { id: 'option-b', label: 'B' }];
const definition = type => ({ version: 1, element_id: elementId, type, prompt: 'Pregunta', ...(type === 'poll' || type === 'quiz' ? { options } : {}), ...(type === 'slider' || type === 'reaction' ? { emoji: '🔥' } : {}) });

test('authoring supports all five kinds and preserves stable option IDs', () => {
  for (const type of ['poll', 'slider', 'quiz', 'question', 'reaction']) {
    assert.ok(contract.parseStoryInteractiveDefinition(definition(type)));
  }
  const draft = { definition: definition('poll'), correctOptionId: null };
  const changed = { ...draft, definition: { ...draft.definition, options: draft.definition.options.map(option => option.id === 'option-a' ? { ...option, label: 'Changed' } : option) } };
  assert.deepEqual(changed.definition.options.map(option => option.id), ['option-a', 'option-b']);
});

test('publication enforces exact placement-definition sets and rejects duplicates or orphans', () => {
  const composition = { version: 2, elements: [placement] };
  const draft = { definition: definition('poll'), correctOptionId: null };
  assert.ok(contract.buildStoryInteractivePublication(composition, [draft]));
  assert.equal(contract.buildStoryInteractivePublication(composition, []), null);
  assert.equal(contract.buildStoryInteractivePublication({ version: 2, elements: [] }, [draft]), null);
  assert.equal(contract.buildStoryInteractivePublication(composition, [draft, draft]), null);
  assert.equal(contract.buildStoryInteractivePublication({ version: 2, elements: [placement, { ...placement, id: secondId }] }, [draft]), null);
});

test('quiz answer remains private to the RPC envelope and is validated against stable options', () => {
  const composition = { version: 2, elements: [placement] };
  const draft = { definition: definition('quiz'), correctOptionId: 'option-b' };
  const publication = contract.buildStoryInteractivePublication(composition, [draft]);
  assert.equal(publication.interactiveDefinitions[0].correct_option_id, 'option-b');
  assert.equal(JSON.stringify(publication.composition).includes('correct'), false);
  assert.equal(JSON.stringify(draft.definition).includes('correct'), false);
  assert.equal(contract.parseStoryInteractiveDefinition(publication.interactiveDefinitions[0]), null, 'private answer cannot round-trip through public parser');
  assert.equal(contract.buildStoryInteractivePublication(composition, [{ ...draft, correctOptionId: 'missing' }]), null);
  assert.equal(contract.buildStoryInteractivePublication(composition, [{ definition: definition('poll'), correctOptionId: 'option-a' }]), null);
});

test('static drafts stay v1, first interaction promotes to v2, removing all returns v1', () => {
  const staticElement = { id: secondId, type: 'sticker', value: '🔥', x: 0.2, y: 0.2, scale: 1, rotation: 0 };
  assert.equal(contract.normalizeStoryCompositionVersion({ version: 2, elements: [staticElement] }).version, 1);
  assert.equal(contract.normalizeStoryCompositionVersion({ version: 1, elements: [staticElement, placement] }).version, 2);
  assert.equal(contract.normalizeStoryCompositionVersion({ version: 2, elements: [staticElement] }).version, 1);
});

test('publication ordering follows placement layer order and retry identity is unchanged', () => {
  const secondPlacement = { ...placement, id: secondId, element_id: secondId };
  const firstDraft = { definition: definition('poll'), correctOptionId: null };
  const secondDraft = { definition: { ...definition('question'), element_id: secondId }, correctOptionId: null };
  const publication = contract.buildStoryInteractivePublication({ version: 2, elements: [secondPlacement, placement] }, [firstDraft, secondDraft]);
  assert.deepEqual(publication.interactiveDefinitions.map(item => item.element_id), [secondId, elementId]);
  assert.equal(publication.composition.elements[0].id, secondId);
});
