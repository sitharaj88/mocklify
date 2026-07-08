import type * as vscode from 'vscode';
import { NEGATIVE_ROUTE_PRIORITY, RouteConfig } from '../types/core.js';
import type { AiService } from './AiService.js';
import type {
  CodebaseScanProgress,
  CodebaseScanSummary,
  ScanSurface,
  WorkspaceRecon,
} from './CodebaseMockGenerator.js';
import { extractJson } from './extractJson.js';
import {
  MockGenerator,
  ROUTE_FORMAT_INSTRUCTIONS,
  ROUTES_JSON_SCHEMA,
  RejectedRoute,
} from './MockGenerator.js';
import { ScoredFile, extractApiSnippets, dedupeRoutes } from './scan/heuristics.js';
import {
  detectUniversalSignals,
  isProbablyTextFile,
  pickScanCandidates,
  scoreFileUniversal,
  shouldScanPath,
  universalLean,
  type UniversalDirection,
  type UniversalSignals,
} from './scan/universalSignals.js';
import { censusWorkspace, describeCensus } from './scan/census.js';
import { enumerateScanCandidates } from './scan/enumerateFiles.js';
import { hasGraphQlMarkers } from './scan/modelContext.js';
import {
  describeProfiles,
  profileWorkspace,
  type ApiDirection,
  type ProjectKind,
  type ProjectProfile,
} from './scan/projectProfile.js';
import { createWorkspaceTools, DEFAULT_READ_BUDGET_BYTES } from './agent/workspaceTools.js';
import { AgenticScanUnavailableError } from './providers/types.js';
import type { AiToolCall, AiToolDefinition, AiToolExecutor } from './providers/types.js';
import { DEFAULT_MAX_TOOL_CALLS } from './providers/toolLoop.js';

/**
 * Recon-first agentic codebase scan. A deterministic recon phase profiles the
 * workspace (project kinds, API direction, spec files) and runs the
 * directional seed scan; the model then explores through read-only tools
 * (list_files / read_file / search_code), narrates milestones via
 * report_progress, and submits finished mock routes — optionally split across
 * multiple API surfaces — through submit_routes, which validates on the spot.
 *
 * Pure helpers (recon assembly, prompt building, budget scaling, submit and
 * surface bookkeeping, progress math) are exported for unit tests; vscode is
 * loaded lazily inside the class so the module imports cleanly under vitest.
 */

// Seed scan — inclusive text-file discovery gated by shouldScanPath (path
// blocklist) + isProbablyTextFile (content sniff) instead of the legacy
// API_FILE_GLOB extension whitelist, sampled by pickScanCandidates under the
// same MAX_FILES_TO_READ budget the whitelist scan used.
/** Paths enumerated at most before sampling. */
export const MAX_FILES_TO_ENUMERATE = 4000;
const MAX_FILES_TO_READ = 600;
const MAX_FILE_BYTES = 262_144;
const MIN_SCORE = 10;
/** Bytes sniffed per file to reject binaries. */
const TEXT_SNIFF_BYTES = 8192;
/** Best seed score below which the whole seed set counts as low-confidence. */
export const LOW_CONFIDENCE_SEED_SCORE = 12;

/** Base tool-execution cap for a single-project scan (provider loop default). */
export const AGENT_MAX_TOOL_CALLS = DEFAULT_MAX_TOOL_CALLS;
/** Extra tool calls granted per additional detected project. */
export const EXTRA_PROJECT_TOOL_CALLS = 15;
/** Hard ceiling on tool executions however many projects were detected. */
export const MAX_TOOL_CALLS_CAP = 60;
/** Base wall-clock budget for a single-project scan. */
export const AGENTIC_SCAN_BUDGET_MS = 8 * 60_000;
/** Extra wall-clock budget granted per additional detected project. */
export const EXTRA_PROJECT_BUDGET_MS = 4 * 60_000;
/** Hard wall-clock ceiling however many projects were detected. */
export const SCAN_BUDGET_CAP_MS = 16 * 60_000;
/** Tool read budget when more than one project must be explored. */
export const MULTI_PROJECT_READ_BUDGET_BYTES = 1024 * 1024;
/** Inside this window before the deadline, exploration tools demand a submit. */
export const SUBMIT_NUDGE_WINDOW_MS = 90_000;
/** Failed submit_routes rounds tolerated before the valid subset is accepted. */
export const MAX_SUBMIT_REJECTIONS = 2;

export const SEED_MAX_FILES = 30;
/** Per-surface seed cap when several projects share the prompt. */
export const SEED_MAX_FILES_MULTI = 15;
export const SEED_TEASER_LINES = 3;
export const SEED_TEASER_LINE_CHARS = 120;

export const PROGRESS_NOTE_MAX_CHARS = 200;
export const PROGRESS_NOTE_ACK = 'Noted — continue.';

export const SUBMIT_ROUTES_ACCEPTED_ACK =
  'Routes accepted — the mock server will be assembled from them. Stop calling tools and reply "done".';
export const ROUTES_ALREADY_ACCEPTED =
  'Routes were already accepted — stop calling tools and reply "done".';
export const TIME_BUDGET_NUDGE =
  'Time budget nearly exhausted — stop exploring and call submit_routes NOW with every route you have found.';
export const NO_API_SURFACE_ACK =
  'No-API-surface conclusion accepted. Reply now with one short paragraph explaining why this workspace has no HTTP API surface to mock (it will be shown to the user), then stop calling tools.';
export const NO_API_SURFACE_FALLBACK_REASON =
  'The agent explored the workspace and found no HTTP API calls or route declarations to mock.';
export const NO_API_SURFACE_REASON_MAX_CHARS = 600;

export { AgenticScanUnavailableError } from './providers/types.js';

// ---------------------------------------------------------------------------
// Budget scaling (pure)
// ---------------------------------------------------------------------------

function extraProjects(projectCount: number): number {
  return Math.max(0, Math.floor(projectCount) - 1);
}

/** 30 tool calls + 15 per additional detected project, capped at 60. */
export function scaleMaxToolCalls(projectCount: number): number {
  return Math.min(
    MAX_TOOL_CALLS_CAP,
    AGENT_MAX_TOOL_CALLS + EXTRA_PROJECT_TOOL_CALLS * extraProjects(projectCount)
  );
}

/** 8 minutes + 4 per additional detected project, capped at 16 minutes. */
export function scaleScanBudgetMs(projectCount: number): number {
  return Math.min(
    SCAN_BUDGET_CAP_MS,
    AGENTIC_SCAN_BUDGET_MS + EXTRA_PROJECT_BUDGET_MS * extraProjects(projectCount)
  );
}

/** 512KB read budget for one project, 1MB when several must be explored. */
export function scaleReadBudgetBytes(projectCount: number): number {
  return projectCount > 1 ? MULTI_PROJECT_READ_BUDGET_BYTES : DEFAULT_READ_BUDGET_BYTES;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

/**
 * ROUTES_JSON_SCHEMA extended for multi-surface submissions: an optional
 * per-route "surface" name plus a top-level "surfaceNames" list. Built as a
 * deep copy so the shared schema (used by other generation flows) is never
 * mutated; stays inside the strict structured-output dialect (object root,
 * additionalProperties: false everywhere, no min/max constraints).
 */
export const SURFACE_ROUTES_JSON_SCHEMA: Record<string, unknown> = (() => {
  const schema = JSON.parse(JSON.stringify(ROUTES_JSON_SCHEMA)) as Record<string, unknown>;
  const properties = schema.properties as Record<string, Record<string, unknown>>;
  const items = properties.routes.items as Record<string, unknown>;
  (items.properties as Record<string, unknown>).surface = {
    type: 'string',
    description:
      'Name of the API surface this route belongs to — one of the surface names listed in the mission. Omit when the mission has a single surface.',
  };
  properties.surfaceNames = {
    type: 'array',
    items: { type: 'string' },
    description: 'Every surface name used across the submitted routes.',
  };
  return schema;
})();

/** The submit tool: the model hands over the finished routes through it. */
export const SUBMIT_ROUTES_TOOL: AiToolDefinition = {
  name: 'submit_routes',
  description:
    'Submit the final set of mock routes for the scanned workspace. Call this exactly once, after exploring, with EVERY route (success routes plus disabled negative-flow routes) as {"routes": [...]}. When the mission lists multiple API surfaces, set "surface" on every route to its surface name and include a top-level "surfaceNames" array. If the result lists validation problems, fix them and call submit_routes again with the COMPLETE corrected set. Never put route JSON in your text reply — it is only read from this tool.',
  inputSchema: SURFACE_ROUTES_JSON_SCHEMA,
};

/** Lightweight narration tool: milestones stream straight to the progress UI. */
export const REPORT_PROGRESS_TOOL: AiToolDefinition = {
  name: 'report_progress',
  description:
    'Report a short progress milestone to the user while you explore, e.g. {"note": "Detected Spring backend, reading UserController…"}. One line of plain text — never route JSON. This does not submit anything; you still must call submit_routes with the routes.',
  inputSchema: {
    type: 'object',
    properties: {
      note: { type: 'string', description: 'One-line progress note shown to the user.' },
    },
    required: ['note'],
    additionalProperties: false,
  },
};

/** Sanitize a report_progress note: single line, trimmed, length-capped. */
export function progressNote(input: unknown): string {
  if (input === null || typeof input !== 'object') {
    return '';
  }
  const note = (input as Record<string, unknown>).note;
  if (typeof note !== 'string') {
    return '';
  }
  const flattened = note.replace(/\s+/g, ' ').trim();
  return flattened.length > PROGRESS_NOTE_MAX_CHARS
    ? `${flattened.slice(0, PROGRESS_NOTE_MAX_CHARS)}…`
    : flattened;
}

// ---------------------------------------------------------------------------
// Seed formatting (pure)
// ---------------------------------------------------------------------------

/** A seed-scan hit scored separately per API direction. */
export interface DirectionalScoredFile extends ScoredFile {
  clientScore: number;
  serverScore: number;
  /** Language-agnostic universal-signal score; absent on legacy callers. */
  universalScore?: number;
  /** Direction guess when only universal signals scored; absent on legacy callers. */
  universalDirection?: UniversalDirection;
}

// ---------------------------------------------------------------------------
// Mission variant selection (pure)
// ---------------------------------------------------------------------------

export type ScanMissionVariant = 'seeded' | 'recon-first';

/**
 * Which mission the agent runs: the seeded flow (today's behavior) when at
 * least one seed carries real confidence, or the recon-first census flow when
 * the seed scan came back empty or every hit is barely above the threshold.
 */
export function selectMissionVariant(seeds: { score: number }[]): ScanMissionVariant {
  if (seeds.length === 0) {
    return 'recon-first';
  }
  return seeds.every((seed) => seed.score < LOW_CONFIDENCE_SEED_SCORE) ? 'recon-first' : 'seeded';
}

export const LANGUAGE_UNKNOWN_NOTE =
  'Note: every seed file below matched only language-agnostic API signals (literal URL paths, HTTP verbs, payload shapes) — no known framework markers fired, so the implementation language or stack may be unfamiliar. Read the seed files first and derive routes from the literal paths, verbs, and payload shapes you see; do not assume any particular framework.';

/**
 * The 'language-unknown' mission note: present when seeds exist but NONE of
 * them was found by the ecosystem marker heuristics — i.e. every seed owes
 * its place to the universal signal layer alone.
 */
export function languageUnknownNote(
  seeds: { clientScore: number; serverScore: number }[]
): string | undefined {
  if (seeds.length === 0) {
    return undefined;
  }
  const universalOnly = seeds.every(
    (seed) => seed.clientScore < MIN_SCORE && seed.serverScore < MIN_SCORE
  );
  return universalOnly ? LANGUAGE_UNKNOWN_NOTE : undefined;
}

/**
 * Seed teaser for files the marker-based snippet extractor came back empty
 * on (unknown languages): the detected universal signals themselves.
 */
export function universalSeedSnippet(signals: UniversalSignals): string {
  const parts: string[] = [];
  if (signals.urlPaths.length > 0) {
    parts.push(`paths: ${signals.urlPaths.slice(0, 6).join(' ')}`);
  }
  if (signals.absoluteUrls.length > 0) {
    parts.push(`urls: ${signals.absoluteUrls.slice(0, 3).join(' ')}`);
  }
  return parts.join('\n');
}

/**
 * The user-facing reason behind a zero-route completion: the agent's final
 * text reply flattened to one paragraph and length-capped, or a generic
 * fallback when the reply was empty.
 */
export function noApiSurfaceReason(finalText: string): string {
  const flattened = finalText.replace(/\s+/g, ' ').trim();
  if (flattened === '') {
    return NO_API_SURFACE_FALLBACK_REASON;
  }
  return flattened.length > NO_API_SURFACE_REASON_MAX_CHARS
    ? `${flattened.slice(0, NO_API_SURFACE_REASON_MAX_CHARS)}…`
    : flattened;
}

/** First few non-empty snippet lines, trimmed and length-capped. */
export function formatSeedTeaser(
  snippet: string,
  maxLines = SEED_TEASER_LINES,
  maxLineChars = SEED_TEASER_LINE_CHARS
): string {
  return snippet
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines)
    .map((line) => (line.length > maxLineChars ? `${line.slice(0, maxLineChars)}…` : line))
    .join('\n');
}

/**
 * The seed the agent starts from: the top-scored files with a short teaser
 * each — deliberately NOT the full snippets, the agent reads what it needs.
 */
export function formatSeedSection(files: ScoredFile[], maxFiles = SEED_MAX_FILES): string {
  const top = [...files].sort((a, b) => b.score - a.score).slice(0, maxFiles);
  return top
    .map((file) => {
      const teaser = formatSeedTeaser(file.snippet)
        .split('\n')
        .filter(Boolean)
        .map((line) => `    ${line}`)
        .join('\n');
      return `- ${file.path} (score ${file.score})${teaser ? `\n${teaser}` : ''}`;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// Recon surfaces (pure)
// ---------------------------------------------------------------------------

/** One API surface the mission asks the agent to cover. */
export interface SurfaceSeed {
  name: string;
  rootPath: string;
  kind: ProjectKind;
  frameworks: string[];
  direction: ApiDirection;
  specFiles: string[];
  seedSection: string;
  /** Files listed in seedSection. */
  seedFileCount: number;
  /** Seed-scan hits assigned to this surface. */
  matchedFileCount: number;
}

function directionalScoreFor(file: DirectionalScoredFile, direction: ApiDirection): number {
  const preferred =
    direction === 'serves' ? file.serverScore : direction === 'consumes' ? file.clientScore : file.score;
  return preferred > 0 ? preferred : file.score;
}

/**
 * Assign seed-scan hits to the detected projects (deepest enclosing root
 * wins; orphans go to the first, shallowest profile) and produce one
 * SurfaceSeed per project, its seed list re-ranked by the project's API
 * direction. With no profiles at all, everything folds into one default
 * consumes surface named after the workspace — today's single-app behavior.
 */
export function buildSurfaceSeeds(
  profiles: ProjectProfile[],
  files: DirectionalScoredFile[],
  appName: string
): SurfaceSeed[] {
  if (profiles.length === 0) {
    // Universal-only seed sets (unknown languages) can override the default
    // 'consumes': a workspace of route tables should be explored as a server.
    const direction: ApiDirection = universalLean(files) === 'serves' ? 'serves' : 'consumes';
    return [
      {
        name: appName,
        rootPath: '',
        kind: 'unknown',
        frameworks: [],
        direction,
        specFiles: [],
        seedSection: formatSeedSection(files),
        seedFileCount: Math.min(files.length, SEED_MAX_FILES),
        matchedFileCount: files.length,
      },
    ];
  }

  const buckets: DirectionalScoredFile[][] = profiles.map(() => []);
  for (const file of files) {
    let best = -1;
    for (let i = 0; i < profiles.length; i++) {
      const root = profiles[i].rootPath;
      if (root === '' || file.path === root || file.path.startsWith(`${root}/`)) {
        if (best === -1 || root.length > profiles[best].rootPath.length) {
          best = i;
        }
      }
    }
    buckets[best === -1 ? 0 : best].push(file);
  }

  const maxPer = profiles.length > 1 ? SEED_MAX_FILES_MULTI : SEED_MAX_FILES;
  return profiles.map((profile, i) => {
    const ranked = buckets[i].map((file) => ({
      ...file,
      score: directionalScoreFor(file, profile.direction),
    }));
    return {
      name: profile.rootPath === '' ? appName : profile.rootPath,
      rootPath: profile.rootPath,
      kind: profile.kind,
      frameworks: profile.frameworks,
      direction: profile.direction,
      specFiles: profile.specFiles,
      seedSection: formatSeedSection(ranked, maxPer),
      seedFileCount: Math.min(ranked.length, maxPer),
      matchedFileCount: ranked.length,
    };
  });
}

// ---------------------------------------------------------------------------
// Progress (pure)
// ---------------------------------------------------------------------------

function mainToolArg(call: AiToolCall): string {
  const input = (call.input ?? {}) as Record<string, unknown>;
  const value = input.path ?? input.glob ?? input.pattern ?? input.note;
  if (typeof value !== 'string' || value === '') {
    return '';
  }
  return value.length > 60 ? `${value.slice(0, 60)}…` : value;
}

/** Short human description of one tool call, e.g. `read src/api/UserApi.kt`. */
export function describeToolCall(call: AiToolCall): string {
  const arg = mainToolArg(call);
  switch (call.name) {
    case 'read_file':
      return `read ${arg || 'a file'}`;
    case 'list_files':
      return `list ${arg || 'files'}`;
    case 'search_code':
      return `search "${arg}"`;
    case 'report_progress':
      return arg || 'progress note';
    case 'submit_routes':
      return 'submitting routes';
    default:
      return call.name;
  }
}

/** Fraction for the running tool-call index, advancing 0.2 → 0.9. */
export function toolCallFraction(index: number, maxCalls = AGENT_MAX_TOOL_CALLS): number {
  const progress = (index + 1) / Math.max(1, maxCalls);
  return Math.min(0.9, 0.2 + 0.7 * progress);
}

export function formatToolCallProgress(
  call: AiToolCall,
  index: number,
  maxCalls = AGENT_MAX_TOOL_CALLS
): string {
  return `Exploring codebase: ${describeToolCall(call)} (call ${index + 1}/${maxCalls})…`;
}

// ---------------------------------------------------------------------------
// submit_routes bookkeeping (pure)
// ---------------------------------------------------------------------------

/**
 * Key that ties a submitted route back to its declared surface after Zod
 * validation strips the non-core "surface" field. Includes the response
 * status code when available so a negative variant (e.g. the 404 twin of a
 * success route) can belong to a different surface than the route sharing
 * its method+path.
 */
export function routeSurfaceKey(method: unknown, path: unknown, statusCode?: unknown): string {
  const methods = Array.isArray(method)
    ? method.map((m) => String(m)).sort().join(',')
    : String(method ?? '');
  const base = `${methods.toUpperCase()}|${String(path ?? '').toLowerCase()}`;
  return typeof statusCode === 'number' ? `${base}|${statusCode}` : base;
}

/** Status code of a raw (pre-validation) submitted route, if present. */
function rawStatusCode(route: Record<string, unknown>): unknown {
  const response = route.response;
  return response !== null && typeof response === 'object'
    ? (response as Record<string, unknown>).statusCode
    : undefined;
}

const SURFACE_NAME_MAX_CHARS = 120;
const MAX_SURFACE_NAMES = 32;

/** Model-controlled surface names: one trimmed, length-capped line. */
export function sanitizeSurfaceName(raw: string): string {
  const flattened = raw.replace(/\s+/g, ' ').trim();
  return flattened.length > SURFACE_NAME_MAX_CHARS
    ? flattened.slice(0, SURFACE_NAME_MAX_CHARS)
    : flattened;
}

export interface SubmitState {
  /** Failed rounds so far. */
  rejections: number;
  /** True once a submission has been accepted (loop should end). */
  done: boolean;
  /** The accepted routes (only meaningful when done). */
  routes: Omit<RouteConfig, 'id'>[];
  /** Best accepted subset seen across rejected rounds — the salvage pool. */
  salvage: Omit<RouteConfig, 'id'>[];
  /** Rejected-route count of the most recent failed round. */
  prevRejectedCount: number;
  /** Routes that failed an earlier round but passed by acceptance time. */
  repairedCount: number;
  /** Routes still failing at acceptance time. */
  droppedCount: number;
  /**
   * True when the agent deliberately submitted ZERO routes to say the
   * workspace has no HTTP API surface (recon-first missions only). The
   * scanner turns this into a user-facing message instead of an error.
   */
  noApiSurface: boolean;
  /** Surface names declared across submissions (top-level + per-route). */
  surfaceNames: string[];
  /** routeSurfaceKey → declared surface name, latest submission wins. */
  surfaceByKey: Map<string, string>;
  /**
   * Status-aware routeSurfaceKey → EVERY surface declared for it in the
   * latest submission. Two surfaces legitimately sharing an endpoint (an app
   * and the backend it calls both cover GET /api/users 200) collide on one
   * key; this map keeps all of them so the deduped route can be attached to
   * every declaring surface instead of silently vanishing from all but one.
   */
  surfaceNamesByKey: Map<string, string[]>;
}

export function createSubmitState(): SubmitState {
  return {
    rejections: 0,
    done: false,
    routes: [],
    salvage: [],
    prevRejectedCount: 0,
    repairedCount: 0,
    droppedCount: 0,
    noApiSurface: false,
    surfaceNames: [],
    surfaceByKey: new Map(),
    surfaceNamesByKey: new Map(),
  };
}

/**
 * Capture surface declarations from a raw submission before validation
 * strips them: top-level surfaceNames plus per-route "surface" strings.
 */
export function recordSurfaceInfo(state: SubmitState, input: unknown): void {
  if (input === null || typeof input !== 'object') {
    return;
  }
  const record = input as Record<string, unknown>;
  const addName = (value: unknown): void => {
    if (typeof value !== 'string') {
      return;
    }
    const name = sanitizeSurfaceName(value);
    if (name !== '' && !state.surfaceNames.includes(name) && state.surfaceNames.length < MAX_SURFACE_NAMES) {
      state.surfaceNames.push(name);
    }
  };
  if (Array.isArray(record.surfaceNames)) {
    record.surfaceNames.forEach(addName);
  }
  if (!Array.isArray(record.routes)) {
    return;
  }
  // Rebuilt per submission — a correction round's complete resubmission
  // replaces earlier per-key declarations rather than accumulating them.
  state.surfaceNamesByKey = new Map();
  for (const item of record.routes) {
    if (item === null || typeof item !== 'object') {
      continue;
    }
    const route = item as Record<string, unknown>;
    if (typeof route.surface === 'string' && route.surface.trim() !== '') {
      const name = sanitizeSurfaceName(route.surface);
      // Status-aware key first (lets a negative variant live on a different
      // surface), plus the method+path key as a fallback for lookups on
      // routes whose raw submission carried no usable status code.
      const statusKey = routeSurfaceKey(route.method, route.path, rawStatusCode(route));
      state.surfaceByKey.set(statusKey, name);
      state.surfaceByKey.set(routeSurfaceKey(route.method, route.path), name);
      const names = state.surfaceNamesByKey.get(statusKey);
      if (!names) {
        state.surfaceNamesByKey.set(statusKey, [name]);
      } else if (!names.includes(name)) {
        names.push(name);
      }
      addName(route.surface);
    }
  }
}

/**
 * Surface name(s) declared for a validated route: status-aware key first,
 * then the method+path fallback.
 */
function declaredSurfaces(
  route: Omit<RouteConfig, 'id'>,
  surfaceByKey: ReadonlyMap<string, string | readonly string[]>
): string | readonly string[] | undefined {
  return (
    surfaceByKey.get(routeSurfaceKey(route.method, route.path, route.response.statusCode)) ??
    surfaceByKey.get(routeSurfaceKey(route.method, route.path))
  );
}

/**
 * The grouping map for groupRoutesBySurface: status-aware keys carry EVERY
 * surface declared for them in the latest submission (an endpoint shared by
 * an app and its backend belongs to both), while method+path fallback keys
 * keep the latest single declaration.
 */
export function surfaceLookup(state: SubmitState): Map<string, string | readonly string[]> {
  const merged = new Map<string, string | readonly string[]>(state.surfaceByKey);
  for (const [key, names] of state.surfaceNamesByKey) {
    merged.set(key, names.length === 1 ? names[0] : names);
  }
  return merged;
}

const REJECTION_LISTING_MAX_CHARS = 4000;

/** Tool result quoting every verification failure back to the model. */
export function formatRejectionResult(rejected: RejectedRoute[], acceptedCount: number): string {
  let listing = rejected
    .map(({ route, reasons }) => {
      const method = Array.isArray(route.method) ? route.method.join('|') : route.method;
      return `- "${route.name}" (${method} ${route.path}): ${reasons.join('; ')}`;
    })
    .join('\n');
  if (listing.length > REJECTION_LISTING_MAX_CHARS) {
    listing = `${listing.slice(0, REJECTION_LISTING_MAX_CHARS)}…`;
  }
  return `${rejected.length} route(s) failed verification (${acceptedCount} passed):\n${listing}\nFix every listed reason and call submit_routes again with the COMPLETE set of routes, including the ones that passed.`;
}

function acceptRoutes(
  state: SubmitState,
  accepted: Omit<RouteConfig, 'id'>[],
  rejectedCount: number
): void {
  state.done = true;
  // Prefer the model's latest intent; fall back to salvage from earlier rounds.
  state.routes = accepted.length > 0 ? accepted : state.salvage;
  state.droppedCount = rejectedCount;
  state.repairedCount = Math.max(0, state.prevRejectedCount - rejectedCount);
}

/**
 * Handle one submit_routes call: record surface declarations, validate +
 * verify, quote failures back for up to MAX_SUBMIT_REJECTIONS rounds, then
 * accept the valid subset. Mutates state; returns the tool result text.
 *
 * With options.allowEmpty (recon-first missions), an explicit {"routes": []}
 * submission is a legitimate "this workspace has no API surface" answer: it
 * completes the mission with zero routes (state.noApiSurface) instead of
 * being rejected — unless earlier rounds salvaged validated routes, which
 * then win over the contradictory empty claim.
 */
export function handleSubmitRoutes(
  state: SubmitState,
  input: unknown,
  options?: { allowEmpty?: boolean }
): string {
  if (state.done) {
    return ROUTES_ALREADY_ACCEPTED;
  }
  recordSurfaceInfo(state, input);

  if (
    options?.allowEmpty === true &&
    input !== null &&
    typeof input === 'object' &&
    Array.isArray((input as Record<string, unknown>).routes) &&
    ((input as Record<string, unknown>).routes as unknown[]).length === 0
  ) {
    if (state.salvage.length > 0) {
      acceptRoutes(state, [], state.prevRejectedCount);
      return SUBMIT_ROUTES_ACCEPTED_ACK;
    }
    state.done = true;
    state.noApiSurface = true;
    state.routes = [];
    return NO_API_SURFACE_ACK;
  }

  let valid: Omit<RouteConfig, 'id'>[];
  try {
    valid = MockGenerator.validateRoutes(input);
  } catch (error) {
    if (state.rejections >= MAX_SUBMIT_REJECTIONS) {
      acceptRoutes(state, [], state.prevRejectedCount);
      return state.routes.length > 0 ? SUBMIT_ROUTES_ACCEPTED_ACK : ROUTES_ALREADY_ACCEPTED;
    }
    state.rejections++;
    const reason = error instanceof Error ? error.message : String(error);
    return `Submission rejected: ${reason} Call submit_routes again with {"routes": [...]} matching the required route shape.`;
  }

  const { accepted, rejected } = MockGenerator.verifyRoutes(dedupeRoutes(valid));

  if (rejected.length === 0) {
    acceptRoutes(state, accepted, 0);
    return SUBMIT_ROUTES_ACCEPTED_ACK;
  }

  if (state.rejections >= MAX_SUBMIT_REJECTIONS) {
    acceptRoutes(state, accepted, rejected.length);
    return SUBMIT_ROUTES_ACCEPTED_ACK;
  }

  state.rejections++;
  if (accepted.length > state.salvage.length) {
    state.salvage = accepted;
  }
  state.prevRejectedCount = rejected.length;
  return formatRejectionResult(rejected, accepted.length);
}

// ---------------------------------------------------------------------------
// Surface grouping (pure)
// ---------------------------------------------------------------------------

// The surface shape is shared with the fast scanner — one type, one server
// per surface downstream. Re-exported so existing imports keep working.
export type { ScanSurface } from './CodebaseMockGenerator.js';

/** The agentic scan result: the flat back-compat summary plus per-surface routes. */
export interface AgenticScanSummary extends CodebaseScanSummary {
  surfaces: ScanSurface[];
  /** API spec files recon found — a direct import is an alternative to these routes. */
  specFiles: string[];
  /**
   * Present ONLY when the agent explored the workspace and deliberately
   * concluded there is no HTTP API surface to mock (routes/surfaces are empty
   * then): the agent's own explanation, ready for a user-facing message. The
   * command layer should surface it instead of treating the scan as failed.
   */
  noApiSurfaceReason?: string;
}

/**
 * Group the final flattened routes by their declared surface(s). Declared
 * names are clamped to the recon surface list (exact match first, then
 * case-insensitive): a route declaring an unknown name lands on the first
 * recon surface instead of minting a new one, so injected instructions in a
 * scanned repo cannot fan a submission out into unbounded extra mock servers.
 * A key declared for several surfaces (a shared endpoint) is attached to each
 * of them. Recon order is preserved; surfaces with no routes are dropped.
 * Directions come from recon, defaulting to 'consumes'.
 */
export function groupRoutesBySurface(
  routes: Omit<RouteConfig, 'id'>[],
  surfaceByKey: ReadonlyMap<string, string | readonly string[]>,
  recon: { name: string; direction: ApiDirection }[]
): ScanSurface[] {
  const defaultName = recon[0]?.name ?? 'API';
  const clamp = (declared: string): string =>
    recon.find((r) => r.name === declared)?.name ??
    recon.find((r) => r.name.toLowerCase() === declared.toLowerCase())?.name ??
    defaultName;
  const grouped = new Map<string, Omit<RouteConfig, 'id'>[]>();
  for (const { name } of recon) {
    grouped.set(name, []);
  }
  if (!grouped.has(defaultName)) {
    grouped.set(defaultName, []);
  }
  for (const route of routes) {
    const declared = declaredSurfaces(route, surfaceByKey);
    const names =
      declared === undefined
        ? [defaultName]
        : [...new Set((typeof declared === 'string' ? [declared] : declared).map(clamp))];
    for (const name of names) {
      grouped.get(name)?.push(route);
    }
  }
  const directionFor = (name: string): ApiDirection => {
    const match = recon.find((r) => r.name === name);
    if (match) {
      return match.direction;
    }
    return recon.length === 1 ? recon[0].direction : 'consumes';
  };
  const surfaces: ScanSurface[] = [];
  for (const [name, surfaceRoutes] of grouped) {
    if (surfaceRoutes.length > 0) {
      surfaces.push({ name, routes: surfaceRoutes, direction: directionFor(name) });
    }
  }
  return surfaces;
}

// ---------------------------------------------------------------------------
// Mission prompt (pure)
// ---------------------------------------------------------------------------

const GRAPHQL_INSTRUCTIONS = `

## GraphQL
This codebase uses a GraphQL client. Mocklify matches requests on path + method only (it cannot inspect the operation name), so create ONE "POST /graphql" route per operation family (e.g. one for the user queries, one for the order mutations) with a realistic { "data": { ... } } body matching the operations' selection sets. Also add one disabled negative variant per family with status 200 and a { "errors": [{ "message": "…", "extensions": { "code": "…" } }] } body, tagged ["negative", "graphql"].`;

const DIRECTION_STRATEGIES: Record<ApiDirection, string> = {
  consumes:
    'This project CALLS APIs. Explore its HTTP call sites (clients, repositories, services, interceptors), follow imports to the data-model types it parses so every response body matches EXACTLY the shape the client expects, and find its auth and error-body conventions. Mock every endpoint it CALLS so the app can run against the mock server.',
  serves:
    'This project SERVES an API. Explore its route declarations (controllers, routers, URL maps, decorators, route files), then READ THE HANDLERS behind each route — return statements, serializers, DTOs, view models, fixtures — to derive the EXACT response shapes it produces. Mock what this backend SERVES so frontend teams can develop against the mock without running the backend.',
  both:
    'This project both SERVES and CALLS APIs (fullstack). Its served API is this surface: derive routes from its route/handler declarations and read the handlers for exact response shapes; its own client-side calls to those routes confirm the same contract.',
};

function specInstruction(specFiles: string[]): string {
  return `An API specification already exists for this surface: ${specFiles.join(', ')}. Read it FIRST and prefer its exact contract — paths, parameters, status codes, schemas, examples — over inference from code. In your final text reply, mention that the user could also import this spec file directly instead of scanning.`;
}

const KIND_HEADINGS: Record<ProjectKind, string> = {
  web: 'web app',
  'mobile-android': 'Android app',
  'mobile-ios': 'iOS app',
  kmp: 'Kotlin Multiplatform app',
  'react-native': 'React Native app',
  flutter: 'Flutter app',
  'ionic-capacitor': 'Ionic/Capacitor app',
  backend: 'backend service',
  library: 'library',
  unknown: 'project',
};

function surfaceSection(seed: SurfaceSeed): string {
  const frameworks = seed.frameworks.length > 0 ? ` (${seed.frameworks.join(', ')})` : '';
  const at = seed.rootPath === '' ? 'the workspace root' : `${seed.rootPath}/`;
  const parts = [
    `### Surface "${seed.name}" — ${KIND_HEADINGS[seed.kind]}${frameworks} at ${at} [${seed.direction}]`,
    DIRECTION_STRATEGIES[seed.direction],
  ];
  if (seed.specFiles.length > 0) {
    parts.push(specInstruction(seed.specFiles));
  }
  parts.push(
    seed.seedSection
      ? `Seed files (top ${seed.seedFileCount} of ${seed.matchedFileCount} matched by the deterministic scan):\n${seed.seedSection}`
      : 'No pre-scored seed files for this surface — map it with list_files and search_code.'
  );
  return parts.join('\n');
}

/** Route-authoring contract shared by the seeded and recon-first missions. */
function routeAuthoringSection(graphQl: boolean): string {
  return `For EVERY endpoint you find, create:
1. A success route (\`"enabled": true\`) whose response body matches EXACTLY the real contract — for consumed APIs the shape the client code parses, for served APIs the shape the handlers actually return (serializers, DTOs, fixtures). Never guess field names when you can read the model or handler. Use realistic, domain-appropriate example data.
2. Negative-flow routes (\`"enabled": false\`) for realistic failures: 400 validation error (for endpoints with request bodies), 401 unauthorized (when the code involves auth headers/tokens), 403 forbidden (for authenticated endpoints where a role or permission check could fail), 404 not found (for endpoints with path parameters), 429 rate limit (for the most important endpoints — include "Retry-After": "30" in the response headers), and 500 server error (for the most important endpoints). Shape the error bodies the way the code's error handling produces or expects them. Tag every negative route with "negative" plus its status, e.g. "tags": ["negative", "401"]. Also give them names like "GET /api/users/:id — 404 not found".
3. For the 1-3 most critical endpoints, a slow-response simulation route (\`"enabled": false\`) that mirrors the success response (same status and body) but adds "delay": { "type": "fixed", "value": 10000 }, tagged ["negative", "timeout"], named like "GET /api/orders — slow response (10s)".

Rules:
- ONLY include endpoints this code actually calls or serves — never invent endpoints.
- Strip the host/base URL; keep only the path. Convert path variables to :param form.
- Tag positive routes with a short domain tag (e.g. "users", "orders").
- When the success routes for one resource form a CRUD family (GET list + GET by :id + POST/PUT/PATCH/DELETE), give every route in the family the SAME "stateful" field (collection = resource name, idParam = the path's :param name, seed of 3-5 coherent items — each including the id field — on the GET list route only). Never add "stateful" to negative-flow routes or to endpoints outside a CRUD family.${graphQl ? GRAPHQL_INSTRUCTIONS : ''}

## Route JSON shape (for the submit_routes input)

${ROUTE_FORMAT_INSTRUCTIONS}`;
}

/**
 * The recon-informed mission prompt: project inventory, one strategy section
 * per API surface (consumes → mock what it calls; serves → read handlers and
 * mock what it serves; spec files trump inference), multi-surface submission
 * rules, and the shared route-authoring contract. `extraNote` (e.g. the
 * language-unknown note) lands right under the recon inventory.
 */
export function buildMissionPrompt(
  appName: string,
  inventory: string,
  surfaces: SurfaceSeed[],
  graphQl: boolean,
  extraNote?: string
): string {
  const multi = surfaces.length > 1;
  const surfaceSections = surfaces.map(surfaceSection).join('\n\n');
  const noteBlock = extraNote !== undefined && extraNote !== '' ? `\n\n${extraNote}` : '';
  const multiBlock = multi
    ? `\n\n## Multiple API surfaces
This workspace has ${surfaces.length} distinct API surfaces (${surfaces
        .map((s) => `"${s.name}"`)
        .join(', ')}); each becomes its own mock server. Set "surface" on EVERY submitted route to exactly one of those names, and include a top-level "surfaceNames" array listing every name you used. Submit ALL surfaces' routes in the ONE submit_routes call.`
    : '';

  return `You are an expert API reverse-engineer exploring the workspace "${appName}" through read-only tools (list_files / read_file / search_code). A deterministic recon pass already profiled the projects in it and pre-scored the most likely API-related files.

## Recon
${inventory}${noteBlock}

Narrate milestones as you work by calling report_progress with a short one-line note (e.g. {"note": "Detected Spring backend, reading UserController…"}).

## API surfaces (${surfaces.length})

${surfaceSections}${multiBlock}

When you have the full picture, call submit_routes EXACTLY ONCE with every route${multi ? ' across ALL surfaces' : ''}. If the result lists validation problems, fix them and call submit_routes again with the complete corrected set. Do not write route JSON in your text replies.

${routeAuthoringSection(graphQl)}

(The routes go into the submit_routes tool input as {"routes": [...]}${multi ? ' with a "surface" name on each route and a top-level "surfaceNames" array' : ''} — never into your text reply.)`;
}

/**
 * The recon-first mission prompt for workspaces where the deterministic scan
 * found nothing (or only weak hits): hands the agent a workspace census and
 * asks it to work out what the project is and where its API surface lives —
 * and explicitly allows a justified zero-route submission, so the scan never
 * dead-ends in an unexplained "nothing found".
 */
export function buildReconFirstPrompt(
  appName: string,
  inventory: string,
  censusText: string,
  weakSeedSection: string,
  graphQl: boolean,
  surfaceNames: string[] = []
): string {
  const multi = surfaceNames.length > 1;
  const weakBlock = weakSeedSection
    ? `\n\n## Weak candidate files\nThe deterministic scan found only weak, low-confidence signals in these files — verify them with read_file before trusting them:\n${weakSeedSection}`
    : '';
  const multiBlock = multi
    ? `\n\n## Multiple API surfaces\nRecon detected ${surfaceNames.length} projects (${surfaceNames
        .map((name) => `"${name}"`)
        .join(
          ', '
        )}); each becomes its own mock server. Set "surface" on EVERY submitted route to exactly one of those names, and include a top-level "surfaceNames" array listing every name you used.`
    : '';

  return `You are an expert API reverse-engineer exploring the workspace "${appName}" through read-only tools (list_files / read_file / search_code).

No known API patterns were detected in this workspace by the deterministic scan. Here is a census of the workspace. Explore with your tools to determine (a) what kind of project this is, and (b) where its API surface lives — the HTTP calls it makes or the routes it serves — then mock that API surface. Source files may be in ANY language; judge them by the literal URL paths, HTTP verbs, and payload shapes they contain, not by framework names.

## Recon
${inventory}

${censusText}${weakBlock}${multiBlock}

Narrate milestones as you work by calling report_progress with a short one-line note (e.g. {"note": "This looks like a Lua service, reading src/http.lua…"}).

When you have the full picture, call submit_routes EXACTLY ONCE with every route you found. If the result lists validation problems, fix them and call submit_routes again with the complete corrected set. Do not write route JSON in your text replies.

If after exploring you conclude there is genuinely no HTTP API surface in this workspace, call submit_routes with {"routes": []} and then reply with one short paragraph explaining why — it will be shown to the user.

${routeAuthoringSection(graphQl)}

(The routes go into the submit_routes tool input as {"routes": [...]}${multi ? ' with a "surface" name on each route and a top-level "surfaceNames" array' : ''} — never into your text reply.)`;
}

// ---------------------------------------------------------------------------
// The scanner (vscode-coupled)
// ---------------------------------------------------------------------------

export class AgenticScanner {
  constructor(private ai: AiService) {}

  /**
   * Same contract as CodebaseMockGenerator.generate so the command layer can
   * treat both scanners identically; the resolved summary additionally
   * carries per-surface route groups. Throws AgenticScanUnavailableError when
   * the active provider cannot run tool loops — callers should fall back to
   * the fast scan.
   */
  async generate(options?: {
    token?: vscode.CancellationToken;
    onProgress?: (progress: CodebaseScanProgress) => void;
    /**
     * Pre-computed recon (from the ScanOrchestrator) — skips the profiling
     * and seed-scan steps so shared recon is never recomputed. A recon with
     * zero or only weak seed files is fine: the recon-first census mission
     * covers it, exactly as it does for the self-computed path.
     */
    recon?: WorkspaceRecon;
  }): Promise<AgenticScanSummary> {
    // Lazy so the pure exports above stay importable outside the extension host.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const vs: typeof import('vscode') = require('vscode');
    const report = (message: string, fraction: number) =>
      options?.onProgress?.({ message, fraction });

    // Fail fast — before any file I/O — when the provider can't drive tools.
    const provider = await this.ai.resolveProvider();
    if (!provider.runToolLoop) {
      throw new AgenticScanUnavailableError(
        `${provider.label} does not support the agentic scan in Mocklify. Use the fast scan instead, or switch providers with "Mocklify: Select AI Provider".`
      );
    }

    const root = vs.workspace.workspaceFolders?.[0]?.uri;
    if (!root) {
      throw new Error('Open a workspace folder to scan for API calls.');
    }

    // 1. Recon: shared from the ScanOrchestrator when provided (never
    //    recomputed); otherwise profile the projects (best-effort), then run
    //    the inclusive seed scan.
    let profiles: ProjectProfile[] = [];
    let scored: DirectionalScoredFile[] = [];
    let scanned = 0;
    if (options?.recon) {
      profiles = options.recon.profiles;
      scored = options.recon.files;
      scanned = options.recon.scannedFileCount;
    } else {
      report('Profiling workspace projects…', 0.02);
      try {
        profiles = await profileWorkspace(root);
      } catch {
        // Recon is advisory — a plain single-surface scan still works.
      }

      report('Scanning workspace for API usage…', 0.04);
      // Inclusive discovery: every text file is a candidate (path blocklist +
      // binary sniff) instead of the legacy extension whitelist, sampled
      // breadth-fairly under the same read budget the whitelist scan used.
      // Two-pass enumeration keeps known source extensions in the pool even
      // when assets/fixtures outnumber the findFiles cap.
      const uris = await enumerateScanCandidates(MAX_FILES_TO_ENUMERATE);
      const uriByPath = new Map<string, vscode.Uri>();
      for (const uri of uris) {
        const relativePath = vs.workspace.asRelativePath(uri);
        if (shouldScanPath(relativePath)) {
          uriByPath.set(relativePath, uri);
        }
      }
      const candidates = pickScanCandidates([...uriByPath.keys()], MAX_FILES_TO_READ);

      for (const relativePath of candidates) {
        if (options?.token?.isCancellationRequested) {
          throw new vs.CancellationError();
        }
        scanned++;
        if (scanned % 100 === 0) {
          report(
            `Scanning workspace for API usage… (${scanned}/${candidates.length} files)`,
            0.04 + 0.09 * (scanned / candidates.length)
          );
        }
        try {
          const uri = uriByPath.get(relativePath) as vscode.Uri;
          const stat = await vs.workspace.fs.stat(uri);
          if (stat.size > MAX_FILE_BYTES) {
            continue;
          }
          const data = await vs.workspace.fs.readFile(uri);
          if (!isProbablyTextFile(data.subarray(0, TEXT_SNIFF_BYTES))) {
            continue;
          }
          const content = Buffer.from(data).toString('utf-8');
          const { clientScore, serverScore, universalScore, universalDirection } =
            scoreFileUniversal(content, relativePath);
          const score = Math.max(clientScore, serverScore, universalScore);
          if (score >= MIN_SCORE) {
            // Marker-based snippets first; for unknown languages fall back to
            // the universal signals themselves as the teaser.
            const snippet =
              extractApiSnippets(content) || universalSeedSnippet(detectUniversalSignals(content));
            scored.push({
              path: relativePath,
              score,
              clientScore,
              serverScore,
              universalScore,
              universalDirection,
              snippet,
            });
          }
        } catch {
          // Unreadable file — skip
        }
      }
    }

    // 2. Mission prompt. Seeds with real confidence run today's seeded
    //    mission; an empty or all-low-confidence seed set runs the
    //    recon-first census mission instead of erroring out.
    const appName = options?.recon?.appName ?? vs.workspace.workspaceFolders?.[0]?.name ?? 'App';
    const graphQl = scored.some((file) => hasGraphQlMarkers(file.snippet));
    const surfaces = buildSurfaceSeeds(profiles, scored, appName);
    const reconFirst = selectMissionVariant(scored) === 'recon-first';

    let prompt: string;
    if (reconFirst) {
      report('No strong API signals found — taking a workspace census…', 0.14);
      const census = await censusWorkspace(root);
      prompt = buildReconFirstPrompt(
        appName,
        describeProfiles(profiles),
        describeCensus(census),
        scored.length > 0 ? formatSeedSection(scored) : '',
        graphQl,
        surfaces.map((surface) => surface.name)
      );
    } else {
      prompt = buildMissionPrompt(
        appName,
        describeProfiles(profiles),
        surfaces,
        graphQl,
        languageUnknownNote(scored)
      );
    }
    report(`Preparing the exploration agent (${provider.label})…`, 0.16);

    const projectCount = Math.max(1, profiles.length);
    const maxToolCalls = scaleMaxToolCalls(projectCount);
    const budgetMs = scaleScanBudgetMs(projectCount);

    // 3. Tool belt: read-only workspace tools + report_progress + submit_routes
    const tools = createWorkspaceTools(root, scaleReadBudgetBytes(projectCount));
    const state = createSubmitState();
    const deadline = Date.now() + budgetMs;

    // Loop cancellation: fired by the user's token, by the wall-clock budget,
    // or by an accepted submission (providers return quietly on cancel).
    const loopCancel = new vs.CancellationTokenSource();
    const userCancelSub = options?.token?.onCancellationRequested(() => loopCancel.cancel());
    if (options?.token?.isCancellationRequested) {
      loopCancel.cancel();
    }
    const budgetTimer = setTimeout(() => loopCancel.cancel(), budgetMs);

    let lastLabel = `Exploring codebase with ${provider.label}…`;
    let lastFraction = 0.2;
    report(lastLabel, lastFraction);

    const execute: AiToolExecutor = async (call) => {
      if (call.name === SUBMIT_ROUTES_TOOL.name) {
        const result = handleSubmitRoutes(state, call.input, { allowEmpty: reconFirst });
        if (state.done && !state.noApiSurface) {
          loopCancel.cancel(); // accepted — end the loop after this batch
        }
        // A no-API-surface conclusion keeps the loop alive for one more turn
        // so the model can reply with the user-facing reason.
        return result;
      }
      if (call.name === REPORT_PROGRESS_TOOL.name) {
        const note = progressNote(call.input);
        if (note !== '' && !state.done) {
          lastLabel = note;
          report(note, lastFraction);
        }
        return PROGRESS_NOTE_ACK;
      }
      if (state.done) {
        return ROUTES_ALREADY_ACCEPTED;
      }
      if (Date.now() >= deadline - SUBMIT_NUDGE_WINDOW_MS) {
        return TIME_BUDGET_NUDGE;
      }
      return tools.execute({ name: call.name, input: (call.input ?? {}) as Record<string, unknown> });
    };

    let finalText = '';
    try {
      try {
        finalText = await provider.runToolLoop(
          prompt,
          [...tools.definitions, REPORT_PROGRESS_TOOL, SUBMIT_ROUTES_TOOL],
          execute,
          {
            justification: 'Mocklify is exploring your codebase to generate a mock server.',
            token: loopCancel.token,
            maxToolCalls,
            onToolCall: (call, index) => {
              lastLabel = formatToolCallProgress(call, index, maxToolCalls);
              lastFraction = toolCallFraction(index, maxToolCalls);
              report(lastLabel, lastFraction);
            },
            // Liveness while a model turn streams (labels end with '…').
            onData: (chars) =>
              report(`${lastLabel.replace(/…$/, '')} · ${(chars / 1000).toFixed(1)}k received…`, lastFraction),
          }
        );
      } catch (error) {
        // A provider failure after routes were captured (per-turn timeout,
        // rate limit, transient 5xx) must not discard them — end degraded,
        // exactly as if the wall-clock budget had expired quietly.
        if (!state.done && state.salvage.length === 0) {
          throw error;
        }
        console.warn('Mocklify: agentic scan ended early, salvaging routes:', error);
      }
    } finally {
      clearTimeout(budgetTimer);
      userCancelSub?.dispose();
      loopCancel.dispose();
    }

    if (options?.token?.isCancellationRequested) {
      throw new vs.CancellationError();
    }

    // 4. Salvage order: accepted submission → best subset from rejected
    //    rounds → routes parsed out of the final text (belt and braces).
    let routes = state.done ? state.routes : state.salvage;
    let droppedCount = state.done ? state.droppedCount : state.prevRejectedCount;
    const repairedCount = state.done ? state.repairedCount : 0;
    if (routes.length === 0 && finalText && !state.noApiSurface) {
      try {
        routes = MockGenerator.verifyRoutes(
          dedupeRoutes(MockGenerator.validateRoutes(extractJson(finalText)))
        ).accepted;
        droppedCount = 0;
      } catch {
        // Final text held no usable routes — fall through to the error below
      }
    }

    const specFiles = [...new Set(surfaces.flatMap((s) => s.specFiles))];

    if (routes.length === 0) {
      if (state.noApiSurface) {
        // The agent explored and deliberately concluded there is nothing to
        // mock — a clear user-facing answer, not an exception.
        return {
          scannedFileCount: scanned,
          matchedFileCount: scored.length,
          chunkCount: 1,
          routes: [],
          positiveCount: 0,
          negativeCount: 0,
          repairedCount: 0,
          droppedCount: 0,
          surfaces: [],
          specFiles,
          noApiSurfaceReason: noApiSurfaceReason(finalText),
        };
      }
      throw new Error(
        Date.now() >= deadline
          ? `The agentic scan hit its ${Math.round(budgetMs / 60_000)}-minute budget before any valid routes were submitted. Try again, or switch mocklify.ai.scanMode to "fast".`
          : 'The AI exploration did not produce any valid mock routes from this codebase. Try again, use the fast scan, or use "AI: Generate Mock Server from Description" instead.'
      );
    }

    report('Assembling mock server…', 0.95);

    routes = dedupeRoutes(routes);
    // An enabled negative route must outscore the success route sharing its
    // method+path (the matcher keeps the first route on a score tie).
    for (const route of routes) {
      if (route.tags?.includes('negative') && route.priority === undefined) {
        route.priority = NEGATIVE_ROUTE_PRIORITY;
      }
    }

    const negativeCount = routes.filter((r) => r.tags?.includes('negative')).length;

    return {
      scannedFileCount: scanned,
      matchedFileCount: scored.length,
      chunkCount: 1, // one agent session — kept for summary-shape parity
      routes,
      positiveCount: routes.length - negativeCount,
      negativeCount,
      repairedCount,
      droppedCount,
      surfaces: groupRoutesBySurface(
        routes,
        surfaceLookup(state),
        surfaces.map((s) => ({ name: s.name, direction: s.direction }))
      ),
      specFiles,
    };
  }
}
