import { defineConfig } from '@vscode/test-cli';

// Runs compiled E2E tests (out-test/test/e2e/**/*.test.js, produced by `npm run
// compile:e2e` — tsconfig.e2e has rootDir '.', so tests land under out-test/test/e2e)
// against the fixture workspace. Mocha uses the TDD UI (suite/test). Other extensions
// are disabled so the host is isolated to the extension under development.
export default defineConfig({
  files: 'out-test/test/e2e/**/*.test.js',
  workspaceFolder: 'test/e2e/fixtures',
  mocha: {
    ui: 'tdd',
    timeout: 20000,
    // Without this, a glob that stops matching (a rename, an outDir change)
    // launches the host, runs nothing, and exits 0 — a green suite that tests
    // nothing. This exact bug shipped once already.
    failZero: true,
  },
  launchArgs: ['--disable-extensions'],
});
