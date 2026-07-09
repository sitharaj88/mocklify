#!/usr/bin/env node
/**
 * Stage the npm package for @mocklify/cli.
 *
 * The extension's package.json cannot be published as-is: it declares a vscode
 * engine, points "main" at a bundle that imports vscode, and would ship src/,
 * test/ and webview/. So the CLI publishes from a generated, minimal manifest
 * over the single self-contained bundle esbuild produces.
 *
 * Two safeguards, both earned the hard way:
 *   1. The staged bundle is smoke-tested from a temp dir with no node_modules,
 *      because "works in the repo" is not the same as "works when installed".
 *   2. The version is read from the root manifest, so the CLI and the extension
 *      can never drift apart.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stage = join(root, 'npm-dist');
const bundle = join(root, 'dist', 'cli.js');

const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

if (!existsSync(bundle)) {
  console.error('dist/cli.js is missing — run `npm run build` first.');
  process.exit(1);
}

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

const pkg = {
  name: '@mocklify/cli',
  version: rootPkg.version,
  description:
    'Run Mocklify mock servers outside VS Code — start the mocks your team designs in the dashboard, from CI or the terminal.',
  bin: { mocklify: 'cli.js' },
  files: ['cli.js', 'README.md', 'LICENSE'],
  engines: { node: '>=18' },
  license: rootPkg.license,
  author: 'Sitharaj Seenivasan',
  homepage: 'https://github.com/sitharaj88/mocklify#readme',
  repository: { type: 'git', url: 'git+https://github.com/sitharaj88/mocklify.git' },
  bugs: { url: 'https://github.com/sitharaj88/mocklify/issues' },
  keywords: ['mock', 'mock-server', 'api', 'rest', 'graphql', 'openapi', 'testing', 'ci', 'cli'],
  // Scoped packages default to restricted; publish public without the flag.
  publishConfig: { access: 'public' },
};

writeFileSync(join(stage, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
cpSync(bundle, join(stage, 'cli.js'));
cpSync(join(root, 'LICENSE'), join(stage, 'LICENSE'));
cpSync(join(root, 'scripts', 'cli-readme.md'), join(stage, 'README.md'));

// Safeguard 1: prove the package runs with nothing else installed. The sandbox
// mirrors the installed layout — cli.js beside its package.json (the CLI reads
// its version from __dirname) — and deliberately has no node_modules.
const sandbox = mkdtempSync(join(tmpdir(), 'mocklify-cli-smoke-'));
try {
  cpSync(join(stage, 'cli.js'), join(sandbox, 'cli.js'));
  cpSync(join(stage, 'package.json'), join(sandbox, 'package.json'));
  const help = execFileSync(process.execPath, [join(sandbox, 'cli.js'), '--help'], {
    encoding: 'utf8',
    cwd: sandbox,
    timeout: 30_000,
  });
  if (!help.includes('mocklify <command>')) {
    throw new Error(`--help output looks wrong:\n${help.slice(0, 400)}`);
  }
  const version = execFileSync(process.execPath, [join(sandbox, 'cli.js'), '--version'], {
    encoding: 'utf8',
    cwd: sandbox,
    timeout: 30_000,
  }).trim();
  if (!version.includes(rootPkg.version)) {
    throw new Error(`--version printed "${version}", expected ${rootPkg.version}`);
  }
} catch (error) {
  console.error('\nStandalone smoke test FAILED — the bundle is not self-contained.');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

const sizeMb = (readFileSync(bundle).byteLength / 1024 / 1024).toFixed(1);
console.log(`Staged ${pkg.name}@${pkg.version} in npm-dist/ (cli.js ${sizeMb} MB)`);
console.log('Standalone smoke test passed (no node_modules).');
console.log('\nNext:');
console.log('  cd npm-dist && npm pack --dry-run   # inspect the tarball');
console.log('  cd npm-dist && npm publish          # publishConfig makes it public');
