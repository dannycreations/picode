export function createRequestRegistry<T>() {
  const pending = new Map<string, (value: T) => void>();
  return {
    register(id: string, settle: (value: T) => void): void {
      pending.set(id, settle);
    },
    resolve(id: string, value: T): boolean {
      const settle = pending.get(id);
      if (!settle) return false;
      pending.delete(id);
      settle(value);
      return true;
    },
    cancelAll(value: T): void {
      const settlers = [...pending.values()];
      pending.clear();
      for (const settle of settlers) settle(value);
    },
  };
}
