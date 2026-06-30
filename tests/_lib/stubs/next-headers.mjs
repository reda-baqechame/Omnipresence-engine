/**
 * Test-only stub of `next/headers`.
 *
 * Many engines transitively import `@/lib/supabase/server`, which imports
 * `next/headers` at module load — a Next.js runtime boundary that does not exist
 * under `node --test`. We only ever exercise the PURE exports of those engines
 * in unit tests (never the cookie/DB-backed paths), so a no-op store is faithful:
 * it lets the module graph load without faking any business logic.
 */
const store = new Map();

export async function cookies() {
  return {
    get: (name) => (store.has(name) ? { name, value: store.get(name) } : undefined),
    getAll: () => [...store.entries()].map(([name, value]) => ({ name, value })),
    set: (name, value) => store.set(name, value),
    delete: (name) => store.delete(name),
    has: (name) => store.has(name),
  };
}

export async function headers() {
  return new Headers();
}

export function draftMode() {
  return { isEnabled: false, enable() {}, disable() {} };
}
