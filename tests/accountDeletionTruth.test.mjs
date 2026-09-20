import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { accountDeletionNotice } from '../shared/legal/accountDeletionNotice.ts';
import { legalDocuments } from '../shared/legal/manifest.ts';

test('both active settings surfaces show information, not a deletion confirmation', () => {
  assert.equal(accountDeletionNotice.effect, 'information_only');
  assert.match(accountDeletionNotice.message, /no elimina.*cuenta|no se elimina.*cuenta/i);
  assert.match(accountDeletionNotice.message, /(?:no|ni) env[ií]a.*solicitud/i);
  assert.doesNotMatch(Object.values(accountDeletionNotice).join(' '), /todos tus datos|todos tus videos|balance DAG.*elimin|48 horas|permanente e irreversible/i);
  for (const path of ['app/settings.tsx', 'app/account-settings.tsx']) {
    const source = readFileSync(path, 'utf8');
    assert.match(source, /accountDeletionNotice/);
    assert.doesNotMatch(source, /TODOS tus datos|Todos tus datos|balance DAG seran eliminados|Accion permanente e irreversible|Eliminar cuenta permanentemente/);
  }
  const privacy = legalDocuments.find((document) => document.id === 'privacy');
  const deletion = privacy.sections.find((section) => section.id === 'retention-deletion');
  assert.doesNotMatch(deletion.blocks[0].text, /currently promises deletion/i);
  assert.match(deletion.blocks[0].text, /does not delete|do not delete/i);
});
