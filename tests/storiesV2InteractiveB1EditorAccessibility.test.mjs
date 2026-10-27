import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const editor = read('../components/feature/StoryEditor.tsx');
const element = read('../components/feature/StoryInteractiveElement.tsx');
const sheet = read('../components/feature/StoryInteractiveEditorSheet.tsx');
const context = read('../contexts/StoriesContext.tsx');
const feed = read('../app/(tabs)/index.tsx');

test('one editor owns a full-media measured stage with overlay chrome and safe insets', () => {
  assert.match(editor, /onLayout=\{handleStageLayout\}/);
  assert.match(editor, /StyleSheet\.absoluteFill/);
  assert.match(editor, /safeInsets/);
  assert.match(editor, /position: 'absolute'/);
  assert.doesNotMatch(editor, /screenHeight - headerHeight - toolbarHeight/);
  assert.doesNotMatch(editor, /Math\.max\(360/);
});

test('interactive authoring is an internal accessible sheet, never a second editor', () => {
  assert.match(editor, /<StoryInteractiveEditorSheet/);
  assert.match(sheet, /KeyboardAvoidingView/);
  assert.match(sheet, /ScrollView/);
  assert.match(sheet, /poll|slider|quiz|question|reaction/);
  assert.match(sheet, /minHeight: 44/);
  assert.equal((editor.match(/export function StoryEditor/g) ?? []).length, 1);
});

test('element has touch-transparent preview and accessible transform/layer alternatives', () => {
  assert.match(element, /pointerEvents="none"/);
  assert.match(editor, /accessibilityActions/);
  assert.match(editor, /currentTouches\.length >= 2 && start\.current\.touches\.length < 2/);
  assert.match(editor, /currentTouches\.length === 1 && start\.current\.touches\.length >= 2/);
  for (const action of ['Mover arriba', 'Mover abajo', 'Mover a la izquierda', 'Mover a la derecha', 'Aumentar', 'Reducir', 'Girar', 'Traer al frente', 'Enviar al fondo', 'Editar', 'Eliminar']) {
    assert.ok(editor.includes(action), action);
  }
  assert.match(editor, /width: 44/);
  assert.match(editor, /height: 44/);
});

test('selected elements expose visible 44px layer controls backed by the same array authority', () => {
  assert.match(editor, /accessibilityLabel="Enviar elemento al fondo"/);
  assert.match(editor, /accessibilityLabel="Traer elemento al frente"/);
  assert.match(editor, /reorderStoryLayer\(composition\.elements, selected\.id, 'back'\)/);
  assert.match(editor, /reorderStoryLayer\(composition\.elements, selected\.id, 'front'\)/);
  assert.match(editor, /layerAction: \{ minWidth: 44, height: 44/);
});

test('publication envelope is handed through feed and the existing context RPCs', () => {
  assert.match(editor, /StoryEditorPublication/);
  assert.match(editor, /buildStoryInteractivePublication/);
  assert.match(feed, /publication: StoryEditorPublication/);
  assert.match(feed, /publication\.interactiveDefinitions/);
  assert.match(context, /p_interactive_definitions: interactiveDefinitions/);
  assert.equal((context.match(/p_interactive_definitions:/g) ?? []).length, 2);
});

test('presentational interactive components have no persistence or service authority', () => {
  assert.doesNotMatch(element + sheet, /supabase|@\/services|\.rpc\(|\.from\(/i);
  assert.doesNotMatch(element + sheet, /correct_option_id/);
});
