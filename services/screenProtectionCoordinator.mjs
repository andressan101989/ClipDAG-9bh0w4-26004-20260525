function validOwner(owner) {
  if (typeof owner !== 'string' || owner.trim().length === 0) {
    throw new Error('screen_protection_owner_required');
  }
  return owner;
}

export function createAppSwitcherProtectionCoordinator(adapter) {
  const claims = new Set();
  let queue = Promise.resolve();

  function serialized(operation) {
    const result = queue.then(operation, operation);
    queue = result.catch(() => undefined);
    return result;
  }

  return {
    acquire(owner) {
      const normalized = validOwner(owner);
      return serialized(async () => {
        if (claims.has(normalized)) return;
        if (claims.size === 0) await adapter.enable();
        claims.add(normalized);
      });
    },

    release(owner) {
      const normalized = validOwner(owner);
      return serialized(async () => {
        if (!claims.has(normalized)) return;
        if (claims.size > 1) {
          claims.delete(normalized);
          return;
        }
        await adapter.disable();
        claims.delete(normalized);
      });
    },

    releaseAllForOwner(owner) {
      return this.release(owner);
    },

    has(owner) {
      return claims.has(owner);
    },

    claimCount() {
      return claims.size;
    },
  };
}

let screenCaptureModule = null;

export function configureAppSwitcherProtectionModule(module) {
  if (!module
    || typeof module.enableAppSwitcherProtectionAsync !== 'function'
    || typeof module.disableAppSwitcherProtectionAsync !== 'function') {
    throw new Error('screen_protection_native_module_invalid');
  }
  if (!screenCaptureModule || appSwitcherProtectionCoordinator.claimCount() === 0) {
    screenCaptureModule = module;
  }
}

export const appSwitcherProtectionCoordinator = createAppSwitcherProtectionCoordinator({
  async enable() {
    if (!screenCaptureModule) throw new Error('screen_protection_native_unavailable');
    await screenCaptureModule.enableAppSwitcherProtectionAsync(1);
  },
  async disable() {
    if (!screenCaptureModule) throw new Error('screen_protection_native_unavailable');
    await screenCaptureModule.disableAppSwitcherProtectionAsync();
  },
});
