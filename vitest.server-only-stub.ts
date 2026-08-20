// Vitest has no notion of "client" vs "server" bundles the way Next's
// bundler does, so the real `server-only` package (which unconditionally
// throws) would break every test that imports server-side code. This stub
// replaces it for the test environment only -- see vitest.config.ts alias.
export {};
