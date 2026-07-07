import * as vscode from 'vscode';
import { NEGATIVE_ROUTE_PRIORITY, RouteConfig } from '../types/core.js';
import type { AiService, AiRequestOptions } from './AiService.js';
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

const MAX_FILES_TO_READ = 600;
const MAX_FILE_BYTES = 262_144; // skip generated/bundled monsters
const MIN_SCORE = 10; // at least one strong API marker

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
}

export interface CodebaseScanProgress {
  message: string;
  /** 0..1 across the whole pipeline */
  fraction: number;
}

interface MatchedFile extends ScoredFile {
  importPaths: string[];
  typeNames: string[];
}

/**
 * Scans the workspace codebase (any client: Android, iOS, web, Flutter, …)
 * for HTTP API usage and asks the active AI provider to reverse-engineer a
 * complete mock server: success routes plus disabled negative-flow routes
 * (400/401/403/404/429/500 and slow-response simulations) the user can
 * toggle on to simulate failures.
 */
export class CodebaseMockGenerator {
  constructor(private ai: AiService) {}

  async generate(options?: {
    token?: vscode.CancellationToken;
    onProgress?: (progress: CodebaseScanProgress) => void;
  }): Promise<CodebaseScanSummary> {
    const report = (message: string, fraction: number) =>
      options?.onProgress?.({ message, fraction });

    // 1. Deterministic discovery — no AI, no cost
    report('Scanning workspace for API calls…', 0.02);
    const uris = await vscode.workspace.findFiles(
      API_FILE_GLOB,
      SCAN_EXCLUDE_GLOB,
      MAX_FILES_TO_READ
    );

    const scored: MatchedFile[] = [];
    let scanned = 0;
    for (const uri of uris) {
      if (options?.token?.isCancellationRequested) {
        throw new vscode.CancellationError();
      }
      scanned++;
      if (scanned % 100 === 0) {
        report(`Scanning workspace for API calls… (${scanned}/${uris.length} files)`, 0.02 + 0.11 * (scanned / uris.length));
      }
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.size > MAX_FILE_BYTES) {
          continue;
        }
        const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8');
        const relativePath = vscode.workspace.asRelativePath(uri);
        const score = scoreApiContent(content, relativePath);
        if (score >= MIN_SCORE) {
          const refs = extractModelReferences(content, relativePath);
          scored.push({
            path: relativePath,
            score,
            snippet: extractApiSnippets(content),
            importPaths: refs.importPaths,
            typeNames: refs.typeNames,
          });
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

    // 2. Resolve referenced data models so response bodies match real shapes
    report('Resolving data models…', 0.15);
    let modelSection = '';
    try {
      modelSection = await this.buildModelContext(scored, options?.token);
    } catch (error) {
      if (error instanceof vscode.CancellationError) {
        throw error;
      }
      console.error('Mocklify: data-model resolution failed:', error);
    }

    // 3. Pack snippets into provider-friendly chunks, leaving room for models
    const chunks = chunkScoredFiles(scored, CHUNK_CHAR_BUDGET - modelSection.length);

    // 4. AI analysis per chunk — extract endpoints and generate routes
    const appName = vscode.workspace.workspaceFolders?.[0]?.name ?? 'App';
    const allRoutes: Omit<RouteConfig, 'id'>[] = [];

    for (let i = 0; i < chunks.length; i++) {
      if (options?.token?.isCancellationRequested) {
        throw new vscode.CancellationError();
      }
      const provider = (await this.ai.getActiveProviderLabel()) ?? 'AI';
      const partLabel = `Analyzing API integrations with ${provider} (part ${i + 1}/${chunks.length}`;
      const fraction = 0.2 + 0.6 * (i / chunks.length);
      report(`${partLabel})…`, fraction);

      try {
        const routes = await this.analyzeChunk(appName, chunks[i], modelSection, {
          token: options?.token,
          // Liveness signal — without it the notification looks frozen for
          // the full duration of a model response.
          onData: (chars) =>
            report(`${partLabel} · ${(chars / 1000).toFixed(1)}k received)…`, fraction),
        });
        allRoutes.push(...routes);
      } catch (error) {
        // One failed chunk shouldn't lose the whole scan — unless it's the only one
        if (chunks.length === 1) {
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
        if (error instanceof vscode.CancellationError) {
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
    };
  }

  /**
   * Resolve the data-model types referenced by the top-scored API files and
   * extract their definitions into a bounded "## Data models" prompt section.
   */
  private async buildModelContext(
    scored: MatchedFile[],
    token?: vscode.CancellationToken
  ): Promise<string> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
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
      const relativePath = vscode.workspace.asRelativePath(uri);
      if (readPaths.has(relativePath) || remaining.size === 0) {
        return;
      }
      readPaths.add(relativePath);
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.size > MAX_FILE_BYTES) {
          return;
        }
        const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8');
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
        throw new vscode.CancellationError();
      }
      if (blocks.length >= MODEL_MAX_FILES || remaining.size === 0) {
        break;
      }
      const uri = vscode.Uri.joinPath(root, candidate);
      try {
        await vscode.workspace.fs.stat(uri);
      } catch {
        continue; // candidate doesn't exist
      }
      await harvest(uri);
    }

    // Then a bounded filename search for still-unresolved type names
    let searches = 0;
    for (const name of typeNames) {
      if (token?.isCancellationRequested) {
        throw new vscode.CancellationError();
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
      const found = await vscode.workspace.findFiles(
        `**/{${stems}}.{ts,tsx,js,jsx,kt,java,swift,dart}`,
        SCAN_EXCLUDE_GLOB,
        2
      );
      for (const uri of found) {
        if (blocks.length >= MODEL_MAX_FILES) {
          break;
        }
        await harvest(uri);
      }
    }

    return formatModelSection(blocks, MODEL_CONTEXT_MAX_CHARS);
  }

  private async analyzeChunk(
    appName: string,
    chunk: string,
    modelSection: string,
    options?: AiRequestOptions
  ): Promise<Omit<RouteConfig, 'id'>[]> {
    const graphQlInstructions = hasGraphQlMarkers(chunk)
      ? `

## GraphQL
These snippets use a GraphQL client. Mocklify matches requests on path + method only (it cannot inspect the operation name), so create ONE "POST /graphql" route per operation family (e.g. one for the user queries, one for the order mutations) with a realistic { "data": { ... } } body matching the operations' selection sets. Also add one disabled negative variant per family with status 200 and a { "errors": [{ "message": "…", "extensions": { "code": "…" } }] } body, tagged ["negative", "graphql"].`
      : '';

    const prompt = `You are an expert API reverse-engineer. Below are code snippets from a client application ("${appName}" — could be Android, iOS, web, Flutter, or similar). Identify every HTTP API endpoint this code calls, then create mock API routes for a mock server so the app can run against it.

For EVERY endpoint you find, create:
1. A success route (\`"enabled": true\`) whose response body matches EXACTLY what the client code expects to parse — infer field names and types from data models, JSON parsing, and how the response is used. Use realistic, domain-appropriate example data.
2. Negative-flow routes (\`"enabled": false\`) for realistic failures: 400 validation error (for endpoints with request bodies), 401 unauthorized (when the code sends auth headers/tokens), 403 forbidden (for authenticated endpoints where a role or permission check could fail), 404 not found (for endpoints with path parameters), 429 rate limit (for the most important endpoints — include "Retry-After": "30" in the response headers), and 500 server error (for the most important endpoints). Shape the error bodies the way the client's error handling expects (look for error parsing in the code). Tag every negative route with "negative" plus its status, e.g. "tags": ["negative", "401"]. Also give them names like "GET /api/users/:id — 404 not found".
3. For the 1-3 most critical endpoints, a slow-response simulation route (\`"enabled": false\`) that mirrors the success response (same status and body) but adds "delay": { "type": "fixed", "value": 10000 }, tagged ["negative", "timeout"], named like "GET /api/orders — slow response (10s)".

Rules:
- ONLY include endpoints this code actually calls — never invent endpoints.
- Strip the host/base URL; keep only the path. Convert path variables to :param form.
- Tag positive routes with a short domain tag (e.g. "users", "orders").
- When the success routes for one resource form a CRUD family (GET list + GET by :id + POST/PUT/PATCH/DELETE), give every route in the family the SAME "stateful" field (collection = resource name, idParam = the path's :param name, seed of 3-5 coherent items — each including the id field — on the GET list route only). Never add "stateful" to negative-flow routes or to endpoints outside a CRUD family.${graphQlInstructions}

Return a JSON array of route objects.

${ROUTE_FORMAT_INSTRUCTIONS}
${modelSection ? `\n${modelSection}\n` : ''}
## Code snippets

${chunk}`;

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
