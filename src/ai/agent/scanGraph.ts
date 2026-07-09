import type * as vscode from 'vscode';
import { Annotation, END, Send, START, StateGraph } from '@langchain/langgraph';
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import { NEGATIVE_ROUTE_PRIORITY, RouteConfig } from '../../types/core.js';
import type {
  AiRequestOptions,
  AiToolDefinition,
  AiToolExecutor,
  AiToolLoopOptions,
} from '../providers/types.js';
import {
  PROGRESS_NOTE_ACK,
  REPORT_PROGRESS_TOOL,
  ROUTES_ALREADY_ACCEPTED,
  SUBMIT_NUDGE_WINDOW_MS,
  SUBMIT_ROUTES_TOOL,
  TIME_BUDGET_NUDGE,
  buildMissionPrompt,
  buildReconFirstPrompt,
  buildSurfaceSeeds,
  createSubmitState,
  formatSeedSection,
  formatToolCallProgress,
  groupRoutesBySurface,
  handleSubmitRoutes,
  languageUnknownNote,
  noApiSurfaceReason,
  progressNote,
  routeSurfaceKey,
  scaleMaxToolCalls,
  scaleReadBudgetBytes,
  scaleScanBudgetMs,
  selectMissionVariant,
  surfaceLookup,
  AGENT_MAX_TOOL_CALLS,
  MAX_TOOL_CALLS_CAP,
  MULTI_PROJECT_READ_BUDGET_BYTES,
  SCAN_BUDGET_CAP_MS,
  type AgenticScanSummary,
} from '../AgenticScanner.js';
import {
  collectWorkspaceRecon,
  type CodebaseScanProgress,
  type ScanSurface,
  type WorkspaceRecon,
} from '../CodebaseMockGenerator.js';
import { extractJson } from '../extractJson.js';
import { MockGenerator, ROUTES_JSON_SCHEMA, ROUTE_FORMAT_INSTRUCTIONS } from '../MockGenerator.js';
import { dedupeRoutes } from '../scan/heuristics.js';
import { hasGraphQlMarkers } from '../scan/modelContext.js';
import { censusWorkspace, describeCensus } from '../scan/census.js';
import { describeProfiles, type ApiDirection } from '../scan/projectProfile.js';
import {
  buildScanMemoryFromSummary,
  createScanMemoryStore,
  describeScanMemory,
  mergeScanMemory,
  type ScanMemoryStore,
} from '../scan/scanMemory.js';
import {
  DEFAULT_READ_BUDGET_BYTES,
  createWorkspaceTools,
  type WorkspaceTools,
} from './workspaceTools.js';
import {
  FileCheckpointSaver,
  createScanGraphRuntime,
  createVscodeCheckpointStorage,
  type CheckpointStorage,
  type QuestionHandler,
  type ScanGraphRuntime,
  type ScanGraphRuntimeOptions,
} from './graphRuntime.js';
import {
  ASK_USER_TOOL,
  ASK_USER_UNAVAILABLE_MESSAGE,
  createAskUserState,
  executeAskUser,
  sanitizeAskUserInput,
} from './askUser.js';

/**
 * The scan graph: the agentic codebase scan re-expressed as a LangGraph
 * StateGraph with parallel per-surface exploration and a verification loop.
 *
 * LANGGRAPH IS ORCHESTRATION-ONLY. Every node below is a plain async function
 * that calls Mocklify's own AI layer (AiService.runToolLoop /
 * sendJsonRequest) through the injected {@link ScanGraphAi}; no LangChain
 * model classes, adapters, tools, or prompts appear anywhere in this module.
 *
 * Topology:
 *
 *   START → recon → dispatch ⇄ exploreSurface (Send fanout, ≤3 per wave)
 *         → collect → verify → [repair → reVerify]? → finalize → END
 *
 * - recon reuses the shared workspace recon (profiles + seed scan), loads the
 *   workspace scan memory (describeScanMemory) into the mission context, and
 *   plans one exploration mission per API surface (or a single recon-first
 *   census mission when the seed scan found nothing trustworthy).
 * - dispatch fans pending missions out via the Send API, at most
 *   {@link SURFACE_CONCURRENCY} per superstep; exploreSurface branches edge
 *   back to dispatch so remaining missions run in the next wave. Each
 *   superstep is checkpointed, so a resumed thread skips completed surfaces.
 * - exploreSurface runs the same hardened read-only workspaceTools +
 *   submit_routes flow as AgenticScanner (identical submit bookkeeping and
 *   salvage semantics); a branch failure salvages that surface's partial
 *   routes without touching the other branches.
 * - verify is a CRITIC with fresh context: a new runToolLoop call per surface
 *   under a tight budget that checks the proposed routes against the actual
 *   code and returns verdicts through its own strict-dialect JSON schema.
 * - Routes marked wrong get ONE bounded repair round (MockGenerator repair
 *   prompt style) and the repaired subset alone is re-verified.
 * - finalize reuses MockGenerator.verifyRoutes + NEGATIVE_ROUTE_PRIORITY
 *   stamping and persists what the scan learned via buildScanMemoryFromSummary
 *   + mergeScanMemory.
 *
 * Everything except createDefaultScanGraphDeps is vitest-importable: the
 * vscode-coupled collaborators are injected through {@link ScanGraphDeps}.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum exploreSurface branches running in one superstep (one wave). */
export const SURFACE_CONCURRENCY = 3;
/** No mission gets fewer tool calls than this, however many surfaces exist. */
export const MIN_SURFACE_TOOL_CALLS = 12;
/** No mission gets less wall clock than this, however many surfaces exist. */
export const MIN_SURFACE_BUDGET_MS = 3 * 60_000;
/** Tool-execution cap for one critic (verify) session. */
export const VERIFY_MAX_TOOL_CALLS = 10;
/** Wall-clock budget for one critic (verify) session. */
export const VERIFY_BUDGET_MS = 3 * 60_000;
/** Read budget for one critic session — it only spot-checks files. */
export const VERIFY_READ_BUDGET_BYTES = 256 * 1024;
/** Routes sent through the single bounded repair round at most. */
export const MAX_REPAIR_ROUTES = 20;
/** Ceiling on the repair prompt's route listing. */
export const MAX_REPAIR_PROMPT_CHARS = 16_000;
/** Ceiling on the critic prompt's route listing. */
export const CRITIC_LISTING_MAX_CHARS = 12_000;
/** Response-body preview per route in the critic prompt. */
export const CRITIC_BODY_PREVIEW_CHARS = 400;
/** Explored file paths remembered per branch (for scan memory). */
export const EXPLORED_PATHS_MAX = 400;

export const SUBMIT_VERDICTS_ACK = 'Verdicts recorded — stop calling tools and reply "done".';
export const VERDICTS_ALREADY_RECORDED =
  'Verdicts were already recorded — stop calling tools and reply "done".';
export const INVALID_VERDICTS_MESSAGE =
  'No valid verdicts found — call submit_verdicts again with {"verdicts": [{"routeKey": "…", "verdict": "confirmed" | "wrong", "reason": "…"}]} covering every listed routeKey.';

/** Human-friendly labels for the graph's nodes (progress UI). */
export const SCAN_NODE_LABELS: Record<string, string> = {
  recon: 'Profiling workspace',
  dispatch: 'Planning surface exploration',
  exploreSurface: 'Exploring an API surface',
  collect: 'Merging surface routes',
  verify: 'Verifying routes against the code',
  repair: 'Repairing rejected routes',
  reVerify: 'Re-verifying repaired routes',
  finalize: 'Assembling mock server',
};

/**
 * Thrown when the LangGraph pipeline cannot even be constructed (a langgraph
 * import/runtime problem). Callers catch it and fall back to the legacy
 * non-graph AgenticScanner path.
 */
export class GraphUnavailableError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'GraphUnavailableError';
  }
}

// ---------------------------------------------------------------------------
// Budget division (pure) — existing scalers ÷ concurrency-aware
// ---------------------------------------------------------------------------

/**
 * Tool calls granted to ONE surface mission: the workspace-wide budget from
 * the existing scaler divided across missions (each mission is its own tool
 * loop), floored at {@link MIN_SURFACE_TOOL_CALLS}.
 */
export function divideToolCalls(projectCount: number, missionCount: number): number {
  const total = scaleMaxToolCalls(projectCount);
  return Math.max(MIN_SURFACE_TOOL_CALLS, Math.ceil(total / Math.max(1, missionCount)));
}

/**
 * Wall clock granted to ONE surface mission: the workspace-wide budget from
 * the existing scaler divided across WAVES (up to {@link SURFACE_CONCURRENCY}
 * missions share a wave's wall clock), floored at
 * {@link MIN_SURFACE_BUDGET_MS}.
 */
export function divideBudgetMs(projectCount: number, missionCount: number): number {
  const total = scaleScanBudgetMs(projectCount);
  const waves = Math.ceil(Math.max(1, missionCount) / SURFACE_CONCURRENCY);
  return Math.max(MIN_SURFACE_BUDGET_MS, Math.floor(total / Math.max(1, waves)));
}

// ---------------------------------------------------------------------------
// Mission planning (pure)
// ---------------------------------------------------------------------------

/** One exploreSurface branch's serializable work order. */
export interface SurfaceMission {
  /** Unique mission name (the surface name; the app name for recon-first). */
  name: string;
  direction: ApiDirection;
  /** The full mission prompt for the exploration tool loop. */
  prompt: string;
  /** True for the census mission (empty submissions allowed). */
  reconFirst: boolean;
  /** Seed-file section reused by the critic prompt. */
  seedSection: string;
  /** Surfaces this mission's routes may be grouped into. */
  groupSurfaces: { name: string; direction: ApiDirection; rootPath: string }[];
  maxToolCalls: number;
  budgetMs: number;
  readBudgetBytes: number;
}

/** Recon facts the final summary needs. */
export interface ScanReconMeta {
  appName: string;
  scannedFileCount: number;
  matchedFileCount: number;
  specFiles: string[];
}

export interface ScanMissionPlan {
  missions: SurfaceMission[];
  meta: ScanReconMeta;
}

/**
 * Plan the exploration missions from the shared recon: one seeded mission per
 * detected API surface (per-surface seed teasers, concurrency-aware divided
 * budgets), or a single recon-first census mission when the seed scan found
 * nothing (or only weak hits). `memoryBlock` (describeScanMemory output) is
 * appended to the recon inventory so every mission knows what previous scans
 * learned.
 */
export function buildSurfaceMissions(
  recon: WorkspaceRecon,
  censusText: string,
  memoryBlock: string
): ScanMissionPlan {
  const surfaces = buildSurfaceSeeds(recon.profiles, recon.files, recon.appName);
  const graphQl = recon.files.some((file) => hasGraphQlMarkers(file.snippet));
  const inventoryBase = describeProfiles(recon.profiles);
  const inventory = memoryBlock !== '' ? `${inventoryBase}\n\n${memoryBlock}` : inventoryBase;
  const projectCount = Math.max(1, recon.profiles.length);
  const specFiles = [...new Set(surfaces.flatMap((surface) => surface.specFiles))];
  const meta: ScanReconMeta = {
    appName: recon.appName,
    scannedFileCount: recon.scannedFileCount,
    matchedFileCount: recon.files.length,
    specFiles,
  };

  if (selectMissionVariant(recon.files) === 'recon-first') {
    const seedSection = recon.files.length > 0 ? formatSeedSection(recon.files) : '';
    return {
      missions: [
        {
          name: recon.appName,
          direction: surfaces[0]?.direction ?? 'consumes',
          prompt: buildReconFirstPrompt(
            recon.appName,
            inventory,
            censusText,
            seedSection,
            graphQl,
            surfaces.map((surface) => surface.name)
          ),
          reconFirst: true,
          seedSection,
          groupSurfaces: surfaces.map((surface) => ({
            name: surface.name,
            direction: surface.direction,
            rootPath: surface.rootPath,
          })),
          maxToolCalls: scaleMaxToolCalls(projectCount),
          budgetMs: scaleScanBudgetMs(projectCount),
          readBudgetBytes: scaleReadBudgetBytes(projectCount),
        },
      ],
      meta,
    };
  }

  const note = languageUnknownNote(recon.files);
  const maxToolCalls = divideToolCalls(projectCount, surfaces.length);
  const budgetMs = divideBudgetMs(projectCount, surfaces.length);
  return {
    missions: surfaces.map((seed) => ({
      name: seed.name,
      direction: seed.direction,
      prompt: buildMissionPrompt(recon.appName, inventory, [seed], graphQl, note),
      reconFirst: false,
      seedSection: seed.seedSection,
      groupSurfaces: [{ name: seed.name, direction: seed.direction, rootPath: seed.rootPath }],
      maxToolCalls,
      budgetMs,
      readBudgetBytes: DEFAULT_READ_BUDGET_BYTES,
    })),
    meta,
  };
}

/** Missions with no result yet — the dispatch node's work queue. */
export function pendingMissions(
  missions: readonly SurfaceMission[],
  results: readonly SurfaceScanResult[]
): SurfaceMission[] {
  const done = new Set(results.map((result) => result.missionName));
  return missions.filter((mission) => !done.has(mission.name));
}

// ---------------------------------------------------------------------------
// Surface results + collection (pure)
// ---------------------------------------------------------------------------

/** What one exploreSurface branch produced. */
export interface SurfaceScanResult {
  missionName: string;
  surfaces: ScanSurface[];
  routes: Omit<RouteConfig, 'id'>[];
  /** Routes fixed across the branch's own submit correction rounds. */
  repairedCount: number;
  /** Routes still failing at the branch's acceptance time. */
  droppedCount: number;
  noApiSurfaceReason?: string;
  /** Present when the branch's tool loop failed and partials were salvaged. */
  error?: string;
  /** Files the branch actually read (scan-memory input). */
  exploredPaths: string[];
}

export interface CollectedScan {
  routes: Omit<RouteConfig, 'id'>[];
  surfaces: ScanSurface[];
  repairedCount: number;
  droppedCount: number;
  noApiSurfaceReason?: string;
  errors: string[];
}

/**
 * Merge the per-surface branch results: routes flattened and deduped (the
 * same per-surface dedupe discipline as ScanOrchestrator.mergeScanSummaries),
 * surfaces concatenated (empty ones dropped), counts summed. The scan
 * concludes "no API surface" only when EVERY branch did and nothing errored.
 */
export function collectSurfaceResults(results: readonly SurfaceScanResult[]): CollectedScan {
  const routes = dedupeRoutes(results.flatMap((result) => result.routes));
  const surfaces = results
    .flatMap((result) => result.surfaces)
    .filter((surface) => surface.routes.length > 0);
  const errors = results.flatMap((result) => (result.error !== undefined ? [result.error] : []));
  const reasons = results
    .map((result) => result.noApiSurfaceReason)
    .filter((reason): reason is string => reason !== undefined);
  const collected: CollectedScan = {
    routes,
    surfaces,
    repairedCount: results.reduce((sum, result) => sum + result.repairedCount, 0),
    droppedCount: results.reduce((sum, result) => sum + result.droppedCount, 0),
    errors,
  };
  if (
    routes.length === 0 &&
    errors.length === 0 &&
    results.length > 0 &&
    reasons.length === results.length
  ) {
    collected.noApiSurfaceReason = reasons.join(' ');
  }
  return collected;
}

// ---------------------------------------------------------------------------
// Verification (pure pieces)
// ---------------------------------------------------------------------------

export type RouteVerdictValue = 'confirmed' | 'wrong';

export interface RouteVerdict {
  routeKey: string;
  verdict: RouteVerdictValue;
  reason?: string;
  suggestedFix?: string;
}

/**
 * The critic's structured-output schema, written to the same strict dialect
 * as ROUTES_JSON_SCHEMA: object root, additionalProperties: false everywhere,
 * no min/max constraints.
 */
export const VERDICTS_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          routeKey: { type: 'string', description: 'The routeKey exactly as listed in the mission.' },
          verdict: { type: 'string', enum: ['confirmed', 'wrong'] },
          reason: { type: 'string', description: 'One line: what the code contradicts (required for "wrong").' },
          suggestedFix: { type: 'string', description: 'Optional one-line fix, e.g. the correct field name or path.' },
        },
        required: ['routeKey', 'verdict'],
        additionalProperties: false,
      },
    },
  },
  required: ['verdicts'],
  additionalProperties: false,
};

/** The critic hands its verdicts over through this tool. */
export const SUBMIT_VERDICTS_TOOL: AiToolDefinition = {
  name: 'submit_verdicts',
  description:
    'Submit your final verdicts for the proposed mock routes. Call this exactly once, after checking the code, with one verdict per listed routeKey as {"verdicts": [...]}. Never put verdict JSON in your text reply — it is only read from this tool.',
  inputSchema: VERDICTS_JSON_SCHEMA,
};

/** Stable identity of a route across the verify/repair pipeline. */
export function verificationRouteKey(route: Omit<RouteConfig, 'id'>): string {
  return routeSurfaceKey(route.method, route.path, route.response.statusCode);
}

function singleLine(raw: string, maxChars: number): string {
  const flattened = raw.replace(/\s+/g, ' ').trim();
  return flattened.length > maxChars ? `${flattened.slice(0, maxChars)}…` : flattened;
}

/** Best-effort parse of a submit_verdicts input; invalid entries are dropped. */
export function parseVerdicts(input: unknown): RouteVerdict[] {
  if (input === null || typeof input !== 'object') {
    return [];
  }
  const list = (input as Record<string, unknown>).verdicts;
  if (!Array.isArray(list)) {
    return [];
  }
  const out: RouteVerdict[] = [];
  for (const item of list) {
    if (item === null || typeof item !== 'object') {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (typeof record.routeKey !== 'string' || record.routeKey.trim() === '') {
      continue;
    }
    const verdict =
      record.verdict === 'wrong' ? 'wrong' : record.verdict === 'confirmed' ? 'confirmed' : undefined;
    if (verdict === undefined) {
      continue;
    }
    const entry: RouteVerdict = { routeKey: singleLine(record.routeKey, 200), verdict };
    if (typeof record.reason === 'string' && record.reason.trim() !== '') {
      entry.reason = singleLine(record.reason, 300);
    }
    if (typeof record.suggestedFix === 'string' && record.suggestedFix.trim() !== '') {
      entry.suggestedFix = singleLine(record.suggestedFix, 300);
    }
    out.push(entry);
    if (out.length >= 200) {
      break;
    }
  }
  return out;
}

/** A route the critic rejected, with everything the repair round needs. */
export interface WrongRoute {
  surfaceName: string;
  routeKey: string;
  reason: string;
  suggestedFix?: string;
  route: Omit<RouteConfig, 'id'>;
}

export interface VerdictSplit<T> {
  confirmed: T[];
  wrong: { route: T; reason: string; suggestedFix?: string }[];
}

/**
 * Split routes by the critic's verdicts. FAIL-OPEN by design: a route with no
 * verdict (or a verdict for an unknown key) stays confirmed — verification
 * can only ever demote routes it explicitly checked and contradicted.
 */
export function applyVerdicts<T extends Omit<RouteConfig, 'id'>>(
  routes: readonly T[],
  verdicts: readonly RouteVerdict[]
): VerdictSplit<T> {
  const byKey = new Map<string, RouteVerdict>();
  for (const verdict of verdicts) {
    if (!byKey.has(verdict.routeKey)) {
      byKey.set(verdict.routeKey, verdict);
    }
  }
  const split: VerdictSplit<T> = { confirmed: [], wrong: [] };
  for (const route of routes) {
    const verdict = byKey.get(verificationRouteKey(route));
    if (verdict?.verdict === 'wrong') {
      split.wrong.push({
        route,
        reason: verdict.reason ?? 'flagged wrong by code verification',
        ...(verdict.suggestedFix !== undefined ? { suggestedFix: verdict.suggestedFix } : {}),
      });
    } else {
      split.confirmed.push(route);
    }
  }
  return split;
}

function formatRouteForCritic(route: Omit<RouteConfig, 'id'>): string {
  const method = Array.isArray(route.method) ? route.method.join('|') : route.method;
  const body = route.response.body?.content;
  let preview = '';
  if (body !== undefined) {
    try {
      preview = `, response body: ${singleLine(JSON.stringify(body), CRITIC_BODY_PREVIEW_CHARS)}`;
    } catch {
      preview = '';
    }
  }
  return `- routeKey "${verificationRouteKey(route)}": ${method} ${route.path} → ${route.response.statusCode}${preview}`;
}

/**
 * The critic mission: fresh context, the proposed routes for ONE surface plus
 * its seed files, read-only tools, and a submit_verdicts contract.
 */
export function buildCriticPrompt(
  surfaceName: string,
  direction: ApiDirection,
  routes: readonly Omit<RouteConfig, 'id'>[],
  seedSection: string,
  options?: { reVerify?: boolean }
): string {
  let listing = routes.map(formatRouteForCritic).join('\n');
  if (listing.length > CRITIC_LISTING_MAX_CHARS) {
    listing = `${listing.slice(0, CRITIC_LISTING_MAX_CHARS)}…`;
  }
  const reVerifyNote =
    options?.reVerify === true
      ? '\n\nThese routes were REPAIRED after failing an earlier review — verify only them, with fresh eyes.'
      : '';
  const seeds = seedSection
    ? `## Seed files (from the deterministic scan)\n${seedSection}`
    : '## Seed files\nNone pre-scored — locate the relevant code with search_code and list_files.';

  return `You are a skeptical API-contract reviewer with read-only access to this workspace (list_files / read_file / search_code). Proposed mock routes for the API surface "${surfaceName}" [${direction}] are listed below. Verify each one against the ACTUAL code: read the files that declare or call the endpoint and check the HTTP method, the path (including :param form), the response status code, and that the response body's field names and nesting match the real contract.${reVerifyNote}

## Proposed routes
${listing}

${seeds}

When you are done, call submit_verdicts EXACTLY ONCE with one verdict per routeKey listed above. Mark a route "wrong" ONLY when the code contradicts it (wrong field names, wrong path, wrong method, wrong status); give a one-line reason and, when obvious, a short suggestedFix. Routes you could not check stay "confirmed". Do not write verdict JSON in your text replies.`;
}

/**
 * The bounded repair prompt — same style as CodebaseMockGenerator's repair
 * round: quote each rejected route with its reasons, ask for corrected
 * versions that preserve intent, allow dropping the unfixable.
 */
export function buildRepairPrompt(wrong: readonly WrongRoute[]): string {
  const bounded = wrong.slice(0, MAX_REPAIR_ROUTES);
  let listing = JSON.stringify(
    bounded.map(({ route, reason, suggestedFix }) => ({
      route,
      rejectionReasons: [reason, ...(suggestedFix !== undefined ? [`suggested fix: ${suggestedFix}`] : [])],
    })),
    null,
    2
  );
  if (listing.length > MAX_REPAIR_PROMPT_CHARS) {
    listing = JSON.stringify(
      bounded.map(({ route, reason }) => ({
        route: { name: route.name, method: route.method, path: route.path, response: route.response },
        rejectionReasons: [reason],
      }))
    ).slice(0, MAX_REPAIR_PROMPT_CHARS);
  }

  return `These generated mock routes were rejected by Mocklify's code verification for the reasons listed with each one. Return corrected versions that fix every listed reason while preserving the route's intent (same endpoint, method, and realistic response data). Omit any route you cannot fix.

${listing}

Return a JSON array of the corrected route objects only.

${ROUTE_FORMAT_INSTRUCTIONS}`;
}

/** Which surface a repaired route belongs to (its key may have changed). */
export function attributeRepairedRoute(
  route: Omit<RouteConfig, 'id'>,
  wrong: readonly WrongRoute[]
): string {
  const exact = wrong.find((entry) => entry.routeKey === verificationRouteKey(route));
  if (exact) {
    return exact.surfaceName;
  }
  const methodPath = routeSurfaceKey(route.method, route.path);
  const loose = wrong.find(
    (entry) => routeSurfaceKey(entry.route.method, entry.route.path) === methodPath
  );
  return (loose ?? wrong[0])?.surfaceName ?? '';
}

export interface VerifyOutcome {
  wrong: WrongRoute[];
  /** Total verdicts the critics returned (0 = verification never landed). */
  verdictCount: number;
  criticErrors: string[];
}

export interface RepairCandidate {
  surfaceName: string;
  route: Omit<RouteConfig, 'id'>;
}

export interface RepairOutcome {
  accepted: RepairCandidate[];
}

export interface ScanVerification {
  confirmed: number;
  repaired: number;
  dropped: number;
}

/** The graph's result: the familiar summary plus verification counts. */
export interface ScanGraphSummary extends AgenticScanSummary {
  verification?: ScanVerification;
}

/**
 * Rebuild the per-surface groups over the FINAL route objects (identity
 * matters — priorities were stamped on them): each collected surface keeps
 * the final versions of its routes, repaired routes land on the surface the
 * wrong original belonged to, and any orphaned route falls back to the first
 * surface. Empty surfaces are dropped.
 */
export function rebuildSurfaces(
  surfaces: readonly ScanSurface[],
  finalRoutes: readonly Omit<RouteConfig, 'id'>[],
  repaired: readonly RepairCandidate[]
): ScanSurface[] {
  const byKey = new Map<string, Omit<RouteConfig, 'id'>>();
  for (const route of finalRoutes) {
    byKey.set(verificationRouteKey(route), route);
  }
  const attached = new Set<string>();
  const out: ScanSurface[] = [];
  for (const surface of surfaces) {
    const kept: Omit<RouteConfig, 'id'>[] = [];
    const push = (key: string): void => {
      const final = byKey.get(key);
      if (final !== undefined && !kept.includes(final)) {
        kept.push(final);
        attached.add(key);
      }
    };
    for (const route of surface.routes) {
      push(verificationRouteKey(route));
    }
    for (const candidate of repaired) {
      if (candidate.surfaceName === surface.name) {
        push(verificationRouteKey(candidate.route));
      }
    }
    if (kept.length > 0) {
      out.push({ ...surface, routes: kept });
    }
  }
  const orphans = finalRoutes.filter((route) => !attached.has(verificationRouteKey(route)));
  if (orphans.length > 0) {
    if (out.length > 0) {
      out[0] = { ...out[0], routes: [...out[0].routes, ...orphans] };
    } else if (surfaces.length > 0) {
      out.push({ ...surfaces[0], routes: [...orphans] });
    } else {
      out.push({ name: 'API', direction: 'consumes', routes: [...orphans] });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dependencies (injected; default assembly is the only vscode-coupled part)
// ---------------------------------------------------------------------------

/**
 * The slice of Mocklify's AI layer the graph nodes call. AiService satisfies
 * this structurally — graph nodes never talk to a model any other way.
 */
export interface ScanGraphAi {
  runToolLoop(
    prompt: string,
    tools: AiToolDefinition[],
    execute: AiToolExecutor,
    options?: AiToolLoopOptions
  ): Promise<string>;
  sendJsonRequest<T = unknown>(
    prompt: string,
    options?: AiRequestOptions,
    schema?: Record<string, unknown>
  ): Promise<T>;
}

/** A cancellable token source for one tool loop (vscode CTS or a test fake). */
export interface LoopCancellation {
  token: vscode.CancellationToken;
  cancel(): void;
  dispose(): void;
}

export interface ScanGraphDeps {
  ai: ScanGraphAi;
  /** The shared workspace recon (pre-computed or collected on demand). */
  recon(): Promise<WorkspaceRecon>;
  /** Census text for recon-first missions (describeCensus output). */
  census(): Promise<string>;
  /** Fresh hardened read-only tools for one branch/critic session. */
  createTools(readBudgetBytes: number): WorkspaceTools;
  memory: ScanMemoryStore;
  createLoopCancellation(): LoopCancellation;
  /** Checkpoint persistence; in-memory when omitted. */
  storage?: CheckpointStorage;
  /**
   * Answers ask_user questions raised by exploration branches (QuickPick /
   * InputBox in production). When absent, the ask_user tool is not offered.
   */
  askUser?: QuestionHandler;
  /** Override for the 120s ask_user answer timeout (tests). */
  askUserTimeoutMs?: number;
}

/**
 * Production wiring — the only place this module touches vscode (lazily, so
 * every export above stays importable under vitest).
 */
export function createDefaultScanGraphDeps(
  ai: ScanGraphAi,
  options?: {
    token?: vscode.CancellationToken;
    onProgress?: (progress: CodebaseScanProgress) => void;
    recon?: WorkspaceRecon;
    /** Answers ask_user questions from exploration branches. */
    onQuestion?: QuestionHandler;
  }
): ScanGraphDeps {
  // Lazy so the pure exports above stay importable outside the extension host.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const vs: typeof import('vscode') = require('vscode');
  const root = vs.workspace.workspaceFolders?.[0]?.uri;
  if (!root) {
    throw new Error('Open a workspace folder to scan for API calls.');
  }
  const shared = options?.recon;
  return {
    ai,
    recon: shared
      ? async () => shared
      : () => collectWorkspaceRecon({ token: options?.token, onProgress: options?.onProgress }),
    census: async () => describeCensus(await censusWorkspace(root)),
    createTools: (readBudgetBytes) => createWorkspaceTools(root, readBudgetBytes),
    memory: createScanMemoryStore(root),
    createLoopCancellation: () => {
      const source = new vs.CancellationTokenSource();
      return {
        token: source.token,
        cancel: () => source.cancel(),
        dispose: () => source.dispose(),
      };
    },
    storage: createVscodeCheckpointStorage(root),
    ...(options?.onQuestion !== undefined ? { askUser: options.onQuestion } : {}),
  };
}

// ---------------------------------------------------------------------------
// Graph state
// ---------------------------------------------------------------------------

const last = <T>(_prev: T, next: T): T => next;

const ScanGraphAnnotation = Annotation.Root({
  missions: Annotation<SurfaceMission[]>({ reducer: last, default: () => [] }),
  meta: Annotation<ScanReconMeta | undefined>({ reducer: last, default: () => undefined }),
  results: Annotation<SurfaceScanResult[]>({
    reducer: (prev, next) => prev.concat(next),
    default: () => [],
  }),
  collected: Annotation<CollectedScan | undefined>({ reducer: last, default: () => undefined }),
  verifyOutcome: Annotation<VerifyOutcome | undefined>({ reducer: last, default: () => undefined }),
  repairOutcome: Annotation<RepairOutcome | undefined>({ reducer: last, default: () => undefined }),
  summary: Annotation<ScanGraphSummary | undefined>({ reducer: last, default: () => undefined }),
});

export type ScanGraphState = typeof ScanGraphAnnotation.State;

// ---------------------------------------------------------------------------
// Node helpers
// ---------------------------------------------------------------------------

function isCancellationLike(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'Canceled' || error.name === 'AbortError' || error.name === 'CancellationError')
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Cancel a loop when the graph's AbortSignal fires or a budget expires. */
function linkCancellation(
  cancel: LoopCancellation,
  signal: AbortSignal | undefined,
  budgetMs: number
): () => void {
  const onAbort = (): void => cancel.cancel();
  if (signal?.aborted) {
    cancel.cancel();
  } else {
    signal?.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => cancel.cancel(), budgetMs);
  return () => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    cancel.dispose();
  };
}

/**
 * One critic session over a fresh tool belt: read-only exploration plus
 * submit_verdicts, under the tight verify budget. Returns the verdicts, or
 * undefined when the critic never produced any (callers fail open).
 */
async function runCritic(
  deps: ScanGraphDeps,
  prompt: string,
  signal: AbortSignal | undefined
): Promise<RouteVerdict[] | undefined> {
  const tools = deps.createTools(VERIFY_READ_BUDGET_BYTES);
  const cancel = deps.createLoopCancellation();
  const unlink = linkCancellation(cancel, signal, VERIFY_BUDGET_MS);
  let submitted: RouteVerdict[] | undefined;

  const execute: AiToolExecutor = async (call) => {
    if (call.name === SUBMIT_VERDICTS_TOOL.name) {
      const verdicts = parseVerdicts(call.input);
      if (verdicts.length === 0) {
        return INVALID_VERDICTS_MESSAGE;
      }
      submitted = verdicts;
      cancel.cancel();
      return SUBMIT_VERDICTS_ACK;
    }
    if (submitted !== undefined) {
      return VERDICTS_ALREADY_RECORDED;
    }
    return tools.execute({ name: call.name, input: (call.input ?? {}) as Record<string, unknown> });
  };

  try {
    const finalText = await deps.ai.runToolLoop(
      prompt,
      [...tools.definitions, SUBMIT_VERDICTS_TOOL],
      execute,
      {
        justification: 'Mocklify is verifying generated mock routes against your code.',
        token: cancel.token,
        maxToolCalls: VERIFY_MAX_TOOL_CALLS,
        jsonSchema: VERDICTS_JSON_SCHEMA,
      }
    );
    if (submitted === undefined && finalText !== '') {
      // Belt and braces: some models answer in text despite the tool contract.
      try {
        const parsed = parseVerdicts(extractJson(finalText));
        if (parsed.length > 0) {
          submitted = parsed;
        }
      } catch {
        // fail open — no verdicts
      }
    }
  } finally {
    unlink();
  }
  return submitted;
}

// ---------------------------------------------------------------------------
// Graph construction
// ---------------------------------------------------------------------------

/**
 * Build the scan StateGraph (uncompiled — the runtime compiles it with its
 * checkpointer). Throws whatever langgraph throws; runScanGraph wraps that in
 * GraphUnavailableError.
 */
export function buildScanGraph(
  deps: ScanGraphDeps,
  onProgress?: (progress: CodebaseScanProgress) => void
): StateGraph<typeof ScanGraphAnnotation.spec> {
  const report = (message: string, fraction: number): void =>
    onProgress?.({ message, fraction });

  const reconNode = async (): Promise<Partial<ScanGraphState>> => {
    report('Profiling workspace projects…', 0.03);
    const recon = await deps.recon();
    let memoryBlock = '';
    try {
      memoryBlock = describeScanMemory(await deps.memory.load());
    } catch {
      // Memory is an optimization — never fail recon over it.
    }
    let censusText = '';
    if (selectMissionVariant(recon.files) === 'recon-first') {
      report('No strong API signals found — taking a workspace census…', 0.1);
      try {
        censusText = await deps.census();
      } catch {
        censusText = '';
      }
    }
    const plan = buildSurfaceMissions(recon, censusText, memoryBlock);
    report(
      `Planned ${plan.missions.length} exploration mission${plan.missions.length === 1 ? '' : 's'}…`,
      0.16
    );
    return { missions: plan.missions, meta: plan.meta };
  };

  const dispatchNode = async (): Promise<Partial<ScanGraphState>> => ({});

  const dispatchRoute = (state: ScanGraphState): Send[] | 'collect' => {
    const pending = pendingMissions(state.missions, state.results);
    if (pending.length === 0) {
      return 'collect';
    }
    return pending
      .slice(0, SURFACE_CONCURRENCY)
      .map((mission) => new Send('exploreSurface', { mission }));
  };

  const exploreNode = async (
    state: ScanGraphState,
    config?: LangGraphRunnableConfig
  ): Promise<Partial<ScanGraphState>> => {
    // Send args, not the full graph state.
    const { mission: rawMission } = state as unknown as { mission: SurfaceMission };
    // Missions can arrive from a checkpoint file on disk, so their budgets are
    // untrusted input: clamp to the legitimate scaler ranges before spending.
    const mission = clampMissionBudgets(rawMission);
    const signal = config?.signal;
    const tools = deps.createTools(mission.readBudgetBytes);
    const submit = createSubmitState();
    const askState = createAskUserState();
    const cancel = deps.createLoopCancellation();
    const unlink = linkCancellation(cancel, signal, mission.budgetMs);
    const deadline = Date.now() + mission.budgetMs;
    const exploredPaths: string[] = [];
    let lastFraction = 0.2;

    const execute: AiToolExecutor = async (call) => {
      if (call.name === SUBMIT_ROUTES_TOOL.name) {
        const result = handleSubmitRoutes(submit, call.input, { allowEmpty: mission.reconFirst });
        if (submit.done && !submit.noApiSurface) {
          cancel.cancel(); // accepted — end the loop after this batch
        }
        return result;
      }
      if (call.name === REPORT_PROGRESS_TOOL.name) {
        const note = progressNote(call.input);
        if (note !== '' && !submit.done) {
          report(note, lastFraction);
        }
        return PROGRESS_NOTE_ACK;
      }
      if (submit.done) {
        return ROUTES_ALREADY_ACCEPTED;
      }
      if (Date.now() >= deadline - SUBMIT_NUDGE_WINDOW_MS) {
        return TIME_BUDGET_NUDGE;
      }
      if (call.name === ASK_USER_TOOL.name) {
        const askUser = deps.askUser;
        if (askUser === undefined) {
          return ASK_USER_UNAVAILABLE_MESSAGE;
        }
        const preview = sanitizeAskUserInput(call.input);
        if (preview !== undefined) {
          report(`[${mission.name}] Waiting for your answer: ${preview.question}`, lastFraction);
        }
        // Bridges to the runtime's HumanQuestion channel; rejects only on
        // cancellation (which unwinds the branch to a resumable checkpoint).
        return executeAskUser(askState, call.input, {
          ask: askUser,
          ...(signal !== undefined ? { signal } : {}),
          ...(deps.askUserTimeoutMs !== undefined ? { timeoutMs: deps.askUserTimeoutMs } : {}),
        });
      }
      if (call.name === 'read_file') {
        const path = (call.input as Record<string, unknown> | null)?.path;
        if (typeof path === 'string' && exploredPaths.length < EXPLORED_PATHS_MAX) {
          exploredPaths.push(path);
        }
      }
      return tools.execute({ name: call.name, input: (call.input ?? {}) as Record<string, unknown> });
    };

    let finalText = '';
    let branchError: unknown;
    try {
      finalText = await deps.ai.runToolLoop(
        mission.prompt,
        [
          ...tools.definitions,
          REPORT_PROGRESS_TOOL,
          ...(deps.askUser !== undefined ? [ASK_USER_TOOL] : []),
          SUBMIT_ROUTES_TOOL,
        ],
        execute,
        {
          justification: 'Mocklify is exploring your codebase to generate a mock server.',
          token: cancel.token,
          maxToolCalls: mission.maxToolCalls,
          onToolCall: (call, index) => {
            lastFraction = Math.min(0.7, 0.2 + 0.5 * ((index + 1) / Math.max(1, mission.maxToolCalls)));
            report(
              `[${mission.name}] ${formatToolCallProgress(call, index, mission.maxToolCalls)}`,
              lastFraction
            );
          },
        }
      );
    } catch (error) {
      // Cancellation aborts the whole run (resumable from the checkpoint);
      // anything else is a per-branch failure — salvage this surface's
      // partial and leave the other branches untouched.
      if (signal?.aborted || isCancellationLike(error)) {
        throw error;
      }
      branchError = error;
      console.warn(`Mocklify: surface branch "${mission.name}" ended early, salvaging:`, error);
    } finally {
      unlink();
    }

    // Providers return their partial text instead of throwing when the token is
    // cancelled mid-loop (Copilot, Claude). Without this the branch would commit
    // as a completed surface holding no routes, and a resumed run would skip it
    // forever. The branch's own budget timer is not a cancellation — only an
    // aborted run signal is.
    if (signal?.aborted) {
      const cancelled = new Error('The scan was cancelled.');
      cancelled.name = 'AbortError';
      throw cancelled;
    }

    // Salvage order mirrors AgenticScanner: accepted submission → best subset
    // from rejected rounds → routes parsed out of the final text.
    let routes = submit.done ? submit.routes : submit.salvage;
    let droppedCount = submit.done ? submit.droppedCount : submit.prevRejectedCount;
    const repairedCount = submit.done ? submit.repairedCount : 0;
    if (routes.length === 0 && finalText !== '' && !submit.noApiSurface) {
      try {
        routes = MockGenerator.verifyRoutes(
          dedupeRoutes(MockGenerator.validateRoutes(extractJson(finalText)))
        ).accepted;
        droppedCount = 0;
      } catch {
        // Final text held no usable routes.
      }
    }
    routes = dedupeRoutes(routes);

    // Grouped surfaces regain their recon rootPath so scan memory can
    // attribute explored files to the right project.
    const grouped = groupRoutesBySurface(routes, surfaceLookup(submit), mission.groupSurfaces).map(
      (surface) => {
        const group = mission.groupSurfaces.find((entry) => entry.name === surface.name);
        return group !== undefined ? { ...surface, rootPath: group.rootPath } : surface;
      }
    );
    const result: SurfaceScanResult = {
      missionName: mission.name,
      routes,
      surfaces: grouped,
      repairedCount,
      droppedCount,
      exploredPaths,
    };
    if (submit.noApiSurface && routes.length === 0) {
      result.noApiSurfaceReason = noApiSurfaceReason(finalText);
    }
    if (branchError !== undefined) {
      result.error = `Exploring "${mission.name}" failed: ${errorMessage(branchError)}${
        routes.length > 0 ? ' (partial routes were salvaged)' : ''
      }`;
    }
    return { results: [result] };
  };

  const collectNode = async (state: ScanGraphState): Promise<Partial<ScanGraphState>> => {
    report('Merging surface results…', 0.72);
    return { collected: collectSurfaceResults(state.results) };
  };

  const verifyNode = async (
    state: ScanGraphState,
    config?: LangGraphRunnableConfig
  ): Promise<Partial<ScanGraphState>> => {
    const collected = state.collected;
    if (!collected || collected.routes.length === 0) {
      return { verifyOutcome: { wrong: [], verdictCount: 0, criticErrors: [] } };
    }
    const wrongByKey = new Map<string, WrongRoute>();
    let verdictCount = 0;
    const criticErrors: string[] = [];
    for (const surface of collected.surfaces) {
      report(`Verifying ${surface.routes.length} route(s) for "${surface.name}"…`, 0.76);
      const seedSection =
        state.missions.find((mission) =>
          mission.groupSurfaces.some((group) => group.name === surface.name)
        )?.seedSection ?? '';
      try {
        const verdicts = await runCritic(
          deps,
          buildCriticPrompt(surface.name, surface.direction, surface.routes, seedSection),
          config?.signal
        );
        if (verdicts === undefined) {
          continue; // critic never landed — fail open for this surface
        }
        verdictCount += verdicts.length;
        for (const entry of applyVerdicts(surface.routes, verdicts).wrong) {
          const key = verificationRouteKey(entry.route);
          if (!wrongByKey.has(key)) {
            wrongByKey.set(key, {
              surfaceName: surface.name,
              routeKey: key,
              reason: entry.reason,
              ...(entry.suggestedFix !== undefined ? { suggestedFix: entry.suggestedFix } : {}),
              route: entry.route,
            });
          }
        }
      } catch (error) {
        if (config?.signal?.aborted || isCancellationLike(error)) {
          throw error;
        }
        // Verification is advisory — a failed critic never drops routes.
        criticErrors.push(`Verifying "${surface.name}" failed: ${errorMessage(error)}`);
        console.warn(`Mocklify: route verification for "${surface.name}" failed:`, error);
      }
    }
    return {
      verifyOutcome: { wrong: [...wrongByKey.values()], verdictCount, criticErrors },
    };
  };

  const verifyRoute = (state: ScanGraphState): 'repair' | 'finalize' =>
    (state.verifyOutcome?.wrong.length ?? 0) > 0 ? 'repair' : 'finalize';

  const repairNode = async (
    state: ScanGraphState,
    config?: LangGraphRunnableConfig
  ): Promise<Partial<ScanGraphState>> => {
    const wrong = state.verifyOutcome?.wrong ?? [];
    report(`Repairing ${wrong.length} route(s) flagged by verification…`, 0.86);
    const bounded = wrong.slice(0, MAX_REPAIR_ROUTES);
    let accepted: RepairCandidate[] = [];
    try {
      const raw = await deps.ai.sendJsonRequest(
        buildRepairPrompt(bounded),
        { justification: 'Mocklify is repairing mock routes that failed code verification.' },
        ROUTES_JSON_SCHEMA
      );
      const repaired = MockGenerator.verifyRoutes(MockGenerator.validateRoutes(raw)).accepted;
      accepted = repaired.map((route) => ({
        surfaceName: attributeRepairedRoute(route, bounded),
        route,
      }));
    } catch (error) {
      if (config?.signal?.aborted || isCancellationLike(error)) {
        throw error;
      }
      // ONE bounded round — a failed repair just drops the wrong routes.
      console.warn('Mocklify: verification repair round failed:', error);
    }
    return { repairOutcome: { accepted } };
  };

  const reVerifyNode = async (
    state: ScanGraphState,
    config?: LangGraphRunnableConfig
  ): Promise<Partial<ScanGraphState>> => {
    const candidates = state.repairOutcome?.accepted ?? [];
    if (candidates.length === 0) {
      return { repairOutcome: { accepted: [] } };
    }
    report(`Re-verifying ${candidates.length} repaired route(s)…`, 0.9);
    const bySurface = new Map<string, RepairCandidate[]>();
    for (const candidate of candidates) {
      const list = bySurface.get(candidate.surfaceName) ?? [];
      list.push(candidate);
      bySurface.set(candidate.surfaceName, list);
    }
    const accepted: RepairCandidate[] = [];
    for (const [surfaceName, group] of bySurface) {
      const mission = state.missions.find((entry) =>
        entry.groupSurfaces.some((surface) => surface.name === surfaceName)
      );
      const direction =
        mission?.groupSurfaces.find((surface) => surface.name === surfaceName)?.direction ??
        'consumes';
      try {
        const verdicts = await runCritic(
          deps,
          buildCriticPrompt(
            surfaceName,
            direction,
            group.map((candidate) => candidate.route),
            mission?.seedSection ?? '',
            { reVerify: true }
          ),
          config?.signal
        );
        if (verdicts === undefined) {
          accepted.push(...group); // critic never landed — fail open
          continue;
        }
        const split = applyVerdicts(
          group.map((candidate) => candidate.route),
          verdicts
        );
        for (const route of split.confirmed) {
          accepted.push({ surfaceName, route });
        }
        // Wrong again after the one repair round → dropped, never re-repaired.
      } catch (error) {
        if (config?.signal?.aborted || isCancellationLike(error)) {
          throw error;
        }
        accepted.push(...group); // fail open
        console.warn(`Mocklify: re-verification for "${surfaceName}" failed:`, error);
      }
    }
    return { repairOutcome: { accepted } };
  };

  const finalizeNode = async (state: ScanGraphState): Promise<Partial<ScanGraphState>> => {
    const collected = state.collected;
    const meta = state.meta;
    if (!collected || !meta) {
      throw new Error('The scan graph reached finalize without recon results.');
    }
    const verifyOutcome = state.verifyOutcome ?? { wrong: [], verdictCount: 0, criticErrors: [] };
    const repairAccepted = state.repairOutcome?.accepted ?? [];

    const wrongKeys = new Set(verifyOutcome.wrong.map((entry) => entry.routeKey));
    const confirmed = collected.routes.filter(
      (route) => !wrongKeys.has(verificationRouteKey(route))
    );
    // Final safety net — the same programmatic checks every scan path runs.
    const finalCheck = MockGenerator.verifyRoutes(
      dedupeRoutes([...confirmed, ...repairAccepted.map((candidate) => candidate.route)])
    );
    const routes = finalCheck.accepted;

    if (routes.length === 0) {
      if (collected.noApiSurfaceReason !== undefined) {
        const summary: ScanGraphSummary = {
          scannedFileCount: meta.scannedFileCount,
          matchedFileCount: meta.matchedFileCount,
          chunkCount: state.missions.length,
          routes: [],
          positiveCount: 0,
          negativeCount: 0,
          repairedCount: 0,
          droppedCount: 0,
          surfaces: [],
          specFiles: meta.specFiles,
          noApiSurfaceReason: collected.noApiSurfaceReason,
        };
        await persistScanMemory(deps, summary, state.results);
        return { summary };
      }
      throw new Error(
        collected.errors[0] ??
          'The AI exploration did not produce any valid mock routes from this codebase. Try again, use the fast scan, or use "AI: Generate Mock Server from Description" instead.'
      );
    }

    // An enabled negative route must outscore the success route sharing its
    // method+path (the matcher keeps the first route on a score tie).
    for (const route of routes) {
      if (route.tags?.includes('negative') && route.priority === undefined) {
        route.priority = NEGATIVE_ROUTE_PRIORITY;
      }
    }
    const negativeCount = routes.filter((route) => route.tags?.includes('negative')).length;
    const verificationDropped = Math.max(0, verifyOutcome.wrong.length - repairAccepted.length);

    const summary: ScanGraphSummary = {
      scannedFileCount: meta.scannedFileCount,
      matchedFileCount: meta.matchedFileCount,
      chunkCount: state.missions.length, // one agent session per mission
      routes,
      positiveCount: routes.length - negativeCount,
      negativeCount,
      repairedCount: collected.repairedCount + repairAccepted.length,
      droppedCount: collected.droppedCount + verificationDropped + finalCheck.rejected.length,
      surfaces: rebuildSurfaces(collected.surfaces, routes, repairAccepted),
      specFiles: meta.specFiles,
    };
    if (verifyOutcome.verdictCount > 0) {
      summary.verification = {
        confirmed: Math.max(0, routes.length - repairAccepted.length),
        repaired: repairAccepted.length,
        dropped: verificationDropped,
      };
    }
    await persistScanMemory(deps, summary, state.results);
    report('Assembling mock server…', 0.95);
    return { summary };
  };

  return new StateGraph(ScanGraphAnnotation)
    .addNode('recon', reconNode)
    .addNode('dispatch', dispatchNode)
    .addNode('exploreSurface', exploreNode)
    .addNode('collect', collectNode)
    .addNode('verify', verifyNode)
    .addNode('repair', repairNode)
    .addNode('reVerify', reVerifyNode)
    .addNode('finalize', finalizeNode)
    .addEdge(START, 'recon')
    .addEdge('recon', 'dispatch')
    .addConditionalEdges('dispatch', dispatchRoute, ['exploreSurface', 'collect'])
    .addEdge('exploreSurface', 'dispatch')
    .addEdge('collect', 'verify')
    .addConditionalEdges('verify', verifyRoute, ['repair', 'finalize'])
    .addEdge('repair', 'reVerify')
    .addEdge('reVerify', 'finalize')
    .addEdge('finalize', END) as unknown as StateGraph<typeof ScanGraphAnnotation.spec>;
}

/** What the scan learned, persisted for future scans. Never throws. */
async function persistScanMemory(
  deps: ScanGraphDeps,
  summary: ScanGraphSummary,
  results: readonly SurfaceScanResult[]
): Promise<void> {
  try {
    const explored = results.flatMap((result) => result.exploredPaths);
    const built = buildScanMemoryFromSummary(summary, explored);
    const previous = await deps.memory.load();
    await deps.memory.save(mergeScanMemory(previous, built));
  } catch (error) {
    console.warn('Mocklify: failed to persist scan memory:', error);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface RunScanGraphOptions {
  token?: vscode.CancellationToken;
  onProgress?: (progress: CodebaseScanProgress) => void;
  /**
   * Answers ask_user questions raised by exploration branches (and any graph
   * interrupts). Without it the ask_user tool is not offered to the model.
   */
  onQuestion?: QuestionHandler;
  /** Shared recon from the orchestrator — never recomputed when given. */
  recon?: WorkspaceRecon;
  /** Checkpoint thread; pass the same id with `resume` to continue a run. */
  threadId?: string;
  /** Resume the checkpointed thread, skipping completed surfaces. */
  resume?: boolean;
  /** Full collaborator override (tests, custom wiring). */
  deps?: ScanGraphDeps;
  /** Runtime factory override (tests). */
  createRuntime?: (options: ScanGraphRuntimeOptions) => ScanGraphRuntime;
}

/**
 * Run the whole scan as a LangGraph pipeline and return the familiar
 * AgenticScanSummary shape plus verification counts. Throws
 * {@link GraphUnavailableError} when the graph cannot be CONSTRUCTED (the
 * caller falls back to the legacy AgenticScanner); scan-time failures
 * propagate as ordinary errors, and cancellations abort with an AbortError
 * that leaves a resumable checkpoint behind.
 */
export async function runScanGraph(
  ai: ScanGraphAi,
  options: RunScanGraphOptions = {}
): Promise<ScanGraphSummary> {
  let graph: ReturnType<typeof buildScanGraph>;
  let runtime: ScanGraphRuntime;
  try {
    // Deps assembly is part of construction: a failure here (vscode missing,
    // no workspace folder, …) must read as "graph unavailable" so the caller
    // falls back to the legacy AgenticScanner instead of failing the scan.
    const baseDeps = options.deps ?? createDefaultScanGraphDeps(ai, options);
    const deps: ScanGraphDeps =
      options.onQuestion !== undefined && baseDeps.askUser === undefined
        ? { ...baseDeps, askUser: options.onQuestion }
        : baseDeps;
    const onQuestion = options.onQuestion ?? deps.askUser;
    graph = buildScanGraph(deps, options.onProgress);
    const runtimeOptions: ScanGraphRuntimeOptions = {
      storage: deps.storage,
      threadId: options.threadId,
      cancellationToken: options.token,
      nodeLabels: SCAN_NODE_LABELS,
      ...(onQuestion !== undefined ? { onQuestion } : {}),
      onWarning: (message) => console.warn(`Mocklify: ${message}`),
    };
    runtime = options.createRuntime
      ? options.createRuntime(runtimeOptions)
      : createScanGraphRuntime(runtimeOptions);
  } catch (error) {
    throw new GraphUnavailableError(
      `The LangGraph scan pipeline could not be constructed: ${errorMessage(error)}`,
      error
    );
  }

  // "Start fresh" must be fresh: LangGraph resumes channel values from any
  // checkpoint on the thread id, so a non-resume run over a dirty thread would
  // silently inherit the previous run's completed surfaces and their routes.
  if (options.resume !== true) {
    await discardThread(runtime);
  }

  let state: ScanGraphState | undefined;
  try {
    state = await runtime.run<ScanGraphState>(
      graph as unknown as Parameters<ScanGraphRuntime['run']>[0],
      options.resume === true ? null : {}
    );
  } catch (error) {
    // Only a cancellation leaves a checkpoint worth resuming. A terminal
    // failure would otherwise poison the thread: the next scan sees a resume
    // offer that deterministically fails again.
    if (!isCancellationLike(error)) {
      await discardThread(runtime);
    }
    throw error;
  }

  const summary = state?.summary;
  if (summary === undefined) {
    await discardThread(runtime);
    throw new Error('The scan graph completed without producing a result.');
  }
  await discardThread(runtime); // the run finished — its checkpoints are spent
  return summary;
}

/**
 * Bound a mission's budgets to the ranges the scalers can legitimately
 * produce. Missions are checkpointed to disk, so a tampered (or simply stale)
 * checkpoint must never buy an attacker-chosen tool-call, wall-clock, or read
 * budget when the thread is resumed.
 */
export function clampMissionBudgets(mission: SurfaceMission): SurfaceMission {
  const bound = (value: unknown, min: number, max: number, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.min(max, Math.max(min, Math.floor(value)))
      : fallback;

  return {
    ...mission,
    maxToolCalls: bound(mission.maxToolCalls, 1, MAX_TOOL_CALLS_CAP, AGENT_MAX_TOOL_CALLS),
    budgetMs: bound(mission.budgetMs, 1_000, SCAN_BUDGET_CAP_MS, SCAN_BUDGET_CAP_MS),
    readBudgetBytes: bound(
      mission.readBudgetBytes,
      1_024,
      MULTI_PROJECT_READ_BUDGET_BYTES,
      MULTI_PROJECT_READ_BUDGET_BYTES
    ),
  };
}

/** Best-effort checkpoint cleanup; never fails a scan. */
async function discardThread(runtime: ScanGraphRuntime): Promise<void> {
  try {
    await runtime.deleteThread();
  } catch {
    // best-effort cleanup
  }
}

// ---------------------------------------------------------------------------
// Resume: thread-id derivation, detection, continuation
// ---------------------------------------------------------------------------

/**
 * Bump when the scan pipeline's shape changes incompatibly (mission planning,
 * state annotation, budgets…): old checkpoints are then ignored and deleted
 * instead of resumed into a graph they no longer fit.
 */
export const SCAN_GRAPH_CONFIG_REVISION = '1';
/** Checkpoints older than this are stale — ignored and deleted. */
export const RESUMABLE_SCAN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** FNV-1a 32-bit, hex — tiny, stable, dependency-free. */
function fnv1aHex(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Every derived scan thread id for this workspace starts with this. */
export function scanThreadIdPrefix(workspaceFsPath: string): string {
  return `scan-ws${fnv1aHex(workspaceFsPath)}-`;
}

/**
 * The deterministic checkpoint thread id for agentic scans of a workspace:
 * one resumable scan per (workspace, config revision). A config-revision bump
 * changes the id, so incompatible checkpoints are simply never found.
 */
export function deriveScanThreadId(
  workspaceFsPath: string,
  configRevision: string = SCAN_GRAPH_CONFIG_REVISION
): string {
  return `${scanThreadIdPrefix(workspaceFsPath)}cfg${fnv1aHex(configRevision)}`;
}

/** Matches any derived scan thread id (any workspace, any revision). */
const DERIVED_THREAD_ID = /^scan-ws[0-9a-f]{8}-cfg[0-9a-f]{8}$/;

export interface ResumableScanInfo {
  threadId: string;
  /** Epoch ms of the interrupted run's earliest checkpoint. */
  startedAt: number;
  completedSurfaces: number;
  totalSurfaces: number;
}

export interface HasResumableScanOptions {
  /** Defaults to {@link SCAN_GRAPH_CONFIG_REVISION}. */
  configRevision?: string;
  /** Storage override (tests). Defaults to the workspace's .mocklify store. */
  storage?: CheckpointStorage;
  /** Clock override (tests). */
  now?: number;
  /** Staleness override (tests). Defaults to {@link RESUMABLE_SCAN_MAX_AGE_MS}. */
  maxAgeMs?: number;
}

function defaultCheckpointStorage(workspaceRoot: vscode.Uri | string): CheckpointStorage {
  // Lazy so this module stays importable outside the extension host.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const vs: typeof import('vscode') = require('vscode');
  const uri = typeof workspaceRoot === 'string' ? vs.Uri.file(workspaceRoot) : workspaceRoot;
  return createVscodeCheckpointStorage(uri);
}

/**
 * Detect an interrupted agentic scan that can be resumed. Reads the derived
 * thread's latest checkpoint and reports how far the run got. Stale
 * checkpoints — older than 24h, from a different config revision, already
 * finished, or unreadable — are ignored AND deleted, so a stale file is only
 * ever inspected once. Never throws; any storage problem reads as "nothing
 * to resume".
 */
export async function hasResumableScan(
  workspaceRoot: vscode.Uri | string,
  options: HasResumableScanOptions = {}
): Promise<ResumableScanInfo | null> {
  try {
    const fsPath = typeof workspaceRoot === 'string' ? workspaceRoot : workspaceRoot.fsPath;
    const storage = options.storage ?? defaultCheckpointStorage(workspaceRoot);
    const threadId = deriveScanThreadId(fsPath, options.configRevision);
    const now = options.now ?? Date.now();
    const maxAgeMs = options.maxAgeMs ?? RESUMABLE_SCAN_MAX_AGE_MS;

    const entries = await storage.list();
    let candidate: (typeof entries)[number] | undefined;
    for (const entry of entries) {
      if (entry.id === threadId) {
        candidate = entry;
        continue;
      }
      // The checkpoint dir belongs to ONE workspace, so any other derived id
      // is a different config revision (or a moved workspace root) — stale.
      // Non-derived leftovers (crashed ad-hoc runs) go once they age out.
      if (DERIVED_THREAD_ID.test(entry.id) || now - entry.mtime > maxAgeMs) {
        try {
          await storage.delete(entry.id);
        } catch {
          // best-effort eviction
        }
      }
    }
    if (candidate === undefined) {
      return null;
    }
    const evict = async (): Promise<null> => {
      try {
        await storage.delete(threadId);
      } catch {
        // best-effort eviction
      }
      return null;
    };

    const saver = new FileCheckpointSaver(storage);
    const tuple = await saver.getTuple({ configurable: { thread_id: threadId } });
    if (tuple === undefined) {
      return await evict(); // corrupt/empty checkpoint file — nothing usable
    }
    const latestTs = Date.parse(tuple.checkpoint.ts);
    const latest = Number.isFinite(latestTs) ? latestTs : candidate.mtime;
    if (now - latest > maxAgeMs) {
      return await evict(); // >24h old — stale
    }

    const channels = tuple.checkpoint.channel_values as Record<string, unknown>;
    if (channels.summary !== undefined) {
      return await evict(); // the run actually finished — nothing to resume
    }
    const missions = Array.isArray(channels.missions) ? channels.missions : [];
    if (missions.length === 0) {
      return await evict(); // died before planning anything — fresh scan is equal
    }

    // Completed surfaces live in the results channel AND in pendingWrites of
    // the interrupted superstep (branches that finished before the abort).
    const done = new Set<string>();
    const addMissionNames = (value: unknown): void => {
      if (!Array.isArray(value)) {
        return;
      }
      for (const item of value) {
        const name = (item as { missionName?: unknown } | null)?.missionName;
        if (typeof name === 'string') {
          done.add(name);
        }
      }
    };
    addMissionNames(channels.results);
    for (const write of tuple.pendingWrites ?? []) {
      if (write[1] === 'results') {
        addMissionNames(write[2]);
      }
    }

    let startedAt = latest;
    try {
      for await (const item of saver.list({ configurable: { thread_id: threadId } })) {
        const ts = Date.parse(item.checkpoint.ts);
        if (Number.isFinite(ts) && ts < startedAt) {
          startedAt = ts;
        }
      }
    } catch {
      // best-effort — the latest checkpoint's timestamp is close enough
    }

    return {
      threadId,
      startedAt,
      completedSurfaces: Math.min(done.size, missions.length),
      totalSurfaces: missions.length,
    };
  } catch {
    return null; // detection must never break starting a fresh scan
  }
}

/**
 * Continue an interrupted scan from its checkpoints: completed surface
 * branches are NOT re-explored (their results replay from pendingWrites);
 * everything downstream (collect → verify → finalize) runs as usual. Get the
 * threadId from {@link hasResumableScan}.
 */
export async function resumeScanGraph(
  ai: ScanGraphAi,
  threadId: string,
  options: Omit<RunScanGraphOptions, 'threadId' | 'resume'> = {}
): Promise<ScanGraphSummary> {
  return runScanGraph(ai, { ...options, threadId, resume: true });
}
