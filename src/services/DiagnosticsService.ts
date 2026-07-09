/**
 * Diagnostics report for bug reports. The pure core (buildDiagnosticsReport +
 * redact + formatForIssueUrl) takes a plain input object and never imports
 * vscode, so it is fully unit-testable. Only collectDiagnostics talks to the
 * extension host, behind a lazy require (same pattern as projectProfile /
 * workspaceTools).
 *
 * REDACTION IS THE POINT: the report is meant to be pasted into a public
 * GitHub issue, so it must never leak API keys, gateway URLs, absolute paths,
 * route response bodies, or request logs. Every free-text field runs through
 * redact() and no secret-bearing field is ever collected in the first place.
 */

import type { ScanStrategyReport } from '../ai/CodebaseMockGenerator.js';

export type ConfiguredProvider = 'auto' | 'copilot' | 'claude' | 'openai' | 'gemini';
export type ResolvedProvider = 'copilot' | 'claude' | 'openai' | 'gemini' | null;
export type ScanMode = 'auto' | 'fast' | 'agentic';

export interface DiagnosticsInput {
  /** From getExtensionVersion(). */
  extensionVersion: string;
  /** vscode.version. */
  vscodeVersion: string;
  /** os.platform(). */
  os: string;
  /** os.arch(). */
  arch: string;
  /** process.version. */
  node: string;
  ai: {
    configuredProvider: ConfiguredProvider;
    resolvedProvider: ResolvedProvider;
    /** mocklify.ai.<provider>Model, or null when unset/not applicable. */
    model: string | null;
    /** BOOLEAN ONLY — true iff mocklify.ai.<provider>BaseUrl is a non-empty string. */
    gatewayConfigured: boolean;
    scanMode: ScanMode;
  };
  workspace: {
    serverCount: number;
    routeCount: number;
    runningServerCount: number;
  };
  features: {
    driftWatch: boolean;
    askQuestions: boolean;
  };
  /** Last codebase scan strategy report, if a scan ran this session. */
  lastScan?: { strategies: ScanStrategyReport[] } | null;
  /** Last captured error, redacted before rendering. */
  lastError?: { message: string; when?: string } | null;
  /** Absolute workspace root — used only to relativize paths out of the report. */
  workspaceRoot?: string;
  /** ISO timestamp; defaults to now when omitted. */
  generatedAt?: string;
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

const REDACTED = '«redacted»';

// Order matters: token/key shapes before the catch-all hex, URLs last so an
// already-redacted token inside a URL doesn't get double-processed oddly.
const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/g, // OpenAI / Anthropic style keys (sk-, sk-ant-...)
  /\bghp_[A-Za-z0-9]{20,}\b/g, // GitHub personal access tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, // GitHub fine-grained PATs
  /\bAIza[A-Za-z0-9_-]{20,}\b/g, // Google API keys
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, // Slack tokens (defensive)
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, // Bearer <token>
  /\bauthorization["']?\s*[:=]\s*["']?\S+/gi, // authorization: <v> / "authorization":"<v>"
  // key=<v>, token: <v>, and JSON-quoted "api_key": "<v>". The optional quote
  // around the key and before the value covers the common JSON-dump shape.
  /\b(?:api[-_]?key|token|secret|password|pwd)["']?\s*[:=]\s*["']?\S+/gi,
  /\b[A-Fa-f0-9]{40,}\b/g, // 40+ char hex (SHA-1+, hex secrets)
];

const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)\]]+/gi;

/**
 * Redact common secret shapes and URLs from a free-text string, then
 * relativize the workspace root and the user's home directory out of any
 * absolute paths. Pure and defensive — safe to run over any collected text.
 */
export function redact(text: string, opts: { workspaceRoot?: string; home?: string } = {}): string {
  if (!text) {
    return text;
  }
  let out = text;

  // Paths first: strip the workspace root to a relative marker and the home
  // dir to ~, so absolute filesystem layout never lands in a public report.
  const root = opts.workspaceRoot?.replace(/[/\\]+$/, '');
  if (root) {
    out = replaceAllLiteral(out, root, '.');
  }
  const home = opts.home?.replace(/[/\\]+$/, '');
  if (home) {
    out = replaceAllLiteral(out, home, '~');
  }

  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  out = out.replace(URL_PATTERN, '«url»');
  return out;
}

function replaceAllLiteral(text: string, find: string, replacement: string): string {
  if (!find) {
    return text;
  }
  return text.split(find).join(replacement);
}

// ---------------------------------------------------------------------------
// Report rendering (pure)
// ---------------------------------------------------------------------------

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}

/**
 * Build the diagnostics report as GitHub-flavored markdown from a plain input
 * object. Pure: no vscode, no I/O. Every free-text field (last error, scan
 * reasons/surfaces) is redacted; no secret-bearing field exists in the input.
 */
export function buildDiagnosticsReport(input: DiagnosticsInput): string {
  const home = detectHome();
  const scrub = (s: string): string => redact(s, { workspaceRoot: input.workspaceRoot, home });

  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const lines: string[] = [];

  lines.push('## Mocklify Diagnostics');
  lines.push('');
  lines.push(`_Generated: ${generatedAt}_`);
  lines.push('');

  lines.push('### Environment');
  lines.push('');
  lines.push(`- **Mocklify version:** ${input.extensionVersion}`);
  lines.push(`- **VS Code version:** ${input.vscodeVersion}`);
  lines.push(`- **OS / arch:** ${input.os} / ${input.arch}`);
  lines.push(`- **Node:** ${input.node}`);
  lines.push('');

  lines.push('### AI');
  lines.push('');
  lines.push(`- **Configured provider:** ${input.ai.configuredProvider}`);
  lines.push(`- **Resolved provider:** ${input.ai.resolvedProvider ?? 'none'}`);
  lines.push(`- **Model:** ${input.ai.model ?? 'default'}`);
  lines.push(`- **Custom gateway configured:** ${yesNo(input.ai.gatewayConfigured)}`);
  lines.push(`- **Scan mode:** ${input.ai.scanMode}`);
  lines.push('');

  lines.push('### Workspace');
  lines.push('');
  lines.push(`- **Servers:** ${input.workspace.serverCount}`);
  lines.push(`- **Routes:** ${input.workspace.routeCount}`);
  lines.push(`- **Running servers:** ${input.workspace.runningServerCount}`);
  lines.push('');

  lines.push('### Feature flags');
  lines.push('');
  lines.push(`- **Drift watch:** ${yesNo(input.features.driftWatch)}`);
  lines.push(`- **Ask clarifying questions:** ${yesNo(input.features.askQuestions)}`);
  lines.push('');

  lines.push('### Last codebase scan');
  lines.push('');
  const strategies = input.lastScan?.strategies ?? [];
  if (strategies.length === 0) {
    lines.push('_No scan recorded this session._');
  } else {
    for (const report of strategies) {
      lines.push(`- **${scrub(report.surface)}** → \`${report.strategy}\` — ${scrub(report.reason)}`);
    }
  }
  lines.push('');

  lines.push('### Last error');
  lines.push('');
  if (input.lastError && input.lastError.message) {
    const when = input.lastError.when ? ` _(at ${input.lastError.when})_` : '';
    lines.push('```');
    lines.push(scrub(input.lastError.message));
    lines.push('```');
    if (when) {
      lines.push(when.trim());
    }
  } else {
    lines.push('_None captured this session._');
  }
  lines.push('');

  return lines.join('\n');
}

/** process.env.HOME / USERPROFILE when available, else undefined. Pure-safe. */
function detectHome(): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  return env?.HOME || env?.USERPROFILE || undefined;
}

// ---------------------------------------------------------------------------
// GitHub issue URL
// ---------------------------------------------------------------------------

const DEFAULT_REPO_URL = 'https://github.com/sitharaj88/mocklify';
const ISSUE_TITLE = 'Mocklify: <describe the issue>';
/** Keep the encoded URL comfortably under GitHub's ~8k limit. */
const MAX_BODY_CHARS = 6000;
const TRUNCATION_NOTE = '\n\n_…report truncated; attach the full report if needed._';

/** Normalize a package.json repository URL to a clean https base. */
function normalizeRepoUrl(raw: string | undefined): string {
  if (!raw) {
    return DEFAULT_REPO_URL;
  }
  let url = raw.trim();
  url = url.replace(/^git\+/, '').replace(/\.git$/, '');
  url = url.replace(/^git@github\.com:/, 'https://github.com/');
  if (!/^https?:\/\//.test(url)) {
    return DEFAULT_REPO_URL;
  }
  return url.replace(/\/+$/, '');
}

/**
 * Build a "new issue" URL for the repository with the report pre-filled as the
 * body. The body is capped near MAX_BODY_CHARS (truncated with a note) so the
 * final URL stays within GitHub's length limit.
 */
export function formatForIssueUrl(
  reportMarkdown: string,
  opts: { repositoryUrl?: string; title?: string } = {}
): string {
  const base = normalizeRepoUrl(opts.repositoryUrl);
  let body = reportMarkdown;
  if (body.length > MAX_BODY_CHARS) {
    body = body.slice(0, MAX_BODY_CHARS - TRUNCATION_NOTE.length) + TRUNCATION_NOTE;
  }
  const params = new URLSearchParams({
    title: opts.title ?? ISSUE_TITLE,
    body,
  });
  return `${base}/issues/new?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Session state (integration pushes into this; collectDiagnostics reads it)
// ---------------------------------------------------------------------------

let lastScanReport: ScanStrategyReport[] | undefined;
let lastError: { message: string; when: string } | undefined;

/** Record the strategy report of the most recent codebase scan. */
export function recordScanReport(strategies: ScanStrategyReport[] | undefined): void {
  lastScanReport = strategies && strategies.length > 0 ? strategies : undefined;
}

/** Record the most recent error for the next diagnostics report. */
export function recordError(err: unknown): void {
  const message = err instanceof Error ? err.stack || err.message : String(err);
  lastError = { message, when: new Date().toISOString() };
}

/** Clear captured session state (used by tests). */
export function resetDiagnosticsState(): void {
  lastScanReport = undefined;
  lastError = undefined;
}

// ---------------------------------------------------------------------------
// vscode adapter
// ---------------------------------------------------------------------------

/** Structural view of the pieces collectDiagnostics reads — avoids vscode-typed deps. */
export interface DiagnosticsDeps {
  extensionVersion: string;
  workspaceRoot?: string;
  /** Server configs (id + routes) to count servers/routes without leaking bodies. */
  getServers(): Promise<Array<{ routes?: unknown[] }>>;
  /** Runtime states keyed by server id; used only to count running servers. */
  getServerStates(): Iterable<{ status: string }>;
  /** The configured provider id from settings ('auto' | provider). */
  getConfiguredProviderId(): ConfiguredProvider;
  /** Resolve the active provider id, or null when none is available. */
  resolveProviderId(): Promise<ResolvedProvider>;
}

/**
 * Gather a DiagnosticsInput from the extension host. Thin adapter: lazy-require
 * vscode/os, read settings (never secrets), count servers/routes/running, and
 * pull the recorded last scan/error. The heavy lifting (rendering + redaction)
 * happens in the pure buildDiagnosticsReport.
 */
export async function collectDiagnostics(deps: DiagnosticsDeps): Promise<DiagnosticsInput> {
  // Lazy so the pure exports above import cleanly under vitest.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const vs: typeof import('vscode') = require('vscode');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os: typeof import('os') = require('os');

  const config = vs.workspace.getConfiguration('mocklify');

  const configuredProvider = deps.getConfiguredProviderId();
  let resolvedProvider: ResolvedProvider = null;
  try {
    resolvedProvider = await deps.resolveProviderId();
  } catch {
    resolvedProvider = null;
  }

  // The provider whose model/gateway settings are relevant: the resolved one,
  // falling back to the configured one (never 'auto').
  const settingProvider =
    resolvedProvider ?? (configuredProvider === 'auto' ? undefined : configuredProvider);

  const model =
    settingProvider !== undefined
      ? config.get<string>(`ai.${settingProvider}Model`, '').trim() || null
      : null;
  const baseUrl =
    settingProvider !== undefined
      ? config.get<string>(`ai.${settingProvider}BaseUrl`, '').trim()
      : '';

  const servers = await deps.getServers();
  const routeCount = servers.reduce((sum, s) => sum + (s.routes?.length ?? 0), 0);
  let runningServerCount = 0;
  for (const state of deps.getServerStates()) {
    if (state.status === 'running') {
      runningServerCount++;
    }
  }

  return {
    extensionVersion: deps.extensionVersion,
    vscodeVersion: vs.version,
    os: os.platform(),
    arch: os.arch(),
    node: process.version,
    ai: {
      configuredProvider,
      resolvedProvider,
      model,
      gatewayConfigured: baseUrl.length > 0,
      scanMode: config.get<ScanMode>('ai.scanMode', 'auto'),
    },
    workspace: {
      serverCount: servers.length,
      routeCount,
      runningServerCount,
    },
    features: {
      driftWatch: config.get<boolean>('ai.driftWatch', false),
      askQuestions: config.get<boolean>('ai.askQuestions', true),
    },
    lastScan: lastScanReport ? { strategies: lastScanReport } : null,
    lastError: lastError ? { ...lastError } : null,
    workspaceRoot: deps.workspaceRoot,
    generatedAt: new Date().toISOString(),
  };
}
