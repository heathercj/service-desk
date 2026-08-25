// CLI scripts run via `tsx` (see package.json), which has no notion of
// "client" vs "server" bundles the way Next's own bundler does -- the real
// `server-only` package (which unconditionally throws on import) would
// break every script that calls into src/lib/** modules carrying that
// guard. Remapped in place of the real package for tsx-run scripts only
// (see tsconfig.json's "server-only" path); Next's own build is untouched
// and still enforces the real guard. Mirrors vitest.server-only-stub.ts,
// which does the same for the test runner.
export {};
