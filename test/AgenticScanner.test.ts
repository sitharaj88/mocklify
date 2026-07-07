import { describe, it, expect } from 'vitest';
import {
  AGENT_MAX_TOOL_CALLS,
  MAX_SUBMIT_REJECTIONS,
  ROUTES_ALREADY_ACCEPTED,
  SEED_MAX_FILES,
  SEED_TEASER_LINE_CHARS,
  SUBMIT_ROUTES_ACCEPTED_ACK,
  SUBMIT_ROUTES_TOOL,
  buildAgentPrompt,
  createSubmitState,
  describeToolCall,
  formatRejectionResult,
  formatSeedSection,
  formatSeedTeaser,
  formatToolCallProgress,
  handleSubmitRoutes,
  toolCallFraction,
} from '../src/ai/AgenticScanner';
import { ROUTES_JSON_SCHEMA } from '../src/ai/MockGenerator';
import type { ScoredFile } from '../src/ai/scan/heuristics';

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

describe('submit_routes tool definition', () => {
  it('uses the strict routes JSON schema as its input schema', () => {
    expect(SUBMIT_ROUTES_TOOL.name).toBe('submit_routes');
    expect(SUBMIT_ROUTES_TOOL.inputSchema).toBe(ROUTES_JSON_SCHEMA);
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

  it('dedupes duplicate routes within a submission', () => {
    const state = createSubmitState();
    handleSubmitRoutes(state, { routes: [makeRoute(), makeRoute()] });
    expect(state.routes).toHaveLength(1);
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

describe('buildAgentPrompt', () => {
  it('embeds the app name, seed section, and exploration instructions', () => {
    const prompt = buildAgentPrompt('ShopApp', '- src/api.ts (score 40)', 12, false);
    expect(prompt).toContain('"ShopApp"');
    expect(prompt).toContain('- src/api.ts (score 40)');
    expect(prompt).toContain(`top 12 of 12`);
    expect(prompt).toContain('submit_routes EXACTLY ONCE');
    expect(prompt).toContain('Follow imports to the data-model types');
    expect(prompt).not.toContain('## GraphQL');
  });

  it('caps the advertised seed count and adds GraphQL guidance when flagged', () => {
    const prompt = buildAgentPrompt('App', 'seed', 200, true);
    expect(prompt).toContain(`top ${SEED_MAX_FILES} of 200`);
    expect(prompt).toContain('## GraphQL');
    expect(prompt).toContain('POST /graphql');
  });

  it('references the shared tool budget in progress math', () => {
    expect(AGENT_MAX_TOOL_CALLS).toBe(30);
  });
});
