import { CHAT_INPUT_MAX_CHARS } from '../chat/chatProtocol.js';

/**
 * Pure drift-proposal builder: turns a DriftWatcher report into a bounded,
 * deterministic notification + chat-prefill proposal.
 * Zero vscode imports, fully vitest-importable.
 */

/** Endpoints shown in the notification body (matches DriftWatcher's preview style). */
export const DRIFT_NOTIFY_MAX_LISTED = 3;
/** Endpoints enumerated in the chat prompt. */
export const DRIFT_PROMPT_MAX_ENDPOINTS = 12;
/** Prefill prompt hard cap — must equal the chat input cap it lands in. */
export const CHAT_PREFILL_MAX_CHARS = CHAT_INPUT_MAX_CHARS; // 4_000
/** Fingerprint length cap. */
export const DRIFT_FINGERPRINT_MAX_CHARS = 512;

/** What DriftWatcher.evaluate hands over instead of showing its legacy notification. */
export interface DriftReport {
  /** Workspace-relative path of the saved file. */
  relativePath: string;
  /** path.basename(relativePath) — DriftWatcher already computes it. */
  fileName: string;
  /** Normalized endpoint paths (DriftWatcher's `missing`) no route covers. Non-empty. */
  missingEndpoints: string[];
  /** Epoch ms. */
  detectedAt: number;
}

/** Minimal server view for suggestion scoring (built from MockServerConfig by the adapter). */
export interface DriftServerInfo {
  name: string;
  routePaths: string[];
}

export interface DriftProposal {
  /** 'drift:' + sorted-deduped endpoints joined '|', sliced to DRIFT_FINGERPRINT_MAX_CHARS. */
  fingerprint: string;
  /**
   * One ledger key per missing endpoint (FULL set, not the display cap) — the
   * rate-limit identity. Keyed per endpoint rather than per set because the
   * set evolves as the user types: a set-level fingerprint changes on every
   * new endpoint and would re-notify on every save.
   */
  endpointKeys: string[];
  /** One-line notification body. */
  notificationText: string;
  /** Prefill text, ≤ CHAT_PREFILL_MAX_CHARS, interior newlines allowed. */
  chatPrompt: string;
  /** Sorted, deduped, capped at DRIFT_PROMPT_MAX_ENDPOINTS (display list only). */
  missingEndpoints: string[];
  /** Present iff some server scored > 0 (conditional spread). */
  suggestedServerName?: string;
}

function sortedDeduped(endpoints: readonly string[]): string[] {
  return [...new Set(endpoints)].sort();
}

/** Exported for tests; order-insensitive over the endpoint set. */
export function driftFingerprint(missingEndpoints: readonly string[]): string {
  return `drift:${sortedDeduped(missingEndpoints).join('|')}`.slice(
    0,
    DRIFT_FINGERPRINT_MAX_CHARS
  );
}

/** Per-endpoint key length cap (belt-and-braces against pathological paths). */
export const DRIFT_ENDPOINT_KEY_MAX_CHARS = 200;

/** One rate-limit ledger key per endpoint; sorted + deduped + clamped. */
export function driftEndpointKeys(missingEndpoints: readonly string[]): string[] {
  return sortedDeduped(missingEndpoints).map((endpoint) =>
    `drift:${endpoint}`.slice(0, DRIFT_ENDPOINT_KEY_MAX_CHARS)
  );
}

/** First non-empty path segment, lowercased; undefined for '/' or empty. */
function firstSegment(path: string): string | undefined {
  const segment = path.split('/').filter(Boolean)[0];
  return segment === undefined ? undefined : segment.toLowerCase();
}

function suggestServerName(
  missingEndpoints: readonly string[],
  servers: readonly DriftServerInfo[]
): string | undefined {
  let bestName: string | undefined;
  let bestScore = 0;
  for (const server of servers) {
    const routeFirsts = new Set<string>();
    for (const routePath of server.routePaths) {
      const seg = firstSegment(routePath);
      if (seg !== undefined) {
        routeFirsts.add(seg);
      }
    }
    let score = 0;
    for (const endpoint of missingEndpoints) {
      const seg = firstSegment(endpoint);
      if (seg !== undefined && routeFirsts.has(seg)) {
        score++;
      }
    }
    // Highest score > 0 wins; first server on ties.
    if (score > bestScore) {
      bestScore = score;
      bestName = server.name;
    }
  }
  return bestName;
}

/**
 * Pure proposal builder. Returns undefined when missingEndpoints is empty.
 * suggestedServerName: for each server, score = count of missing endpoints
 * whose first path segment case-insensitively equals the first segment of any
 * of the server's routePaths; highest score > 0 wins, first server on ties.
 */
export function buildDriftProposal(
  report: DriftReport,
  servers: readonly DriftServerInfo[]
): DriftProposal | undefined {
  const all = sortedDeduped(report.missingEndpoints);
  if (all.length === 0) {
    return undefined;
  }

  const suggestedServerName = suggestServerName(all, servers);

  const preview = all.slice(0, DRIFT_NOTIFY_MAX_LISTED).join(', ');
  const overflow =
    all.length > DRIFT_NOTIFY_MAX_LISTED
      ? ` and ${all.length - DRIFT_NOTIFY_MAX_LISTED} more`
      : '';
  const notificationText = `Mocklify: ${all.length} API call(s) in ${report.fileName} aren't covered by your mocks: ${preview}${overflow}`;

  const listed = all.slice(0, DRIFT_PROMPT_MAX_ENDPOINTS);
  const lines = listed.map((endpoint) => `- ${endpoint}`);
  if (all.length > listed.length) {
    lines.push(`- …and ${all.length - listed.length} more`);
  }
  const lastParagraph =
    suggestedServerName === undefined
      ? 'Please create or extend a mock server with routes for these, with realistic success responses and sensible error cases.'
      : `Please add mock routes for these to the "${suggestedServerName}" server (or another server if it fits better), with realistic success responses and sensible error cases.`;
  const chatPrompt = [
    `My code changed and the mocks may be out of date. ${report.relativePath} now calls ${all.length} endpoint(s) that no mock route covers:`,
    ...lines,
    lastParagraph,
  ]
    .join('\n')
    .slice(0, CHAT_PREFILL_MAX_CHARS);

  return {
    fingerprint: driftFingerprint(all),
    endpointKeys: driftEndpointKeys(all),
    notificationText,
    chatPrompt,
    missingEndpoints: listed,
    ...(suggestedServerName !== undefined ? { suggestedServerName } : {}),
  };
}
