import { describe, it, expect } from 'vitest';
import {
  CRITIC_LISTING_MAX_CHARS,
  GraphUnavailableError,
  MIN_SURFACE_BUDGET_MS,
  MIN_SURFACE_TOOL_CALLS,
  SURFACE_CONCURRENCY,
  applyVerdicts,
  attributeRepairedRoute,
  buildCriticPrompt,
  buildRepairPrompt,
  buildSurfaceMissions,
  collectSurfaceResults,
  deriveScanThreadId,
  divideBudgetMs,
  divideToolCalls,
  hasResumableScan,
  parseVerdicts,
  pendingMissions,
  rebuildSurfaces,
  resumeScanGraph,
  runScanGraph,
  scanThreadIdPrefix,
  verificationRouteKey,
  type LoopCancellation,
  type RepairCandidate,
  type RouteVerdict,
  type ScanGraphAi,
  type ScanGraphDeps,
  type SurfaceMission,
  type SurfaceScanResult,
  type WrongRoute,
} from '../src/ai/agent/scanGraph';
import { createInMemoryCheckpointStorage, type HumanQuestion } from '../src/ai/agent/graphRuntime';
import {
  ASK_USER_BUDGET_MESSAGE,
  MAX_QUESTIONS_PER_SURFACE,
  NO_ANSWER_FALLBACK,
} from '../src/ai/agent/askUser';
import { scaleMaxToolCalls, scaleScanBudgetMs } from '../src/ai/AgenticScanner';
import type { ReconFile, ScanSurface, WorkspaceRecon } from '../src/ai/CodebaseMockGenerator';
import type { ProjectProfile } from '../src/ai/scan/projectProfile';
import type { ScanMemory } from '../src/ai/scan/scanMemory';
import type { WorkspaceTools } from '../src/ai/agent/workspaceTools';
import type {
  AiRequestOptions,
  AiToolDefinition,
  AiToolExecutor,
  AiToolLoopOptions,
} from '../src/ai/providers/types';
import type { RouteConfig } from '../src/types/core';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function profile(rootPath: string, over?: Partial<ProjectProfile>): ProjectProfile {
  return {
    rootPath,
    kind: 'web',
    frameworks: ['react'],
    direction: 'consumes',
    confidence: 'high',
    specFiles: [],
    evidence: [],
    ...over,
  };
}

function reconFile(path: string, score = 40): ReconFile {
  return {
    path,
    score,
    snippet: `fetch('/api/things')`,
    clientScore: score,
    serverScore: 0,
    importPaths: [],
    typeNames: [],
  };
}

/** A workspace with one detected project (and one seed file) per root. */
function reconOf(roots: string[]): WorkspaceRecon {
  return {
    appName: 'Shop',
    profiles: roots.map((root) => profile(root)),
    files: roots.map((root) => reconFile(root === '' ? 'src/api.ts' : `${root}/src/api.ts`)),
    scannedFileCount: 42,
  };
}

type RawRoute = Record<string, unknown>;

function rawRoute(name: string, path: string, over: RawRoute = {}): RawRoute {
  return {
    name,
    enabled: true,
    method: 'GET',
    path,
    response: {
      type: 'static',
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { contentType: 'application/json', content: { ok: name } },
    },
    tags: ['things'],
    ...over,
  };
}

function routeOf(name: string, path: string, over: RawRoute = {}): Omit<RouteConfig, 'id'> {
  return rawRoute(name, path, over) as unknown as Omit<RouteConfig, 'id'>;
}

function fakeTools(): WorkspaceTools {
  return {
    definitions: [
      {
        name: 'read_file',
        description: 'read a file',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
          additionalProperties: false,
        },
      },
    ],
    execute: async (call) =>
      `contents of ${String((call.input as Record<string, unknown>).path ?? '')}`,
    stats: () => ({ toolCalls: 0, bytesRead: 0, filesRead: 0 }),
  };
}

function fakeLoopCancellation(): LoopCancellation {
  let cancelled = false;
  const listeners: Array<(e: unknown) => unknown> = [];
  const token = {
    get isCancellationRequested() {
      return cancelled;
    },
    onCancellationRequested(listener: (e: unknown) => unknown) {
      listeners.push(listener);
      return { dispose: () => undefined };
    },
  };
  return {
    token: token as never,
    cancel: () => {
      if (!cancelled) {
        cancelled = true;
        for (const listener of listeners) {
          listener(undefined);
        }
      }
    },
    dispose: () => undefined,
  };
}

interface MemoryStore {
  saved: ScanMemory[];
  load(): Promise<ScanMemory | null>;
  save(mem: ScanMemory): Promise<void>;
}

function memoryStore(initial: ScanMemory | null = null): MemoryStore {
  const saved: ScanMemory[] = [];
  return {
    saved,
    load: async () => initial,
    save: async (mem) => {
      saved.push(mem);
    },
  };
}

// ---------------------------------------------------------------------------
// The scripted fake AI (no LangChain, no network)
// ---------------------------------------------------------------------------

type ExploreHandler = (
  surface: string,
  execute: AiToolExecutor,
  prompt: string
) => Promise<string>;
type CriticHandler = (
  keys: string[],
  prompt: string,
  criticCall: number
) => RouteVerdict[] | undefined;

function surfaceFromPrompt(prompt: string): string {
  return /### Surface "([^"]+)"/.exec(prompt)?.[1] ?? '';
}

class FakeAi implements ScanGraphAi {
  explorePrompts: string[] = [];
  exploreOptionsBySurface = new Map<string, AiToolLoopOptions | undefined>();
  exploreToolsBySurface = new Map<string, string[]>();
  exploreCounts = new Map<string, number>();
  criticPrompts: string[] = [];
  repairPrompts: string[] = [];
  active = 0;
  maxActive = 0;

  onExplore: ExploreHandler = async (surface, execute) => {
    await execute({ name: 'read_file', input: { path: `${surface}/src/api.ts` } });
    await execute({
      name: 'submit_routes',
      input: { routes: [rawRoute(`route of ${surface}`, `/api/${surface.replace(/\W+/g, '-')}`)] },
    });
    return 'done';
  };

  /** Default critic confirms every listed routeKey. */
  onCritic: CriticHandler = (keys) =>
    keys.map((routeKey) => ({ routeKey, verdict: 'confirmed' as const }));

  onRepair: (prompt: string) => unknown = () => {
    throw new Error('unexpected repair call');
  };

  async runToolLoop(
    prompt: string,
    tools: AiToolDefinition[],
    execute: AiToolExecutor,
    options?: AiToolLoopOptions
  ): Promise<string> {
    if (tools.some((tool) => tool.name === 'submit_verdicts')) {
      this.criticPrompts.push(prompt);
      const keys = [...prompt.matchAll(/routeKey "([^"]+)"/g)].map((match) => match[1]);
      const verdicts = this.onCritic(keys, prompt, this.criticPrompts.length);
      if (verdicts !== undefined) {
        await execute({ name: 'submit_verdicts', input: { verdicts } });
      }
      return 'done';
    }
    const surface = surfaceFromPrompt(prompt) || 'census';
    this.explorePrompts.push(prompt);
    this.exploreOptionsBySurface.set(surface, options);
    this.exploreToolsBySurface.set(surface, tools.map((tool) => tool.name));
    this.exploreCounts.set(surface, (this.exploreCounts.get(surface) ?? 0) + 1);
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      await sleep(5);
      return await this.onExplore(surface, execute, prompt);
    } finally {
      this.active--;
    }
  }

  async sendJsonRequest<T = unknown>(
    prompt: string,
    _options?: AiRequestOptions,
    _schema?: Record<string, unknown>
  ): Promise<T> {
    this.repairPrompts.push(prompt);
    return this.onRepair(prompt) as T;
  }
}

function makeDeps(
  ai: FakeAi,
  recon: WorkspaceRecon,
  over: Partial<ScanGraphDeps> = {}
): ScanGraphDeps & { memory: MemoryStore } {
  return {
    ai,
    recon: async () => recon,
    census: async () => '## Workspace census (3 files)\nCENSUS-BLOCK',
    createTools: () => fakeTools(),
    memory: memoryStore(),
    createLoopCancellation: fakeLoopCancellation,
    storage: createInMemoryCheckpointStorage(),
    ...over,
  } as ScanGraphDeps & { memory: MemoryStore };
}

// ---------------------------------------------------------------------------
// Budget division math
// ---------------------------------------------------------------------------

describe('budget division', () => {
  it('gives a single surface the whole single-project budget', () => {
    expect(divideToolCalls(1, 1)).toBe(scaleMaxToolCalls(1));
    expect(divideBudgetMs(1, 1)).toBe(scaleScanBudgetMs(1));
  });

  it('divides the scaled tool-call budget across missions', () => {
    // scaleMaxToolCalls(2) = 45 → ceil(45/2) = 23
    expect(divideToolCalls(2, 2)).toBe(23);
    // scaleMaxToolCalls(4) caps at 60 → 60/4 = 15
    expect(divideToolCalls(4, 4)).toBe(15);
  });

  it('floors tool calls at MIN_SURFACE_TOOL_CALLS', () => {
    // 30 / 4 = 8 would starve a surface
    expect(divideToolCalls(1, 4)).toBe(MIN_SURFACE_TOOL_CALLS);
  });

  it('divides wall clock across WAVES, not surfaces (concurrency-aware)', () => {
    // 2 surfaces share one wave → each gets the whole 12-minute budget.
    expect(divideBudgetMs(2, 2)).toBe(scaleScanBudgetMs(2));
    // 4 surfaces = 2 waves of the capped 16-minute budget → 8 minutes each.
    expect(divideBudgetMs(4, 4)).toBe(scaleScanBudgetMs(4) / 2);
  });

  it('floors wall clock at MIN_SURFACE_BUDGET_MS', () => {
    // 1 project, 7 missions → 3 waves of 8 minutes = 160s < 3-minute floor
    expect(divideBudgetMs(1, 7)).toBe(Math.max(MIN_SURFACE_BUDGET_MS, Math.floor(scaleScanBudgetMs(1) / 3)));
    expect(divideBudgetMs(1, 9)).toBe(MIN_SURFACE_BUDGET_MS);
  });
});

// ---------------------------------------------------------------------------
// Mission planning
// ---------------------------------------------------------------------------

describe('buildSurfaceMissions', () => {
  it('plans one seeded mission per surface with divided budgets and the memory block', () => {
    const plan = buildSurfaceMissions(reconOf(['apps/a', 'apps/b']), '', 'Previous scans learned:\n- "apps/a" (consumes)');
    expect(plan.missions).toHaveLength(2);
    expect(plan.missions.map((m) => m.name)).toEqual(['apps/a', 'apps/b']);
    for (const mission of plan.missions) {
      expect(mission.reconFirst).toBe(false);
      expect(mission.maxToolCalls).toBe(divideToolCalls(2, 2));
      expect(mission.budgetMs).toBe(divideBudgetMs(2, 2));
      expect(mission.prompt).toContain('Previous scans learned:');
      expect(mission.prompt).toContain(`### Surface "${mission.name}"`);
      expect(mission.groupSurfaces).toEqual([
        { name: mission.name, direction: 'consumes', rootPath: mission.name },
      ]);
    }
    // Each mission sees ONLY its own surface section.
    expect(plan.missions[0].prompt).not.toContain('### Surface "apps/b"');
    expect(plan.meta).toEqual({
      appName: 'Shop',
      scannedFileCount: 42,
      matchedFileCount: 2,
      specFiles: [],
    });
  });

  it('plans a single recon-first census mission when there are no seeds', () => {
    const recon: WorkspaceRecon = { appName: 'Shop', profiles: [], files: [], scannedFileCount: 7 };
    const plan = buildSurfaceMissions(recon, 'CENSUS-BLOCK', '');
    expect(plan.missions).toHaveLength(1);
    const mission = plan.missions[0];
    expect(mission.reconFirst).toBe(true);
    expect(mission.name).toBe('Shop');
    expect(mission.prompt).toContain('CENSUS-BLOCK');
    expect(mission.prompt).toContain('{"routes": []}');
    expect(mission.maxToolCalls).toBe(scaleMaxToolCalls(1));
    expect(mission.groupSurfaces).toEqual([{ name: 'Shop', direction: 'consumes', rootPath: '' }]);
  });
});

describe('pendingMissions', () => {
  it('filters out missions that already have a result', () => {
    const missions = [{ name: 'a' }, { name: 'b' }, { name: 'c' }] as SurfaceMission[];
    const results = [{ missionName: 'b' }] as SurfaceScanResult[];
    expect(pendingMissions(missions, results).map((m) => m.name)).toEqual(['a', 'c']);
    expect(pendingMissions(missions, [])).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

function surfaceResult(over: Partial<SurfaceScanResult>): SurfaceScanResult {
  return {
    missionName: 'm',
    surfaces: [],
    routes: [],
    repairedCount: 0,
    droppedCount: 0,
    exploredPaths: [],
    ...over,
  };
}

describe('collectSurfaceResults', () => {
  it('dedupes routes across branches and sums counts', () => {
    const shared = routeOf('shared', '/api/shared');
    const a = surfaceResult({
      missionName: 'a',
      routes: [routeOf('a', '/api/a'), shared],
      surfaces: [{ name: 'a', direction: 'consumes', routes: [routeOf('a', '/api/a'), shared] }],
      droppedCount: 1,
    });
    const b = surfaceResult({
      missionName: 'b',
      routes: [routeOf('b', '/api/b'), routeOf('shared twin', '/api/shared')],
      surfaces: [{ name: 'b', direction: 'serves', routes: [routeOf('b', '/api/b')] }],
      repairedCount: 2,
    });
    const collected = collectSurfaceResults([a, b]);
    expect(collected.routes.map((r) => r.path).sort()).toEqual(['/api/a', '/api/b', '/api/shared']);
    expect(collected.surfaces.map((s) => s.name)).toEqual(['a', 'b']);
    expect(collected.droppedCount).toBe(1);
    expect(collected.repairedCount).toBe(2);
    expect(collected.noApiSurfaceReason).toBeUndefined();
  });

  it('concludes no-API-surface only when EVERY branch did and nothing errored', () => {
    const none = surfaceResult({ missionName: 'a', noApiSurfaceReason: 'No HTTP calls.' });
    expect(collectSurfaceResults([none]).noApiSurfaceReason).toBe('No HTTP calls.');
    const withRoutes = surfaceResult({ missionName: 'b', routes: [routeOf('r', '/api/r')] });
    expect(collectSurfaceResults([none, withRoutes]).noApiSurfaceReason).toBeUndefined();
    const errored = surfaceResult({ missionName: 'c', error: 'boom', noApiSurfaceReason: 'none' });
    expect(collectSurfaceResults([none, errored]).noApiSurfaceReason).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Verdicts (pure)
// ---------------------------------------------------------------------------

describe('parseVerdicts', () => {
  it('parses well-formed verdicts and drops malformed entries', () => {
    const verdicts = parseVerdicts({
      verdicts: [
        { routeKey: 'GET|/a|200', verdict: 'confirmed' },
        { routeKey: 'GET|/b|200', verdict: 'wrong', reason: 'field is\nnamed userId', suggestedFix: 'rename' },
        { routeKey: '', verdict: 'wrong' }, // empty key
        { routeKey: 'GET|/c|200', verdict: 'maybe' }, // bad enum
        'nonsense',
        { verdict: 'wrong' }, // no key
      ],
    });
    expect(verdicts).toEqual([
      { routeKey: 'GET|/a|200', verdict: 'confirmed' },
      { routeKey: 'GET|/b|200', verdict: 'wrong', reason: 'field is named userId', suggestedFix: 'rename' },
    ]);
  });

  it('returns [] for non-object and array-less input', () => {
    expect(parseVerdicts(null)).toEqual([]);
    expect(parseVerdicts('verdicts')).toEqual([]);
    expect(parseVerdicts({ verdicts: 'yes' })).toEqual([]);
  });
});

describe('applyVerdicts', () => {
  const users = routeOf('users', '/api/users');
  const orders = routeOf('orders', '/api/orders');

  it('splits wrong routes and FAILS OPEN for missing/unknown verdicts', () => {
    const split = applyVerdicts(
      [users, orders],
      [
        { routeKey: verificationRouteKey(orders), verdict: 'wrong', reason: 'bad shape' },
        { routeKey: 'GET|/api/ghost|200', verdict: 'wrong', reason: 'ignored — unknown key' },
        // no verdict at all for /api/users → stays confirmed
      ]
    );
    expect(split.confirmed).toEqual([users]);
    expect(split.wrong).toEqual([{ route: orders, reason: 'bad shape' }]);
  });

  it('first verdict wins on duplicate keys', () => {
    const split = applyVerdicts(
      [users],
      [
        { routeKey: verificationRouteKey(users), verdict: 'confirmed' },
        { routeKey: verificationRouteKey(users), verdict: 'wrong', reason: 'late contradiction' },
      ]
    );
    expect(split.wrong).toHaveLength(0);
  });
});

describe('verificationRouteKey', () => {
  it('is method+path+status, casing-normalized', () => {
    expect(verificationRouteKey(routeOf('r', '/api/Users'))).toBe('GET|/api/users|200');
  });
});

// ---------------------------------------------------------------------------
// Critic + repair prompts (pure)
// ---------------------------------------------------------------------------

describe('buildCriticPrompt', () => {
  const routes = [routeOf('users', '/api/users'), routeOf('orders', '/api/orders')];

  it('lists every route with its key and includes the seed section', () => {
    const prompt = buildCriticPrompt('Shop', 'consumes', routes, '- src/api.ts (score 40)');
    expect(prompt).toContain('"Shop" [consumes]');
    expect(prompt).toContain(`routeKey "${verificationRouteKey(routes[0])}"`);
    expect(prompt).toContain(`routeKey "${verificationRouteKey(routes[1])}"`);
    expect(prompt).toContain('- src/api.ts (score 40)');
    expect(prompt).toContain('submit_verdicts EXACTLY ONCE');
    expect(prompt).not.toContain('REPAIRED');
  });

  it('marks re-verification runs and caps the listing', () => {
    const prompt = buildCriticPrompt('Shop', 'serves', routes, '', { reVerify: true });
    expect(prompt).toContain('REPAIRED');
    const big = Array.from({ length: 300 }, (_, i) =>
      routeOf(`r${i}`, `/api/things/${i}`, {
        response: {
          type: 'static',
          statusCode: 200,
          body: { contentType: 'application/json', content: { filler: 'x'.repeat(400) } },
        },
      })
    );
    const capped = buildCriticPrompt('Shop', 'consumes', big, '');
    const listing = capped.split('## Proposed routes')[1].split('## Seed files')[0];
    expect(listing.length).toBeLessThanOrEqual(CRITIC_LISTING_MAX_CHARS + 10);
  });
});

describe('buildRepairPrompt / attributeRepairedRoute', () => {
  const wrong: WrongRoute[] = [
    {
      surfaceName: 'apps/a',
      routeKey: verificationRouteKey(routeOf('orders', '/api/orders')),
      reason: 'body shape wrong',
      suggestedFix: 'rename total to totalCents',
      route: routeOf('orders', '/api/orders'),
    },
  ];

  it('quotes routes with their rejection reasons and suggested fixes', () => {
    const prompt = buildRepairPrompt(wrong);
    expect(prompt).toContain('rejectionReasons');
    expect(prompt).toContain('body shape wrong');
    expect(prompt).toContain('suggested fix: rename total to totalCents');
    expect(prompt).toContain('Return a JSON array of the corrected route objects only.');
  });

  it('attributes repaired routes by exact key, then method+path, then first', () => {
    expect(attributeRepairedRoute(routeOf('fixed', '/api/orders'), wrong)).toBe('apps/a');
    // Status changed by the repair → falls back to method+path.
    expect(
      attributeRepairedRoute(
        routeOf('fixed', '/api/orders', {
          response: { type: 'static', statusCode: 201, body: { contentType: 'application/json', content: {} } },
        }),
        wrong
      )
    ).toBe('apps/a');
    expect(attributeRepairedRoute(routeOf('other', '/api/new'), wrong)).toBe('apps/a');
    expect(attributeRepairedRoute(routeOf('other', '/api/new'), [])).toBe('');
  });
});

describe('rebuildSurfaces', () => {
  it('keeps final route identity, attaches repaired routes to their surface, and parks orphans on the first surface', () => {
    const users = routeOf('users', '/api/users');
    const repairedOrders = routeOf('orders fixed', '/api/orders');
    const orphan = routeOf('orphan', '/api/orphan');
    const surfaces: ScanSurface[] = [
      { name: 'A', direction: 'consumes', routes: [users, routeOf('orders', '/api/orders')] },
      { name: 'B', direction: 'serves', routes: [] },
    ];
    const repaired: RepairCandidate[] = [{ surfaceName: 'A', route: repairedOrders }];
    const rebuilt = rebuildSurfaces(surfaces, [users, repairedOrders, orphan], repaired);
    expect(rebuilt).toHaveLength(1); // B was empty and is dropped
    expect(rebuilt[0].name).toBe('A');
    expect(rebuilt[0].routes).toContain(users); // same object identity
    expect(rebuilt[0].routes).toContain(repairedOrders);
    expect(rebuilt[0].routes).toContain(orphan);
  });

  it('invents a default surface when there is nothing to attach to', () => {
    const route = routeOf('r', '/api/r');
    const rebuilt = rebuildSurfaces([], [route], []);
    expect(rebuilt).toEqual([{ name: 'API', direction: 'consumes', routes: [route] }]);
  });
});

// ---------------------------------------------------------------------------
// The graph end-to-end (fake AI, no network)
// ---------------------------------------------------------------------------

describe('runScanGraph', () => {
  it('fans out one exploration branch per surface and merges their routes', async () => {
    const ai = new FakeAi();
    const deps = makeDeps(ai, reconOf(['apps/a', 'apps/b', 'apps/c']));
    const summary = await runScanGraph(ai, { deps });

    expect(ai.explorePrompts).toHaveLength(3);
    expect([...ai.exploreCounts.keys()].sort()).toEqual(['apps/a', 'apps/b', 'apps/c']);
    // Each mission prompt covers ONLY its surface.
    const promptA = ai.explorePrompts.find((p) => p.includes('### Surface "apps/a"'));
    expect(promptA).toBeDefined();
    expect(promptA).not.toContain('### Surface "apps/b"');
    // Divided tool budget rides into every branch's tool loop.
    expect(ai.exploreOptionsBySurface.get('apps/a')?.maxToolCalls).toBe(divideToolCalls(3, 3));

    expect(summary.routes).toHaveLength(3);
    expect(summary.chunkCount).toBe(3);
    expect(summary.positiveCount).toBe(3);
    expect((summary.surfaces ?? []).map((s) => s.name).sort()).toEqual([
      'apps/a',
      'apps/b',
      'apps/c',
    ]);
    expect(summary.verification).toEqual({ confirmed: 3, repaired: 0, dropped: 0 });

    // What the scan learned is persisted for the next scan.
    const memory = deps.memory as unknown as MemoryStore;
    expect(memory.saved).toHaveLength(1);
    expect(memory.saved[0].version).toBe(1);
    expect(memory.saved[0].surfaces.length).toBeGreaterThan(0);
  });

  it('caps parallel surface branches at SURFACE_CONCURRENCY', async () => {
    const ai = new FakeAi();
    const roots = ['apps/a', 'apps/b', 'apps/c', 'apps/d', 'apps/e'];
    const deps = makeDeps(ai, reconOf(roots));
    const summary = await runScanGraph(ai, { deps });

    expect(ai.maxActive).toBeLessThanOrEqual(SURFACE_CONCURRENCY);
    expect(ai.maxActive).toBeGreaterThan(1); // the wave really ran in parallel
    expect(ai.explorePrompts).toHaveLength(5);
    expect(summary.routes).toHaveLength(5);
    expect(ai.exploreOptionsBySurface.get('apps/e')?.maxToolCalls).toBe(divideToolCalls(5, 5));
  });

  it('runs verify → repair → re-verify: a wrong route is repaired once and re-verified', async () => {
    const ai = new FakeAi();
    const users = rawRoute('users', '/api/users');
    const orders = rawRoute('orders', '/api/orders');
    const ordersKey = verificationRouteKey(orders as never);
    ai.onExplore = async (_surface, execute) => {
      await execute({ name: 'submit_routes', input: { routes: [users, orders] } });
      return 'done';
    };
    ai.onCritic = (keys, _prompt, call) => {
      if (call === 1) {
        return keys.map((routeKey) =>
          routeKey === ordersKey
            ? { routeKey, verdict: 'wrong' as const, reason: 'body has totalCents, not total', suggestedFix: 'rename the field' }
            : { routeKey, verdict: 'confirmed' as const }
        );
      }
      return keys.map((routeKey) => ({ routeKey, verdict: 'confirmed' as const }));
    };
    const repairedOrders = rawRoute('orders', '/api/orders', {
      response: {
        type: 'static',
        statusCode: 200,
        body: { contentType: 'application/json', content: { totalCents: 129900 } },
      },
    });
    ai.onRepair = () => ({ routes: [repairedOrders] });

    const deps = makeDeps(ai, reconOf(['']));
    const summary = await runScanGraph(ai, { deps });

    expect(ai.criticPrompts).toHaveLength(2);
    expect(ai.criticPrompts[1]).toContain('REPAIRED');
    expect(ai.criticPrompts[1]).toContain(ordersKey);
    expect(ai.criticPrompts[1]).not.toContain(verificationRouteKey(users as never));
    expect(ai.repairPrompts).toHaveLength(1);
    expect(ai.repairPrompts[0]).toContain('body has totalCents, not total');
    expect(ai.repairPrompts[0]).toContain('suggested fix: rename the field');

    expect(summary.routes).toHaveLength(2);
    const finalOrders = summary.routes.find((r) => r.path === '/api/orders');
    expect(finalOrders?.response.body?.content).toEqual({ totalCents: 129900 });
    expect(summary.verification).toEqual({ confirmed: 1, repaired: 1, dropped: 0 });
    expect(summary.repairedCount).toBe(1);
  });

  it('drops a wrong route when the repair round fails', async () => {
    const ai = new FakeAi();
    const users = rawRoute('users', '/api/users');
    const orders = rawRoute('orders', '/api/orders');
    ai.onExplore = async (_surface, execute) => {
      await execute({ name: 'submit_routes', input: { routes: [users, orders] } });
      return 'done';
    };
    ai.onCritic = (keys) =>
      keys.map((routeKey) =>
        routeKey === verificationRouteKey(orders as never)
          ? { routeKey, verdict: 'wrong' as const, reason: 'wrong path' }
          : { routeKey, verdict: 'confirmed' as const }
      );
    ai.onRepair = () => {
      throw new Error('rate limited');
    };

    const summary = await runScanGraph(ai, { deps: makeDeps(ai, reconOf([''])) });
    expect(summary.routes.map((r) => r.path)).toEqual(['/api/users']);
    expect(summary.verification).toEqual({ confirmed: 1, repaired: 0, dropped: 1 });
    expect(summary.droppedCount).toBe(1);
    // No repaired candidates → no re-verify critic session.
    expect(ai.criticPrompts).toHaveLength(1);
  });

  it('drops a repaired route that fails re-verification (ONE bounded repair round)', async () => {
    const ai = new FakeAi();
    const users = rawRoute('users', '/api/users');
    const orders = rawRoute('orders', '/api/orders');
    ai.onExplore = async (_surface, execute) => {
      await execute({ name: 'submit_routes', input: { routes: [users, orders] } });
      return 'done';
    };
    ai.onCritic = (keys, _prompt, call) =>
      keys.map((routeKey) =>
        call === 1 && routeKey !== verificationRouteKey(orders as never)
          ? { routeKey, verdict: 'confirmed' as const }
          : { routeKey, verdict: 'wrong' as const, reason: 'still wrong' }
      );
    ai.onRepair = () => ({ routes: [orders] });

    const summary = await runScanGraph(ai, { deps: makeDeps(ai, reconOf([''])) });
    expect(summary.routes.map((r) => r.path)).toEqual(['/api/users']);
    expect(summary.verification).toEqual({ confirmed: 1, repaired: 0, dropped: 1 });
    // Exactly two critic sessions: verify + one re-verify. Never a third.
    expect(ai.criticPrompts).toHaveLength(2);
    expect(ai.repairPrompts).toHaveLength(1);
  });

  it('salvages a failing branch\'s partial routes without touching other branches', async () => {
    const ai = new FakeAi();
    const goodB = rawRoute('good b', '/api/apps-b');
    const badB = rawRoute('bad b', 'no-leading-slash');
    ai.onExplore = async (surface, execute) => {
      if (surface === 'apps/b') {
        await execute({ name: 'submit_routes', input: { routes: [goodB, badB] } });
        throw new Error('provider exploded mid-flight');
      }
      await execute({
        name: 'submit_routes',
        input: { routes: [rawRoute(`route of ${surface}`, `/api/${surface.replace(/\W+/g, '-')}`)] },
      });
      return 'done';
    };

    const summary = await runScanGraph(ai, { deps: makeDeps(ai, reconOf(['apps/a', 'apps/b'])) });
    expect(summary.routes.map((r) => r.path).sort()).toEqual(['/api/apps-a', '/api/apps-b']);
    expect((summary.surfaces ?? []).map((s) => s.name).sort()).toEqual(['apps/a', 'apps/b']);
    // The invalid route from the failed round is reported as dropped.
    expect(summary.droppedCount).toBe(1);
  });

  it('surfaces a deliberate no-API-surface conclusion instead of erroring', async () => {
    const ai = new FakeAi();
    ai.onExplore = async (_surface, execute) => {
      await execute({ name: 'submit_routes', input: { routes: [] } });
      return 'This workspace is a CLI tool with no HTTP surface to mock.';
    };
    const deps = makeDeps(ai, { appName: 'Shop', profiles: [], files: [], scannedFileCount: 7 });
    const summary = await runScanGraph(ai, { deps });

    expect(summary.routes).toEqual([]);
    expect(summary.noApiSurfaceReason).toContain('CLI tool');
    expect(summary.verification).toBeUndefined();
    expect(ai.criticPrompts).toHaveLength(0);
    // The recon-first census mission actually carried the census block.
    expect(ai.explorePrompts[0]).toContain('CENSUS-BLOCK');
    // The conclusion is remembered for future scans.
    const memory = deps.memory as unknown as MemoryStore;
    expect(memory.saved).toHaveLength(1);
    expect(memory.saved[0].notes[0]).toContain('no API surface');
  });

  it('resumes from the checkpoint, skipping surfaces that already completed', async () => {
    const ai = new FakeAi();
    let failB = true;
    ai.onExplore = async (surface, execute) => {
      if (surface === 'apps/b' && failB) {
        await sleep(40); // let apps/a finish (and checkpoint) first
        const abort = new Error('The scan was cancelled.');
        abort.name = 'AbortError';
        throw abort;
      }
      await execute({
        name: 'submit_routes',
        input: { routes: [rawRoute(`route of ${surface}`, `/api/${surface.replace(/\W+/g, '-')}`)] },
      });
      return 'done';
    };
    const storage = createInMemoryCheckpointStorage();
    const deps = makeDeps(ai, reconOf(['apps/a', 'apps/b']), { storage });

    await expect(runScanGraph(ai, { deps, threadId: 'resume-1' })).rejects.toThrow();
    expect(ai.exploreCounts.get('apps/a')).toBe(1);
    expect(ai.exploreCounts.get('apps/b')).toBe(1);

    failB = false;
    const summary = await runScanGraph(ai, { deps, threadId: 'resume-1', resume: true });
    // apps/a was NOT re-explored — its branch result came from the checkpoint.
    expect(ai.exploreCounts.get('apps/a')).toBe(1);
    expect(ai.exploreCounts.get('apps/b')).toBe(2);
    expect(summary.routes.map((r) => r.path).sort()).toEqual(['/api/apps-a', '/api/apps-b']);
  });

  it('throws GraphUnavailableError when the pipeline cannot be constructed', async () => {
    const ai = new FakeAi();
    const deps = makeDeps(ai, reconOf(['apps/a']));
    await expect(
      runScanGraph(ai, {
        deps,
        createRuntime: () => {
          throw new Error('langgraph runtime import failed');
        },
      })
    ).rejects.toThrow(GraphUnavailableError);
    await expect(
      runScanGraph(ai, {
        deps,
        createRuntime: () => {
          throw new Error('langgraph runtime import failed');
        },
      })
    ).rejects.toThrow(/could not be constructed/);
    expect(ai.explorePrompts).toHaveLength(0); // nothing ran
  });

  it('fails with a clear error when no branch produced any valid route', async () => {
    const ai = new FakeAi();
    ai.onExplore = async () => 'I found nothing and submitted nothing.';
    await expect(runScanGraph(ai, { deps: makeDeps(ai, reconOf(['apps/a'])) })).rejects.toThrow(
      /did not produce any valid mock routes/
    );
  });

  it('stamps NEGATIVE_ROUTE_PRIORITY on enabled negative routes in the final summary', async () => {
    const ai = new FakeAi();
    ai.onExplore = async (_surface, execute) => {
      await execute({
        name: 'submit_routes',
        input: {
          routes: [
            rawRoute('ok', '/api/things'),
            rawRoute('not found', '/api/things/:id', {
              enabled: false,
              tags: ['negative', '404'],
              response: {
                type: 'static',
                statusCode: 404,
                body: { contentType: 'application/json', content: { error: 'not found' } },
              },
            }),
          ],
        },
      });
      return 'done';
    };
    const summary = await runScanGraph(ai, { deps: makeDeps(ai, reconOf([''])) });
    expect(summary.negativeCount).toBe(1);
    expect(summary.positiveCount).toBe(1);
    const negative = summary.routes.find((r) => r.tags?.includes('negative'));
    expect(negative?.priority).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// ask_user: human-in-the-loop inside exploration branches
// ---------------------------------------------------------------------------

describe('ask_user (human-in-the-loop)', () => {
  it('bridges ask_user to the question handler and feeds the answer back to the model', async () => {
    const ai = new FakeAi();
    const questions: HumanQuestion[] = [];
    const answers: string[] = [];
    ai.onExplore = async (surface, execute) => {
      answers.push(
        await execute({
          name: 'ask_user',
          input: {
            question: '  Which auth\nflow should the mock use?  ',
            options: ['OAuth 2.0', 'API key', 42],
          },
        })
      );
      await execute({
        name: 'submit_routes',
        input: { routes: [rawRoute(`route of ${surface}`, '/api/things')] },
      });
      return 'done';
    };
    const progress: string[] = [];
    const deps = makeDeps(ai, reconOf(['apps/a']), {
      askUser: (question) => {
        questions.push(question);
        return 'OAuth 2.0';
      },
    });
    const summary = await runScanGraph(ai, { deps, onProgress: (p) => progress.push(p.message) });

    expect(summary.routes).toHaveLength(1);
    expect(questions).toHaveLength(1);
    expect(questions[0].question).toBe('Which auth flow should the mock use?');
    expect(questions[0].options).toEqual(['OAuth 2.0', 'API key']); // sanitized: non-strings dropped
    expect(questions[0].freeText).toBe(true);
    expect(answers[0]).toContain('The user answered: "OAuth 2.0"');
    // The tool was actually offered to the model…
    expect(ai.exploreToolsBySurface.get('apps/a')).toContain('ask_user');
    // …and the dashboard saw the waiting state.
    expect(progress.some((message) => message.includes('Waiting for your answer:'))).toBe(true);
  });

  it('does not offer ask_user when no question handler is wired', async () => {
    const ai = new FakeAi();
    await runScanGraph(ai, { deps: makeDeps(ai, reconOf(['apps/a'])) });
    expect(ai.exploreToolsBySurface.get('apps/a')).not.toContain('ask_user');
  });

  it('enforces the 2-question cap per surface', async () => {
    const ai = new FakeAi();
    const answers: string[] = [];
    ai.onExplore = async (surface, execute) => {
      for (let i = 0; i < MAX_QUESTIONS_PER_SURFACE + 1; i++) {
        answers.push(await execute({ name: 'ask_user', input: { question: `Question ${i}?` } }));
      }
      await execute({
        name: 'submit_routes',
        input: { routes: [rawRoute(`route of ${surface}`, '/api/things')] },
      });
      return 'done';
    };
    let handled = 0;
    const deps = makeDeps(ai, reconOf(['apps/a']), {
      askUser: () => {
        handled += 1;
        return `answer ${handled}`;
      },
    });
    const summary = await runScanGraph(ai, { deps });

    expect(handled).toBe(MAX_QUESTIONS_PER_SURFACE);
    expect(answers[0]).toContain('answer 1');
    expect(answers[1]).toContain('answer 2');
    expect(answers[2]).toBe(ASK_USER_BUDGET_MESSAGE);
    expect(summary.routes).toHaveLength(1); // the scan still completed
  });

  it('resumes with the no-answer fallback when the answer times out', async () => {
    const ai = new FakeAi();
    let answer = '';
    ai.onExplore = async (surface, execute) => {
      answer = await execute({ name: 'ask_user', input: { question: 'Anyone there?' } });
      await execute({
        name: 'submit_routes',
        input: { routes: [rawRoute(`route of ${surface}`, '/api/things')] },
      });
      return 'done';
    };
    const deps = makeDeps(ai, reconOf(['apps/a']), {
      askUser: () => new Promise<string>(() => undefined), // the human never answers
      askUserTimeoutMs: 20,
    });
    const summary = await runScanGraph(ai, { deps });
    expect(answer).toBe(NO_ANSWER_FALLBACK);
    expect(summary.routes).toHaveLength(1);
  });

  it('aborts cleanly when the scan is cancelled during a pending question', async () => {
    const ai = new FakeAi();
    const cancellation = fakeLoopCancellation();
    let questionSeen = false;
    ai.onExplore = async (_surface, execute) => {
      await execute({ name: 'ask_user', input: { question: 'Pick one?' } });
      throw new Error('unreachable — the pending question must reject first');
    };
    const deps = makeDeps(ai, reconOf(['apps/a']), {
      askUser: () => {
        questionSeen = true;
        setTimeout(() => cancellation.cancel(), 15);
        return new Promise<string>(() => undefined);
      },
    });
    await expect(runScanGraph(ai, { deps, token: cancellation.token })).rejects.toThrow();
    expect(questionSeen).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Resume: thread ids, detection, stale eviction, continuation
// ---------------------------------------------------------------------------

const WS = '/test/ws';

/** An AI whose apps/b branch aborts (as user cancellation does) until told otherwise. */
function interruptedAi(): { ai: FakeAi; letBSucceed: () => void } {
  const ai = new FakeAi();
  let failB = true;
  ai.onExplore = async (surface, execute) => {
    if (surface === 'apps/b' && failB) {
      await sleep(40); // let apps/a finish (and checkpoint) first
      const abort = new Error('The scan was cancelled.');
      abort.name = 'AbortError';
      throw abort;
    }
    await execute({
      name: 'submit_routes',
      input: { routes: [rawRoute(`route of ${surface}`, `/api/${surface.replace(/\W+/g, '-')}`)] },
    });
    return 'done';
  };
  return { ai, letBSucceed: () => (failB = false) };
}

describe('deriveScanThreadId', () => {
  it('is deterministic and distinct per workspace and config revision', () => {
    expect(deriveScanThreadId('/a')).toBe(deriveScanThreadId('/a'));
    expect(deriveScanThreadId('/a')).not.toBe(deriveScanThreadId('/b'));
    expect(deriveScanThreadId('/a', 'rev-1')).not.toBe(deriveScanThreadId('/a', 'rev-2'));
    expect(deriveScanThreadId('/a')).toMatch(/^scan-ws[0-9a-f]{8}-cfg[0-9a-f]{8}$/);
    expect(deriveScanThreadId('/a', 'rev-1').startsWith(scanThreadIdPrefix('/a'))).toBe(true);
  });
});

describe('hasResumableScan / resumeScanGraph', () => {
  it('detects an interrupted scan and resumes it, skipping completed surfaces', async () => {
    const { ai, letBSucceed } = interruptedAi();
    const storage = createInMemoryCheckpointStorage();
    const deps = makeDeps(ai, reconOf(['apps/a', 'apps/b']), { storage });
    const threadId = deriveScanThreadId(WS);
    const before = Date.now();

    await expect(runScanGraph(ai, { deps, threadId })).rejects.toThrow();

    const info = await hasResumableScan(WS, { storage });
    expect(info).not.toBeNull();
    expect(info?.threadId).toBe(threadId);
    expect(info?.totalSurfaces).toBe(2);
    expect(info?.completedSurfaces).toBe(1); // apps/a finished before the abort
    expect(info?.startedAt).toBeGreaterThanOrEqual(before - 1000);
    expect(info?.startedAt).toBeLessThanOrEqual(Date.now());

    letBSucceed();
    const summary = await resumeScanGraph(ai, threadId, { deps });
    expect(ai.exploreCounts.get('apps/a')).toBe(1); // never re-explored
    expect(ai.exploreCounts.get('apps/b')).toBe(2);
    expect(summary.routes.map((r) => r.path).sort()).toEqual(['/api/apps-a', '/api/apps-b']);

    // The finished run cleaned its checkpoints — nothing left to resume.
    expect(await hasResumableScan(WS, { storage })).toBeNull();
    expect(await storage.list()).toEqual([]);
  });

  it('returns null on an empty checkpoint store', async () => {
    expect(await hasResumableScan(WS, { storage: createInMemoryCheckpointStorage() })).toBeNull();
  });

  it('ignores AND deletes checkpoints older than 24 hours', async () => {
    const { ai } = interruptedAi();
    const storage = createInMemoryCheckpointStorage();
    const deps = makeDeps(ai, reconOf(['apps/a', 'apps/b']), { storage });
    const threadId = deriveScanThreadId(WS);
    await expect(runScanGraph(ai, { deps, threadId })).rejects.toThrow();
    expect((await storage.list()).length).toBe(1);

    const dayLater = Date.now() + 25 * 60 * 60 * 1000;
    expect(await hasResumableScan(WS, { storage, now: dayLater })).toBeNull();
    expect(await storage.list()).toEqual([]); // evicted, not just ignored
    // Even at the original time there is nothing left to resume.
    expect(await hasResumableScan(WS, { storage })).toBeNull();
  });

  it('ignores AND deletes checkpoints from a different config revision', async () => {
    const { ai } = interruptedAi();
    const storage = createInMemoryCheckpointStorage();
    const deps = makeDeps(ai, reconOf(['apps/a', 'apps/b']), { storage });
    const oldThreadId = deriveScanThreadId(WS, 'rev-a');
    await expect(runScanGraph(ai, { deps, threadId: oldThreadId })).rejects.toThrow();
    expect((await storage.list()).length).toBe(1);

    expect(await hasResumableScan(WS, { storage, configRevision: 'rev-b' })).toBeNull();
    expect(await storage.list()).toEqual([]); // the rev-a thread was evicted
    expect(await hasResumableScan(WS, { storage, configRevision: 'rev-a' })).toBeNull();
  });
});
