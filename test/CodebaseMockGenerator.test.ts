import { describe, it, expect } from 'vitest';
import {
  buildCensusChunkPrompt,
  buildChunkPrompt,
  buildRouteSurfaces,
  chunkModeForProject,
  directionalChunkScore,
  formatCensusHeads,
  pickCensusHeads,
  planProjectChunks,
  routeProjectKey,
  CENSUS_HEAD_CHARS,
  CENSUS_MAX_HEADS,
  DirectionalScoredFile,
  ProjectChunkGroup,
} from '../src/ai/CodebaseMockGenerator';
import type { RouteConfig } from '../src/types/core';
import { ROUTE_FORMAT_INSTRUCTIONS } from '../src/ai/MockGenerator';
import type { ApiDirection, ProjectKind } from '../src/ai/scan/projectProfile';

function file(
  path: string,
  clientScore: number,
  serverScore: number,
  snippet = `snippet of ${path}`
): DirectionalScoredFile {
  return { path, score: Math.max(clientScore, serverScore), snippet, clientScore, serverScore };
}

function profile(
  rootPath: string,
  direction: ApiDirection,
  kind: ProjectKind = 'backend',
  frameworks: string[] = []
): { rootPath: string; kind: ProjectKind; direction: ApiDirection; frameworks: string[] } {
  return { rootPath, kind, direction, frameworks };
}

describe('directionalChunkScore', () => {
  it('uses max(client, server) outside serves projects', () => {
    expect(directionalChunkScore({ clientScore: 30, serverScore: 12 }, 'consumes')).toBe(30);
    expect(directionalChunkScore({ clientScore: 12, serverScore: 30 }, 'consumes')).toBe(30);
    expect(directionalChunkScore({ clientScore: 12, serverScore: 30 }, 'both')).toBe(30);
    expect(directionalChunkScore({ clientScore: 12, serverScore: 30 }, undefined)).toBe(30);
  });

  it('ranks any server-scored file above any pure-client file in a serves project', () => {
    const declaring = directionalChunkScore({ clientScore: 0, serverScore: 10 }, 'serves');
    const clientOnly = directionalChunkScore({ clientScore: 900, serverScore: 0 }, 'serves');
    expect(declaring).toBeGreaterThan(clientOnly);
    expect(clientOnly).toBe(900); // falls back to the plain score
  });

  it('orders server-scored files by their server score in a serves project', () => {
    const a = directionalChunkScore({ clientScore: 0, serverScore: 40 }, 'serves');
    const b = directionalChunkScore({ clientScore: 100, serverScore: 20 }, 'serves');
    expect(a).toBeGreaterThan(b);
  });

  it('keeps the universal ranking for universal-only files instead of collapsing to 0', () => {
    expect(
      directionalChunkScore(
        { clientScore: 0, serverScore: 0, universalScore: 27, universalDirection: 'consumes' },
        undefined
      )
    ).toBe(27);
    // A serves-shaped universal-only file earns the serves boost too.
    const boosted = directionalChunkScore(
      { clientScore: 0, serverScore: 0, universalScore: 15, universalDirection: 'serves' },
      'serves'
    );
    const clientOnly = directionalChunkScore({ clientScore: 900, serverScore: 0 }, 'serves');
    expect(boosted).toBeGreaterThan(clientOnly);
    // Marker scores still win when present.
    expect(
      directionalChunkScore({ clientScore: 12, serverScore: 0, universalScore: 40 }, undefined)
    ).toBe(12);
  });
});

describe('chunkModeForProject', () => {
  it('maps serves to server mode and consumes to client mode regardless of totals', () => {
    expect(chunkModeForProject('serves', { clientScore: 999, serverScore: 0 })).toBe('server');
    expect(chunkModeForProject('consumes', { clientScore: 0, serverScore: 999 })).toBe('client');
  });

  it('decides both/unknown projects by aggregate scores, ties going to client', () => {
    expect(chunkModeForProject('both', { clientScore: 10, serverScore: 40 })).toBe('server');
    expect(chunkModeForProject('both', { clientScore: 40, serverScore: 10 })).toBe('client');
    expect(chunkModeForProject('both', { clientScore: 25, serverScore: 25 })).toBe('client');
    expect(chunkModeForProject(undefined, { clientScore: 5, serverScore: 50 })).toBe('server');
    expect(chunkModeForProject(undefined, { clientScore: 0, serverScore: 0 })).toBe('client');
  });

  it('breaks marker-score ties with the universal lean (unknown-language route tables)', () => {
    expect(chunkModeForProject(undefined, { clientScore: 0, serverScore: 0 }, 'serves')).toBe(
      'server'
    );
    expect(chunkModeForProject(undefined, { clientScore: 0, serverScore: 0 }, 'consumes')).toBe(
      'client'
    );
    // The lean never overrides real marker or profile signals.
    expect(chunkModeForProject(undefined, { clientScore: 40, serverScore: 10 }, 'serves')).toBe(
      'client'
    );
    expect(chunkModeForProject('consumes', { clientScore: 0, serverScore: 0 }, 'serves')).toBe(
      'client'
    );
  });
});

describe('planProjectChunks', () => {
  it('groups files per project with per-chunk direction and records project groups', () => {
    const profiles = [
      profile('app', 'consumes', 'mobile-android', ['Retrofit']),
      profile('server', 'serves', 'backend', ['Spring Boot']),
    ];
    const files = [
      file('app/src/ApiService.kt', 30, 0),
      file('server/src/UserController.java', 0, 40),
      file('server/src/HttpUtil.java', 20, 0),
    ];

    const { chunks, groups } = planProjectChunks(files, profiles);

    expect(chunks).toHaveLength(2);
    const appChunk = chunks.find((c) => c.rootPath === 'app');
    const serverChunk = chunks.find((c) => c.rootPath === 'server');
    expect(appChunk?.mode).toBe('client');
    expect(appChunk?.text).toContain('app/src/ApiService.kt');
    expect(serverChunk?.mode).toBe('server');
    expect(serverChunk?.text).toContain('server/src/UserController.java');
    expect(serverChunk?.text).toContain('server/src/HttpUtil.java');

    expect(groups).toEqual([
      {
        rootPath: 'app',
        kind: 'mobile-android',
        direction: 'consumes',
        frameworks: ['Retrofit'],
        matchedFileCount: 1,
        chunkCount: 1,
      },
      {
        rootPath: 'server',
        kind: 'backend',
        direction: 'serves',
        frameworks: ['Spring Boot'],
        matchedFileCount: 2,
        chunkCount: 1,
      },
    ]);
  });

  it('prefers server-scored files first inside a serves project chunk', () => {
    const profiles = [profile('server', 'serves')];
    const files = [
      file('server/client-helper.ts', 50, 0),
      file('server/routes.ts', 0, 20),
    ];
    const { chunks } = planProjectChunks(files, profiles);
    expect(chunks).toHaveLength(1);
    const routesAt = chunks[0].text.indexOf('server/routes.ts');
    const helperAt = chunks[0].text.indexOf('server/client-helper.ts');
    expect(routesAt).toBeGreaterThanOrEqual(0);
    expect(helperAt).toBeGreaterThanOrEqual(0);
    expect(routesAt).toBeLessThan(helperAt);
  });

  it('assigns files to the deepest enclosing project root', () => {
    const profiles = [profile('', 'consumes', 'web', ['React']), profile('server', 'serves')];
    const files = [file('src/api.ts', 30, 0), file('server/routes.ts', 0, 30)];
    const { chunks } = planProjectChunks(files, profiles);
    const rootChunk = chunks.find((c) => c.rootPath === '');
    const serverChunk = chunks.find((c) => c.rootPath === 'server');
    expect(rootChunk?.text).toContain('src/api.ts');
    expect(rootChunk?.text).not.toContain('server/routes.ts');
    expect(serverChunk?.text).toContain('server/routes.ts');
  });

  it('does not treat a sibling path sharing the root prefix as inside the project', () => {
    const profiles = [profile('app', 'consumes', 'mobile-android')];
    const files = [file('app-secondary/src/api.ts', 30, 0)];
    const { chunks, groups } = planProjectChunks(files, profiles);
    expect(chunks).toEqual([
      { text: expect.stringContaining('app-secondary/src/api.ts'), mode: 'client', rootPath: '' },
    ]);
    expect(groups.find((g) => g.rootPath === 'app')?.matchedFileCount).toBe(0);
  });

  it('collects files outside every project root into a workspace-root fallback group', () => {
    const profiles = [profile('app', 'consumes', 'mobile-android')];
    const files = [file('app/Api.kt', 30, 0), file('tools/seed.ts', 0, 25)];
    const { chunks, groups } = planProjectChunks(files, profiles);

    const fallbackChunk = chunks.find((c) => c.rootPath === '');
    expect(fallbackChunk?.mode).toBe('server'); // its files lean server-side
    expect(fallbackChunk?.text).toContain('tools/seed.ts');

    const fallbackGroup = groups.find((g) => g.rootPath === '');
    expect(fallbackGroup).toEqual({
      rootPath: '',
      kind: 'unknown',
      direction: 'serves',
      frameworks: [],
      matchedFileCount: 1,
      chunkCount: 1,
    });
  });

  it('keeps a group with zero counts for a project without matched files', () => {
    const profiles = [profile('app', 'consumes', 'mobile-ios'), profile('server', 'serves')];
    const files = [file('server/routes.rb', 0, 30)];
    const { groups } = planProjectChunks(files, profiles);
    expect(groups.find((g) => g.rootPath === 'app')).toMatchObject({
      matchedFileCount: 0,
      chunkCount: 0,
    });
  });

  it('picks a per-project mode for both-direction projects from aggregate scores', () => {
    const profiles = [profile('', 'both', 'web', ['Next.js'])];
    const serverHeavy = planProjectChunks(
      [file('pages/api/users.ts', 5, 40), file('lib/fetch.ts', 10, 0)],
      profiles
    );
    expect(serverHeavy.chunks[0]?.mode).toBe('server');

    const clientHeavy = planProjectChunks(
      [file('pages/api/users.ts', 5, 10), file('lib/fetch.ts', 40, 0)],
      profiles
    );
    expect(clientHeavy.chunks[0]?.mode).toBe('client');
  });

  it('splits a large project into multiple chunks and counts them on the group', () => {
    const profiles = [profile('server', 'serves')];
    const files = [
      file('server/a.ts', 0, 30, 'x'.repeat(500)),
      file('server/b.ts', 0, 20, 'y'.repeat(500)),
    ];
    const { chunks, groups } = planProjectChunks(files, profiles, 600);
    expect(chunks).toHaveLength(2);
    expect(chunks.every((c) => c.rootPath === 'server' && c.mode === 'server')).toBe(true);
    expect(groups[0].chunkCount).toBe(2);
  });

  it('returns no chunks but full groups when files list is empty', () => {
    const profiles = [profile('app', 'consumes', 'flutter')];
    const { chunks, groups } = planProjectChunks([], profiles);
    expect(chunks).toEqual([]);
    expect(groups).toHaveLength(1);
  });

  it('prompts a universal-only serves-shaped group as a server (unknown-language route table)', () => {
    const routeTable: DirectionalScoredFile = {
      path: 'src/routes.sin',
      score: 22,
      snippet: 'get "/users" do',
      clientScore: 0,
      serverScore: 0,
      universalScore: 22,
      universalDirection: 'serves',
    };
    const noProfiles = planProjectChunks([routeTable], []);
    expect(noProfiles.chunks[0]?.mode).toBe('server');
    expect(noProfiles.groups[0]?.direction).toBe('serves');

    const bothProfile = planProjectChunks(
      [routeTable],
      [{ rootPath: '', kind: 'unknown', direction: 'both', frameworks: [] }]
    );
    expect(bothProfile.chunks[0]?.mode).toBe('server');
  });
});

describe('buildRouteSurfaces', () => {
  function route(method: string, path: string, statusCode = 200): Omit<RouteConfig, 'id'> {
    return {
      name: `${method} ${path}`,
      enabled: true,
      method: method as RouteConfig['method'],
      path,
      response: { type: 'static', statusCode, body: {} },
    } as Omit<RouteConfig, 'id'>;
  }

  function group(rootPath: string, direction: 'consumes' | 'serves' | 'both'): ProjectChunkGroup {
    return {
      rootPath,
      kind: rootPath === 'server' ? 'backend' : 'mobile-android',
      direction,
      frameworks: [],
      matchedFileCount: 1,
      chunkCount: 1,
    };
  }

  it('groups final routes by the project whose chunk produced them', () => {
    const appRoute = route('GET', '/api/profile');
    const serverRoute = route('GET', '/api/orders');
    const rootByKey = new Map([
      [routeProjectKey('GET', '/api/profile', 200), 'app'],
      [routeProjectKey('GET', '/api/orders', 200), 'server'],
    ]);
    const surfaces = buildRouteSurfaces(
      [appRoute, serverRoute],
      rootByKey,
      [group('app', 'consumes'), group('server', 'serves')],
      'Shop'
    );
    expect(surfaces).toHaveLength(2);
    expect(surfaces[0]).toMatchObject({
      name: 'app',
      rootPath: 'app',
      direction: 'consumes',
      routes: [appRoute],
    });
    expect(surfaces[1]).toMatchObject({
      name: 'server',
      kind: 'backend',
      direction: 'serves',
      routes: [serverRoute],
    });
  });

  it('names the workspace-root surface after the app and drops empty surfaces', () => {
    const r = route('GET', '/api/users');
    const rootByKey = new Map([[routeProjectKey('GET', '/api/users', 200), '']]);
    const surfaces = buildRouteSurfaces(
      [r],
      rootByKey,
      [group('', 'consumes'), group('server', 'serves')],
      'Shop'
    );
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0].name).toBe('Shop');
    expect(surfaces[0].routes).toEqual([r]);
  });

  it('sends unattributed routes (e.g. repaired ones) to the first surface', () => {
    const repaired = route('POST', '/api/checkout', 201);
    const surfaces = buildRouteSurfaces(
      [repaired],
      new Map(),
      [group('app', 'consumes'), group('server', 'serves')],
      'Shop'
    );
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0].name).toBe('app');
    expect(surfaces[0].routes).toEqual([repaired]);
  });

  it('keys attribution on method + path + status so negative variants track their chunk', () => {
    const ok = route('GET', '/api/users/:id', 200);
    const notFound = route('GET', '/api/users/:id', 404);
    const rootByKey = new Map([
      [routeProjectKey('GET', '/api/users/:id', 200), 'app'],
      [routeProjectKey('GET', '/api/users/:id', 404), 'server'],
    ]);
    const surfaces = buildRouteSurfaces(
      [ok, notFound],
      rootByKey,
      [group('app', 'consumes'), group('server', 'serves')],
      'Shop'
    );
    expect(surfaces.find((s) => s.name === 'app')?.routes).toEqual([ok]);
    expect(surfaces.find((s) => s.name === 'server')?.routes).toEqual([notFound]);
  });

  it('attaches a route produced by several projects to every owning surface', () => {
    const shared = route('GET', '/health');
    const appOnly = route('GET', '/api/profile');
    const rootByKey = new Map<string, string[]>([
      [routeProjectKey('GET', '/health', 200), ['app', 'server']],
      [routeProjectKey('GET', '/api/profile', 200), ['app']],
    ]);
    const surfaces = buildRouteSurfaces(
      [shared, appOnly],
      rootByKey,
      [group('app', 'consumes'), group('server', 'serves')],
      'Shop'
    );
    expect(surfaces).toHaveLength(2);
    expect(surfaces.find((s) => s.name === 'app')?.routes).toEqual([shared, appOnly]);
    expect(surfaces.find((s) => s.name === 'server')?.routes).toEqual([shared]);
  });

  it('keeps the second surface alive when ALL of its routes are shared with the first', () => {
    const shared = route('GET', '/api/users');
    const rootByKey = new Map<string, string[]>([
      [routeProjectKey('GET', '/api/users', 200), ['app', 'server']],
    ]);
    const surfaces = buildRouteSurfaces(
      [shared],
      rootByKey,
      [group('app', 'consumes'), group('server', 'serves')],
      'Shop'
    );
    expect(surfaces.map((s) => s.name)).toEqual(['app', 'server']);
  });

  it('returns [] when there are no groups (profile-less fallback)', () => {
    expect(buildRouteSurfaces([route('GET', '/x')], new Map(), [], 'Shop')).toEqual([]);
  });
});

describe('buildChunkPrompt', () => {
  const base = {
    appName: 'Shop',
    chunk: '// File: src/api.ts\nfetch("/api/users")',
    modelSection: '',
  };

  it('client mode without a profile reproduces the original prompt framing', () => {
    const prompt = buildChunkPrompt({ ...base, mode: 'client' });
    expect(prompt).toContain(
      'Below are code snippets from a client application ("Shop" — could be Android, iOS, web, Flutter, or similar). Identify every HTTP API endpoint this code calls'
    );
    expect(prompt).toContain('- ONLY include endpoints this code actually calls — never invent endpoints.');
    expect(prompt).toContain("the way the client's error handling expects");
    expect(prompt).toContain('\n## Code snippets\n\n// File: src/api.ts');
    expect(prompt).toContain(ROUTE_FORMAT_INSTRUCTIONS);
    expect(prompt).not.toContain('## Workspace profile');
    expect(prompt).not.toContain('DECLARE');
    expect(prompt).not.toContain('## GraphQL');
  });

  it('server mode switches to backend framing: declarations, handlers, DTOs', () => {
    const prompt = buildChunkPrompt({ ...base, mode: 'server' });
    expect(prompt).toContain('backend service ("Shop")');
    expect(prompt).toContain('These snippets DECLARE routes');
    expect(prompt).toContain('handler code, serializers, and DTOs');
    expect(prompt).toContain('what this backend serves');
    expect(prompt).toContain('- ONLY include endpoints this code actually declares — never invent endpoints.');
    expect(prompt).toContain('## Code snippets (route declarations)');
    expect(prompt).not.toContain('client application (');
    // Shared instructions survive in both modes
    expect(prompt).toContain('"tags": ["negative", "401"]');
    expect(prompt).toContain('"delay": { "type": "fixed", "value": 10000 }');
    expect(prompt).toContain(ROUTE_FORMAT_INSTRUCTIONS);
  });

  it('includes the workspace profile section when a summary is provided', () => {
    const summary = 'Detected: Spring Boot backend at server/ [serves]';
    for (const mode of ['client', 'server'] as const) {
      const prompt = buildChunkPrompt({ ...base, mode, profileSummary: summary });
      expect(prompt).toContain(`## Workspace profile\n${summary}`);
    }
  });

  it('includes the model section when present', () => {
    const prompt = buildChunkPrompt({
      ...base,
      mode: 'client',
      modelSection: '## Data models\ninterface User { id: string }',
    });
    expect(prompt).toContain('interface User { id: string }');
  });

  it('adds mode-appropriate GraphQL guidance when the chunk has GraphQL markers', () => {
    const gqlChunk = 'const client = new ApolloClient({ uri: "/graphql" })';
    const client = buildChunkPrompt({ ...base, chunk: gqlChunk, mode: 'client' });
    expect(client).toContain('## GraphQL');
    expect(client).toContain('These snippets use a GraphQL client.');
    const server = buildChunkPrompt({ ...base, chunk: gqlChunk, mode: 'server' });
    expect(server).toContain('These snippets define a GraphQL API.');
  });
});

describe('pickCensusHeads', () => {
  const apiLua = [
    'local url = "https://api.shop.example/v1"',
    'http.request("GET", "/api/products/{id}")',
    'http.request("POST", "/api/orders")',
    'headers["Authorization"] = "Bearer " .. token',
  ].join('\n');
  const prose = 'This project bakes bread. It has no networking whatsoever, just flour and water.';

  it('ranks API-looking content above prose and truncates long heads', () => {
    const heads = pickCensusHeads([
      { path: 'README.txt', content: prose },
      { path: 'src/http.lua', content: apiLua },
    ]);
    expect(heads[0].path).toBe('src/http.lua');
    expect(heads[1].path).toBe('README.txt');

    const long = pickCensusHeads([{ path: 'big.lua', content: 'x'.repeat(CENSUS_HEAD_CHARS + 50) }]);
    expect(long[0].head).toHaveLength(CENSUS_HEAD_CHARS + 1); // + ellipsis
    expect(long[0].head.endsWith('…')).toBe(true);
  });

  it('caps the number of heads and breaks score ties deterministically by path', () => {
    const files = Array.from({ length: CENSUS_MAX_HEADS + 5 }, (_, i) => ({
      path: `file-${String(i).padStart(2, '0')}.txt`,
      content: prose,
    })).reverse(); // input order must not matter
    const heads = pickCensusHeads(files);
    expect(heads).toHaveLength(CENSUS_MAX_HEADS);
    expect(heads.map((h) => h.path)).toEqual([...heads.map((h) => h.path)].sort());
    expect(heads[0].path).toBe('file-00.txt');
  });

  it('keeps zero-scoring files — any head beats none in a seedless workspace', () => {
    const heads = pickCensusHeads([{ path: 'notes.txt', content: prose }]);
    expect(heads).toHaveLength(1);
  });
});

describe('formatCensusHeads', () => {
  it('returns an empty string for no heads', () => {
    expect(formatCensusHeads([])).toBe('');
  });

  it('formats each head under a File header', () => {
    const section = formatCensusHeads([
      { path: 'src/a.lua', head: 'local x = 1' },
      { path: 'src/b.lua', head: 'local y = 2' },
    ]);
    expect(section).toContain('### Most promising file heads');
    expect(section).toContain('#### File: src/a.lua\nlocal x = 1');
    expect(section).toContain('#### File: src/b.lua\nlocal y = 2');
  });
});

describe('buildCensusChunkPrompt', () => {
  const censusSection = '## Workspace census (3 files)\n### Directory tree (top 3 levels)\n. (3 files)';

  it('frames the zero-seed census scan and embeds the census section verbatim', () => {
    const prompt = buildCensusChunkPrompt({ appName: 'Shop', censusSection });
    expect(prompt).toContain('NO known API client/server patterns in the workspace "Shop"');
    expect(prompt).toContain(censusSection);
    expect(prompt).toContain(ROUTE_FORMAT_INSTRUCTIONS);
    expect(prompt).toContain('Return a JSON array of route objects.');
    expect(prompt).not.toContain('## Workspace profile');
  });

  it('is direction-neutral and allows an honest empty result', () => {
    const prompt = buildCensusChunkPrompt({ appName: 'Shop', censusSection });
    expect(prompt).toContain('calls or serves');
    expect(prompt).toContain('return an empty JSON array []');
    // Shared negative-flow contract survives in census mode
    expect(prompt).toContain('"tags": ["negative", "401"]');
    expect(prompt).toContain('"delay": { "type": "fixed", "value": 10000 }');
  });

  it('includes the workspace profile section when a summary is provided', () => {
    const prompt = buildCensusChunkPrompt({
      appName: 'Shop',
      censusSection,
      profileSummary: 'Detected: library at workspace root',
    });
    expect(prompt).toContain('## Workspace profile\nDetected: library at workspace root');
  });
});
