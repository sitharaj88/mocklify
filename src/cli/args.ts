import { parseArgs } from 'node:util';

export type CliCommand = 'serve' | 'validate' | 'list' | 'help' | 'version';

export interface ParsedCli {
  command: CliCommand;
  /** Positional config path (directory holding servers.json, or a *.json file). */
  configPath?: string;
  port?: number;
  server?: string;
  all: boolean;
  watch: boolean;
  quiet: boolean;
  /** Non-fatal parse problems; a non-empty list means the CLI should refuse to run. */
  errors: string[];
}

const KNOWN_COMMANDS = new Set(['serve', 'validate', 'list', 'help', 'version']);

/**
 * Pure argv parser. `argv` excludes node + script (i.e. process.argv.slice(2)).
 * Never throws: unknown flags and bad values are collected into `errors` so the
 * caller controls the exit code.
 */
export function parseCliArgs(argv: string[]): ParsedCli {
  const result: ParsedCli = {
    command: 'help',
    all: false,
    watch: false,
    quiet: false,
    errors: [],
  };

  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        port: { type: 'string', short: 'p' },
        server: { type: 'string', short: 's' },
        all: { type: 'boolean' },
        watch: { type: 'boolean', short: 'w' },
        quiet: { type: 'boolean', short: 'q' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean' },
      },
    });
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
    return result;
  }

  const { values, positionals } = parsed;

  // --help / --version win over any command.
  if (values.help) {
    result.command = 'help';
    return result;
  }
  if (values.version) {
    result.command = 'version';
    return result;
  }

  const [rawCommand, rawConfigPath, ...extra] = positionals;

  if (rawCommand === undefined) {
    result.command = 'help';
    return result;
  }

  if (!KNOWN_COMMANDS.has(rawCommand)) {
    result.errors.push(`Unknown command: "${rawCommand}". Expected serve, validate, or list.`);
    return result;
  }
  result.command = rawCommand as CliCommand;

  if (rawConfigPath !== undefined) {
    result.configPath = rawConfigPath;
  }
  if (extra.length > 0) {
    result.errors.push(`Unexpected extra arguments: ${extra.join(', ')}`);
  }

  result.all = values.all === true;
  result.watch = values.watch === true;
  result.quiet = values.quiet === true;

  if (values.server !== undefined) {
    result.server = values.server;
  }

  if (values.port !== undefined) {
    const port = Number(values.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      result.errors.push(`Invalid --port "${values.port}": must be an integer 1-65535.`);
    } else {
      result.port = port;
    }
  }

  return result;
}

export const HELP_TEXT = `Mocklify CLI — run your mock servers outside VS Code.

Usage:
  mocklify <command> [configPath] [options]

Commands:
  serve [configPath]      Start one or all mock servers and stream request logs.
  validate [configPath]   Validate the config; exit 1 if any server is invalid.
  list [configPath]        List servers, ports and route counts.

Arguments:
  configPath              Directory containing servers.json (default: .mocklify),
                          or a path to a *.json config file. Resolved from the
                          current working directory.

Options:
  -s, --server <name|id>  Select a single server by name or id.
      --all               Select every server in the config.
  -p, --port <number>     Override the port (only with a single selected server).
  -w, --watch             Restart servers when the config file changes.
  -q, --quiet             Do not stream per-request log lines.
  -h, --help              Show this help.
      --version           Show the version.

Exit codes:
  0  success            1  config/validation error            2  port in use

Servers bind to all interfaces (0.0.0.0) as provided by the mock engine.
`;
