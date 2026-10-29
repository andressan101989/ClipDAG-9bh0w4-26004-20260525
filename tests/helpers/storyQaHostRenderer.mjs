import React from 'react';
import Reconciler from 'react-reconciler';
import { DefaultEventPriority } from 'react-reconciler/constants.js';

// Real React state/effects with a small native host boundary; no component/hooks are replaced.
const append = (parent, child) => { parent.children.push(child); };
const remove = (parent, child) => { parent.children = parent.children.filter(item => item !== child); };
const renderer = Reconciler({
  supportsMutation: true, isPrimaryRenderer: true,
  getRootHostContext: () => ({}), getChildHostContext: parent => parent,
  createInstance: (type, props) => ({ type, props, children: [] }),
  createTextInstance: text => ({ text }),
  appendInitialChild: append, appendChild: append, appendChildToContainer: append,
  removeChild: remove, removeChildFromContainer: remove,
  insertBefore: (parent, child, before) => { remove(parent, child); parent.children.splice(parent.children.indexOf(before), 0, child); },
  finalizeInitialChildren: () => false, shouldSetTextContent: () => false,
  prepareForCommit: () => null, resetAfterCommit() {},
  commitUpdate: (node, type, oldProps, newProps) => { node.props = newProps; },
  commitTextUpdate: (node, oldText, newText) => { node.text = newText; },
  clearContainer: container => { container.children = []; },
  getPublicInstance: node => node,
  scheduleTimeout: setTimeout, cancelTimeout: clearTimeout, noTimeout: -1,
  getCurrentUpdatePriority: () => DefaultEventPriority,
  resolveUpdatePriority: () => DefaultEventPriority, setCurrentUpdatePriority() {},
  maySuspendCommit: () => false, preloadInstance: () => true,
  startSuspendingCommit() {}, suspendInstance() {}, waitForCommitToBeReady: () => null,
  NotPendingTransition: null, HostTransitionContext: React.createContext(null),
  resetFormInstance() {}, requestPostPaintCallback: callback => setTimeout(callback),
  detachDeletedInstance() {},
  hideInstance() {}, unhideInstance() {}, hideTextInstance() {}, unhideTextInstance() {},
});

export async function mount(Component, props = {}, options = {}) {
  const container = { children: [] };
  let thrown;
  const root = renderer.createContainer(container, 1, null, Boolean(options.strict), null, '', error => { thrown = error; }, error => { thrown = error; }, () => {});
  const flush = async action => {
    if (action) renderer.flushSyncFromReconciler(action);
    for (let turn = 0; turn < 4; turn += 1) {
      renderer.flushPassiveEffects();
      await new Promise(resolve => setImmediate(resolve));
      renderer.flushSyncFromReconciler(() => {});
    }
    renderer.flushPassiveEffects();
    if (thrown) throw thrown;
  };
  await flush(() => renderer.updateContainer(React.createElement(Component, props), root, null, null));
  const nodes = () => {
    const result = [];
    const visit = node => { result.push(node); node.children?.forEach(visit); };
    container.children.forEach(visit);
    return result;
  };
  return {
    nodes, flush,
    find: predicate => nodes().find(predicate),
    update: async next => { props = next; await flush(() => renderer.updateContainer(React.createElement(Component, props), root, null, null)); },
    unmount: () => flush(() => renderer.updateContainer(null, root, null, null)),
  };
}
