import * as vscode from 'vscode';
import * as path from 'path';
import type { MockServerManager } from '../core/MockServerManager.js';
import { scoreApiContent } from './scan/heuristics.js';
import { isPathCovered } from './proactive/pathCoverage.js';
import type { DriftReport } from './proactive/driftProposal.js';

// Coverage matching moved verbatim to proactive/pathCoverage.ts (pure, so the
// rescan differ can reuse it); re-exported here to preserve the public surface.
export { isPathCovered } from './proactive/pathCoverage.js';

const CONFIG_KEY = 'ai.driftWatch';
const NOTIFY_CONFIG_KEY = 'ai.driftNotifications';
const DEBOUNCE_MS = 2000;
const MIN_SCORE = 10; // same threshold as CodebaseMockGenerator
const MAX_FILE_CHARS = 262_144;

/** Mirrors API_FILE_GLOB extensions from scan/heuristics. */
const SOURCE_EXTENSIONS = new Set([
  'kt', 'java', 'swift', 'm', 'mm', 'ts', 'tsx', 'js', 'jsx',
  'dart', 'vue', 'svelte', 'py', 'cs', 'go', 'rb', 'php',
]);

/** Mirrors SCAN_EXCLUDE_GLOB directory segments from scan/heuristics. */
const EXCLUDED_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', '.git', 'target',
  'Pods', 'vendor', '.mocklify', 'coverage', '__pycache__',
]);

/** Quoted absolute /api/… (or versioned) paths, including template literals. */
const QUOTED_API_PATH = /["'`](\/(?:api|rest|graphql|v\d+)\/[^"'`\s?#]*)["'`]/g;

/** Retrofit-style HTTP annotations: @GET("users/{id}"), @POST(value = "…"). */
const RETROFIT_ANNOTATION =
  /@(?:GET|POST|PUT|DELETE|PATCH|HEAD)\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/g;

export function isScannablePath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  if (/\.min\.js$/.test(normalized) || /\.d\.ts$/.test(normalized)) {
    return false;
  }
  const segments = normalized.split('/');
  if (segments.slice(0, -1).some((s) => EXCLUDED_DIRS.has(s))) {
    return false;
  }
  const fileName = segments[segments.length - 1];
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) {
    return false;
  }
  return SOURCE_EXTENSIONS.has(fileName.slice(dot + 1).toLowerCase());
}

/** Normalize to a route-comparable form: {id} and ${id} become :param segments. */
function normalizeEndpointPath(raw: string): string | undefined {
  let p = raw.trim();
  if (/^https?:\/\//i.test(p)) {
    try {
      p = new URL(p).pathname;
    } catch {
      return undefined;
    }
  }
  p = p
    .replace(/[?#].*$/, '')
    .replace(/\{([^}/]+)\}/g, ':$1')
    .replace(/\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*/g, ':param');
  if (!p.startsWith('/')) {
    p = '/' + p;
  }
  p = p.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  if (!p || p === '/' || !/^[/\w:.~%-]+$/.test(p)) {
    return undefined;
  }
  return p;
}

export function extractEndpointPaths(content: string): string[] {
  const found = new Set<string>();
  for (const regex of [QUOTED_API_PATH, RETROFIT_ANNOTATION]) {
    regex.lastIndex = 0;
    for (const match of content.matchAll(regex)) {
      const normalized = normalizeEndpointPath(match[1]);
      if (normalized) {
        found.add(normalized);
      }
    }
  }
  return [...found];
}

/**
 * Watches saved source files for API calls no mock server covers and offers
 * to generate routes. Gated on the mocklify.ai.driftWatch setting; toggling
 * it takes effect without a reload.
 */
export class DriftWatcher implements vscode.Disposable {
  private saveListener: vscode.Disposable | undefined;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly ignoredFiles = new Set<string>();
  private readonly notifiedFiles = new Set<string>();
  private readonly notifiedPathSets = new Set<string>();

  constructor(
    private readonly manager: MockServerManager,
    private readonly onDriftReport?: (report: DriftReport) => void
  ) {}

  activate(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      this,
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration(`mocklify.${CONFIG_KEY}`) ||
          e.affectsConfiguration(`mocklify.${NOTIFY_CONFIG_KEY}`)
        ) {
          this.syncEnabled();
        }
      })
    );
    this.syncEnabled();
  }

  dispose(): void {
    this.saveListener?.dispose();
    this.saveListener = undefined;
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  private syncEnabled(): void {
    const config = vscode.workspace.getConfiguration('mocklify');
    const enabled =
      config.get<boolean>(CONFIG_KEY, false) ||
      (this.onDriftReport !== undefined && config.get<boolean>(NOTIFY_CONFIG_KEY, false));
    if (enabled && !this.saveListener) {
      this.saveListener = vscode.workspace.onDidSaveTextDocument((doc) =>
        this.onSave(doc)
      );
    } else if (!enabled && this.saveListener) {
      this.dispose();
    }
  }

  private onSave(document: vscode.TextDocument): void {
    if (document.uri.scheme !== 'file') {
      return;
    }
    // Files outside the workspace (dependency sources, unrelated projects)
    // have nothing to do with this workspace's mocks.
    if (!vscode.workspace.getWorkspaceFolder(document.uri)) {
      return;
    }
    const fileKey = document.uri.fsPath;
    if (this.ignoredFiles.has(fileKey) || this.notifiedFiles.has(fileKey)) {
      return;
    }
    const relativePath = vscode.workspace.asRelativePath(document.uri);
    if (!isScannablePath(relativePath)) {
      return;
    }
    const content = document.getText();
    if (content.length > MAX_FILE_CHARS) {
      return;
    }

    const pending = this.timers.get(fileKey);
    if (pending) {
      clearTimeout(pending);
    }
    this.timers.set(
      fileKey,
      setTimeout(() => {
        this.timers.delete(fileKey);
        void this.evaluate(fileKey, relativePath, content).catch(() => {
          // Drift detection is best-effort; never surface errors on save
        });
      }, DEBOUNCE_MS)
    );
  }

  private async evaluate(
    fileKey: string,
    relativePath: string,
    content: string
  ): Promise<void> {
    if (this.ignoredFiles.has(fileKey) || this.notifiedFiles.has(fileKey)) {
      return;
    }
    if (scoreApiContent(content, relativePath) < MIN_SCORE) {
      return;
    }
    const endpoints = extractEndpointPaths(content);
    if (endpoints.length === 0) {
      return;
    }

    const servers = await this.manager.getServers();
    const routePaths = servers.flatMap((server) =>
      server.routes.map((route) => route.path)
    );
    const missing = endpoints.filter((p) => !isPathCovered(p, routePaths));
    if (missing.length === 0) {
      return;
    }

    const config = vscode.workspace.getConfiguration('mocklify');
    if (this.onDriftReport !== undefined && config.get<boolean>(NOTIFY_CONFIG_KEY, false)) {
      // Proactive proposal path: cooldown/mute rate limiting is the ledger's job,
      // so the legacy per-session latches are not set here (drift that persists
      // may legitimately re-notify after the cooldown).
      this.onDriftReport({
        relativePath,
        fileName: path.basename(relativePath),
        missingEndpoints: missing,
        detectedAt: Date.now(),
      });
      return;
    }
    if (!config.get<boolean>(CONFIG_KEY, false)) {
      // Only driftNotifications enabled but the handler is missing.
      return;
    }

    const pathSetKey = [...missing].sort().join('|');
    if (this.notifiedPathSets.has(pathSetKey)) {
      return;
    }
    this.notifiedFiles.add(fileKey);
    this.notifiedPathSets.add(pathSetKey);

    const fileName = path.basename(relativePath);
    const preview = missing.slice(0, 3).join(', ');
    const overflow = missing.length > 3 ? ` and ${missing.length - 3} more` : '';
    const action = await vscode.window.showInformationMessage(
      `Mocklify: ${missing.length} new API call(s) in ${fileName} aren't covered by your mocks: ${preview}${overflow}`,
      'Generate Routes',
      'Ignore file'
    );
    if (action === 'Generate Routes') {
      void vscode.commands.executeCommand('mocklify.aiGenerateRoute', {
        description: `Mock routes for these endpoints called from ${fileName}: ${missing.join(', ')}`,
      });
    } else if (action === 'Ignore file') {
      this.ignoredFiles.add(fileKey);
    }
  }
}

export function activateDriftWatcher(
  context: vscode.ExtensionContext,
  manager: MockServerManager,
  onDriftReport?: (report: DriftReport) => void
): DriftWatcher {
  const watcher = new DriftWatcher(manager, onDriftReport);
  watcher.activate(context);
  return watcher;
}
