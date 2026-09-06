import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

function load(source, imports = {}, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  } }).outputText;
  Function('require', 'module', 'exports', ...Object.keys(globals), code)(
    name => { assert.ok(name in imports, `unexpected import: ${name}`); return imports[name]; },
    module,
    module.exports,
    ...Object.values(globals),
  );
  return module.exports;
}

function hookRunner() {
  const slots = [];
  let cursor = 0;
  let pending = [];
  const changed = (before, after) => !before
    || before.length !== after.length
    || before.some((value, index) => !Object.is(value, after[index]));
  const react = {
    useRef(value) {
      const index = cursor++;
      return slots[index] ??= { current: value };
    },
    useState(value) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof value === 'function' ? value() : value;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      if (!slots[index] || changed(slots[index].dependencies, dependencies)) {
        pending.push(() => {
          slots[index]?.cleanup?.();
          slots[index] = { dependencies, cleanup: effect() };
        });
      }
    },
  };
  return {
    react,
    render(renderHook) {
      cursor = 0;
      pending = [];
      const value = renderHook();
      pending.forEach(run => run());
      return value;
    },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

function harness() {
  const runner = hookRunner();
  const timers = new Map();
  let clock = 0;
  let sequence = 0;
  const props = {
    surface: 'remote-video',
    scope: { battleId: 'battle-1', roundNumber: 1, opponentId: 'opponent-1', enabled: true },
  };
  const module = load(read('hooks/live/useRemoteVideoPresentationGrace.ts'), { react: runner.react }, {
    setTimeout: (callback, delay) => {
      const id = ++sequence;
      timers.set(id, { callback, deadline: clock + delay, delay });
      return id;
    },
    clearTimeout: id => timers.delete(id),
  });
  const render = () => runner.render(() => module.useRemoteVideoPresentationGrace(props.surface, props.scope));
  render();
  return {
    module,
    props,
    timers,
    render,
    advance(milliseconds) {
      clock += milliseconds;
      for (const [id, timer] of [...timers]) {
        if (timer.deadline <= clock) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
    unmount: () => runner.unmount(),
  };
}

test('a confirmed surface survives a loss shorter than 700 ms without a placeholder', () => {
  const h = harness();
  h.props.surface = null;
  assert.equal(h.render(), 'remote-video');
  assert.equal([...h.timers.values()][0].delay, 700);
  h.advance(500);
  h.props.surface = 'remote-video';
  assert.equal(h.render(), 'remote-video');
  assert.equal(h.timers.size, 0);
  h.unmount();
});

test('recovery immediately before the boundary cancels the timer and keeps video', () => {
  const h = harness();
  h.props.surface = null;
  assert.equal(h.render(), 'remote-video');
  h.advance(699);
  h.props.surface = 'remote-video';
  assert.equal(h.render(), 'remote-video');
  assert.equal(h.timers.size, 0);
  h.advance(1);
  assert.equal(h.render(), 'remote-video');
  h.unmount();
});

test('a loss lasting exactly 700 ms exposes the existing placeholder', () => {
  const h = harness();
  h.props.surface = null;
  assert.equal(h.render(), 'remote-video');
  h.advance(h.module.REMOTE_VIDEO_PLACEHOLDER_GRACE_MS);
  assert.equal(h.render(), null);
  h.unmount();
});

test('recovery after the placeholder is visible restores video immediately', () => {
  const h = harness();
  h.props.surface = null;
  h.render();
  h.advance(700);
  assert.equal(h.render(), null);
  h.props.surface = 'remote-video';
  assert.equal(h.render(), 'remote-video');
  h.unmount();
});

test('changing rounds cancels the old timer and fences its callback', () => {
  const h = harness();
  h.props.surface = null;
  h.render();
  const oldTimer = [...h.timers.values()][0].callback;
  h.props.scope = { ...h.props.scope, battleId: 'battle-2', roundNumber: 2 };
  assert.equal(h.render(), 'remote-video');
  oldTimer();
  assert.equal(h.render(), 'remote-video');
  assert.equal(h.timers.size, 1);
  h.unmount();
});

test('an old rematch timer cannot alter the new battle', () => {
  const h = harness();
  h.props.surface = null;
  h.render();
  const oldTimer = [...h.timers.values()][0].callback;
  h.props.scope = { ...h.props.scope, battleId: 'battle-2', roundNumber: 2 };
  h.props.surface = 'remote-video-round-2';
  assert.equal(h.render(), 'remote-video-round-2');
  oldTimer();
  assert.equal(h.render(), 'remote-video-round-2');
  h.unmount();
});

test('closing the series clears timers and prevents later presentation updates', () => {
  const h = harness();
  h.props.surface = null;
  h.render();
  const oldTimer = [...h.timers.values()][0].callback;
  h.props.scope = { ...h.props.scope, enabled: false };
  assert.equal(h.render(), null);
  assert.equal(h.timers.size, 0);
  oldTimer();
  assert.equal(h.render(), null);
  h.unmount();
});

test('unmount cancels the timer and fences its callback', () => {
  const h = harness();
  h.props.surface = null;
  h.render();
  const oldTimer = [...h.timers.values()][0].callback;
  h.unmount();
  assert.equal(h.timers.size, 0);
  oldTimer();
  assert.equal(h.timers.size, 0);
});

test('a real disconnect shows the placeholder after the bounded grace', () => {
  const h = harness();
  h.props.surface = null;
  assert.equal(h.render(), 'remote-video');
  h.advance(701);
  assert.equal(h.render(), null);
  assert.equal(h.timers.size, 0);
  h.unmount();
});

test('a different opponent never receives the retained surface', () => {
  const h = harness();
  h.props.surface = null;
  h.props.scope = { battleId: 'battle-2', roundNumber: 1, opponentId: 'opponent-2', enabled: true };
  assert.equal(h.render(), null);
  assert.equal(h.timers.size, 0);
  h.unmount();
});

test('Stage applies the grace only to remote panels and keeps its existing placeholder', () => {
  const stage = read('components/live/LiveBattleStage.tsx');
  assert.match(stage, /useRemoteVideoPresentationGrace\(opponentSurface/);
  assert.match(stage, /useRemoteVideoPresentationGrace\(localSurface[\s\S]*enabled: viewerMode/);
  assert.match(stage, /accessibilityLabel=\{`\$\{label\} conectando`\}/);
  assert.doesNotMatch(stage, /key=\{(?:state\.)?battleId/);
});
