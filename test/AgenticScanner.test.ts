import { describe, it, expect } from 'vitest';
import {
  AGENT_MAX_TOOL_CALLS,
  AGENTIC_SCAN_BUDGET_MS,
  LANGUAGE_UNKNOWN_NOTE,
  LOW_CONFIDENCE_SEED_SCORE,
  MAX_SUBMIT_REJECTIONS,
  MAX_TOOL_CALLS_CAP,
  MULTI_PROJECT_READ_BUDGET_BYTES,
  NO_API_SURFACE_ACK,
  NO_API_SURFACE_FALLBACK_REASON,
  NO_API_SURFACE_REASON_MAX_CHARS,
  PROGRESS_NOTE_MAX_CHARS,
  REPORT_PROGRESS_TOOL,
  ROUTES_ALREADY_ACCEPTED,
  SCAN_BUDGET_CAP_MS,
  SEED_MAX_FILES,
  SEED_MAX_FILES_MULTI,
  SEED_TEASER_LINE_CHARS,
  SUBMIT_ROUTES_ACCEPTED_ACK,
  SUBMIT_ROUTES_TOOL,
  SURFACE_ROUTES_JSON_SCHEMA,
  buildMissionPrompt,
  buildReconFirstPrompt,
  buildSurfaceSeeds,
  createSubmitState,
  languageUnknownNote,
  noApiSurfaceReason,
  selectMissionVariant,
  universalSeedSnippet,
  describeToolCall,
  formatRejectionResult,
  formatSeedSection,
  formatSeedTeaser,
  formatToolCallProgress,
  groupRoutesBySurface,
  handleSubmitRoutes,
  progressNote,
  recordSurfaceInfo,
  routeSurfaceKey,
  sanitizeSurfaceName,
  scaleMaxToolCalls,
  scaleReadBudgetBytes,
  scaleScanBudgetMs,
  surfaceLookup,
  toolCallFraction,
  type DirectionalScoredFile,
  type SurfaceSeed,
} from '../src/ai/AgenticScanner';
import { ROUTES_JSON_SCHEMA } from '../src/ai/MockGenerator';
import { DEFAULT_READ_BUDGET_BYTES } from '../src/ai/agent/workspaceTools';
import type { ProjectProfile } from '../src/ai/scan/projectProfile';
import type { ScoredFile } from '../src/ai/scan/heuristics';
import type { UniversalSignals } from '../src/ai/scan/universalSignals';
import type { RouteConfig } from '../src/types/core';

function makeRoute(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'GET /api/users',
    enabled: true,
    method: 'GET',
    path: '/api/users',
    response: {
      type: 'static',
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { contentType: 'application/json', content: { users: [{ id: 1, name: 'Ada' }] } },
    },
    tags: ['users'],
    ...overrides,
  };
}

/** A schema-valid route that fails verifyRoutes (negative but enabled). */
function badNegativeRoute(): Record<string, unknown> {
  return makeRoute({
    name: 'GET /api/users — 401 unauthorized',
    path: '/api/users/:id',
    enabled: true,
    tags: ['negative', '401'],
    response: {
      type: 'static',
      statusCode: 401,
      body: { contentType: 'application/json', content: { error: 'unauthorized' } },
    },
  });
}

function makeProfile(overrides: Partial<ProjectProfile> = {}): ProjectProfile {
  return {
    rootPath: '',
    kind: 'web',
    frameworks: [],
    direction: 'consumes',
    confidence: 'high',
    specFiles: [],
    evidence: [],
    ...overrides,
  };
}

function makeSeed(overrides: Partial<SurfaceSeed> = {}): SurfaceSeed {
  return {
    name: 'app',
    rootPath: '',
    kind: 'web',
    frameworks: [],
    direction: 'consumes',
    specFiles: [],
    seedSection: '- src/api.ts (score 40)',
    seedFileCount: 1,
    matchedFileCount: 1,
    ...overrides,
  };
}

function directionalFile(
  path: string,
  clientScore: number,
  serverScore: number,
  snippet = 'fetch("/api")'
): DirectionalScoredFile {
  return { path, score: Math.max(clientScore, serverScore), clientScore, serverScore, snippet };
}

describe('formatSeedTeaser', () => {
  it('keeps the first non-empty lines, trimmed', () => {
    const teaser = formatSeedTeaser('  const a = fetch("/api/users");\n\n   .then(r => r.json())\nreturn a;\nextra line');
    expect(teaser.split('\n')).toEqual([
      'const a = fetch("/api/users");',
      '.then(r => r.json())',
      'return a;',
    ]);
  });

  it('truncates long lines with an ellipsis', () => {
    const long = 'x'.repeat(SEED_TEASER_LINE_CHARS + 40);
    const teaser = formatSeedTeaser(long);
    expect(teaser).toBe(`${'x'.repeat(SEED_TEASER_LINE_CHARS)}…`);
  });

  it('returns an empty string for an empty snippet', () => {
    expect(formatSeedTeaser('')).toBe('');
    expect(formatSeedTeaser('\n \n')).toBe('');
  });
});

describe('formatSeedSection', () => {
  const file = (path: string, score: number, snippet = 'fetch("/api")'): ScoredFile => ({
    path,
    score,
    snippet,
  });

  it('sorts by score descending and lists path with score', () => {
    const section = formatSeedSection([file('b.ts', 10), file('a.ts', 50)]);
    const lines = section.split('\n');
    expect(lines[0]).toBe('- a.ts (score 50)');
    expect(section.indexOf('a.ts')).toBeLessThan(section.indexOf('b.ts'));
  });

  it('caps the list at maxFiles', () => {
    const files = Array.from({ length: SEED_MAX_FILES + 10 }, (_, i) => file(`f${i}.ts`, i));
    const section = formatSeedSection(files);
    expect(section.split('\n').filter((l) => l.startsWith('- ')).length).toBe(SEED_MAX_FILES);
    // Lowest-scored files fell off
    expect(section).not.toContain('- f0.ts');
    expect(section).toContain(`- f${SEED_MAX_FILES + 9}.ts`);
  });

  it('indents teaser lines under the file entry', () => {
    const section = formatSeedSection([file('api.ts', 20, 'line one\nline two')]);
    expect(section).toBe('- api.ts (score 20)\n    line one\n    line two');
  });

  it('omits the teaser block for empty snippets', () => {
    expect(formatSeedSection([file('api.ts', 20, '')])).toBe('- api.ts (score 20)');
  });
});

describe('describeToolCall / formatToolCallProgress', () => {
  it('names the tool and its main argument', () => {
    expect(describeToolCall({ name: 'read_file', input: { path: 'src/api/UserApi.kt' } })).toBe(
      'read src/api/UserApi.kt'
    );
    expect(describeToolCall({ name: 'list_files', input: { glob: '**/*.swift' } })).toBe(
      'list **/*.swift'
    );
    expect(describeToolCall({ name: 'search_code', input: { pattern: '/api/orders' } })).toBe(
      'search "/api/orders"'
    );
    expect(describeToolCall({ name: 'submit_routes', input: { routes: [] } })).toBe(
      'submitting routes'
    );
  });

  it('surfaces the note for report_progress calls', () => {
    expect(
      describeToolCall({ name: 'report_progress', input: { note: 'Reading UserController…' } })
    ).toBe('Reading UserController…');
    expect(describeToolCall({ name: 'report_progress', input: {} })).toBe('progress note');
  });

  it('handles missing input and unknown tools', () => {
    expect(describeToolCall({ name: 'read_file', input: undefined })).toBe('read a file');
    expect(describeToolCall({ name: 'mystery_tool', input: {} })).toBe('mystery_tool');
  });

  it('truncates long arguments', () => {
    const long = 'a'.repeat(100);
    expect(describeToolCall({ name: 'read_file', input: { path: long } })).toBe(
      `read ${'a'.repeat(60)}…`
    );
  });

  it('formats the running call counter (1-based) from the 0-based index', () => {
    const message = formatToolCallProgress(
      { name: 'read_file', input: { path: 'src/api/UserApi.kt' } },
      11,
      30
    );
    expect(message).toBe('Exploring codebase: read src/api/UserApi.kt (call 12/30)…');
  });
});

describe('toolCallFraction', () => {
  it('starts just above the loop baseline and advances monotonically', () => {
    const first = toolCallFraction(0, 30);
    expect(first).toBeGreaterThan(0.2);
    let previous = first;
    for (let i = 1; i < 30; i++) {
      const fraction = toolCallFraction(i, 30);
      expect(fraction).toBeGreaterThanOrEqual(previous);
      previous = fraction;
    }
  });

  it('caps at 0.9 even past the nominal budget', () => {
    expect(toolCallFraction(29, 30)).toBeCloseTo(0.9, 10);
    expect(toolCallFraction(50, 30)).toBe(0.9);
    expect(toolCallFraction(0, 0)).toBeLessThanOrEqual(0.9);
  });
});

describe('budget scaling', () => {
  it('keeps the single-project baseline unchanged', () => {
    expect(AGENT_MAX_TOOL_CALLS).toBe(30);
    expect(scaleMaxToolCalls(1)).toBe(AGENT_MAX_TOOL_CALLS);
    expect(scaleScanBudgetMs(1)).toBe(AGENTIC_SCAN_BUDGET_MS);
    expect(scaleReadBudgetBytes(1)).toBe(DEFAULT_READ_BUDGET_BYTES);
  });

  it('grants 15 calls and 4 minutes per additional project', () => {
    expect(scaleMaxToolCalls(2)).toBe(45);
    expect(scaleScanBudgetMs(2)).toBe(12 * 60_000);
    expect(scaleMaxToolCalls(3)).toBe(60);
    expect(scaleScanBudgetMs(3)).toBe(16 * 60_000);
  });

  it('caps at 60 calls and 16 minutes however many projects were detected', () => {
    expect(scaleMaxToolCalls(10)).toBe(MAX_TOOL_CALLS_CAP);
    expect(scaleScanBudgetMs(10)).toBe(SCAN_BUDGET_CAP_MS);
  });

  it('raises the read budget to 1MB only for multi-project workspaces', () => {
    expect(scaleReadBudgetBytes(0)).toBe(DEFAULT_READ_BUDGET_BYTES);
    expect(scaleReadBudgetBytes(2)).toBe(MULTI_PROJECT_READ_BUDGET_BYTES);
    expect(MULTI_PROJECT_READ_BUDGET_BYTES).toBe(1024 * 1024);
  });

  it('treats fractional or non-positive counts as one project', () => {
    expect(scaleMaxToolCalls(0)).toBe(AGENT_MAX_TOOL_CALLS);
    expect(scaleScanBudgetMs(-3)).toBe(AGENTIC_SCAN_BUDGET_MS);
    expect(scaleMaxToolCalls(1.9)).toBe(AGENT_MAX_TOOL_CALLS);
  });
});

describe('SURFACE_ROUTES_JSON_SCHEMA', () => {
  const properties = SURFACE_ROUTES_JSON_SCHEMA.properties as Record<
    string,
    Record<string, unknown>
  >;
  const routeItems = properties.routes.items as Record<string, unknown>;
  const routeProperties = routeItems.properties as Record<string, Record<string, unknown>>;

  it('is a deep copy — the shared ROUTES_JSON_SCHEMA is untouched', () => {
    expect(SURFACE_ROUTES_JSON_SCHEMA).not.toBe(ROUTES_JSON_SCHEMA);
    const sharedRouteProps = (
      (ROUTES_JSON_SCHEMA.properties as Record<string, Record<string, unknown>>).routes
        .items as Record<string, unknown>
    ).properties as Record<string, unknown>;
    expect(sharedRouteProps.surface).toBeUndefined();
    expect((ROUTES_JSON_SCHEMA.properties as Record<string, unknown>).surfaceNames).toBeUndefined();
  });

  it('adds an optional per-route surface and top-level surfaceNames', () => {
    expect(routeProperties.surface.type).toBe('string');
    expect(properties.surfaceNames.type).toBe('array');
    expect((routeItems.required as string[])).not.toContain('surface');
    expect(SURFACE_ROUTES_JSON_SCHEMA.required).toEqual(['routes']);
  });

  it('conforms to the strict structured-output dialect', () => {
    const violations: string[] = [];
    const walk = (node: unknown, at: string): void => {
      if (Array.isArray(node)) {
        node.forEach((item, i) => walk(item, `${at}[${i}]`));
        return;
      }
      if (node === null || typeof node !== 'object') {
        return;
      }
      const record = node as Record<string, unknown>;
      for (const key of ['minLength', 'maxLength', 'minimum', 'maximum']) {
        if (key in record) {
          violations.push(`${at} uses ${key}`);
        }
      }
      if (record.type === 'object') {
        if (record.additionalProperties !== false) {
          violations.push(`${at} object is missing additionalProperties: false`);
        }
      }
      if ('additionalProperties' in record && record.additionalProperties !== false) {
        violations.push(`${at} sets additionalProperties to something other than false`);
      }
      for (const [key, value] of Object.entries(record)) {
        walk(value, `${at}.${key}`);
      }
    };
    walk(SURFACE_ROUTES_JSON_SCHEMA, '$');
    expect(violations).toEqual([]);
  });
});

describe('tool definitions', () => {
  it('submit_routes uses the surface-extended schema', () => {
    expect(SUBMIT_ROUTES_TOOL.name).toBe('submit_routes');
    expect(SUBMIT_ROUTES_TOOL.inputSchema).toBe(SURFACE_ROUTES_JSON_SCHEMA);
    expect(SUBMIT_ROUTES_TOOL.description).toContain('surfaceNames');
  });

  it('report_progress takes a single required note string', () => {
    expect(REPORT_PROGRESS_TOOL.name).toBe('report_progress');
    const schema = REPORT_PROGRESS_TOOL.inputSchema as Record<string, unknown>;
    expect(schema.required).toEqual(['note']);
    expect(schema.additionalProperties).toBe(false);
  });
});

describe('progressNote', () => {
  it('flattens whitespace and trims', () => {
    expect(progressNote({ note: '  Reading\n UserController…  ' })).toBe('Reading UserController…');
  });

  it('caps long notes', () => {
    const note = progressNote({ note: 'x'.repeat(PROGRESS_NOTE_MAX_CHARS + 50) });
    expect(note).toBe(`${'x'.repeat(PROGRESS_NOTE_MAX_CHARS)}…`);
  });

  it('returns empty string for invalid input', () => {
    expect(progressNote(undefined)).toBe('');
    expect(progressNote(null)).toBe('');
    expect(progressNote({ note: 42 })).toBe('');
    expect(progressNote('just a string')).toBe('');
  });
});

describe('buildSurfaceSeeds', () => {
  it('falls back to one consumes surface named after the app when recon found nothing', () => {
    const seeds = buildSurfaceSeeds([], [directionalFile('src/api.ts', 40, 0)], 'ShopApp');
    expect(seeds).toHaveLength(1);
    expect(seeds[0].name).toBe('ShopApp');
    expect(seeds[0].direction).toBe('consumes');
    expect(seeds[0].matchedFileCount).toBe(1);
    expect(seeds[0].seedSection).toContain('src/api.ts');
  });

  it('flips the profile-less default surface to serves for a universal-only serves-shaped seed set', () => {
    const routeTable: DirectionalScoredFile = {
      path: 'src/routes.sin',
      score: 22,
      snippet: 'get "/users" do',
      clientScore: 0,
      serverScore: 0,
      universalScore: 22,
      universalDirection: 'serves',
    };
    expect(buildSurfaceSeeds([], [routeTable], 'App')[0].direction).toBe('serves');
    // Any real marker confidence keeps today's consumes default.
    expect(
      buildSurfaceSeeds([], [routeTable, directionalFile('src/api.ts', 40, 0)], 'App')[0].direction
    ).toBe('consumes');
  });

  it('assigns files to the deepest enclosing project root', () => {
    const profiles = [
      makeProfile({ rootPath: '', kind: 'web' }),
      makeProfile({ rootPath: 'server', kind: 'backend', direction: 'serves' }),
    ];
    const seeds = buildSurfaceSeeds(
      profiles,
      [
        directionalFile('src/api.ts', 40, 0),
        directionalFile('server/routes/users.ts', 0, 50),
      ],
      'App'
    );
    expect(seeds[0].seedSection).toContain('src/api.ts');
    expect(seeds[0].seedSection).not.toContain('server/routes/users.ts');
    expect(seeds[1].seedSection).toContain('server/routes/users.ts');
    expect(seeds[1].matchedFileCount).toBe(1);
  });

  it('routes orphan files to the first profile when no root encloses them', () => {
    const profiles = [
      makeProfile({ rootPath: 'app', kind: 'mobile-android' }),
      makeProfile({ rootPath: 'server', kind: 'backend', direction: 'serves' }),
    ];
    const seeds = buildSurfaceSeeds(profiles, [directionalFile('scripts/api.ts', 20, 0)], 'App');
    expect(seeds[0].seedSection).toContain('scripts/api.ts');
    expect(seeds[1].matchedFileCount).toBe(0);
    expect(seeds[1].seedSection).toBe('');
  });

  it('re-ranks seeds by the surface direction', () => {
    const profiles = [makeProfile({ rootPath: '', kind: 'backend', direction: 'serves' })];
    const seeds = buildSurfaceSeeds(
      profiles,
      [
        directionalFile('client.ts', 90, 10),
        directionalFile('controller.ts', 10, 60),
      ],
      'App'
    );
    const lines = seeds[0].seedSection.split('\n').filter((l) => l.startsWith('- '));
    expect(lines[0]).toContain('controller.ts');
    expect(lines[0]).toContain('score 60');
    expect(lines[1]).toContain('client.ts');
  });

  it('keeps files whose direction score is zero, using the overall score', () => {
    const profiles = [makeProfile({ rootPath: '', kind: 'backend', direction: 'serves' })];
    const seeds = buildSurfaceSeeds(profiles, [directionalFile('client-only.ts', 30, 0)], 'App');
    expect(seeds[0].seedSection).toContain('client-only.ts (score 30)');
  });

  it('names surfaces after their root path, using the app name at workspace root', () => {
    const profiles = [
      makeProfile({ rootPath: '', kind: 'web' }),
      makeProfile({ rootPath: 'android', kind: 'mobile-android' }),
    ];
    const seeds = buildSurfaceSeeds(profiles, [], 'ShopApp');
    expect(seeds.map((s) => s.name)).toEqual(['ShopApp', 'android']);
  });

  it('halves the per-surface seed cap for multi-project workspaces', () => {
    const files = Array.from({ length: SEED_MAX_FILES }, (_, i) =>
      directionalFile(`app/f${i}.ts`, 10 + i, 0)
    );
    const profiles = [
      makeProfile({ rootPath: 'app' }),
      makeProfile({ rootPath: 'server', direction: 'serves', kind: 'backend' }),
    ];
    const seeds = buildSurfaceSeeds(profiles, files, 'App');
    expect(seeds[0].seedFileCount).toBe(SEED_MAX_FILES_MULTI);
    expect(seeds[0].seedSection.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(
      SEED_MAX_FILES_MULTI
    );
    expect(seeds[0].matchedFileCount).toBe(SEED_MAX_FILES);
  });

  it('carries kind, frameworks, and spec files through', () => {
    const profiles = [
      makeProfile({
        rootPath: 'server',
        kind: 'backend',
        direction: 'serves',
        frameworks: ['Spring Boot'],
        specFiles: ['docs/openapi.yaml'],
      }),
    ];
    const seeds = buildSurfaceSeeds(profiles, [], 'App');
    expect(seeds[0].kind).toBe('backend');
    expect(seeds[0].frameworks).toEqual(['Spring Boot']);
    expect(seeds[0].specFiles).toEqual(['docs/openapi.yaml']);
  });
});

describe('buildMissionPrompt', () => {
  it('embeds the app name, recon inventory, seeds, and submission contract', () => {
    const prompt = buildMissionPrompt(
      'ShopApp',
      'Detected: Web app at workspace root [consumes]',
      [makeSeed({ name: 'ShopApp' })],
      false
    );
    expect(prompt).toContain('"ShopApp"');
    expect(prompt).toContain('Detected: Web app at workspace root [consumes]');
    expect(prompt).toContain('- src/api.ts (score 40)');
    expect(prompt).toContain('submit_routes EXACTLY ONCE');
    expect(prompt).toContain('report_progress');
    expect(prompt).not.toContain('## GraphQL');
    expect(prompt).not.toContain('## Multiple API surfaces');
  });

  it('uses the call-site strategy for consumes surfaces', () => {
    const prompt = buildMissionPrompt('App', 'inv', [makeSeed({ direction: 'consumes' })], false);
    expect(prompt).toContain('This project CALLS APIs');
    expect(prompt).toContain('Mock every endpoint it CALLS');
    expect(prompt).not.toContain('This project SERVES an API');
  });

  it('uses the read-the-handlers strategy for serves surfaces', () => {
    const prompt = buildMissionPrompt(
      'App',
      'inv',
      [makeSeed({ direction: 'serves', kind: 'backend', frameworks: ['Spring Boot'] })],
      false
    );
    expect(prompt).toContain('This project SERVES an API');
    expect(prompt).toContain('READ THE HANDLERS');
    expect(prompt).toContain('serializers, DTOs');
    expect(prompt).toContain('without running the backend');
    expect(prompt).toContain('backend service (Spring Boot)');
  });

  it('uses the fullstack strategy for both-direction surfaces', () => {
    const prompt = buildMissionPrompt('App', 'inv', [makeSeed({ direction: 'both' })], false);
    expect(prompt).toContain('both SERVES and CALLS');
  });

  it('tells the agent to prefer spec files and mention the direct-import alternative', () => {
    const prompt = buildMissionPrompt(
      'App',
      'inv',
      [makeSeed({ specFiles: ['docs/openapi.yaml'] })],
      false
    );
    expect(prompt).toContain('docs/openapi.yaml');
    expect(prompt).toContain('Read it FIRST');
    expect(prompt).toContain('import this spec file directly');
  });

  it('adds surface tagging rules only for multi-surface missions', () => {
    const surfaces = [
      makeSeed({ name: 'android', rootPath: 'android', kind: 'mobile-android' }),
      makeSeed({ name: 'server', rootPath: 'server', kind: 'backend', direction: 'serves' }),
    ];
    const prompt = buildMissionPrompt('App', 'inv', surfaces, false);
    expect(prompt).toContain('## Multiple API surfaces');
    expect(prompt).toContain('"android", "server"');
    expect(prompt).toContain('Set "surface" on EVERY submitted route');
    expect(prompt).toContain('"surfaceNames"');
    expect(prompt).toContain('### Surface "android"');
    expect(prompt).toContain('### Surface "server"');
    expect(prompt).toContain('across ALL surfaces');
  });

  it('points the agent at list_files/search_code when a surface has no seeds', () => {
    const prompt = buildMissionPrompt(
      'App',
      'inv',
      [makeSeed({ seedSection: '', seedFileCount: 0, matchedFileCount: 0 })],
      false
    );
    expect(prompt).toContain('No pre-scored seed files');
  });

  it('adds GraphQL guidance when flagged', () => {
    const prompt = buildMissionPrompt('App', 'inv', [makeSeed()], true);
    expect(prompt).toContain('## GraphQL');
    expect(prompt).toContain('POST /graphql');
  });
});

describe('routeSurfaceKey', () => {
  it('normalizes method case and sorts method arrays', () => {
    expect(routeSurfaceKey('get', '/api/Users')).toBe('GET|/api/users');
    expect(routeSurfaceKey(['POST', 'GET'], '/x')).toBe(routeSurfaceKey(['GET', 'POST'], '/x'));
  });

  it('tolerates missing method or path', () => {
    expect(routeSurfaceKey(undefined, undefined)).toBe('|');
  });

  it('appends a numeric status code and ignores a non-numeric one', () => {
    expect(routeSurfaceKey('GET', '/x', 404)).toBe('GET|/x|404');
    expect(routeSurfaceKey('GET', '/x', 404)).not.toBe(routeSurfaceKey('GET', '/x'));
    expect(routeSurfaceKey('GET', '/x', 'nope')).toBe(routeSurfaceKey('GET', '/x'));
  });
});

describe('recordSurfaceInfo', () => {
  it('captures top-level surfaceNames and per-route surface fields', () => {
    const state = createSubmitState();
    recordSurfaceInfo(state, {
      surfaceNames: ['android', 'server'],
      routes: [
        makeRoute({ surface: 'android' }),
        makeRoute({ surface: 'server', path: '/api/orders' }),
      ],
    });
    expect(state.surfaceNames).toEqual(['android', 'server']);
    expect(state.surfaceByKey.get(routeSurfaceKey('GET', '/api/users'))).toBe('android');
    expect(state.surfaceByKey.get(routeSurfaceKey('GET', '/api/orders'))).toBe('server');
  });

  it('ignores malformed declarations', () => {
    const state = createSubmitState();
    recordSurfaceInfo(state, {
      surfaceNames: [42, '', '  '],
      routes: [makeRoute({ surface: 7 }), null, 'nope'],
    });
    recordSurfaceInfo(state, null);
    recordSurfaceInfo(state, 'text');
    expect(state.surfaceNames).toEqual([]);
    expect(state.surfaceByKey.size).toBe(0);
  });

  it('lets a later submission overwrite a route surface', () => {
    const state = createSubmitState();
    recordSurfaceInfo(state, { routes: [makeRoute({ surface: 'a' })] });
    recordSurfaceInfo(state, { routes: [makeRoute({ surface: 'b' })] });
    expect(state.surfaceByKey.get(routeSurfaceKey('GET', '/api/users'))).toBe('b');
    expect(state.surfaceNames).toEqual(['a', 'b']);
  });

  it('keeps a status-aware mapping so a negative variant cannot steal the success surface', () => {
    const state = createSubmitState();
    const negative = makeRoute({
      surface: 'server',
      enabled: false,
      tags: ['negative', '404'],
      response: {
        type: 'static',
        statusCode: 404,
        body: { contentType: 'application/json', content: { error: 'not found' } },
      },
    });
    recordSurfaceInfo(state, { routes: [makeRoute({ surface: 'android' }), negative] });
    expect(state.surfaceByKey.get(routeSurfaceKey('GET', '/api/users', 200))).toBe('android');
    expect(state.surfaceByKey.get(routeSurfaceKey('GET', '/api/users', 404))).toBe('server');
  });

  it('sanitizes surface names to a single capped line and caps the name list', () => {
    expect(sanitizeSurfaceName('  spaced\nname  ')).toBe('spaced name');
    expect(sanitizeSurfaceName('x'.repeat(500))).toHaveLength(120);
    const state = createSubmitState();
    recordSurfaceInfo(state, {
      routes: [makeRoute({ surface: `evil\nmulti\nline ${'x'.repeat(500)}` })],
    });
    expect(state.surfaceNames[0]).not.toContain('\n');
    expect(state.surfaceNames[0].length).toBeLessThanOrEqual(120);
    recordSurfaceInfo(state, {
      surfaceNames: Array.from({ length: 100 }, (_, i) => `surface-${i}`),
    });
    expect(state.surfaceNames.length).toBeLessThanOrEqual(32);
  });
});

describe('handleSubmitRoutes', () => {
  it('accepts a clean submission and ends the loop', () => {
    const state = createSubmitState();
    const result = handleSubmitRoutes(state, { routes: [makeRoute()] });
    expect(result).toBe(SUBMIT_ROUTES_ACCEPTED_ACK);
    expect(state.done).toBe(true);
    expect(state.routes).toHaveLength(1);
    expect(state.droppedCount).toBe(0);
    expect(state.repairedCount).toBe(0);
  });

  it('accepts routes carrying surface fields and records the mapping', () => {
    const state = createSubmitState();
    const result = handleSubmitRoutes(state, {
      surfaceNames: ['android'],
      routes: [makeRoute({ surface: 'android' })],
    });
    expect(result).toBe(SUBMIT_ROUTES_ACCEPTED_ACK);
    expect(state.done).toBe(true);
    expect(state.routes).toHaveLength(1);
    // Zod strips the non-core surface field; the map preserves the intent.
    expect((state.routes[0] as Record<string, unknown>).surface).toBeUndefined();
    expect(state.surfaceByKey.get(routeSurfaceKey('GET', '/api/users'))).toBe('android');
    expect(state.surfaceNames).toEqual(['android']);
  });

  it('dedupes duplicate routes within a submission', () => {
    const state = createSubmitState();
    handleSubmitRoutes(state, { routes: [makeRoute(), makeRoute()] });
    expect(state.routes).toHaveLength(1);
  });

  it('keeps an endpoint declared for DIFFERENT surfaces on every one of them', () => {
    const state = createSubmitState();
    handleSubmitRoutes(state, {
      surfaceNames: ['android', 'server'],
      routes: [makeRoute({ surface: 'android' }), makeRoute({ surface: 'server' })],
    });
    expect(state.done).toBe(true);
    // The flat list stays deduped (one copy) …
    expect(state.routes).toHaveLength(1);
    // … but grouping attaches the shared endpoint to BOTH surfaces.
    const surfaces = groupRoutesBySurface(state.routes, surfaceLookup(state), [
      { name: 'android', direction: 'consumes' },
      { name: 'server', direction: 'serves' },
    ]);
    expect(surfaces.map((s) => s.name).sort()).toEqual(['android', 'server']);
    expect(surfaces.every((s) => s.routes.length === 1)).toBe(true);
  });

  it('does not double-attach duplicates declared for the SAME surface', () => {
    const state = createSubmitState();
    handleSubmitRoutes(state, {
      routes: [makeRoute({ surface: 'android' }), makeRoute({ surface: 'android' })],
    });
    expect(state.routes).toHaveLength(1);
    const surfaces = groupRoutesBySurface(state.routes, surfaceLookup(state), [
      { name: 'android', direction: 'consumes' },
      { name: 'server', direction: 'serves' },
    ]);
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0].routes).toHaveLength(1);
  });

  it('rejects schema-invalid submissions with a corrective message', () => {
    const state = createSubmitState();
    const result = handleSubmitRoutes(state, { routes: [{ nonsense: true }] });
    expect(result).toContain('Submission rejected');
    expect(result).toContain('submit_routes');
    expect(state.done).toBe(false);
    expect(state.rejections).toBe(1);
  });

  it('quotes verification failures back and salvages the valid subset', () => {
    const state = createSubmitState();
    const result = handleSubmitRoutes(state, {
      routes: [makeRoute(), makeRoute({ name: 'Other', path: '/api/orders' }), badNegativeRoute()],
    });
    expect(state.done).toBe(false);
    expect(state.rejections).toBe(1);
    expect(state.salvage).toHaveLength(2);
    expect(state.prevRejectedCount).toBe(1);
    expect(result).toContain('1 route(s) failed verification (2 passed)');
    expect(result).toContain('negative-flow routes must have "enabled": false');
    expect(result).toContain('COMPLETE set of routes');
  });

  it('keeps surface mappings from rejected rounds for later salvage', () => {
    const state = createSubmitState();
    handleSubmitRoutes(state, {
      routes: [makeRoute({ surface: 'server' }), badNegativeRoute()],
    });
    expect(state.done).toBe(false);
    expect(state.surfaceByKey.get(routeSurfaceKey('GET', '/api/users'))).toBe('server');
  });

  it('counts repaired routes when a rejected round is later fixed', () => {
    const state = createSubmitState();
    handleSubmitRoutes(state, { routes: [makeRoute(), badNegativeRoute()] });
    const fixed = badNegativeRoute();
    fixed.enabled = false;
    const result = handleSubmitRoutes(state, { routes: [makeRoute(), fixed] });
    expect(result).toBe(SUBMIT_ROUTES_ACCEPTED_ACK);
    expect(state.done).toBe(true);
    expect(state.routes).toHaveLength(2);
    expect(state.repairedCount).toBe(1);
    expect(state.droppedCount).toBe(0);
  });

  it('accepts the valid subset after the rejection budget is spent', () => {
    const state = createSubmitState();
    const failing = { routes: [makeRoute(), badNegativeRoute()] };
    for (let i = 0; i < MAX_SUBMIT_REJECTIONS; i++) {
      expect(handleSubmitRoutes(state, failing)).toContain('failed verification');
    }
    expect(state.done).toBe(false);
    const result = handleSubmitRoutes(state, failing);
    expect(result).toBe(SUBMIT_ROUTES_ACCEPTED_ACK);
    expect(state.done).toBe(true);
    expect(state.routes).toHaveLength(1);
    expect(state.droppedCount).toBe(1);
  });

  it('falls back to salvage when the final round has no valid routes', () => {
    const state = createSubmitState();
    handleSubmitRoutes(state, { routes: [makeRoute(), badNegativeRoute()] });
    handleSubmitRoutes(state, { routes: [makeRoute(), badNegativeRoute()] });
    const result = handleSubmitRoutes(state, { routes: [{ nonsense: true }] });
    expect(result).toBe(SUBMIT_ROUTES_ACCEPTED_ACK);
    expect(state.done).toBe(true);
    expect(state.routes).toHaveLength(1); // the salvaged valid route
  });

  it('acknowledges idempotently once accepted', () => {
    const state = createSubmitState();
    handleSubmitRoutes(state, { routes: [makeRoute()] });
    const routes = state.routes;
    expect(handleSubmitRoutes(state, { routes: [makeRoute({ path: '/api/other' })] })).toBe(
      ROUTES_ALREADY_ACCEPTED
    );
    expect(state.routes).toBe(routes);
  });
});

describe('formatRejectionResult', () => {
  it('lists each rejected route with method, path, and reasons', () => {
    const result = formatRejectionResult(
      [
        {
          route: makeRoute({ method: ['GET', 'POST'] }) as never,
          reasons: ['first reason', 'second reason'],
        },
      ],
      3
    );
    expect(result).toContain('1 route(s) failed verification (3 passed)');
    expect(result).toContain('"GET /api/users" (GET|POST /api/users): first reason; second reason');
  });

  it('bounds the listing length', () => {
    const rejected = Array.from({ length: 200 }, (_, i) => ({
      route: makeRoute({ name: `Route ${i}`, path: `/api/${'x'.repeat(80)}/${i}` }) as never,
      reasons: ['some long reason '.repeat(10)],
    }));
    expect(formatRejectionResult(rejected, 0).length).toBeLessThan(4300);
  });
});

describe('groupRoutesBySurface', () => {
  type Route = Omit<RouteConfig, 'id'>;
  const route = (path: string, method = 'GET'): Route =>
    ({
      name: `${method} ${path}`,
      enabled: true,
      method,
      path,
      response: {
        type: 'static',
        statusCode: 200,
        body: { contentType: 'application/json', content: {} },
      },
    }) as Route;

  it('groups routes by their declared surface, preserving recon order', () => {
    const surfaceByKey = new Map([
      [routeSurfaceKey('GET', '/api/users'), 'server'],
      [routeSurfaceKey('GET', '/api/mobile'), 'android'],
    ]);
    const recon = [
      { name: 'android', direction: 'consumes' as const },
      { name: 'server', direction: 'serves' as const },
    ];
    const surfaces = groupRoutesBySurface(
      [route('/api/users'), route('/api/mobile')],
      surfaceByKey,
      recon
    );
    expect(surfaces.map((s) => s.name)).toEqual(['android', 'server']);
    expect(surfaces[0].direction).toBe('consumes');
    expect(surfaces[0].routes[0].path).toBe('/api/mobile');
    expect(surfaces[1].direction).toBe('serves');
    expect(surfaces[1].routes[0].path).toBe('/api/users');
  });

  it('puts undeclared routes on the first recon surface (back-compat flattening)', () => {
    const routes = [route('/api/a'), route('/api/b')];
    const surfaces = groupRoutesBySurface(routes, new Map(), [
      { name: 'ShopApp', direction: 'consumes' },
    ]);
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0].name).toBe('ShopApp');
    expect(surfaces[0].routes).toEqual(routes);
    // Same objects — mutations (priority stamping) stay visible in both views.
    expect(surfaces[0].routes[0]).toBe(routes[0]);
  });

  it('clamps model-invented surface names to the first recon surface', () => {
    const surfaceByKey = new Map([[routeSurfaceKey('GET', '/api/a'), 'payments']]);
    const surfaces = groupRoutesBySurface([route('/api/a')], surfaceByKey, [
      { name: 'app', direction: 'consumes' },
      { name: 'server', direction: 'serves' },
    ]);
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0].name).toBe('app');
    expect(surfaces[0].direction).toBe('consumes');
  });

  it('never mints more surfaces than recon detected, whatever the model declares', () => {
    const routes = Array.from({ length: 10 }, (_, i) => route(`/api/r${i}`));
    const surfaceByKey = new Map(
      routes.map((r, i) => [routeSurfaceKey('GET', r.path), `injected-surface-${i}`])
    );
    const surfaces = groupRoutesBySurface(routes, surfaceByKey, [
      { name: 'app', direction: 'consumes' },
    ]);
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0].name).toBe('app');
    expect(surfaces[0].routes).toHaveLength(10);
  });

  it('routes status variants of one endpoint to their own declared surfaces', () => {
    const success = route('/api/users');
    const negative = route('/api/users');
    (negative.response as { statusCode: number }).statusCode = 404;
    const byKey = new Map([
      [routeSurfaceKey('GET', '/api/users', 200), 'android'],
      [routeSurfaceKey('GET', '/api/users', 404), 'server'],
    ]);
    const surfaces = groupRoutesBySurface([success, negative], byKey, [
      { name: 'android', direction: 'consumes' },
      { name: 'server', direction: 'serves' },
    ]);
    expect(surfaces.map((s) => s.name)).toEqual(['android', 'server']);
    expect(surfaces[0].routes[0].response.statusCode).toBe(200);
    expect(surfaces[1].routes[0].response.statusCode).toBe(404);
  });

  it('matches surface directions case-insensitively and inherits a sole recon direction', () => {
    const surfaceByKey = new Map([[routeSurfaceKey('GET', '/api/a'), 'Server']]);
    const exact = groupRoutesBySurface([route('/api/a')], surfaceByKey, [
      { name: 'app', direction: 'consumes' },
      { name: 'server', direction: 'serves' },
    ]);
    expect(exact[0].direction).toBe('serves');

    const sole = groupRoutesBySurface([route('/api/a')], new Map([[routeSurfaceKey('GET', '/api/a'), 'made-up']]), [
      { name: 'backend', direction: 'serves' },
    ]);
    expect(sole[0].direction).toBe('serves');
  });

  it('drops recon surfaces that received no routes', () => {
    const surfaceByKey = new Map([[routeSurfaceKey('GET', '/api/a'), 'server']]);
    const surfaces = groupRoutesBySurface([route('/api/a')], surfaceByKey, [
      { name: 'app', direction: 'consumes' },
      { name: 'server', direction: 'serves' },
    ]);
    expect(surfaces.map((s) => s.name)).toEqual(['server']);
  });

  it('handles an empty recon list with a default surface name', () => {
    const surfaces = groupRoutesBySurface([route('/api/a')], new Map(), []);
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0].name).toBe('API');
    expect(surfaces[0].direction).toBe('consumes');
  });
});

describe('selectMissionVariant', () => {
  it('picks recon-first for an empty seed set', () => {
    expect(selectMissionVariant([])).toBe('recon-first');
  });

  it('picks recon-first when every seed is below the confidence bar', () => {
    const weak = [{ score: 10 }, { score: LOW_CONFIDENCE_SEED_SCORE - 1 }];
    expect(selectMissionVariant(weak)).toBe('recon-first');
  });

  it('picks the seeded mission once one seed reaches the confidence bar', () => {
    expect(selectMissionVariant([{ score: LOW_CONFIDENCE_SEED_SCORE }])).toBe('seeded');
    expect(selectMissionVariant([{ score: 10 }, { score: 40 }])).toBe('seeded');
  });
});

describe('languageUnknownNote', () => {
  it('returns nothing for an empty seed set (census path, not language note)', () => {
    expect(languageUnknownNote([])).toBeUndefined();
  });

  it('returns the note when every seed owes its place to universal signals', () => {
    const seeds = [
      { clientScore: 0, serverScore: 0 },
      { clientScore: 4, serverScore: 2 }, // weak markers only — below MIN_SCORE
    ];
    expect(languageUnknownNote(seeds)).toBe(LANGUAGE_UNKNOWN_NOTE);
    expect(LANGUAGE_UNKNOWN_NOTE).toContain('language-agnostic');
  });

  it('returns nothing when any seed was found by the marker heuristics', () => {
    const seeds = [
      { clientScore: 0, serverScore: 0 },
      { clientScore: 20, serverScore: 0 },
    ];
    expect(languageUnknownNote(seeds)).toBeUndefined();
  });
});

describe('universalSeedSnippet', () => {
  const signals = (over: Partial<UniversalSignals> = {}): UniversalSignals => ({
    urlPaths: [],
    absoluteUrls: [],
    methodHints: 0,
    jsonShapes: 0,
    authHints: 0,
    score: 0,
    ...over,
  });

  it('lists detected paths and urls', () => {
    const snippet = universalSeedSnippet(
      signals({ urlPaths: ['/api/users', '/api/orders'], absoluteUrls: ['https://api.x.dev/v1'] })
    );
    expect(snippet).toBe('paths: /api/users /api/orders\nurls: https://api.x.dev/v1');
  });

  it('caps the listing and returns empty for empty signals', () => {
    const paths = Array.from({ length: 10 }, (_, i) => `/api/p${i}`);
    const snippet = universalSeedSnippet(signals({ urlPaths: paths }));
    expect(snippet).toContain('/api/p5');
    expect(snippet).not.toContain('/api/p6');
    expect(universalSeedSnippet(signals())).toBe('');
  });
});

describe('noApiSurfaceReason', () => {
  it('falls back when the agent gave no reason', () => {
    expect(noApiSurfaceReason('')).toBe(NO_API_SURFACE_FALLBACK_REASON);
    expect(noApiSurfaceReason('  \n ')).toBe(NO_API_SURFACE_FALLBACK_REASON);
  });

  it('flattens whitespace into one paragraph', () => {
    expect(noApiSurfaceReason(' This repo\nis a CSS\ttheme. ')).toBe('This repo is a CSS theme.');
  });

  it('caps very long reasons with an ellipsis', () => {
    const reason = noApiSurfaceReason('y'.repeat(NO_API_SURFACE_REASON_MAX_CHARS + 100));
    expect(reason).toBe(`${'y'.repeat(NO_API_SURFACE_REASON_MAX_CHARS)}…`);
  });
});

describe('buildReconFirstPrompt', () => {
  const census = '## Workspace census (42 files)\n### Directory tree (top 3 levels)\n. (42 files)';

  it('embeds the census and the recon-first exploration instructions', () => {
    const prompt = buildReconFirstPrompt('MysteryApp', 'Detected: no recognizable projects.', census, '', false);
    expect(prompt).toContain('"MysteryApp"');
    expect(prompt).toContain('No known API patterns were detected');
    expect(prompt).toContain('Detected: no recognizable projects.');
    expect(prompt).toContain('## Workspace census (42 files)');
    expect(prompt).toContain('what kind of project this is');
    expect(prompt).toContain('ANY language');
    expect(prompt).toContain('report_progress');
    expect(prompt).toContain('submit_routes EXACTLY ONCE');
    expect(prompt).toContain('## Route JSON shape');
  });

  it('allows a justified zero-route submission', () => {
    const prompt = buildReconFirstPrompt('App', 'inv', census, '', false);
    expect(prompt).toContain('genuinely no HTTP API surface');
    expect(prompt).toContain('{"routes": []}');
    expect(prompt).toContain('explaining why');
  });

  it('includes weak seed candidates only when present', () => {
    const without = buildReconFirstPrompt('App', 'inv', census, '', false);
    expect(without).not.toContain('## Weak candidate files');
    const withSeeds = buildReconFirstPrompt('App', 'inv', census, '- maybe/api.xyz (score 10)', false);
    expect(withSeeds).toContain('## Weak candidate files');
    expect(withSeeds).toContain('- maybe/api.xyz (score 10)');
  });

  it('adds surface tagging rules only for multi-project recon', () => {
    const single = buildReconFirstPrompt('App', 'inv', census, '', false, ['App']);
    expect(single).not.toContain('## Multiple API surfaces');
    const multi = buildReconFirstPrompt('App', 'inv', census, '', false, ['app', 'server']);
    expect(multi).toContain('## Multiple API surfaces');
    expect(multi).toContain('"app", "server"');
    expect(multi).toContain('"surfaceNames"');
  });

  it('adds GraphQL guidance when flagged', () => {
    expect(buildReconFirstPrompt('App', 'inv', census, '', true)).toContain('## GraphQL');
    expect(buildReconFirstPrompt('App', 'inv', census, '', false)).not.toContain('## GraphQL');
  });
});

describe('buildMissionPrompt extraNote', () => {
  it('places the note under the recon inventory', () => {
    const prompt = buildMissionPrompt('App', 'Detected: things.', [makeSeed()], false, LANGUAGE_UNKNOWN_NOTE);
    expect(prompt).toContain(`Detected: things.\n\n${LANGUAGE_UNKNOWN_NOTE}`);
  });

  it('changes nothing when absent', () => {
    const base = buildMissionPrompt('App', 'inv', [makeSeed()], false);
    expect(base).toBe(buildMissionPrompt('App', 'inv', [makeSeed()], false, undefined));
    expect(base).toBe(buildMissionPrompt('App', 'inv', [makeSeed()], false, ''));
    expect(base).not.toContain('language-agnostic');
  });
});

describe('handleSubmitRoutes with allowEmpty (recon-first missions)', () => {
  it('accepts an explicit zero-route submission as a no-API-surface answer', () => {
    const state = createSubmitState();
    const result = handleSubmitRoutes(state, { routes: [] }, { allowEmpty: true });
    expect(result).toBe(NO_API_SURFACE_ACK);
    expect(state.done).toBe(true);
    expect(state.noApiSurface).toBe(true);
    expect(state.routes).toEqual([]);
    expect(state.rejections).toBe(0);
  });

  it('rejects an empty submission when allowEmpty is off (seeded missions)', () => {
    const state = createSubmitState();
    const result = handleSubmitRoutes(state, { routes: [] });
    expect(result).toContain('Submission rejected');
    expect(state.done).toBe(false);
    expect(state.noApiSurface).toBe(false);
    expect(state.rejections).toBe(1);
  });

  it('prefers salvaged routes over a contradictory later empty claim', () => {
    const state = createSubmitState();
    handleSubmitRoutes(state, { routes: [makeRoute(), badNegativeRoute()] }, { allowEmpty: true });
    expect(state.salvage).toHaveLength(1);
    const result = handleSubmitRoutes(state, { routes: [] }, { allowEmpty: true });
    expect(result).toBe(SUBMIT_ROUTES_ACCEPTED_ACK);
    expect(state.done).toBe(true);
    expect(state.noApiSurface).toBe(false);
    expect(state.routes).toHaveLength(1);
  });

  it('handles non-empty submissions exactly as before', () => {
    const state = createSubmitState();
    const result = handleSubmitRoutes(state, { routes: [makeRoute()] }, { allowEmpty: true });
    expect(result).toBe(SUBMIT_ROUTES_ACCEPTED_ACK);
    expect(state.noApiSurface).toBe(false);
    expect(state.routes).toHaveLength(1);
  });

  it('acknowledges idempotently after a zero-route acceptance', () => {
    const state = createSubmitState();
    handleSubmitRoutes(state, { routes: [] }, { allowEmpty: true });
    expect(handleSubmitRoutes(state, { routes: [makeRoute()] }, { allowEmpty: true })).toBe(
      ROUTES_ALREADY_ACCEPTED
    );
    expect(state.routes).toEqual([]);
  });
});
