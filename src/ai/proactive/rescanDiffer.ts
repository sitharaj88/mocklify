import { isPathCovered } from './pathCoverage.js';
import { CHAT_PREFILL_MAX_CHARS } from './driftProposal.js';
import type { ScanMemory } from '../scan/scanMemory.js';

/**
 * Pure differ: fresh scan summary vs configured mock routes + scan memory.
 * Route-path matching reuses the exact drift semantics via pathCoverage.
 * Zero vscode imports, fully vitest-importable.
 */

/** Endpoints listed in addedEndpoints / prompt / notification. */
export const RESCAN_DIFF_MAX_LISTED = 8;
export const RESCAN_FINGERPRINT_MAX_CHARS = 512;

/** Structural subset of RouteConfig / summary routes (method may be an array). */
export interface RescanRoute {
  method: string | string[];
  path: string;
}
export interface RescanServerInfo {
  name: string;
  routes: RescanRoute[];
}
export interface RescanSurfaceRef {
  name: string;
  rootPath: string;
}
export interface RescanEndpoint {
  method: string;
  path: string;
}

export interface RescanDiff {
  /** First RESCAN_DIFF_MAX_LISTED added endpoints (sorted by `METHOD path` key). */
  addedEndpoints: RescanEndpoint[];
  /** Exact, may exceed addedEndpoints.length. */
  addedCount: number;
  /** Path covered but method not offered by any covering route. */
  changedCount: number;
  /** Enabled configured routes whose path no summary path covers. */
  removedCount: number;
  /** Summary surfaces unknown to scan memory; ALWAYS [] when memory === null. */
  newSurfaceNames: string[];
  /** addedCount > 0 || newSurfaceNames.length > 0 — the only notification trigger. */
  notify: boolean;
}

function methodsOf(route: RescanRoute): string[] {
  return Array.isArray(route.method) ? route.method : [route.method];
}

function endpointKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path.toLowerCase()}`;
}

/** scanMemory surfaceKey rule. */
function surfaceKey(name: string, rootPath: string): string {
  return `${rootPath} ${name.toLowerCase()}`;
}

/**
 * Pure differ. Endpoint universe: expand each summary route to one
 * {method, path} per method (single-or-array), dedupe by
 * `${method.toUpperCase()} ${path.toLowerCase()}`.
 */
export function diffRescan(
  summaryRoutes: readonly RescanRoute[],
  servers: readonly RescanServerInfo[],
  memory: ScanMemory | null,
  summarySurfaces?: readonly RescanSurfaceRef[]
): RescanDiff {
  const configuredRoutes = servers.flatMap((server) => server.routes);
  const configuredPaths = configuredRoutes.map((route) => route.path);

  // Endpoint universe from the summary, deduped case-insensitively.
  const universe = new Map<string, RescanEndpoint>();
  for (const route of summaryRoutes) {
    for (const method of methodsOf(route)) {
      const key = endpointKey(method, route.path);
      if (!universe.has(key)) {
        universe.set(key, { method: method.toUpperCase(), path: route.path });
      }
    }
  }

  const added: { key: string; endpoint: RescanEndpoint }[] = [];
  let changedCount = 0;
  for (const [key, endpoint] of universe) {
    if (!isPathCovered(endpoint.path, configuredPaths)) {
      added.push({ key, endpoint });
      continue;
    }
    // Path covered — is the method offered by any route covering this path?
    const methodOffered = configuredRoutes.some(
      (route) =>
        isPathCovered(endpoint.path, [route.path]) &&
        methodsOf(route).some(
          (m) => m.toUpperCase() === endpoint.method.toUpperCase()
        )
    );
    if (!methodOffered) {
      changedCount++;
    }
  }
  added.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const summaryPaths = summaryRoutes.map((route) => route.path);
  let removedCount = 0;
  for (const route of configuredRoutes) {
    if (!isPathCovered(route.path, summaryPaths)) {
      removedCount++;
    }
  }

  const newSurfaceNames: string[] = [];
  if (memory !== null && summarySurfaces !== undefined) {
    const knownKeys = new Set(
      memory.surfaces.map((s) => surfaceKey(s.name, s.rootPath))
    );
    for (const surface of summarySurfaces) {
      if (!knownKeys.has(surfaceKey(surface.name, surface.rootPath))) {
        newSurfaceNames.push(surface.name);
      }
      if (newSurfaceNames.length >= RESCAN_DIFF_MAX_LISTED) {
        break;
      }
    }
  }

  return {
    addedEndpoints: added
      .slice(0, RESCAN_DIFF_MAX_LISTED)
      .map((entry) => entry.endpoint),
    addedCount: added.length,
    changedCount,
    removedCount,
    newSurfaceNames,
    notify: added.length > 0 || newSurfaceNames.length > 0,
  };
}

/** 'rescan:' + sorted added keys + '|s:' + sorted newSurfaceNames, sliced to cap. */
export function rescanFingerprint(diff: RescanDiff): string {
  const addedKeys = diff.addedEndpoints
    .map((e) => endpointKey(e.method, e.path))
    .sort();
  const surfaceNames = [...diff.newSurfaceNames].sort();
  return `rescan:${addedKeys.join('|')}|s:${surfaceNames.join('|')}`.slice(
    0,
    RESCAN_FINGERPRINT_MAX_CHARS
  );
}

/**
 * 'Mocklify: Scheduled scan found {addedCount} new endpoint(s) your mocks
 *  don't cover{ and {M} new API surface(s)}: {first 3 `METHOD path` keys}
 *  { and {K} more}.'  (zero added, surfaces only → 'found {M} new API
 *  surface(s): {names}.')
 */
export function buildRescanNotificationText(diff: RescanDiff): string {
  if (diff.addedCount === 0) {
    return `Mocklify: Scheduled scan found ${diff.newSurfaceNames.length} new API surface(s): ${diff.newSurfaceNames.join(', ')}.`;
  }
  const surfaces =
    diff.newSurfaceNames.length > 0
      ? ` and ${diff.newSurfaceNames.length} new API surface(s)`
      : '';
  const preview = diff.addedEndpoints
    .slice(0, 3)
    .map((e) => `${e.method} ${e.path}`)
    .join(', ');
  const overflow = diff.addedCount > 3 ? ` and ${diff.addedCount - 3} more` : '';
  return `Mocklify: Scheduled scan found ${diff.addedCount} new endpoint(s) your mocks don't cover${surfaces}: ${preview}${overflow}.`;
}

/**
 * Prefill prompt, ≤ CHAT_PREFILL_MAX_CHARS:
 *   A scheduled Mocklify scan of this workspace found {addedCount} endpoint(s)
 *   in the code that no mock route covers:
 *   - {METHOD} {path}          (≤ RESCAN_DIFF_MAX_LISTED, then '- …and {K} more')
 *   {It also found new API surface(s): {names}.}
 *   Please review these and add mock routes for the ones that make sense,
 *   using the existing mock servers where they fit.
 */
export function buildRescanChatPrompt(diff: RescanDiff): string {
  const lines = [
    `A scheduled Mocklify scan of this workspace found ${diff.addedCount} endpoint(s) in the code that no mock route covers:`,
  ];
  for (const endpoint of diff.addedEndpoints) {
    lines.push(`- ${endpoint.method} ${endpoint.path}`);
  }
  const overflow = diff.addedCount - diff.addedEndpoints.length;
  if (overflow > 0) {
    lines.push(`- …and ${overflow} more`);
  }
  if (diff.newSurfaceNames.length > 0) {
    lines.push(
      `It also found new API surface(s): ${diff.newSurfaceNames.join(', ')}.`
    );
  }
  lines.push(
    'Please review these and add mock routes for the ones that make sense, using the existing mock servers where they fit.'
  );
  return lines.join('\n').slice(0, CHAT_PREFILL_MAX_CHARS);
}
