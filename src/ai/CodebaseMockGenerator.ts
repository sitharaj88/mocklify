import type * as vscode from 'vscode';
import { NEGATIVE_ROUTE_PRIORITY, RouteConfig } from '../types/core.js';
import type { AiService, AiRequestOptions } from './AiService.js';
import {
  MockGenerator,
  ROUTE_FORMAT_INSTRUCTIONS,
  ROUTES_JSON_SCHEMA,
  RejectedRoute,
} from './MockGenerator.js';
import {
  SCAN_EXCLUDE_GLOB,
  ScoredFile,
  extractApiSnippets,
  extractModelReferences,
  extractTypeDefinitions,
  chunkScoredFiles,
  dedupeRoutes,
} from './scan/heuristics.js';
import {
  hasGraphQlMarkers,
  modelFileNameCandidates,
  formatModelSection,
  ModelFileContext,
} from './scan/modelContext.js';
import {
  detectUniversalSignals,
  isProbablyTextFile,
  pickScanCandidates,
  scoreFileUniversal,
  shouldScanPath,
  universalLean,
  type UniversalDirection,
} from './scan/universalSignals.js';
import { censusWorkspace, describeCensus } from './scan/census.js';
import { enumerateScanCandidates } from './scan/enumerateFiles.js';
import { MAX_FILES_TO_ENUMERATE, universalSeedSnippet } from './AgenticScanner.js';
import {
  describeProfiles,
  profileWorkspace,
  type ApiDirection,
  type ProjectKind,
  type ProjectProfile,
} from './scan/projectProfile.js';

// Lazy so the pure exports below stay importable outside the extension host
// (vitest), same pattern as workspaceTools/projectProfile.
function vs(): typeof import('vscode') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('vscode');
}

const MAX_FILES_TO_READ = 600;
const MAX_FILE_BYTES = 262_144; // skip generated/bundled monsters
const MIN_SCORE = 10; // at least one strong API marker
/** Bytes sniffed per file to reject binaries (inclusive discovery). */
const TEXT_SNIFF_BYTES = 8192;

const CHUNK_CHAR_BUDGET = 24_000; // matches chunkScoredFiles default
/** Data-model context must never crowd out the API snippets. */
const MODEL_CONTEXT_MAX_CHARS = Math.floor(CHUNK_CHAR_BUDGET * 0.3);
const MODEL_TOP_FILES = 12; // only chase models referenced by the best API files
const MODEL_MAX_FILES = 8; // model files read for definitions
const MODEL_MAX_TYPE_NAMES = 16;
const MODEL_MAX_NAME_SEARCHES = 8; // bounded findFiles lookups by type name
const MODEL_DEFS_PER_FILE_CHARS = 2_000;

const MAX_REPAIR_ROUTES = 20; // one bounded repair round
const MAX_REPAIR_PROMPT_CHARS = 16_000;

// Census-chunk mode (zero-seed fallback): instead of erroring when no file
// matches the deterministic heuristics, a one-shot prompt gets the workspace
// census (scan/census.ts: tree, file types, README/manifest heads) plus the
// heads of the most promising files, ranked by universal signals.
const CENSUS_FIND_LIMIT = 2_000; // findFiles cap when sampling head candidates
const CENSUS_READ_LIMIT = 80; // candidate files actually read for heads
/** Most-promising file heads embedded in the census prompt. */
export const CENSUS_MAX_HEADS = 12;
/** Characters of each file head embedded in the census prompt. */
export const CENSUS_HEAD_CHARS = 1_600;

/** Which way a chunk's snippets face: calling APIs or declaring them. */
export type ScanDirection = 'client' | 'server';

/**
 * One API surface of the finished scan — potentially its own mock server
 * downstream. The required fields are shape-compatible with the agentic
 * scanner's ScanSurface (AgenticScanSummary extends CodebaseScanSummary);
 * the optional fields carry extra profile metadata only the fast path knows.
 */
export interface ScanSurface {
  name: string;
  /** Ports are assigned by the command layer, never by the scanner. */
  suggestedPort?: never;
  routes: Omit<RouteConfig, 'id'>[];
  direction: ApiDirection;
  /** Workspace-relative project root; '' when the project is the workspace root. */
  rootPath?: string;
  kind?: ProjectKind;
  frameworks?: string[];
  matchedFileCount?: number;
  chunkCount?: number;
}

/** Per-project chunk-planning metadata (pure planning output). */
export interface ProjectChunkGroup {
  /** Workspace-relative project root; '' when the project is the workspace root. */
  rootPath: string;
  kind: ProjectKind;
  direction: ApiDirection;
  frameworks: string[];
  matchedFileCount: number;
  chunkCount: number;
}

/** How one API surface was (or should be) scanned. */
export type ScanStrategy = 'spec' | 'fast' | 'agentic' | 'census';

/**
 * Per-surface strategy report — which scan strategy each detected API surface
 * got and why. Populated by the ScanOrchestrator (additive; plain
 * CodebaseMockGenerator/AgenticScanner summaries omit it).
 */
export interface ScanStrategyReport {
  surface: string;
  strategy: ScanStrategy;
  reason: string;
}

export interface CodebaseScanSummary {
  scannedFileCount: number;
  matchedFileCount: number;
  chunkCount: number;
  routes: Omit<RouteConfig, 'id'>[];
  positiveCount: number;
  negativeCount: number;
  /** Routes that failed programmatic checks but were fixed by the AI repair round. */
  repairedCount: number;
  /** Routes that failed programmatic checks and could not be repaired. */
  droppedCount: number;
  /**
   * Final routes grouped per detected project; present when workspace
   * profiling succeeded. Same field the agentic scanner populates.
   */
  surfaces?: ScanSurface[];
  /**
   * API spec files (OpenAPI/Swagger, proto, GraphQL, Postman) the profiler
   * found; present when non-empty so the command layer can offer importing
   * the spec directly instead of an AI scan.
   */
  specFiles?: string[];
  /**
   * Per-surface strategy decisions ('spec' | 'fast' | 'agentic' | 'census')
   * with reasons; present when the scan ran through the ScanOrchestrator.
   */
  strategies?: ScanStrategyReport[];
  /**
   * Present ONLY when an agentic scan explored the workspace and deliberately
   * concluded there is no HTTP API surface to mock (routes/surfaces are empty
   * then): the agent's own explanation, ready for a user-facing message. The
   * command layer must surface it as an informational outcome, never an
   * error. Set by the AgenticScanner; flows through the ScanOrchestrator.
   */
  noApiSurfaceReason?: string;
}

export interface CodebaseScanProgress {
  message: string;
  /** 0..1 across the whole pipeline */
  fraction: number;
}

/** A scored file carrying its per-direction scores. */
export interface DirectionalScoredFile extends ScoredFile {
  clientScore: number;
  serverScore: number;
  /** Language-agnostic universal-signal score (inclusive discovery). */
  universalScore?: number;
  /** Direction guess when only universal signals scored (inclusive discovery). */
  universalDirection?: UniversalDirection;
}

/** One prompt-sized chunk plus how to analyze it and which project owns it. */
export interface PlannedChunk {
  text: string;
  mode: ScanDirection;
  /** Root of the project this chunk belongs to ('' = workspace root). */
  rootPath: string;
  /**
   * True for the zero-seed census chunk: `text` is a workspace census
   * (describeCensus output) analyzed with buildCensusChunkPrompt instead of
   * the snippet prompt.
   */
  census?: boolean;
}

/** A seed-scan hit plus the model references needed for data-model context. */
export interface ReconFile extends DirectionalScoredFile {
  importPaths: string[];
  typeNames: string[];
}

/**
 * The shared recon both scanners start from: workspace profiles plus the
 * deterministic directional seed scan. Computed once by the ScanOrchestrator
 * (collectWorkspaceRecon) and passed to CodebaseMockGenerator.generate /
 * AgenticScanner.generate so neither recomputes it.
 */
export interface WorkspaceRecon {
  /** Workspace folder name ('App' fallback). */
  appName: string;
  /** Detected project profiles; [] when profiling found nothing or failed. */
  profiles: ProjectProfile[];
  /** Seed-scan hits (files whose heuristic score crossed the threshold). */
  files: ReconFile[];
  /** Files the seed scan read. */
  scannedFileCount: number;
}

/** Any per-direction score is < 1000, so boosted files always sort first. */
const SERVER_PREFERENCE_BOOST = 1_000_000;

/**
 * Sort score for packing a file into chunks. In a 'serves' project, files
 * that declare routes outrank pure client-call files; everywhere else the
 * original max(client, server) ordering is preserved. A universal-only file
 * (marker scores both 0 — unknown language) keeps its universal ranking
 * instead of collapsing to 0, and earns the serves boost when its universal
 * shape says it declares routes.
 */
export function directionalChunkScore(
  scores: {
    clientScore: number;
    serverScore: number;
    universalScore?: number;
    universalDirection?: UniversalDirection;
  },
  direction: ApiDirection | undefined
): number {
  if (direction === 'serves' && scores.serverScore > 0) {
    return SERVER_PREFERENCE_BOOST + scores.serverScore;
  }
  const marker = Math.max(scores.clientScore, scores.serverScore);
  const universal = scores.universalScore ?? 0;
  if (marker === 0 && universal > 0) {
    return direction === 'serves' && scores.universalDirection === 'serves'
      ? SERVER_PREFERENCE_BOOST + universal
      : universal;
  }
  return marker;
}

/**
 * Pick the analyzeChunk prompt mode for a project: 'serves' projects get the
 * backend prompt, 'consumes' the client prompt, and 'both'/unknown projects
 * whichever direction their matched files lean toward. Marker-score ties go
 * to client (today's behavior) unless the group's files seeded purely via
 * universal signals AND their universal shapes lean server-side
 * (`universalLean` — Sinatra-style route tables in unknown languages).
 */
export function chunkModeForProject(
  direction: ApiDirection | undefined,
  totals: { clientScore: number; serverScore: number },
  lean?: UniversalDirection
): ScanDirection {
  if (direction === 'serves') {
    return 'server';
  }
  if (direction === 'consumes') {
    return 'client';
  }
  if (totals.serverScore === totals.clientScore && lean === 'serves') {
    return 'server';
  }
  return totals.serverScore > totals.clientScore ? 'server' : 'client';
}

/**
 * Group matched files by project (deepest enclosing profile root wins) and
 * pack each group into chunks with a per-project direction. Files outside
 * every profile root form a workspace-root fallback group. Pure — fully
 * unit-testable.
 */
export function planProjectChunks<T extends DirectionalScoredFile>(
  files: T[],
  profiles: Pick<ProjectProfile, 'rootPath' | 'kind' | 'direction' | 'frameworks'>[],
  maxCharsPerChunk = CHUNK_CHAR_BUDGET
): { chunks: PlannedChunk[]; groups: ProjectChunkGroup[] } {
  const groups = new Map<number, T[]>();
  const unassigned: T[] = [];
  for (const file of files) {
    let best = -1;
    let bestLen = -1;
    for (let i = 0; i < profiles.length; i++) {
      const root = profiles[i].rootPath;
      const inside = root === '' || file.path === root || file.path.startsWith(`${root}/`);
      if (inside && root.length > bestLen) {
        best = i;
        bestLen = root.length;
      }
    }
    if (best >= 0) {
      const group = groups.get(best);
      if (group) {
        group.push(file);
      } else {
        groups.set(best, [file]);
      }
    } else {
      unassigned.push(file);
    }
  }

  const chunks: PlannedChunk[] = [];
  const groupsOut: ProjectChunkGroup[] = [];
  const emit = (
    group: T[],
    profile: Pick<ProjectProfile, 'rootPath' | 'kind' | 'direction' | 'frameworks'> | undefined,
    rootPath: string
  ): void => {
    const totals = { clientScore: 0, serverScore: 0 };
    for (const file of group) {
      totals.clientScore += file.clientScore;
      totals.serverScore += file.serverScore;
    }
    const mode = chunkModeForProject(profile?.direction, totals, universalLean(group));
    const rescored = group.map((file) => ({
      ...file,
      score: directionalChunkScore(file, profile?.direction),
    }));
    const texts = chunkScoredFiles(rescored, maxCharsPerChunk);
    for (const text of texts) {
      chunks.push({ text, mode, rootPath });
    }
    groupsOut.push({
      rootPath,
      kind: profile?.kind ?? 'unknown',
      direction: profile?.direction ?? (mode === 'server' ? 'serves' : 'consumes'),
      frameworks: profile ? [...profile.frameworks] : [],
      matchedFileCount: group.length,
      chunkCount: texts.length,
    });
  };

  for (let i = 0; i < profiles.length; i++) {
    const group = groups.get(i);
    if (group) {
      emit(group, profiles[i], profiles[i].rootPath);
    } else {
      groupsOut.push({
        rootPath: profiles[i].rootPath,
        kind: profiles[i].kind,
        direction: profiles[i].direction,
        frameworks: [...profiles[i].frameworks],
        matchedFileCount: 0,
        chunkCount: 0,
      });
    }
  }
  if (unassigned.length > 0) {
    emit(unassigned, undefined, '');
  }
  return { chunks, groups: groupsOut };
}

/**
 * Attribution key linking a final route back to the project whose chunk
 * produced it — same identity dedupeRoutes uses (method + path + status), so
 * dedupe and the bounded repair round (which preserves route intent) keep
 * keys stable.
 */
export function routeProjectKey(
  method: RouteConfig['method'],
  path: string,
  statusCode: number
): string {
  const methods = Array.isArray(method) ? [...method].sort().join(',') : method;
  return `${methods}|${path.toLowerCase()}|${statusCode}`;
}

/**
 * Group the final routes into per-project surfaces using the chunk→project
 * attribution recorded during analysis. A key may map to SEVERAL roots when
 * different projects' chunks produced the same endpoint (e.g. a shared
 * GET /health) — the deduped route is then attached to every owning surface
 * so no project's mock server loses part of its contract. Routes that cannot
 * be attributed (e.g. repaired routes whose key changed) land on the first
 * surface; surfaces that end up with no routes are dropped. Pure — testable.
 */
export function buildRouteSurfaces(
  routes: Omit<RouteConfig, 'id'>[],
  rootByKey: ReadonlyMap<string, string | readonly string[]>,
  groups: ProjectChunkGroup[],
  appName: string
): ScanSurface[] {
  if (groups.length === 0) {
    return [];
  }
  const surfaces: ScanSurface[] = groups.map((group) => ({
    name: group.rootPath === '' ? appName : group.rootPath,
    routes: [],
    direction: group.direction,
    rootPath: group.rootPath,
    kind: group.kind,
    frameworks: [...group.frameworks],
    matchedFileCount: group.matchedFileCount,
    chunkCount: group.chunkCount,
  }));
  const byRoot = new Map<string, ScanSurface>();
  for (const surface of surfaces) {
    if (surface.rootPath !== undefined && !byRoot.has(surface.rootPath)) {
      byRoot.set(surface.rootPath, surface);
    }
  }
  for (const route of routes) {
    const value = rootByKey.get(routeProjectKey(route.method, route.path, route.response.statusCode));
    const roots = value === undefined ? [] : typeof value === 'string' ? [value] : value;
    const targets = new Set<ScanSurface>();
    for (const root of roots) {
      targets.add(byRoot.get(root) ?? surfaces[0]);
    }
    if (targets.size === 0) {
      targets.add(surfaces[0]);
    }
    for (const surface of targets) {
      surface.routes.push(route);
    }
  }
  return surfaces.filter((surface) => surface.routes.length > 0);
}

/**
 * Build the analyzeChunk prompt. 'client' mode without a profile summary is
 * byte-identical to the original single-mode prompt (back-compat); 'server'
 * mode flips the framing to route declarations, and a profile summary (from
 * describeProfiles) tells the model what kind of workspace it is reading.
 */
export function buildChunkPrompt(input: {
  appName: string;
  chunk: string;
  modelSection: string;
  mode: ScanDirection;
  profileSummary?: string;
}): string {
  const { appName, chunk, modelSection, mode, profileSummary } = input;
  const server = mode === 'server';

  const graphQlInstructions = hasGraphQlMarkers(chunk)
    ? `

## GraphQL
${server ? 'These snippets define a GraphQL API.' : 'These snippets use a GraphQL client.'} Mocklify matches requests on path + method only (it cannot inspect the operation name), so create ONE "POST /graphql" route per operation family (e.g. one for the user queries, one for the order mutations) with a realistic { "data": { ... } } body matching the operations' selection sets. Also add one disabled negative variant per family with status 200 and a { "errors": [{ "message": "…", "extensions": { "code": "…" } }] } body, tagged ["negative", "graphql"].`
    : '';

  const intro = server
    ? `You are an expert API reverse-engineer. Below are code snippets from a backend service ("${appName}"). These snippets DECLARE routes — derive each endpoint's method and path from the route declarations, and its response body from handler code, serializers, and DTOs. Create mock API routes replicating what this backend serves, so its clients can run against the mock server instead.`
    : `You are an expert API reverse-engineer. Below are code snippets from a client application ("${appName}" — could be Android, iOS, web, Flutter, or similar). Identify every HTTP API endpoint this code calls, then create mock API routes for a mock server so the app can run against it.`;
  const profileSection = profileSummary ? `\n\n## Workspace profile\n${profileSummary}` : '';
  const successRule = server
    ? `1. A success route (\`"enabled": true\`) whose response body matches EXACTLY what this backend returns — infer field names and types from handler code, DTOs, serializers, and data models. Use realistic, domain-appropriate example data.`
    : `1. A success route (\`"enabled": true\`) whose response body matches EXACTLY what the client code expects to parse — infer field names and types from data models, JSON parsing, and how the response is used. Use realistic, domain-appropriate example data.`;
  const authHint = server
    ? 'when the route checks auth or reads auth headers/tokens'
    : 'when the code sends auth headers/tokens';
  const errorShapeHint = server
    ? "Shape the error bodies the way this backend's error handlers format them (look for error handling/middleware in the code)."
    : "Shape the error bodies the way the client's error handling expects (look for error parsing in the code).";
  const onlyRule = server
    ? '- ONLY include endpoints this code actually declares — never invent endpoints.'
    : '- ONLY include endpoints this code actually calls — never invent endpoints.';
  const snippetsLabel = server ? '## Code snippets (route declarations)' : '## Code snippets';

  return `${intro}${profileSection}

For EVERY endpoint you find, create:
${successRule}
2. Negative-flow routes (\`"enabled": false\`) for realistic failures: 400 validation error (for endpoints with request bodies), 401 unauthorized (${authHint}), 403 forbidden (for authenticated endpoints where a role or permission check could fail), 404 not found (for endpoints with path parameters), 429 rate limit (for the most important endpoints — include "Retry-After": "30" in the response headers), and 500 server error (for the most important endpoints). ${errorShapeHint} Tag every negative route with "negative" plus its status, e.g. "tags": ["negative", "401"]. Also give them names like "GET /api/users/:id — 404 not found".
3. For the 1-3 most critical endpoints, a slow-response simulation route (\`"enabled": false\`) that mirrors the success response (same status and body) but adds "delay": { "type": "fixed", "value": 10000 }, tagged ["negative", "timeout"], named like "GET /api/orders — slow response (10s)".

Rules:
${onlyRule}
- Strip the host/base URL; keep only the path. Convert path variables to :param form.
- Tag positive routes with a short domain tag (e.g. "users", "orders").
- When the success routes for one resource form a CRUD family (GET list + GET by :id + POST/PUT/PATCH/DELETE), give every route in the family the SAME "stateful" field (collection = resource name, idParam = the path's :param name, seed of 3-5 coherent items — each including the id field — on the GET list route only). Never add "stateful" to negative-flow routes or to endpoints outside a CRUD family.${graphQlInstructions}

Return a JSON array of route objects.

${ROUTE_FORMAT_INSTRUCTIONS}
${modelSection ? `\n${modelSection}\n` : ''}
${snippetsLabel}

${chunk}`;
}

// ---------------------------------------------------------------------------
// Census-chunk mode (pure helpers)
// ---------------------------------------------------------------------------

/** The head (first CENSUS_HEAD_CHARS chars) of one promising census file. */
export interface CensusFileHead {
  path: string;
  head: string;
}

/**
 * Rank census candidates by the best of their universal (language-agnostic)
 * and heuristic directional scores and keep the top heads. Deterministic:
 * ties break on path. Zero-scoring files still qualify — in a workspace with
 * no seeds at all, any head is better context than none.
 */
export function pickCensusHeads(
  files: readonly { path: string; content: string }[],
  maxHeads = CENSUS_MAX_HEADS,
  headChars = CENSUS_HEAD_CHARS
): CensusFileHead[] {
  const ranked = files
    .map((file) => {
      const scores = scoreFileUniversal(file.content, file.path);
      return {
        path: file.path,
        content: file.content,
        score: Math.max(scores.universalScore, scores.clientScore, scores.serverScore),
      };
    })
    .sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return ranked.slice(0, Math.max(0, maxHeads)).map(({ path, content }) => ({
    path,
    head: content.length > headChars ? `${content.slice(0, headChars)}…` : content,
  }));
}

/**
 * Format the most promising file heads as a census-prompt section appended
 * after describeCensus's inventory; '' when there are no heads.
 */
export function formatCensusHeads(heads: readonly CensusFileHead[]): string {
  if (heads.length === 0) {
    return '';
  }
  return `\n\n### Most promising file heads\n\n${heads
    .map((head) => `#### File: ${head.path}\n${head.head}`)
    .join('\n\n')}`;
}

/**
 * The census-chunk prompt variant: used when the deterministic seed scan
 * matched nothing (unknown language/framework). Direction-neutral — the model
 * decides per endpoint whether the code calls or serves it — and explicitly
 * allowed to return [] so an API-less workspace fails cleanly instead of
 * hallucinating routes.
 */
export function buildCensusChunkPrompt(input: {
  appName: string;
  censusSection: string;
  profileSummary?: string;
}): string {
  const { appName, censusSection, profileSummary } = input;
  const profileSection = profileSummary ? `\n\n## Workspace profile\n${profileSummary}` : '';

  return `You are an expert API reverse-engineer. Mocklify's deterministic scan found NO known API client/server patterns in the workspace "${appName}" — it may use a language or framework Mocklify has no built-in markers for. Below is a census of the workspace's scannable files plus the beginnings of the most promising ones. Identify every HTTP API endpoint this code calls or serves (rooted REST path literals, absolute URLs, route tables, curl invocations, API docs or notes), then create mock API routes for a mock server so the app can run against it.${profileSection}

For EVERY endpoint you find, create:
1. A success route (\`"enabled": true\`) whose response body matches EXACTLY what the code sends or expects — infer field names and types from payload literals, parsing code, and documentation. Use realistic, domain-appropriate example data.
2. Negative-flow routes (\`"enabled": false\`) for realistic failures: 400 validation error (for endpoints with request bodies), 401 unauthorized (when the code involves auth headers/tokens), 403 forbidden (for authenticated endpoints where a role or permission check could fail), 404 not found (for endpoints with path parameters), 429 rate limit (for the most important endpoints — include "Retry-After": "30" in the response headers), and 500 server error (for the most important endpoints). Shape the error bodies the way the code's error handling produces or expects them. Tag every negative route with "negative" plus its status, e.g. "tags": ["negative", "401"]. Also give them names like "GET /api/users/:id — 404 not found".
3. For the 1-3 most critical endpoints, a slow-response simulation route (\`"enabled": false\`) that mirrors the success response (same status and body) but adds "delay": { "type": "fixed", "value": 10000 }, tagged ["negative", "timeout"], named like "GET /api/orders — slow response (10s)".

Rules:
- ONLY include endpoints this code actually calls or serves — never invent endpoints. If the census truly contains no API usage, return an empty JSON array [].
- Strip the host/base URL; keep only the path. Convert path variables to :param form.
- Tag positive routes with a short domain tag (e.g. "users", "orders").
- When the success routes for one resource form a CRUD family (GET list + GET by :id + POST/PUT/PATCH/DELETE), give every route in the family the SAME "stateful" field (collection = resource name, idParam = the path's :param name, seed of 3-5 coherent items — each including the id field — on the GET list route only). Never add "stateful" to negative-flow routes or to endpoints outside a CRUD family.

Return a JSON array of route objects.

${ROUTE_FORMAT_INSTRUCTIONS}

${censusSection}`;
}

/** User-facing error when even the census produced no mockable routes. */
export const CENSUS_NO_ROUTES_MESSAGE =
  'No API usage was found in this workspace — even a language-agnostic census scan produced nothing to mock. Use "AI: Generate Mock Server from Description" instead.';

// ---------------------------------------------------------------------------
// Shared recon (vscode-coupled)
// ---------------------------------------------------------------------------

/**
 * Profile the workspace and run the deterministic directional seed scan —
 * the shared recon both scan strategies start from. The ScanOrchestrator
 * calls this ONCE and hands the result to CodebaseMockGenerator.generate and
 * AgenticScanner.generate via their `recon` option; calling generate without
 * a recon keeps the original self-computing behavior (messages and progress
 * fractions unchanged).
 */
export async function collectWorkspaceRecon(options?: {
  token?: vscode.CancellationToken;
  onProgress?: (progress: CodebaseScanProgress) => void;
}): Promise<WorkspaceRecon> {
  const vsc = vs();
  const report = (message: string, fraction: number) =>
    options?.onProgress?.({ message, fraction });

  // 0. Profile the workspace — graceful: any failure falls back to the
  // original profile-less flow.
  report('Profiling workspace projects…', 0.01);
  let profiles: ProjectProfile[] = [];
  const workspaceRoot = vsc.workspace.workspaceFolders?.[0]?.uri;
  if (workspaceRoot) {
    try {
      profiles = await profileWorkspace(workspaceRoot);
    } catch (error) {
      console.error('Mocklify: workspace profiling failed:', error);
    }
  }
  if (options?.token?.isCancellationRequested) {
    throw new vsc.CancellationError();
  }

  // 1. Deterministic discovery — no AI, no cost. Inclusive: every text file
  // is a candidate (shouldScanPath blocklist + binary sniff) instead of the
  // legacy extension whitelist, sampled breadth-fairly under the same read
  // budget; scoring combines the marker heuristics with the language-agnostic
  // universal signals so unknown stacks can seed too.
  report('Scanning workspace for API calls…', 0.02);
  // Two-pass enumeration: known source extensions first (never crowded out of
  // the cap by assets/fixtures), then '**/*' for unknown extensions.
  const uris = await enumerateScanCandidates(MAX_FILES_TO_ENUMERATE);
  const uriByPath = new Map<string, vscode.Uri>();
  for (const uri of uris) {
    const relativePath = vsc.workspace.asRelativePath(uri);
    if (shouldScanPath(relativePath)) {
      uriByPath.set(relativePath, uri);
    }
  }
  const candidates = pickScanCandidates([...uriByPath.keys()], MAX_FILES_TO_READ);

  const files: ReconFile[] = [];
  let scanned = 0;
  for (const relativePath of candidates) {
    if (options?.token?.isCancellationRequested) {
      throw new vsc.CancellationError();
    }
    scanned++;
    if (scanned % 100 === 0) {
      report(
        `Scanning workspace for API calls… (${scanned}/${candidates.length} files)`,
        0.02 + 0.11 * (scanned / candidates.length)
      );
    }
    try {
      const uri = uriByPath.get(relativePath) as vscode.Uri;
      const stat = await vsc.workspace.fs.stat(uri);
      if (stat.size > MAX_FILE_BYTES) {
        continue;
      }
      const data = await vsc.workspace.fs.readFile(uri);
      if (!isProbablyTextFile(data.subarray(0, TEXT_SNIFF_BYTES))) {
        continue;
      }
      const content = Buffer.from(data).toString('utf-8');
      const { clientScore, serverScore, universalScore, universalDirection } = scoreFileUniversal(
        content,
        relativePath
      );
      if (Math.max(clientScore, serverScore, universalScore) >= MIN_SCORE) {
        const refs = extractModelReferences(content, relativePath);
        // Marker-based snippets first; for unknown languages fall back to
        // the universal signals themselves as the teaser.
        const snippet =
          extractApiSnippets(content) || universalSeedSnippet(detectUniversalSignals(content));
        files.push({
          path: relativePath,
          score: Math.max(clientScore, serverScore, universalScore),
          clientScore,
          serverScore,
          universalScore,
          universalDirection,
          snippet,
          importPaths: refs.importPaths,
          typeNames: refs.typeNames,
        });
      }
    } catch {
      // Unreadable file — skip
    }
  }

  return {
    appName: vsc.workspace.workspaceFolders?.[0]?.name ?? 'App',
    profiles,
    files,
    scannedFileCount: scanned,
  };
}

/**
 * Scans the workspace codebase (clients: Android, iOS, web, Flutter, … and
 * backends: Spring, Express, FastAPI, Rails, …) for HTTP API usage and asks
 * the active AI provider to reverse-engineer a complete mock server: success
 * routes plus disabled negative-flow routes (400/401/403/404/429/500 and
 * slow-response simulations) the user can toggle on to simulate failures.
 * The workspace is profiled first so mixed workspaces get per-project chunks
 * with the right direction (mock what a backend serves vs. what a client
 * calls); when profiling fails the original single-direction flow runs
 * untouched.
 */
export class CodebaseMockGenerator {
  constructor(private ai: AiService) {}

  async generate(options?: {
    token?: vscode.CancellationToken;
    onProgress?: (progress: CodebaseScanProgress) => void;
    /**
     * Pre-computed recon (from the ScanOrchestrator) — skips the profiling
     * and seed-scan steps so shared recon is never recomputed. Direct callers
     * omit it and get the original self-computing behavior.
     */
    recon?: WorkspaceRecon;
  }): Promise<CodebaseScanSummary> {
    const vsc = vs();
    const report = (message: string, fraction: number) =>
      options?.onProgress?.({ message, fraction });

    // 0-1. Shared recon: workspace profiling + deterministic seed scan.
    const recon = options?.recon ?? (await collectWorkspaceRecon(options));
    if (options?.token?.isCancellationRequested) {
      throw new vsc.CancellationError();
    }
    const profiles = recon.profiles.length > 0 ? recon.profiles : undefined;
    const profileSummary = profiles ? describeProfiles(profiles) : undefined;
    const specFiles = profiles
      ? [...new Set(profiles.flatMap((profile) => profile.specFiles))]
      : [];
    const scored = recon.files;
    const scanned = recon.scannedFileCount;
    const appName = recon.appName;

    let modelSection = '';
    let chunks: PlannedChunk[];
    let chunkGroups: ProjectChunkGroup[] | undefined;

    if (scored.length === 0) {
      // Census-chunk mode: a workspace without a single deterministic seed
      // (unknown language/framework) no longer errors — a census of the file
      // inventory plus the most promising file heads goes into one prompt.
      report('No known API patterns matched — building a workspace census…', 0.14);
      const censusSection = await this.collectCensusSection(specFiles, options?.token, report);
      chunks = [{ text: censusSection, mode: 'client', rootPath: '', census: true }];
    } else {
      // 2. Resolve referenced data models so response bodies match real shapes
      report('Resolving data models…', 0.15);
      try {
        modelSection = await this.buildModelContext(
          scored,
          profiles?.some((profile) => profile.kind === 'kmp') ?? false,
          options?.token
        );
      } catch (error) {
        if (error instanceof vsc.CancellationError) {
          throw error;
        }
        console.error('Mocklify: data-model resolution failed:', error);
      }

      // 3. Pack snippets into prompt-sized chunks, leaving room for models.
      // With profiles: one group per project, each with its own direction.
      const chunkBudget = CHUNK_CHAR_BUDGET - modelSection.length;
      if (profiles) {
        const plan = planProjectChunks(scored, profiles, chunkBudget);
        chunks = plan.chunks;
        chunkGroups = plan.groups;
      } else {
        // Profile-less flow: the original client-mode prompt, except when the
        // whole seed set is universal-only (unknown language) and its shapes
        // lean server-side — a route table must not be prompted as a client.
        const mode: ScanDirection = universalLean(scored) === 'serves' ? 'server' : 'client';
        chunks = chunkScoredFiles(scored, chunkBudget).map((text) => ({
          text,
          mode,
          rootPath: '',
        }));
      }
    }

    // 4. AI analysis per chunk — extract endpoints and generate routes
    const allRoutes: Omit<RouteConfig, 'id'>[] = [];
    // Which projects' chunks produced each route key. ALL producing roots are
    // kept (not just the first) so an endpoint shared by several projects —
    // e.g. GET /health served by two backends — survives on every surface
    // after the flat route list is deduped.
    const rootByKey = new Map<string, string[]>();

    for (let i = 0; i < chunks.length; i++) {
      if (options?.token?.isCancellationRequested) {
        throw new vsc.CancellationError();
      }
      const provider = (await this.ai.getActiveProviderLabel()) ?? 'AI';
      const partLabel = `Analyzing API integrations with ${provider} (part ${i + 1}/${chunks.length}`;
      const fraction = 0.2 + 0.6 * (i / chunks.length);
      report(`${partLabel})…`, fraction);

      try {
        const routes = await this.analyzeChunk(appName, chunks[i], modelSection, profileSummary, {
          token: options?.token,
          // Liveness signal — without it the notification looks frozen for
          // the full duration of a model response.
          onData: (chars) =>
            report(`${partLabel} · ${(chars / 1000).toFixed(1)}k received)…`, fraction),
        });
        for (const route of routes) {
          const key = routeProjectKey(route.method, route.path, route.response.statusCode);
          const roots = rootByKey.get(key);
          if (!roots) {
            rootByKey.set(key, [chunks[i].rootPath]);
          } else if (!roots.includes(chunks[i].rootPath)) {
            roots.push(chunks[i].rootPath);
          }
        }
        allRoutes.push(...routes);
      } catch (error) {
        // One failed chunk shouldn't lose the whole scan — unless it's the only one
        if (chunks.length === 1) {
          // A census chunk answered with a genuinely EMPTY array means "no API
          // usage here" — validateRoutes reports that as '… expected format:
          // empty result'. Only that exact outcome becomes the friendly
          // explanation; malformed/invalid routes from a workspace that DOES
          // have an API stay real, retryable errors.
          if (
            chunks[i].census &&
            error instanceof Error &&
            error.message.includes('did not match the expected format') &&
            error.message.includes('empty result')
          ) {
            throw new Error(CENSUS_NO_ROUTES_MESSAGE);
          }
          throw error;
        }
        console.error(`Mocklify: codebase scan chunk ${i + 1} failed:`, error);
      }
    }

    if (allRoutes.length === 0) {
      throw new Error(
        'The AI analysis did not produce any mock routes from the scanned code. Try again, or use "AI: Generate Mock Server from Description" instead.'
      );
    }

    // 5. Self-verification: programmatic checks + one bounded AI repair round
    const verification = MockGenerator.verifyRoutes(dedupeRoutes(allRoutes));
    let routes = verification.accepted;
    let repairedCount = 0;
    let droppedCount = verification.rejected.length;

    if (verification.rejected.length > 0 && !options?.token?.isCancellationRequested) {
      report(
        `Repairing ${verification.rejected.length} invalid route${verification.rejected.length === 1 ? '' : 's'}…`,
        0.85
      );
      try {
        const repaired = await this.repairRoutes(verification.rejected, {
          token: options?.token,
        });
        repairedCount = repaired.length;
        droppedCount = verification.rejected.length - repairedCount;
        routes = dedupeRoutes([...routes, ...repaired]);
      } catch (error) {
        if (error instanceof vsc.CancellationError) {
          throw error;
        }
        console.error('Mocklify: route repair round failed:', error);
      }
    }

    if (routes.length === 0) {
      throw new Error(
        'The AI analysis did not produce any valid mock routes from the scanned code. Try again, or use "AI: Generate Mock Server from Description" instead.'
      );
    }

    report('Assembling mock server…', 0.95);

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
      chunkCount: chunks.length,
      routes,
      positiveCount: routes.length - negativeCount,
      negativeCount,
      repairedCount,
      droppedCount,
      ...(chunkGroups
        ? { surfaces: buildRouteSurfaces(routes, rootByKey, chunkGroups, appName) }
        : {}),
      ...(specFiles.length > 0 ? { specFiles } : {}),
    };
  }

  /**
   * Resolve the data-model types referenced by the top-scored API files and
   * extract their definitions into a bounded "## Data models" prompt section.
   * When the profile detected Kotlin Multiplatform, the shared commonMain
   * source sets are searched first — that is where KMP models live.
   */
  private async buildModelContext(
    scored: ReconFile[],
    kmp: boolean,
    token?: vscode.CancellationToken
  ): Promise<string> {
    const vsc = vs();
    const root = vsc.workspace.workspaceFolders?.[0]?.uri;
    if (!root) {
      return '';
    }

    const topFiles = [...scored].sort((a, b) => b.score - a.score).slice(0, MODEL_TOP_FILES);
    const typeNames: string[] = [];
    const importCandidates: string[] = [];
    for (const file of topFiles) {
      for (const name of file.typeNames) {
        if (!typeNames.includes(name) && typeNames.length < MODEL_MAX_TYPE_NAMES) {
          typeNames.push(name);
        }
      }
      for (const candidate of file.importPaths) {
        if (!importCandidates.includes(candidate)) {
          importCandidates.push(candidate);
        }
      }
    }
    if (typeNames.length === 0) {
      return '';
    }

    const remaining = new Set(typeNames);
    const blocks: ModelFileContext[] = [];
    const readPaths = new Set<string>();

    const harvest = async (uri: vscode.Uri): Promise<void> => {
      const relativePath = vsc.workspace.asRelativePath(uri);
      if (readPaths.has(relativePath) || remaining.size === 0) {
        return;
      }
      readPaths.add(relativePath);
      try {
        const stat = await vsc.workspace.fs.stat(uri);
        if (stat.size > MAX_FILE_BYTES) {
          return;
        }
        const content = Buffer.from(await vsc.workspace.fs.readFile(uri)).toString('utf-8');
        const names = [...remaining];
        const definitions = extractTypeDefinitions(content, names, MODEL_DEFS_PER_FILE_CHARS);
        if (!definitions) {
          return;
        }
        blocks.push({ path: relativePath, definitions });
        for (const name of names) {
          if (
            new RegExp(
              `(?:interface|class|type|struct|enum)\\s+${name}\\b`
            ).test(definitions)
          ) {
            remaining.delete(name);
          }
        }
      } catch {
        // Unreadable candidate — skip
      }
    };

    // Import-path candidates first: cheap existence checks against the root
    for (const candidate of importCandidates) {
      if (token?.isCancellationRequested) {
        throw new vsc.CancellationError();
      }
      if (blocks.length >= MODEL_MAX_FILES || remaining.size === 0) {
        break;
      }
      const uri = vsc.Uri.joinPath(root, candidate);
      try {
        await vsc.workspace.fs.stat(uri);
      } catch {
        continue; // candidate doesn't exist
      }
      await harvest(uri);
    }

    // Then a bounded filename search for still-unresolved type names
    let searches = 0;
    for (const name of typeNames) {
      if (token?.isCancellationRequested) {
        throw new vsc.CancellationError();
      }
      if (
        !remaining.has(name) ||
        blocks.length >= MODEL_MAX_FILES ||
        searches >= MODEL_MAX_NAME_SEARCHES
      ) {
        continue;
      }
      searches++;
      const stems = modelFileNameCandidates(name).join(',');
      const globs = kmp
        ? [
            `**/src/commonMain/**/{${stems}}.kt`,
            `**/{${stems}}.{ts,tsx,js,jsx,kt,java,swift,dart}`,
          ]
        : [`**/{${stems}}.{ts,tsx,js,jsx,kt,java,swift,dart}`];
      for (const glob of globs) {
        if (blocks.length >= MODEL_MAX_FILES || remaining.size === 0) {
          break;
        }
        const found = await vsc.workspace.findFiles(glob, SCAN_EXCLUDE_GLOB, 2);
        for (const uri of found) {
          if (blocks.length >= MODEL_MAX_FILES) {
            break;
          }
          await harvest(uri);
        }
      }
    }

    return formatModelSection(blocks, MODEL_CONTEXT_MAX_CHARS);
  }

  /**
   * Build the census section for the census-chunk prompt: the workspace
   * census (scan/census.ts — tree, file types, README/manifest heads) plus
   * the heads of the most promising scannable files, ranked by combined
   * universal + heuristic scores. Throws the original "no API calls" error
   * when the workspace has nothing scannable at all.
   */
  private async collectCensusSection(
    specFiles: string[],
    token: vscode.CancellationToken | undefined,
    report: (message: string, fraction: number) => void
  ): Promise<string> {
    const vsc = vs();
    const noApiError = (): Error => {
      const specHint =
        specFiles.length > 0
          ? ` However, an API spec file was found (${specFiles[0]}) — importing it directly will give exact routes.`
          : '';
      return new Error(
        `No API calls were found in this workspace. Mocklify looked for fetch/axios/Retrofit/URLSession/Dio/HttpClient and similar patterns in source files.${specHint}`
      );
    };

    const root = vsc.workspace.workspaceFolders?.[0]?.uri;
    if (!root) {
      throw noApiError();
    }
    const census = await censusWorkspace(root);
    if (census.totalFiles === 0) {
      throw noApiError();
    }
    if (token?.isCancellationRequested) {
      throw new vsc.CancellationError();
    }

    // Most promising file heads: sample scannable paths breadth-fairly,
    // read + sniff them, rank with pickCensusHeads. Two-pass enumeration so
    // assets cannot crowd source files out of the findFiles cap.
    const uris = await enumerateScanCandidates(CENSUS_FIND_LIMIT);
    const uriByPath = new Map<string, vscode.Uri>();
    for (const uri of uris) {
      const relativePath = vsc.workspace.asRelativePath(uri);
      if (shouldScanPath(relativePath)) {
        uriByPath.set(relativePath, uri);
      }
    }
    const candidates = pickScanCandidates([...uriByPath.keys()], CENSUS_READ_LIMIT);
    const contents: { path: string; content: string }[] = [];
    let read = 0;
    for (const path of candidates) {
      if (token?.isCancellationRequested) {
        throw new vsc.CancellationError();
      }
      read++;
      if (read % 20 === 0) {
        report(
          `Reading census candidates… (${read}/${candidates.length})`,
          0.14 + 0.04 * (read / candidates.length)
        );
      }
      try {
        const uri = uriByPath.get(path) as vscode.Uri;
        const stat = await vsc.workspace.fs.stat(uri);
        if (stat.size > MAX_FILE_BYTES) {
          continue;
        }
        const bytes = await vsc.workspace.fs.readFile(uri);
        if (!isProbablyTextFile(bytes.subarray(0, TEXT_SNIFF_BYTES))) {
          continue;
        }
        contents.push({ path, content: Buffer.from(bytes).toString('utf-8') });
      } catch {
        // Unreadable candidate — skip
      }
    }

    return `${describeCensus(census)}${formatCensusHeads(pickCensusHeads(contents))}`;
  }

  private async analyzeChunk(
    appName: string,
    chunk: PlannedChunk,
    modelSection: string,
    profileSummary: string | undefined,
    options?: AiRequestOptions
  ): Promise<Omit<RouteConfig, 'id'>[]> {
    const prompt = chunk.census
      ? buildCensusChunkPrompt({ appName, censusSection: chunk.text, profileSummary })
      : buildChunkPrompt({
          appName,
          chunk: chunk.text,
          modelSection,
          mode: chunk.mode,
          profileSummary,
        });

    const raw = await this.ai.sendJsonRequest(
      prompt,
      {
        ...options,
        justification: 'Mocklify is analyzing your codebase to generate a mock server.',
      },
      ROUTES_JSON_SCHEMA
    );
    return MockGenerator.validateRoutes(raw);
  }

  /**
   * One bounded repair round: quote the rejected routes and their reasons
   * back to the model, re-validate, and keep only routes that now pass the
   * programmatic checks.
   */
  private async repairRoutes(
    rejected: RejectedRoute[],
    options?: AiRequestOptions
  ): Promise<Omit<RouteConfig, 'id'>[]> {
    const bounded = rejected.slice(0, MAX_REPAIR_ROUTES);
    let listing = JSON.stringify(
      bounded.map(({ route, reasons }) => ({ route, rejectionReasons: reasons })),
      null,
      2
    );
    if (listing.length > MAX_REPAIR_PROMPT_CHARS) {
      listing = JSON.stringify(
        bounded.map(({ route, reasons }) => ({
          route: { name: route.name, method: route.method, path: route.path, response: route.response },
          rejectionReasons: reasons,
        }))
      ).slice(0, MAX_REPAIR_PROMPT_CHARS);
    }

    const prompt = `These generated mock routes were rejected by Mocklify's validation for the reasons listed with each one. Return corrected versions that fix every listed reason while preserving the route's intent (same endpoint, method, and realistic response data). Omit any route you cannot fix.

${listing}

Return a JSON array of the corrected route objects only.

${ROUTE_FORMAT_INSTRUCTIONS}`;

    const raw = await this.ai.sendJsonRequest(
      prompt,
      {
        ...options,
        justification: 'Mocklify is repairing invalid generated mock routes.',
      },
      ROUTES_JSON_SCHEMA
    );
    return MockGenerator.verifyRoutes(MockGenerator.validateRoutes(raw)).accepted;
  }
}
