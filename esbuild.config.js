const esbuild = require('esbuild');
const fs = require('fs');

const isWatch = process.argv.includes('--watch');

const buildOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: isWatch,  // Only generate sourcemaps in watch mode
  minify: !isWatch,
  treeShaking: true,
};

// Separate CLI target. Bundled independently from dist/extension.js so the CLI
// never becomes part of the extension bundle. Skipped gracefully when the CLI
// entry does not exist yet (a sibling engineer may still be writing it).
const cliEntry = 'src/cli/index.ts';
const cliOptions = {
  entryPoints: [cliEntry],
  bundle: true,
  outfile: 'dist/cli.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  banner: { js: '#!/usr/bin/env node' },
  sourcemap: isWatch,
  minify: !isWatch,
  treeShaking: true,
};

async function build() {
  const hasCli = fs.existsSync(cliEntry);

  if (isWatch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    if (hasCli) {
      const cliCtx = await esbuild.context(cliOptions);
      await cliCtx.watch();
      console.log('Watching for changes (extension + CLI)...');
    } else {
      console.log('Watching for changes (extension; CLI entry not found, skipped)...');
    }
  } else {
    await esbuild.build(buildOptions);
    if (hasCli) {
      await esbuild.build(cliOptions);
      console.log('Build complete (extension + CLI)');
    } else {
      console.log('Build complete (extension; CLI entry not found, skipped)');
    }
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
