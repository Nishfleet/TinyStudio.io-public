// Shared R2 RECORDS mock for test environments that build `env` by hand.
export function recordsMock(objects) {
  return {
    async put(key, body) { objects.set(key, body); },
    async get(key) {
      if (!objects.has(key)) return null;
      const value = objects.get(key);
      return { body: value, text: async () => value, json: async () => JSON.parse(value) };
    },
    async delete(key) { objects.delete(key); }
  };
}
