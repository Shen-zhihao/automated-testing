// Coalesce bursts while allowing one trailing read to observe writes made in flight.
export function createRefreshQueue(load, accept, fail = () => {}) {
  let requested = false;
  let disposed = false;
  let pending = null;
  async function drain() {
    try {
      while (requested && !disposed) {
        requested = false;
        try {
          const value = await load();
          if (!disposed) accept(value);
        } catch (error) {
          if (!disposed) fail(error);
        }
      }
    } finally {
      pending = null;
    }
  }
  return {
    request() {
      if (disposed) return Promise.resolve();
      requested = true;
      pending ??= Promise.resolve().then(drain);
      return pending;
    },
    dispose() {
      disposed = true;
      requested = false;
    },
  };
}
