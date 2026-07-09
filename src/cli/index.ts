import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseCliArgs, HELP_TEXT, ParsedCli } from './args.js';
import {
  loadConfig,
  resolveConfigFile,
  selectServers,
  ConfigFileError,
  LoadConfigResult,
  InvalidServer,
} from './loadConfig.js';
import { startSelectedServers, formatServerTable, PortInUseError, ServeIO } from './serve.js';

/** Exit codes are part of the CLI contract: 0 ok, 1 config error, 2 port in use. */
export const EXIT_OK = 0;
export const EXIT_CONFIG = 1;
export const EXIT_PORT = 2;

const io: ServeIO = {
  log: (line) => process.stdout.write(line + '\n'),
  error: (line) => process.stderr.write(line + '\n'),
};

/**
 * Read the CLI's own version from the bundled package.json. Walks up from the
 * compiled file location; version.ts is avoided since it is populated by the
 * extension host, not the CLI.
 */
export function readCliVersion(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'package.json');
    try {
      const pkg = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
      if (pkg && pkg.name === 'mocklify' && typeof pkg.version === 'string') {
        return pkg.version;
      }
    } catch {
      /* keep walking up */
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '0.0.0';
}

function printInvalid(invalid: InvalidServer[]): void {
  for (const server of invalid) {
    const label = server.name ?? server.id ?? `#${server.index}`;
    io.error(`Invalid server ${label} (entry ${server.index}):`);
    for (const issue of server.issues) {
      const where = issue.path ? issue.path : '(root)';
      io.error(`  - ${where}: ${issue.message}`);
    }
  }
}

function runValidate(loaded: LoadConfigResult): number {
  if (loaded.invalid.length > 0) {
    printInvalid(loaded.invalid);
    io.error(
      `\n${loaded.invalid.length} invalid, ${loaded.servers.length} valid server(s) in ${loaded.filePath}.`
    );
    return EXIT_CONFIG;
  }
  io.log(`OK — ${loaded.servers.length} valid server(s) in ${loaded.filePath}.`);
  return EXIT_OK;
}

function runList(loaded: LoadConfigResult): number {
  if (loaded.servers.length === 0 && loaded.invalid.length === 0) {
    io.log(`No servers in ${loaded.filePath}.`);
    return EXIT_OK;
  }
  for (const server of loaded.servers) {
    io.log(
      `${server.name}  [${server.protocol}]  port ${server.port}  ${server.routes.length} route(s)${
        server.enabled ? '' : '  (disabled)'
      }`
    );
  }
  if (loaded.invalid.length > 0) {
    io.error(`\n${loaded.invalid.length} invalid server(s) skipped (run "validate" for details).`);
  }
  return EXIT_OK;
}

async function runServe(args: ParsedCli, loaded: LoadConfigResult): Promise<number> {
  if (loaded.invalid.length > 0) {
    printInvalid(loaded.invalid);
    io.error(`\nRefusing to start: ${loaded.invalid.length} invalid server(s).`);
    return EXIT_CONFIG;
  }

  const selection = selectServers(loaded.servers, { server: args.server, all: args.all });
  if (selection.error) {
    io.error(selection.error);
    return EXIT_CONFIG;
  }

  if (args.port !== undefined && selection.selected.length > 1) {
    io.error('--port can only be used when a single server is selected (use --server).');
    return EXIT_CONFIG;
  }

  const workspaceRoot = path.dirname(loaded.filePath);

  let started;
  try {
    started = await startSelectedServers(
      selection.selected,
      { port: args.port, quiet: args.quiet, workspaceRoot },
      io
    );
  } catch (error) {
    if (error instanceof PortInUseError) {
      io.error(error.message);
      return EXIT_PORT;
    }
    throw error;
  }

  if (started.running.length === 0) {
    io.error('No servers were started.');
    await started.stop();
    return EXIT_CONFIG;
  }

  io.log(formatServerTable(started.running));
  io.error(
    '\nWarning: servers bind 0.0.0.0 and are reachable from other devices on your network, not just this machine.'
  );
  io.log('\nListening. Press Ctrl+C to stop.');

  await waitForShutdown(args, loaded.filePath, started);
  return EXIT_OK;
}

/**
 * Block until SIGINT/SIGTERM, then stop every server. In --watch mode a config
 * change stops the running set and starts the freshly-selected one; invalid
 * edits are reported and the previous servers stay down until fixed.
 */
async function waitForShutdown(
  args: ParsedCli,
  filePath: string,
  started: Awaited<ReturnType<typeof startSelectedServers>>
): Promise<void> {
  let current = started;

  await new Promise<void>((resolve) => {
    let watcher: fs.FSWatcher | undefined;
    let reloading = false;
    let stopped = false;
    // Hoisted so shutdown can cancel a pending debounced reload — otherwise a
    // Ctrl+C landing within the 150ms window fires reload() after stop(),
    // booting an orphaned server set and keeping the event loop alive forever.
    let debounce: NodeJS.Timeout | undefined;

    const shutdown = () => {
      stopped = true;
      if (debounce) clearTimeout(debounce);
      watcher?.close();
      void current.stop().finally(resolve);
    };

    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);

    if (args.watch) {
      watcher = fs.watch(filePath, () => {
        if (stopped) return;
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => void reload(), 150);
      });
    }

    async function reload(): Promise<void> {
      if (stopped || reloading) return;
      reloading = true;
      try {
        io.log('\nConfig changed — reloading...');
        const loaded = loadConfig(filePath);
        if (loaded.invalid.length > 0) {
          printInvalid(loaded.invalid);
          io.error('Reload skipped: config is invalid; keeping servers stopped until fixed.');
          await current.stop();
          return;
        }
        const selection = selectServers(loaded.servers, { server: args.server, all: args.all });
        if (selection.error) {
          io.error(`Reload skipped: ${selection.error}`);
          return;
        }
        await current.stop();
        current = await startSelectedServers(
          selection.selected,
          { port: args.port, quiet: args.quiet, workspaceRoot: path.dirname(filePath) },
          io
        );
        io.log(formatServerTable(current.running));
      } catch (error) {
        io.error(`Reload failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        reloading = false;
      }
    }
  });
}

export async function main(argv: string[]): Promise<number> {
  const args = parseCliArgs(argv);

  if (args.errors.length > 0) {
    for (const message of args.errors) {
      io.error(message);
    }
    io.error('\nRun "mocklify --help" for usage.');
    return EXIT_CONFIG;
  }

  if (args.command === 'help') {
    io.log(HELP_TEXT);
    return EXIT_OK;
  }

  if (args.command === 'version') {
    io.log(readCliVersion(__dirname));
    return EXIT_OK;
  }

  const filePath = resolveConfigFile(args.configPath, process.cwd());

  let loaded: LoadConfigResult;
  try {
    loaded = loadConfig(filePath);
  } catch (error) {
    if (error instanceof ConfigFileError) {
      io.error(error.message);
      return EXIT_CONFIG;
    }
    throw error;
  }

  switch (args.command) {
    case 'validate':
      return runValidate(loaded);
    case 'list':
      return runList(loaded);
    case 'serve':
      return runServe(args, loaded);
    default:
      io.log(HELP_TEXT);
      return EXIT_OK;
  }
}

// Entry point when executed as ./dist/cli.js. Guarded so importing this module
// (tests, other tooling) never starts the process lifecycle.
if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      io.error(error instanceof Error ? error.stack ?? error.message : String(error));
      process.exitCode = 1;
    });
}
