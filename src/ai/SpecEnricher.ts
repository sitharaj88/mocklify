import type * as vscode from 'vscode';
import { HttpMethod, NEGATIVE_ROUTE_PRIORITY, RouteConfig } from '../types/core.js';
import type { AiService } from './AiService.js';
import { MockGenerator, ROUTE_FORMAT_INSTRUCTIONS, ROUTES_JSON_SCHEMA } from './MockGenerator.js';
import type { OpenApiImportResult } from '../services/OpenApiImportService.js';

/**
 * Best-effort AI enrichment of a deterministic OpenAPI import: replaces
 * faker-generic values with coherent domain data (consistent across routes)
 * and fills in the standard negative routes the spec did not document. The
 * AI may never add endpoints that are not in the spec — anything outside the
 * imported (method, path) set is post-filtered, and every imported
 * (method, path, status) that the AI dropped is restored from the
 * deterministic result. On any AI failure the deterministic import is
 * returned untouched with enriched: false so the command can proceed offline.
 */

const MAX_CHARS_PER_CHUNK = 24000;
const MAX_ROUTE_JSON_CHARS = 2400;
const STANDARD_NEGATIVE_STATUSES = [400, 401, 404, 429, 500];

export interface EnrichedImportResult extends OpenApiImportResult {
  enriched: boolean;
  /** AI request accounting for user-facing summaries (present when enrichment ran). */
  chunksTotal?: number;
  chunksFailed?: number;
}

export interface SpecEnrichProgress {
  message: string;
  /** 0..1 across the whole enrichment */
  fraction: number;
}

export interface SpecEnrichOptions {
  token?: vscode.CancellationToken;
  onProgress?: (progress: SpecEnrichProgress) => void;
}

/** Path key that ignores param names so :id and :petId compare equal. */
function endpointKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path.toLowerCase().replace(/:[^/]+/g, ':p')}`;
}

function methodsOf(route: Omit<RouteConfig, 'id'>): HttpMethod[] {
  return Array.isArray(route.method) ? route.method : [route.method];
}

function truncateJson(value: unknown, maxChars = MAX_ROUTE_JSON_CHARS): string {
  let text: string;
  try {
    text = JSON.stringify(value, null, 1) ?? 'null';
  } catch {
    text = String(value);
  }
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n… (truncated)` : text;
}

/**
 * Render imported routes as prompt blocks grouped per endpoint (so an
 * endpoint's success and documented-error routes never split across chunks),
 * packed into provider-friendly chunks.
 */
export function formatImportBlocks(
  importResult: OpenApiImportResult,
  maxCharsPerChunk = MAX_CHARS_PER_CHUNK
): string[] {
  const groups = new Map<string, { label: string; routes: Omit<RouteConfig, 'id'>[] }>();
  for (const route of importResult.routes) {
    const label = `${methodsOf(route).join('|')} ${route.path}`;
    let group = groups.get(label);
    if (!group) {
      group = { label, routes: [] };
      groups.set(label, group);
    }
    group.routes.push(route);
  }

  const chunks: string[] = [];
  let current = '';
  for (const group of groups.values()) {
    const documented = group.routes
      .map((r) => r.response.statusCode)
      .filter((status) => status < 200 || status >= 300);
    let block = `### ${group.label}\n`;
    block += `Documented error statuses (keep, do not duplicate): ${documented.length > 0 ? documented.join(', ') : 'none'}\n`;
    for (const route of group.routes) {
      block += `${truncateJson(route)}\n`;
    }
    block += '\n';

    if (current && current.length + block.length > maxCharsPerChunk) {
      chunks.push(current);
      current = '';
    }
    current += block;
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

export class SpecEnricher {
  async enrich(
    importResult: OpenApiImportResult,
    ai: AiService,
    options?: SpecEnrichOptions
  ): Promise<EnrichedImportResult> {
    const report = (message: string, fraction: number) =>
      options?.onProgress?.({ message, fraction });

    if (importResult.routes.length === 0) {
      return { ...importResult, enriched: false };
    }

    const chunks = formatImportBlocks(importResult);
    const aiRoutes: Omit<RouteConfig, 'id'>[] = [];
    let failedChunks = 0;

    try {
      for (let i = 0; i < chunks.length; i++) {
        if (options?.token?.isCancellationRequested) {
          break;
        }
        const provider = (await ai.getActiveProviderLabel()) ?? 'AI';
        report(
          `Enriching imported routes with ${provider} (part ${i + 1}/${chunks.length})…`,
          0.1 + 0.8 * (i / chunks.length)
        );
        try {
          const raw = await ai.sendJsonRequest(
            this.buildPrompt(importResult.name, chunks[i]),
            {
              token: options?.token,
              justification:
                'Mocklify is enriching mock routes imported from an OpenAPI/Swagger spec.',
            },
            ROUTES_JSON_SCHEMA
          );
          aiRoutes.push(...MockGenerator.validateRoutes(raw));
        } catch (error) {
          // One failed chunk shouldn't lose the whole run — unless it's the only one
          if (chunks.length === 1) {
            throw error;
          }
          failedChunks++;
          console.error(`Mocklify: spec enrichment chunk ${i + 1} failed:`, error);
        }
      }
    } catch (error) {
      // Enrichment is best-effort (AiUnavailableError or any AI failure):
      // fall back to the deterministic import so the command works offline.
      console.error('Mocklify: spec enrichment failed, keeping deterministic import:', error);
      return { ...importResult, enriched: false };
    }

    if (aiRoutes.length === 0) {
      return { ...importResult, enriched: false };
    }

    report('Assembling enriched routes…', 0.95);
    return {
      name: importResult.name,
      warnings: importResult.warnings,
      routes: this.mergeRoutes(importResult.routes, aiRoutes),
      enriched: true,
      chunksTotal: chunks.length,
      chunksFailed: failedChunks,
    };
  }

  /**
   * Post-filter and merge: drop anything outside the imported endpoint set,
   * enforce the negative-route convention, and restore any imported
   * (method, path, status) the AI dropped from the deterministic routes.
   */
  private mergeRoutes(
    imported: Omit<RouteConfig, 'id'>[],
    aiRoutes: Omit<RouteConfig, 'id'>[]
  ): Omit<RouteConfig, 'id'>[] {
    const allowed = new Set(
      imported.flatMap((route) => methodsOf(route).map((m) => endpointKey(m, route.path)))
    );

    // Hard guarantee the model never invents endpoints: keep only methods
    // whose (method, path) pair was imported, ignoring param name differences.
    const filtered: Omit<RouteConfig, 'id'>[] = [];
    for (const route of aiRoutes) {
      const kept = methodsOf(route).filter((m) => allowed.has(endpointKey(m, route.path)));
      if (kept.length === 0) {
        continue;
      }
      const methods = methodsOf(route);
      filtered.push(
        kept.length === methods.length
          ? route
          : { ...route, method: kept.length === 1 ? kept[0] : kept }
      );
    }

    // Enforce negative-route convention regardless of what the model returned.
    // Priority makes an enabled negative route outscore the success route
    // sharing its method+path (the matcher keeps the first route on a tie).
    for (const route of filtered) {
      const status = route.response.statusCode;
      if (status < 200 || status >= 300) {
        route.enabled = false;
        const tags = new Set(route.tags ?? []);
        tags.add('negative');
        tags.add(String(status));
        route.tags = [...tags];
        if (route.priority === undefined) {
          route.priority = NEGATIVE_ROUTE_PRIORITY;
        }
      }
    }

    // Drop AI routes that fail the programmatic checks (stateful coherence,
    // path shape, …) — the deterministic import below fills whatever is lost.
    const verified = MockGenerator.verifyRoutes(filtered).accepted;

    // AI versions win per (method, path, status); deterministic routes fill
    // whatever the AI dropped, so no imported endpoint is ever lost.
    const seen = new Set<string>();
    const merged: Omit<RouteConfig, 'id'>[] = [];
    for (const route of [...verified, ...imported]) {
      const keys = methodsOf(route).map(
        (m) => `${endpointKey(m, route.path)}|${route.response.statusCode}`
      );
      if (keys.every((key) => seen.has(key))) {
        continue;
      }
      keys.forEach((key) => seen.add(key));
      merged.push(route);
    }
    return merged;
  }

  private buildPrompt(apiName: string, chunk: string): string {
    return `You are improving mock API routes that were imported from an OpenAPI/Swagger specification for "${apiName}". The routes were generated deterministically, so response body values are generic placeholders.

For the endpoints listed below:
1. Rewrite response body VALUES with coherent, realistic domain data appropriate to this API. Keep the body STRUCTURE identical — same keys, same nesting, arrays stay arrays — and keep each route's method, path, and status code exactly as given. Entities must stay consistent ACROSS routes: an item in a list response must reappear with the same id and field values in the corresponding detail (get-by-id) response and in related create/update responses.
2. For each endpoint, add disabled negative routes (\`"enabled": false\`) for the standard failure statuses ${STANDARD_NEGATIVE_STATUSES.join(', ')} that are NOT already listed as documented for that endpoint. Tag every negative route with "negative" plus its status, e.g. "tags": ["negative", "404"], and name it like "GET /api/users/:userId — 404 not found". Shape error bodies realistically, e.g. { "error": { "code": "NOT_FOUND", "message": "…" } }.

Rules:
- ONLY return routes for the endpoints listed below — never invent endpoints, methods, or paths that are not listed.
- Return EVERY listed route (improved) plus the added negative routes.
- Use the :param path form exactly as given.

Return a JSON object of the form {"routes": [...]}.

${ROUTE_FORMAT_INSTRUCTIONS}

## Imported endpoints

${chunk}`;
  }
}
