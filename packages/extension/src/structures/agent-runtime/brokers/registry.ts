interface RequestRegistry<T> {
  readonly register: (id: string, settle: (value: T) => void) => void;
  readonly resolve: (id: string, value: T) => boolean;
  readonly cancelAll: (value: T) => void;
}

export function createRequestRegistry<T>(): RequestRegistry<T> {
  const pending = new Map<string, (value: T) => void>();
  return {
    register(id, settle) {
      pending.set(id, settle);
    },
    resolve(id, value) {
      const settle = pending.get(id);
      if (!settle) return false;
      pending.delete(id);
      settle(value);
      return true;
    },
    cancelAll(value) {
      const settlers = [...pending.values()];
      pending.clear();
      for (const settle of settlers) settle(value);
    },
  };
}
