export function immutableCopy<T>(value: T): T {
  const copied = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (item && typeof item === 'object') {
      Object.values(item).forEach(freeze);
      Object.freeze(item);
    }
  };
  freeze(copied);
  return copied;
}
