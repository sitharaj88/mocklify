import * as vscode from 'vscode';
import { RouteConfig } from '../types/core.js';
import type { AiService, AiRequestOptions } from './AiService.js';
import { MockGenerator, ROUTE_FORMAT_INSTRUCTIONS } from './MockGenerator.js';
import {
  API_FILE_GLOB,
  SCAN_EXCLUDE_GLOB,
  ScoredFile,
  scoreApiContent,
  extractApiSnippets,
  chunkScoredFiles,
  dedupeRoutes,
} from './scan/heuristics.js';

const MAX_FILES_TO_READ = 600;
const MAX_FILE_BYTES = 262_144; // skip generated/bundled monsters
const MIN_SCORE = 10; // at least one strong API marker

export interface CodebaseScanSummary {
  scannedFileCount: number;
  matchedFileCount: number;
  chunkCount: number;
  routes: Omit<RouteConfig, 'id'>[];
  positiveCount: number;
  negativeCount: number;
}

export interface CodebaseScanProgress {
  message: string;
  /** 0..1 across the whole pipeline */
  fraction: number;
}

/**
 * Scans the workspace codebase (any client: Android, iOS, web, Flutter, …)
 * for HTTP API usage and asks the active AI provider to reverse-engineer a
 * complete mock server: success routes plus disabled negative-flow routes
 * (400/401/404/500) the user can toggle on to simulate failures.
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

    const scored: ScoredFile[] = [];
    let scanned = 0;
    for (const uri of uris) {
      if (options?.token?.isCancellationRequested) {
        throw new vscode.CancellationError();
      }
      scanned++;
      if (scanned % 100 === 0) {
        report(`Scanning workspace for API calls… (${scanned}/${uris.length} files)`, 0.02 + 0.13 * (scanned / uris.length));
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

    // 2. Pack snippets into provider-friendly chunks
    const chunks = chunkScoredFiles(scored);

    // 3. AI analysis per chunk — extract endpoints and generate routes
    const appName = vscode.workspace.workspaceFolders?.[0]?.name ?? 'App';
    const allRoutes: Omit<RouteConfig, 'id'>[] = [];

    for (let i = 0; i < chunks.length; i++) {
      if (options?.token?.isCancellationRequested) {
        throw new vscode.CancellationError();
      }
      const provider = (await this.ai.getActiveProviderLabel()) ?? 'AI';
      report(
        `Analyzing API integrations with ${provider} (part ${i + 1}/${chunks.length})…`,
        0.2 + 0.7 * (i / chunks.length)
      );

      try {
        const routes = await this.analyzeChunk(appName, chunks[i], { token: options?.token });
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

    report('Assembling mock server…', 0.95);
    const routes = dedupeRoutes(allRoutes);
    const negativeCount = routes.filter((r) => r.tags?.includes('negative')).length;

    return {
      scannedFileCount: scanned,
      matchedFileCount: scored.length,
      chunkCount: chunks.length,
      routes,
      positiveCount: routes.length - negativeCount,
      negativeCount,
    };
  }

  private async analyzeChunk(
    appName: string,
    chunk: string,
    options?: AiRequestOptions
  ): Promise<Omit<RouteConfig, 'id'>[]> {
    const prompt = `You are an expert API reverse-engineer. Below are code snippets from a client application ("${appName}" — could be Android, iOS, web, Flutter, or similar). Identify every HTTP API endpoint this code calls, then create mock API routes for a mock server so the app can run against it.

For EVERY endpoint you find, create:
1. A success route (\`"enabled": true\`) whose response body matches EXACTLY what the client code expects to parse — infer field names and types from data models, JSON parsing, and how the response is used. Use realistic, domain-appropriate example data.
2. Negative-flow routes (\`"enabled": false\`) for realistic failures: 400 validation error (for endpoints with request bodies), 401 unauthorized (when the code sends auth headers/tokens), 404 not found (for endpoints with path parameters), and 500 server error (for the most important endpoints). Shape the error bodies the way the client's error handling expects (look for error parsing in the code). Tag every negative route with "negative" plus its status, e.g. "tags": ["negative", "401"]. Also give them names like "GET /api/users/:id — 404 not found".

Rules:
- ONLY include endpoints this code actually calls — never invent endpoints.
- Strip the host/base URL; keep only the path. Convert path variables to :param form.
- Tag positive routes with a short domain tag (e.g. "users", "orders").

Return a JSON array of route objects.

${ROUTE_FORMAT_INSTRUCTIONS}

## Code snippets

${chunk}`;

    const raw = await this.ai.sendJsonRequest(prompt, {
      ...options,
      justification: 'Mocklify is analyzing your codebase to generate a mock server.',
    });
    return MockGenerator.validateRoutes(raw);
  }
}
