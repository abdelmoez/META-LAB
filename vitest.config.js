import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests do real bcrypt (cost 12) + HTTP round-trips — they need extra time.
    // Unit tests are fast; this ceiling doesn't hurt them. The heavy-setup integration
    // files (multi-user register + workspace/member seeding) can exceed 10s for their
    // beforeAll hooks when the whole suite runs files in parallel and contends on the
    // server + SQLite — hence a generous 30s hook ceiling (prompt11).
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
