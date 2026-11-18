import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
test('protected recovery success status uses its bound digest, not unrelated ordinary-release state',()=>{
 const source=fs.readFileSync(new URL('../scripts/nelyon-production-release.mjs',import.meta.url),'utf8');
 const start=source.indexOf("if (command === 'revalidate-b2-recovery'");const end=source.indexOf("if (command === 'revalidate' || command === 'preflight-release')",start);assert.ok(start>=0&&end>start);
 const branch=source.slice(start,end);const statement=branch.slice(branch.lastIndexOf('runtime.stdout.write('),branch.lastIndexOf('return 0;'));let output='';const digest='a'.repeat(64);
 vm.runInNewContext(statement,{digest,runtime:{stdout:{write:text=>{output+=text;}}}});
 assert.equal(output,'REVALIDATED '+digest+'\n');
});
