import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests do real bcrypt (cost 12) + HTTP round-trips — they need extra time.
    // Unit tests are fast; this ceiling doesn't hurt them.
    testTimeout: 15000,
    hookTimeout: 10000,
  },
});
