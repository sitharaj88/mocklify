import { describe, it, expect } from 'vitest';
import {
  scoreApiContent,
  extractApiSnippets,
  chunkScoredFiles,
  dedupeRoutes,
} from '../src/ai/scan/heuristics';
import type { RouteConfig } from '../src/types/core';

const RETROFIT_KOTLIN = `
interface UserApi {
    @GET("api/users/{id}")
    suspend fun getUser(@Path("id") id: String): User

    @POST("api/users")
    suspend fun createUser(@Body user: CreateUserRequest): User
}
`;

const FETCH_TS = `
export async function loadOrders(token: string) {
  const response = await fetch(\`\${BASE_URL}/api/orders\`, {
    headers: { Authorization: \`Bearer \${token}\` },
  });
  if (response.status === 401) throw new AuthError();
  return response.json();
}
`;

const PLAIN_UI = `
export function Button({ label }: { label: string }) {
  return <button className="btn">{label}</button>;
}
`;

describe('scoreApiContent', () => {
  it('scores Retrofit interfaces as strong API files', () => {
    expect(scoreApiContent(RETROFIT_KOTLIN, 'UserApi.kt')).toBeGreaterThanOrEqual(10);
  });

  it('scores fetch-based web code as strong API files', () => {
    expect(scoreApiContent(FETCH_TS, 'orders.ts')).toBeGreaterThanOrEqual(10);
  });

  it('scores plain UI components below the threshold', () => {
    expect(scoreApiContent(PLAIN_UI, 'Button.tsx')).toBeLessThan(10);
  });

  it('gives a filename bonus only when markers exist', () => {
    expect(scoreApiContent(PLAIN_UI, 'ApiService.tsx')).toBeLessThan(10);
    const withMarkers = scoreApiContent(FETCH_TS, 'ApiService.ts');
    const withoutHint = scoreApiContent(FETCH_TS, 'orders.ts');
    expect(withMarkers).toBeGreaterThan(withoutHint);
  });
});

describe('extractApiSnippets', () => {
  it('extracts regions around API markers', () => {
    const snippet = extractApiSnippets(RETROFIT_KOTLIN);
    expect(snippet).toContain('@GET("api/users/{id}")');
    expect(snippet).toContain('@POST("api/users")');
  });

  it('returns empty for files without markers', () => {
    expect(extractApiSnippets(PLAIN_UI)).toBe('');
  });

  it('merges overlapping regions instead of duplicating lines', () => {
    const snippet = extractApiSnippets(RETROFIT_KOTLIN);
    const occurrences = snippet.split('interface UserApi').length - 1;
    expect(occurrences).toBe(1);
  });

  it('respects the max character cap', () => {
    const big = Array.from({ length: 500 }, (_, i) => `await fetch("/api/thing/${i}")`).join('\n');
    expect(extractApiSnippets(big, 2000).length).toBeLessThanOrEqual(2000);
  });
});

describe('chunkScoredFiles', () => {
  it('packs files into chunks under the size limit, highest score first', () => {
    const files = [
      { path: 'low.ts', score: 12, snippet: 'x'.repeat(500) },
      { path: 'high.ts', score: 40, snippet: 'y'.repeat(500) },
    ];
    const chunks = chunkScoredFiles(files, 24000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].indexOf('high.ts')).toBeLessThan(chunks[0].indexOf('low.ts'));
  });

  it('splits into multiple chunks when content exceeds the per-chunk limit', () => {
    const files = Array.from({ length: 4 }, (_, i) => ({
      path: `f${i}.ts`,
      score: 20,
      snippet: 'z'.repeat(9000),
    }));
    const chunks = chunkScoredFiles(files, 20000, 96000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(20000);
    }
  });

  it('stops adding files at the total budget', () => {
    const files = Array.from({ length: 30 }, (_, i) => ({
      path: `f${i}.ts`,
      score: 20,
      snippet: 'z'.repeat(9000),
    }));
    const chunks = chunkScoredFiles(files, 24000, 30000);
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    expect(total).toBeLessThanOrEqual(30000);
  });
});

describe('dedupeRoutes', () => {
  const route = (
    method: RouteConfig['method'],
    path: string,
    statusCode: number
  ): Omit<RouteConfig, 'id'> => ({
    name: `${method} ${path} ${statusCode}`,
    enabled: true,
    method,
    path,
    response: { type: 'static', statusCode },
  });

  it('removes duplicates with same method, path, and status', () => {
    const result = dedupeRoutes([route('GET', '/api/users', 200), route('GET', '/api/users', 200)]);
    expect(result).toHaveLength(1);
  });

  it('keeps positive and negative variants of the same endpoint', () => {
    const result = dedupeRoutes([
      route('GET', '/api/users/:id', 200),
      route('GET', '/api/users/:id', 404),
      route('GET', '/api/users/:id', 401),
    ]);
    expect(result).toHaveLength(3);
  });

  it('treats paths case-insensitively and keeps the first occurrence', () => {
    const first = route('GET', '/API/Users', 200);
    const result = dedupeRoutes([first, route('GET', '/api/users', 200)]);
    expect(result).toEqual([first]);
  });

  it('distinguishes different methods on the same path', () => {
    const result = dedupeRoutes([route('GET', '/api/users', 200), route('POST', '/api/users', 200)]);
    expect(result).toHaveLength(2);
  });
});
