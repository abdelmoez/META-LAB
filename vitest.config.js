import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Use the React automatic JSX runtime so unit tests can import real .jsx
  // components (e.g. render-to-static-markup of UI primitives) without each file
  // importing React. Mirrors vite.config's @vitejs/plugin-react for the test
  // transform; harmless for the .js tests that contain no JSX.
  esbuild: { jsx: 'automatic' },
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
