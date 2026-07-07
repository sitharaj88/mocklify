import type * as vscode from 'vscode';
import { NEGATIVE_ROUTE_PRIORITY, RouteConfig } from '../types/core.js';
import type { AiService } from './AiService.js';
import type { CodebaseScanProgress, CodebaseScanSummary } from './CodebaseMockGenerator.js';
import { extractJson } from './extractJson.js';
import {
  MockGenerator,
  ROUTE_FORMAT_INSTRUCTIONS,
  ROUTES_JSON_SCHEMA,
  RejectedRoute,
} from './MockGenerator.js';
import {
  API_FILE_GLOB,
  SCAN_EXCLUDE_GLOB,
  ScoredFile,
  scoreApiContent,
  extractApiSnippets,
  dedupeRoutes,
} from './scan/heuristics.js';
import { hasGraphQlMarkers } from './scan/modelContext.js';
import { createWorkspaceTools } from './agent/workspaceTools.js';
import { AgenticScanUnavailableError } from './providers/types.js';
import type { AiToolCall, AiToolDefinition, AiToolExecutor } from './providers/types.js';
import { DEFAULT_MAX_TOOL_CALLS } from './providers/toolLoop.js';

/**
 * Hybrid agentic codebase scan: the same deterministic heuristics that seed
 * the fast scan produce a scored file list, then the model explores the
 * workspace itself through read-only tools (list_files / read_file /
 * search_code) — following imports to data models, finding auth and error
 * conventions — and submits the finished mock routes through a fourth
 * submit_routes tool that validates them on the spot.
 *
 * Pure helpers (seed formatting, submit bookkeeping, progress math) are
 * exported for unit tests; vscode is loaded lazily inside the class so the
 * module imports cleanly under vitest.
 */

// Seed scan — mirrors CodebaseMockGenerator's deterministic discovery.
const MAX_FILES_TO_READ = 600;
const MAX_FILE_BYTES = 262_144;
const MIN_SCORE = 10;

/** Tool-execution cap for one scan (matches the provider loop default). */
export const AGENT_MAX_TOOL_CALLS = DEFAULT_MAX_TOOL_CALLS;
/** Hard wall-clock budget for the whole agentic scan. */
export const AGENTIC_SCAN_BUDGET_MS = 8 * 60_000;
/** Inside this window before the deadline, exploration tools demand a submit. */
export const SUBMIT_NUDGE_WINDOW_MS = 90_000;
/** Failed submit_routes rounds tolerated before the valid subset is accepted. */
export const MAX_SUBMIT_REJECTIONS = 2;

export const SEED_MAX_FILES = 30;
export const SEED_TEASER_LINES = 3;
export const SEED_TEASER_LINE_CHARS = 120;

export const SUBMIT_ROUTES_ACCEPTED_ACK =
  'Routes accepted — the mock server will be assembled from them. Stop calling tools and reply "done".';
export const ROUTES_ALREADY_ACCEPTED =
  'Routes were already accepted — stop calling tools and reply "done".';
export const TIME_BUDGET_NUDGE =
  'Time budget nearly exhausted — stop exploring and call submit_routes NOW with every route you have found.';

export { AgenticScanUnavailableError } from './providers/types.js';

/** The fourth tool: the model hands over the finished routes through it. */
export const SUBMIT_ROUTES_TOOL: AiToolDefinition = {
  name: 'submit_routes',
  description:
    'Submit the final set of mock routes for the scanned application. Call this exactly once, after exploring, with EVERY route (success routes plus disabled negative-flow routes) as {"routes": [...]}. If the result lists validation problems, fix them and call submit_routes again with the COMPLETE corrected set. Never put route JSON in your text reply — it is only read from this tool.',
  inputSchema: ROUTES_JSON_SCHEMA,
};

// ---------------------------------------------------------------------------
// Seed formatting (pure)
// ---------------------------------------------------------------------------

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
// Progress (pure)
// ---------------------------------------------------------------------------

function mainToolArg(call: AiToolCall): string {
  const input = (call.input ?? {}) as Record<string, unknown>;
  const value = input.path ?? input.glob ?? input.pattern;
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
  };
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
 * Handle one submit_routes call: validate + verify, quote failures back for
 * up to MAX_SUBMIT_REJECTIONS rounds, then accept the valid subset. Mutates
 * state; returns the tool result text.
 */
export function handleSubmitRoutes(state: SubmitState, input: unknown): string {
  if (state.done) {
    return ROUTES_ALREADY_ACCEPTED;
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
// Prompt (pure)
// ---------------------------------------------------------------------------

const GRAPHQL_INSTRUCTIONS = `

## GraphQL
This codebase uses a GraphQL client. Mocklify matches requests on path + method only (it cannot inspect the operation name), so create ONE "POST /graphql" route per operation family (e.g. one for the user queries, one for the order mutations) with a realistic { "data": { ... } } body matching the operations' selection sets. Also add one disabled negative variant per family with status 200 and a { "errors": [{ "message": "…", "extensions": { "code": "…" } }] } body, tagged ["negative", "graphql"].`;

export function buildAgentPrompt(
  appName: string,
  seedSection: string,
  matchedFileCount: number,
  graphQl: boolean
): string {
  const seedCount = Math.min(matchedFileCount, SEED_MAX_FILES);
  return `You are an expert API reverse-engineer exploring the workspace of a client application ("${appName}" — could be Android, iOS, web, Flutter, or similar) through read-only tools. Identify every HTTP API endpoint this app calls, then create mock API routes for a mock server so the app can run against it.

A deterministic scan already found the most likely API-related files (listed under "Seed files" below with a relevance score and a short teaser). Explore from there:
1. Read the highest-scoring seed files to find the endpoints, methods, paths, and request/response handling.
2. Follow imports to the data-model types so every response body matches EXACTLY the shape the client parses — never guess field names when you can read the model.
3. Find the app's auth conventions (headers, tokens, interceptors) and its error-body conventions (how failures are parsed) so negative routes match them.
4. Use search_code to catch endpoints outside the seed list (base URLs, "/api/" strings, HTTP client calls).

When you have the full picture, call submit_routes EXACTLY ONCE with every route. If the result lists validation problems, fix them and call submit_routes again with the complete corrected set. Do not write route JSON in your text replies.

For EVERY endpoint you find, create:
1. A success route (\`"enabled": true\`) whose response body matches EXACTLY what the client code expects to parse — infer field names and types from data models, JSON parsing, and how the response is used. Use realistic, domain-appropriate example data.
2. Negative-flow routes (\`"enabled": false\`) for realistic failures: 400 validation error (for endpoints with request bodies), 401 unauthorized (when the code sends auth headers/tokens), 403 forbidden (for authenticated endpoints where a role or permission check could fail), 404 not found (for endpoints with path parameters), 429 rate limit (for the most important endpoints — include "Retry-After": "30" in the response headers), and 500 server error (for the most important endpoints). Shape the error bodies the way the client's error handling expects. Tag every negative route with "negative" plus its status, e.g. "tags": ["negative", "401"]. Also give them names like "GET /api/users/:id — 404 not found".
3. For the 1-3 most critical endpoints, a slow-response simulation route (\`"enabled": false\`) that mirrors the success response (same status and body) but adds "delay": { "type": "fixed", "value": 10000 }, tagged ["negative", "timeout"], named like "GET /api/orders — slow response (10s)".

Rules:
- ONLY include endpoints this code actually calls — never invent endpoints.
- Strip the host/base URL; keep only the path. Convert path variables to :param form.
- Tag positive routes with a short domain tag (e.g. "users", "orders").
- When the success routes for one resource form a CRUD family (GET list + GET by :id + POST/PUT/PATCH/DELETE), give every route in the family the SAME "stateful" field (collection = resource name, idParam = the path's :param name, seed of 3-5 coherent items — each including the id field — on the GET list route only). Never add "stateful" to negative-flow routes or to endpoints outside a CRUD family.${graphQl ? GRAPHQL_INSTRUCTIONS : ''}

## Route JSON shape (for the submit_routes input)

${ROUTE_FORMAT_INSTRUCTIONS}

(The routes go into the submit_routes tool input as {"routes": [...]} — never into your text reply.)

## Seed files (top ${seedCount} of ${matchedFileCount} matched by the deterministic scan)

${seedSection}`;
}

// ---------------------------------------------------------------------------
// The scanner (vscode-coupled)
// ---------------------------------------------------------------------------

export class AgenticScanner {
  constructor(private ai: AiService) {}

  /**
   * Same contract as CodebaseMockGenerator.generate so the command layer can
   * treat both scanners identically. Throws AgenticScanUnavailableError when
   * the active provider cannot run tool loops — callers should fall back to
   * the fast scan.
   */
  async generate(options?: {
    token?: vscode.CancellationToken;
    onProgress?: (progress: CodebaseScanProgress) => void;
  }): Promise<CodebaseScanSummary> {
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

    // 1. Deterministic seed scan — identical heuristics to the fast path
    report('Scanning workspace for API calls…', 0.02);
    const uris = await vs.workspace.findFiles(API_FILE_GLOB, SCAN_EXCLUDE_GLOB, MAX_FILES_TO_READ);

    const scored: ScoredFile[] = [];
    let scanned = 0;
    for (const uri of uris) {
      if (options?.token?.isCancellationRequested) {
        throw new vs.CancellationError();
      }
      scanned++;
      if (scanned % 100 === 0) {
        report(
          `Scanning workspace for API calls… (${scanned}/${uris.length} files)`,
          0.02 + 0.11 * (scanned / uris.length)
        );
      }
      try {
        const stat = await vs.workspace.fs.stat(uri);
        if (stat.size > MAX_FILE_BYTES) {
          continue;
        }
        const content = Buffer.from(await vs.workspace.fs.readFile(uri)).toString('utf-8');
        const relativePath = vs.workspace.asRelativePath(uri);
        const score = scoreApiContent(content, relativePath);
        if (score >= MIN_SCORE) {
          scored.push({ path: relativePath, score, snippet: extractApiSnippets(content) });
        }
      } catch {
        // Unreadable file — skip
      }
    }

    if (scored.length === 0) {
      throw new Error(
        'No API calls were found in this workspace. Mocklify looked for fetch/axios/Retrofit/URLSession/Dio/HttpClient and similar patterns in source files.'
      );
    }

    // 2. Agent prompt from the seed
    report(`Preparing the exploration agent (${provider.label})…`, 0.16);
    const appName = vs.workspace.workspaceFolders?.[0]?.name ?? 'App';
    const graphQl = scored.some((file) => hasGraphQlMarkers(file.snippet));
    const prompt = buildAgentPrompt(appName, formatSeedSection(scored), scored.length, graphQl);

    // 3. Tool belt: read-only workspace tools + submit_routes
    const tools = createWorkspaceTools(root);
    const state = createSubmitState();
    const deadline = Date.now() + AGENTIC_SCAN_BUDGET_MS;

    // Loop cancellation: fired by the user's token, by the wall-clock budget,
    // or by an accepted submission (providers return quietly on cancel).
    const loopCancel = new vs.CancellationTokenSource();
    const userCancelSub = options?.token?.onCancellationRequested(() => loopCancel.cancel());
    if (options?.token?.isCancellationRequested) {
      loopCancel.cancel();
    }
    const budgetTimer = setTimeout(() => loopCancel.cancel(), AGENTIC_SCAN_BUDGET_MS);

    let lastLabel = `Exploring codebase with ${provider.label}…`;
    let lastFraction = 0.2;
    report(lastLabel, lastFraction);

    const execute: AiToolExecutor = async (call) => {
      if (call.name === SUBMIT_ROUTES_TOOL.name) {
        const result = handleSubmitRoutes(state, call.input);
        if (state.done) {
          loopCancel.cancel(); // accepted — end the loop after this batch
        }
        return result;
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
          [...tools.definitions, SUBMIT_ROUTES_TOOL],
          execute,
          {
            justification: 'Mocklify is exploring your codebase to generate a mock server.',
            token: loopCancel.token,
            maxToolCalls: AGENT_MAX_TOOL_CALLS,
            onToolCall: (call, index) => {
              lastLabel = formatToolCallProgress(call, index, AGENT_MAX_TOOL_CALLS);
              lastFraction = toolCallFraction(index, AGENT_MAX_TOOL_CALLS);
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
    if (routes.length === 0 && finalText) {
      try {
        routes = MockGenerator.verifyRoutes(
          dedupeRoutes(MockGenerator.validateRoutes(extractJson(finalText)))
        ).accepted;
        droppedCount = 0;
      } catch {
        // Final text held no usable routes — fall through to the error below
      }
    }

    if (routes.length === 0) {
      throw new Error(
        Date.now() >= deadline
          ? 'The agentic scan hit its 8-minute budget before any valid routes were submitted. Try again, or switch mocklify.ai.scanMode to "fast".'
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
    };
  }
}
