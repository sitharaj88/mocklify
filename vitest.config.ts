import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // E2E tests run under the VS Code test host (mocha), never under vitest.
    exclude: ['test/e2e/**', 'node_modules/**', 'dist/**', 'out-test/**'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'test/', 'dist/'],
    },
  },
});
