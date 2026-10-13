function isValidGeneration(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isValidSource(source) {
  return Boolean(
    source
      && typeof source.uri === 'string'
      && source.uri.length > 0
      && typeof source.contentId === 'string'
      && source.contentId.length > 0
      && typeof source.expiresAt === 'string'
      && source.expiresAt.length > 0,
  );
}

/**
 * Serializes every native-player command and invalidates awaited work eagerly.
 * The controller owns no durable state: the signed URI exists only in the
 * queued source object and in the native player until invalidation unloads it.
 */
export function createProtectedVideoCommandController(player) {
  let queue = Promise.resolve();
  let epoch = 0;
  let desiredGeneration = null;
  let loadedGeneration = null;
  let disposed = false;
  let disposePromise = null;

  const enqueue = operation => {
    const result = queue.then(operation, operation);
    queue = result.then(() => undefined, () => undefined);
    return result;
  };

  const isCurrent = (operationEpoch, generation) => (
    !disposed
    && epoch === operationEpoch
    && desiredGeneration === generation
  );

  const clearNativeSource = async () => {
    try {
      await Promise.resolve(player.pause());
    } finally {
      await player.replaceAsync(null);
    }
  };

  return {
    load(source, generation) {
      if (disposed || !isValidGeneration(generation) || !isValidSource(source)) {
        return Promise.resolve(false);
      }

      const operationEpoch = ++epoch;
      desiredGeneration = generation;
      loadedGeneration = null;

      return enqueue(async () => {
        if (!isCurrent(operationEpoch, generation)) return false;

        try {
          await player.replaceAsync({
            uri: source.uri,
            contentType: 'hls',
            useCaching: false,
          });
        } catch {
          if (isCurrent(operationEpoch, generation)) {
            desiredGeneration = null;
            loadedGeneration = null;
            epoch += 1;
          }
          await clearNativeSource().catch(() => undefined);
          return false;
        }

        if (!isCurrent(operationEpoch, generation)) {
          await clearNativeSource().catch(() => undefined);
          return false;
        }

        loadedGeneration = generation;
        return true;
      });
    },

    play(generation) {
      if (
        disposed
        || !isValidGeneration(generation)
        || desiredGeneration !== generation
      ) {
        return Promise.resolve(false);
      }

      const operationEpoch = epoch;
      return enqueue(async () => {
        if (
          !isCurrent(operationEpoch, generation)
          || loadedGeneration !== generation
        ) {
          return false;
        }

        try {
          await Promise.resolve(player.play());
        } catch {
          await Promise.resolve(player.pause()).catch(() => undefined);
          return false;
        }

        if (
          !isCurrent(operationEpoch, generation)
          || loadedGeneration !== generation
        ) {
          await Promise.resolve(player.pause()).catch(() => undefined);
          return false;
        }
        return true;
      });
    },

    pause() {
      return enqueue(async () => {
        await Promise.resolve(player.pause()).catch(() => undefined);
      });
    },

    invalidate(_reason) {
      if (disposed) return disposePromise ?? Promise.resolve();
      epoch += 1;
      desiredGeneration = null;
      loadedGeneration = null;
      return enqueue(async () => {
        await clearNativeSource().catch(() => undefined);
      });
    },

    dispose() {
      if (disposePromise) return disposePromise;
      disposed = true;
      epoch += 1;
      desiredGeneration = null;
      loadedGeneration = null;
      disposePromise = enqueue(async () => {
        await clearNativeSource().catch(() => undefined);
      });
      return disposePromise;
    },
  };
}
