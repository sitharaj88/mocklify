import { describe, it, expect, vi } from 'vitest';
import {
  AGENTIC_ESCALATION_MESSAGE,
  ScanOrchestrator,
  StrategyInput,
  assignFilesToProfiles,
  buildSurfaceViews,
  decideStrategy,
  filterReconForRoots,
  isLowConfidenceSeeds,
  mergeScanSummaries,
  type ScanMode,
  type StrategyDecision,
} from '../src/ai/ScanOrchestrator';
import { LOW_CONFIDENCE_SEED_SCORE } from '../src/ai/AgenticScanner';
import { AgenticScanUnavailableError } from '../src/ai/providers/types';
import type {
  CodebaseScanSummary,
  ReconFile,
  WorkspaceRecon,
} from '../src/ai/CodebaseMockGenerator';
import type { AiService } from '../src/ai/AiService';
import type { ProjectProfile } from '../src/ai/scan/projectProfile';
import type { RouteConfig } from '../src/types/core';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function profile(rootPath: string, specFiles: string[] = []): ProjectProfile {
  return {
    rootPath,
    kind: 'backend',
    frameworks: [],
    direction: 'serves',
    confidence: 'high',
    specFiles,
    evidence: [],
  };
}

function reconFile(path: string, score: number): ReconFile {
  return {
    path,
    score,
    snippet: `snippet of ${path}`,
    clientScore: score,
    serverScore: 0,
    importPaths: [],
    typeNames: [],
  };
}

function recon(over?: Partial<WorkspaceRecon>): WorkspaceRecon {
  return {
    appName: 'Shop',
    profiles: [],
    files: [reconFile('src/api.ts', 40)],
    scannedFileCount: 25,
    ...over,
  };
}

function route(method: string, path: string, tags?: string[]): Omit<RouteConfig, 'id'> {
  return {
    name: `${method} ${path}`,
    enabled: true,
    method: method as RouteConfig['method'],
    path,
    response: { type: 'static', statusCode: 200, body: {} },
    ...(tags ? { tags } : {}),
  } as Omit<RouteConfig, 'id'>;
}

function summary(over?: Partial<CodebaseScanSummary>): CodebaseScanSummary {
  const routes = over?.routes ?? [route('GET', '/api/users')];
  const negative = routes.filter((r) => r.tags?.includes('negative')).length;
  return {
    scannedFileCount: 25,
    matchedFileCount: 1,
    chunkCount: 1,
    routes,
    positiveCount: routes.length - negative,
    negativeCount: negative,
    repairedCount: 0,
    droppedCount: 0,
    ...over,
  };
}

function fakeAi(supportsTools: boolean): AiService {
  return {
    resolveProvider: async () => ({
      id: 'claude',
      label: 'Claude',
      isAvailable: async () => true,
      streamRequest: async function* () {
        yield '';
      },
      ...(supportsTools ? { runToolLoop: async () => '' } : {}),
    }),
  } as unknown as AiService;
}

interface FakeDeps {
  fast: { generate: ReturnType<typeof vi.fn> };
  agentic: { generate: ReturnType<typeof vi.fn> };
  recon: ReturnType<typeof vi.fn>;
}

function fakeDeps(input: {
  recon: WorkspaceRecon;
  fastSummary?: CodebaseScanSummary | Error;
  agenticSummary?: CodebaseScanSummary | Error;
}): FakeDeps {
  const behavior = (value: CodebaseScanSummary | Error | undefined) => async () => {
    if (value instanceof Error) {
      throw value;
    }
    return value ?? summary();
  };
  return {
    fast: { generate: vi.fn(behavior(input.fastSummary)) },
    agentic: { generate: vi.fn(behavior(input.agenticSummary)) },
    recon: vi.fn(async () => input.recon),
  };
}

function orchestrator(supportsTools: boolean, deps: FakeDeps): ScanOrchestrator {
  return new ScanOrchestrator(fakeAi(supportsTools), deps);
}

// ---------------------------------------------------------------------------
// decideStrategy — exhaustive branch table
// ---------------------------------------------------------------------------

function input(over?: Partial<StrategyInput>): StrategyInput {
  return {
    scanMode: 'fast',
    providerSupportsTools: false,
    specFiles: [],
    seedFileCount: 5,
    topSeedScore: 40,
    workspaceSeedFileCount: 5,
    ...over,
  };
}

describe('isLowConfidenceSeeds', () => {
  it('is true for zero seeds and for a best score below the agentic bar', () => {
    expect(isLowConfidenceSeeds(0, 0)).toBe(true);
    expect(isLowConfidenceSeeds(3, LOW_CONFIDENCE_SEED_SCORE - 1)).toBe(true);
    expect(isLowConfidenceSeeds(1, LOW_CONFIDENCE_SEED_SCORE)).toBe(false);
    expect(isLowConfidenceSeeds(10, 40)).toBe(false);
  });
});

describe('decideStrategy', () => {
  const MODES: ScanMode[] = ['auto', 'fast', 'agentic'];

  it('scanMode agentic + tool support → agentic', () => {
    const decision = decideStrategy(input({ scanMode: 'agentic', providerSupportsTools: true }));
    expect(decision).toMatchObject({ strategy: 'agentic', executeAs: 'agentic' });
  });

  it('scanMode fast + strong seeds → fast, even with tool support', () => {
    const decision = decideStrategy(input({ scanMode: 'fast', providerSupportsTools: true }));
    expect(decision).toMatchObject({ strategy: 'fast', executeAs: 'fast' });
  });

  it('scanMode fast + zero seeds + tool support auto-escalates to agentic with the documented copy', () => {
    const decision = decideStrategy(
      input({
        scanMode: 'fast',
        providerSupportsTools: true,
        seedFileCount: 0,
        topSeedScore: 0,
        workspaceSeedFileCount: 0,
      })
    );
    expect(decision).toMatchObject({ strategy: 'agentic', executeAs: 'agentic' });
    expect(decision.reason).toBe(AGENTIC_ESCALATION_MESSAGE);
  });

  it('scanMode fast + weak seeds stays fast (explicit fast is a cost control)', () => {
    const low = decideStrategy(
      input({
        scanMode: 'fast',
        providerSupportsTools: true,
        seedFileCount: 2,
        topSeedScore: LOW_CONFIDENCE_SEED_SCORE - 1,
      })
    );
    expect(low.executeAs).toBe('fast');
    const atBar = decideStrategy(
      input({
        scanMode: 'fast',
        providerSupportsTools: true,
        seedFileCount: 1,
        topSeedScore: LOW_CONFIDENCE_SEED_SCORE,
      })
    );
    expect(atBar.executeAs).toBe('fast');
  });

  it('scanMode fast + seedless sub-surface in a workspace WITH seeds stays fast even with tools', () => {
    const decision = decideStrategy(
      input({
        scanMode: 'fast',
        providerSupportsTools: true,
        seedFileCount: 0,
        topSeedScore: 0,
        workspaceSeedFileCount: 8,
      })
    );
    expect(decision.executeAs).toBe('fast');
    expect(decision.reason).toContain('covered by the workspace fast scan');
  });

  it('auto picks agentic when tools are supported, fast otherwise', () => {
    expect(decideStrategy(input({ scanMode: 'auto', providerSupportsTools: true })).executeAs).toBe(
      'agentic'
    );
    expect(decideStrategy(input({ scanMode: 'auto', providerSupportsTools: false })).executeAs).toBe(
      'fast'
    );
  });

  it('a provider without tool support never gets agentic in any mode', () => {
    for (const scanMode of MODES) {
      const decision = decideStrategy(input({ scanMode, providerSupportsTools: false }));
      expect(decision.executeAs).toBe('fast');
    }
  });

  it('scanMode agentic without tool support explains the fast fallback', () => {
    const decision = decideStrategy(input({ scanMode: 'agentic', providerSupportsTools: false }));
    expect(decision.executeAs).toBe('fast');
    expect(decision.reason).toContain('does not support tool use');
  });

  it('zero workspace seeds without tool support → census, in every mode', () => {
    for (const scanMode of MODES) {
      const decision = decideStrategy(
        input({
          scanMode,
          providerSupportsTools: false,
          seedFileCount: 0,
          topSeedScore: 0,
          workspaceSeedFileCount: 0,
        })
      );
      expect(decision).toMatchObject({ strategy: 'census', executeAs: 'census' });
    }
  });

  it('a seedless surface in a workspace WITH seeds stays fast (covered by the workspace scan)', () => {
    const decision = decideStrategy(
      input({
        scanMode: 'fast',
        providerSupportsTools: false,
        seedFileCount: 0,
        topSeedScore: 0,
        workspaceSeedFileCount: 8,
      })
    );
    expect(decision.executeAs).toBe('fast');
    expect(decision.reason).toContain('covered by the workspace fast scan');
  });

  it('spec files override the reported strategy in every mode but keep the execution', () => {
    const table: Array<{ scanMode: ScanMode; tools: boolean; executeAs: string }> = [
      { scanMode: 'auto', tools: true, executeAs: 'agentic' },
      { scanMode: 'auto', tools: false, executeAs: 'fast' },
      { scanMode: 'fast', tools: true, executeAs: 'fast' },
      { scanMode: 'fast', tools: false, executeAs: 'fast' },
      { scanMode: 'agentic', tools: true, executeAs: 'agentic' },
      { scanMode: 'agentic', tools: false, executeAs: 'fast' },
    ];
    for (const row of table) {
      const decision = decideStrategy(
        input({
          scanMode: row.scanMode,
          providerSupportsTools: row.tools,
          specFiles: ['openapi.yaml'],
        })
      );
      expect(decision.strategy).toBe('spec');
      expect(decision.executeAs).toBe(row.executeAs);
      expect(decision.reason).toContain('openapi.yaml');
    }
  });

  it('spec + zero workspace seeds + no tools reports spec but executes census', () => {
    const decision = decideStrategy(
      input({
        providerSupportsTools: false,
        specFiles: ['api/openapi.json'],
        seedFileCount: 0,
        topSeedScore: 0,
        workspaceSeedFileCount: 0,
      })
    );
    expect(decision).toMatchObject({ strategy: 'spec', executeAs: 'census' });
  });
});

// ---------------------------------------------------------------------------
// Surface views + recon filtering
// ---------------------------------------------------------------------------

describe('assignFilesToProfiles', () => {
  it('assigns to the deepest enclosing root and orphans to the first profile', () => {
    const profiles = [profile('app'), profile('app/nested'), profile('server')];
    const files = [
      reconFile('app/src/a.ts', 10),
      reconFile('app/nested/b.ts', 20),
      reconFile('server/c.ts', 30),
      reconFile('tools/orphan.ts', 40),
    ];
    const buckets = assignFilesToProfiles(profiles, files);
    expect(buckets[0].map((f) => f.path)).toEqual(['app/src/a.ts', 'tools/orphan.ts']);
    expect(buckets[1].map((f) => f.path)).toEqual(['app/nested/b.ts']);
    expect(buckets[2].map((f) => f.path)).toEqual(['server/c.ts']);
  });

  it('does not treat a sibling sharing the root prefix as inside the project', () => {
    const buckets = assignFilesToProfiles(
      [profile('app'), profile('other')],
      [reconFile('app-secondary/a.ts', 10)]
    );
    // Orphan → first profile
    expect(buckets[0].map((f) => f.path)).toEqual(['app-secondary/a.ts']);
    expect(buckets[1]).toEqual([]);
  });

  it('returns [] for no profiles', () => {
    expect(assignFilesToProfiles([], [reconFile('a.ts', 10)])).toEqual([]);
  });
});

describe('buildSurfaceViews', () => {
  it('returns one workspace-named default view when profiling found nothing', () => {
    const views = buildSurfaceViews([], [reconFile('a.ts', 15), reconFile('b.ts', 40)], 'Shop');
    expect(views).toEqual([
      { name: 'Shop', rootPath: '', specFiles: [], seedFileCount: 2, topSeedScore: 40 },
    ]);
  });

  it('produces one view per profile with per-surface seed stats and spec files', () => {
    const views = buildSurfaceViews(
      [profile('', ['openapi.yaml']), profile('server')],
      [reconFile('src/api.ts', 25), reconFile('server/routes.ts', 55)],
      'Shop'
    );
    expect(views).toEqual([
      { name: 'Shop', rootPath: '', specFiles: ['openapi.yaml'], seedFileCount: 1, topSeedScore: 25 },
      { name: 'server', rootPath: 'server', specFiles: [], seedFileCount: 1, topSeedScore: 55 },
    ]);
  });

  it('reports zero counts for a profile without seeds', () => {
    const views = buildSurfaceViews([profile('app'), profile('server')], [reconFile('server/r.ts', 30)], 'Shop');
    expect(views[0]).toMatchObject({ seedFileCount: 0, topSeedScore: 0 });
  });
});

describe('filterReconForRoots', () => {
  it('keeps only the requested surfaces and their files', () => {
    const shared = recon({
      profiles: [profile('app'), profile('server')],
      files: [reconFile('app/a.ts', 20), reconFile('server/b.ts', 30), reconFile('orphan.ts', 5)],
    });
    const filtered = filterReconForRoots(shared, ['server']);
    expect(filtered.profiles.map((p) => p.rootPath)).toEqual(['server']);
    expect(filtered.files.map((f) => f.path)).toEqual(['server/b.ts']);
    expect(filtered.appName).toBe('Shop');
    expect(filtered.scannedFileCount).toBe(25);
    // Orphans travel with the first profile's surface
    const appSide = filterReconForRoots(shared, ['app']);
    expect(appSide.files.map((f) => f.path)).toEqual(['app/a.ts', 'orphan.ts']);
  });

  it('returns a profile-less recon unchanged', () => {
    const shared = recon();
    expect(filterReconForRoots(shared, [])).toBe(shared);
  });
});

// ---------------------------------------------------------------------------
// Summary merging
// ---------------------------------------------------------------------------

describe('mergeScanSummaries', () => {
  it('returns a single summary untouched', () => {
    const only = summary();
    expect(mergeScanSummaries([only])).toBe(only);
  });

  it('merges routes with dedupe, recomputes counts, and unions surfaces/specFiles', () => {
    const shared = route('GET', '/health');
    const a = summary({
      routes: [route('GET', '/api/users'), shared, route('GET', '/api/fail', ['negative', '500'])],
      matchedFileCount: 3,
      chunkCount: 2,
      repairedCount: 1,
      droppedCount: 0,
      scannedFileCount: 25,
      surfaces: [{ name: 'app', routes: [shared], direction: 'consumes' }],
      specFiles: ['openapi.yaml'],
    });
    const b = summary({
      routes: [shared, route('POST', '/api/orders')],
      matchedFileCount: 2,
      chunkCount: 1,
      repairedCount: 0,
      droppedCount: 2,
      scannedFileCount: 30,
      surfaces: [{ name: 'server', routes: [shared], direction: 'serves' }],
      specFiles: ['openapi.yaml', 'schema.graphql'],
    });

    const merged = mergeScanSummaries([a, b]);
    expect(merged.routes.map((r) => r.name)).toEqual([
      'GET /api/users',
      'GET /health',
      'GET /api/fail',
      'POST /api/orders',
    ]);
    expect(merged.positiveCount).toBe(3);
    expect(merged.negativeCount).toBe(1);
    expect(merged.matchedFileCount).toBe(5);
    expect(merged.chunkCount).toBe(3);
    expect(merged.repairedCount).toBe(1);
    expect(merged.droppedCount).toBe(2);
    expect(merged.scannedFileCount).toBe(30);
    expect(merged.surfaces?.map((s) => s.name)).toEqual(['app', 'server']);
    expect(merged.specFiles).toEqual(['openapi.yaml', 'schema.graphql']);
  });

  it('omits surfaces/specFiles when no input summary carried them', () => {
    const merged = mergeScanSummaries([
      summary({ routes: [route('GET', '/a')] }),
      summary({ routes: [route('GET', '/b')] }),
    ]);
    expect(merged.surfaces).toBeUndefined();
    expect(merged.specFiles).toBeUndefined();
  });

  it('throws on an empty list', () => {
    expect(() => mergeScanSummaries([])).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ScanOrchestrator.generate
// ---------------------------------------------------------------------------

describe('ScanOrchestrator.generate', () => {
  it('computes the shared recon once and passes the same object to the fast scanner', async () => {
    const shared = recon();
    const deps = fakeDeps({ recon: shared });
    const result = await orchestrator(false, deps).generate({ scanMode: 'fast' });

    expect(deps.recon).toHaveBeenCalledTimes(1);
    expect(deps.fast.generate).toHaveBeenCalledTimes(1);
    expect(deps.fast.generate.mock.calls[0][0].recon).toBe(shared);
    expect(deps.agentic.generate).not.toHaveBeenCalled();
    expect(result.strategies).toEqual([
      { surface: 'Shop', strategy: 'fast', reason: expect.stringContaining('fast chunked scan') },
    ]);
  });

  it('delegates entirely to the agentic scanner (with the shared recon) under scanMode agentic + tools', async () => {
    const shared = recon();
    const deps = fakeDeps({ recon: shared, agenticSummary: summary({ routes: [route('GET', '/x')] }) });
    const result = await orchestrator(true, deps).generate({ scanMode: 'agentic' });

    expect(deps.agentic.generate).toHaveBeenCalledTimes(1);
    expect(deps.agentic.generate.mock.calls[0][0].recon).toBe(shared);
    expect(deps.fast.generate).not.toHaveBeenCalled();
    expect(result.strategies?.[0].strategy).toBe('agentic');
  });

  it('auto mode prefers agentic with tools and fast without', async () => {
    const withTools = fakeDeps({ recon: recon() });
    await orchestrator(true, withTools).generate({ scanMode: 'auto' });
    expect(withTools.agentic.generate).toHaveBeenCalledTimes(1);
    expect(withTools.fast.generate).not.toHaveBeenCalled();

    const withoutTools = fakeDeps({ recon: recon() });
    await orchestrator(false, withoutTools).generate({ scanMode: 'auto' });
    expect(withoutTools.fast.generate).toHaveBeenCalledTimes(1);
    expect(withoutTools.agentic.generate).not.toHaveBeenCalled();
  });

  it('escalates a zero-seed fast scan to agentic and logs the switch via onProgress', async () => {
    const deps = fakeDeps({ recon: recon({ files: [] }) });
    const messages: string[] = [];
    await orchestrator(true, deps).generate({
      scanMode: 'fast',
      onProgress: ({ message }) => messages.push(message),
    });
    expect(deps.agentic.generate).toHaveBeenCalledTimes(1);
    expect(deps.fast.generate).not.toHaveBeenCalled();
    expect(messages).toContain(AGENTIC_ESCALATION_MESSAGE);
  });

  it('reports census strategy for a zero-seed workspace on a tool-less provider (fast path handles it)', async () => {
    const deps = fakeDeps({ recon: recon({ files: [] }) });
    const result = await orchestrator(false, deps).generate({ scanMode: 'fast' });
    expect(deps.fast.generate).toHaveBeenCalledTimes(1);
    expect(result.strategies).toEqual([
      { surface: 'Shop', strategy: 'census', reason: expect.stringContaining('census') },
    ]);
  });

  it('reports spec strategy for surfaces with spec files while still scanning them', async () => {
    const deps = fakeDeps({
      recon: recon({ profiles: [profile('', ['openapi.yaml'])] }),
    });
    const result = await orchestrator(false, deps).generate({ scanMode: 'fast' });
    expect(result.strategies?.[0]).toMatchObject({ surface: 'Shop', strategy: 'spec' });
    expect(deps.fast.generate).toHaveBeenCalledTimes(1);
  });

  it('runs a single fast scan (no mixed split) for a seedless sub-surface under explicit fast + tools', async () => {
    const shared = recon({
      profiles: [profile('app'), profile('server')],
      files: [reconFile('app/src/api.ts', 40)], // server has no seeds → still covered by the fast scan
    });
    const deps = fakeDeps({ recon: shared });
    const result = await orchestrator(true, deps).generate({ scanMode: 'fast' });
    expect(deps.fast.generate).toHaveBeenCalledTimes(1);
    expect(deps.fast.generate.mock.calls[0][0].recon).toBe(shared);
    expect(deps.agentic.generate).not.toHaveBeenCalled();
    expect(result.strategies).toEqual([
      { surface: 'app', strategy: 'fast', reason: expect.stringContaining('fast chunked scan') },
      {
        surface: 'server',
        strategy: 'fast',
        reason: expect.stringContaining('covered by the workspace fast scan'),
      },
    ]);
  });

  it('re-plans without tools when the agentic scanner reports itself unavailable', async () => {
    const deps = fakeDeps({
      recon: recon(),
      agenticSummary: new AgenticScanUnavailableError('no tools after all'),
    });
    const result = await orchestrator(true, deps).generate({ scanMode: 'agentic' });
    expect(deps.agentic.generate).toHaveBeenCalledTimes(1);
    expect(deps.fast.generate).toHaveBeenCalledTimes(1);
    expect(result.strategies?.[0]).toMatchObject({ strategy: 'fast' });
  });

  it('propagates cancellation from a delegated scanner immediately', async () => {
    const cancel = new Error('Canceled');
    cancel.name = 'Canceled';
    const deps = fakeDeps({ recon: recon(), fastSummary: cancel });
    await expect(orchestrator(false, deps).generate({ scanMode: 'fast' })).rejects.toBe(cancel);
  });
});

// ---------------------------------------------------------------------------
// Mixed-strategy execution. decideStrategy no longer produces mixed plans on
// its own (explicit fast stays fast, auto/agentic go all-agentic), so these
// drive the private execute directly — the machinery must stay correct for
// injected strategy plans.
// ---------------------------------------------------------------------------

describe('ScanOrchestrator mixed-strategy execution', () => {
  type Progress = { message: string; fraction: number };
  type ExecuteFn = (
    views: ReturnType<typeof buildSurfaceViews>,
    decisions: StrategyDecision[],
    recon: WorkspaceRecon,
    options: { onProgress?: (p: Progress) => void } | undefined,
    report: (message: string, fraction: number) => void
  ) => Promise<CodebaseScanSummary>;

  function mixedRun(deps: FakeDeps, onProgress?: (p: Progress) => void) {
    const shared = recon({
      profiles: [profile('app'), profile('server')],
      files: [reconFile('app/src/api.ts', 40)],
    });
    const views = buildSurfaceViews(shared.profiles, shared.files, shared.appName);
    const decisions: StrategyDecision[] = [
      { strategy: 'fast', executeAs: 'fast', reason: 'strong seeds' },
      { strategy: 'agentic', executeAs: 'agentic', reason: 'exploration requested' },
    ];
    const exec = orchestrator(true, deps) as unknown as { execute: ExecuteFn };
    return exec.execute(views, decisions, shared, { onProgress }, (message, fraction) =>
      onProgress?.({ message, fraction })
    );
  }

  it('splits mixed workspaces: filtered recon per branch, merged summary, both strategies reported', async () => {
    const fastSummary = summary({
      routes: [route('GET', '/api/profile')],
      matchedFileCount: 1,
      surfaces: [{ name: 'app', routes: [route('GET', '/api/profile')], direction: 'consumes' }],
    });
    const agenticSummary = summary({
      routes: [route('GET', '/api/orders')],
      matchedFileCount: 0,
      surfaces: [{ name: 'server', routes: [route('GET', '/api/orders')], direction: 'serves' }],
    });
    const deps = fakeDeps({ recon: recon(), fastSummary, agenticSummary });

    const result = await mixedRun(deps);

    const fastRecon = deps.fast.generate.mock.calls[0][0].recon as WorkspaceRecon;
    expect(fastRecon.profiles.map((p: ProjectProfile) => p.rootPath)).toEqual(['app']);
    expect(fastRecon.files.map((f: ReconFile) => f.path)).toEqual(['app/src/api.ts']);
    const agenticRecon = deps.agentic.generate.mock.calls[0][0].recon as WorkspaceRecon;
    expect(agenticRecon.profiles.map((p: ProjectProfile) => p.rootPath)).toEqual(['server']);
    expect(agenticRecon.files).toEqual([]);

    expect(result.routes.map((r) => r.name)).toEqual(['GET /api/profile', 'GET /api/orders']);
    expect(result.surfaces?.map((s) => s.name)).toEqual(['app', 'server']);
    expect(result.strategies).toEqual([
      { surface: 'app', strategy: 'fast', reason: 'strong seeds' },
      { surface: 'server', strategy: 'agentic', reason: 'exploration requested' },
    ]);
  });

  it('keeps the surviving branch when the other fails in mixed mode', async () => {
    const agenticSummary = summary({ routes: [route('GET', '/api/orders')] });
    const deps = fakeDeps({
      recon: recon(),
      fastSummary: new Error('fast exploded'),
      agenticSummary,
    });
    const result = await mixedRun(deps);
    expect(result.routes.map((r) => r.name)).toEqual(['GET /api/orders']);
    expect(result.strategies).toHaveLength(2);
  });

  it('throws the first branch error when every branch fails in mixed mode', async () => {
    const deps = fakeDeps({
      recon: recon(),
      fastSummary: new Error('fast exploded'),
      agenticSummary: new Error('agentic exploded'),
    });
    await expect(mixedRun(deps)).rejects.toThrow('fast exploded');
  });

  it('rescans the agentic surfaces with the fast scanner when the agentic branch reports itself unavailable', async () => {
    const deps = fakeDeps({
      recon: recon(),
      agenticSummary: new AgenticScanUnavailableError('no tools after all'),
    });
    deps.fast.generate
      .mockResolvedValueOnce(summary({ routes: [route('GET', '/api/profile')] }))
      .mockResolvedValueOnce(summary({ routes: [route('GET', '/api/orders')] }));

    const result = await mixedRun(deps);

    // Second fast call covers exactly the agentic surfaces' recon slice.
    expect(deps.fast.generate).toHaveBeenCalledTimes(2);
    const fallbackRecon = deps.fast.generate.mock.calls[1][0].recon as WorkspaceRecon;
    expect(fallbackRecon.profiles.map((p: ProjectProfile) => p.rootPath)).toEqual(['server']);
    // Nothing is silently dropped, and the report matches what actually ran.
    expect(result.routes.map((r) => r.name)).toEqual(['GET /api/profile', 'GET /api/orders']);
    expect(result.strategies).toEqual([
      { surface: 'app', strategy: 'fast', reason: 'strong seeds' },
      {
        surface: 'server',
        strategy: 'fast',
        reason: expect.stringContaining('rescanned with the fast scan'),
      },
    ]);
  });

  it('annotates the strategy report when the agentic branch fails for other reasons', async () => {
    const deps = fakeDeps({
      recon: recon(),
      fastSummary: summary({ routes: [route('GET', '/api/profile')] }),
      agenticSummary: new Error('budget exhausted'),
    });
    const result = await mixedRun(deps);
    expect(deps.fast.generate).toHaveBeenCalledTimes(1);
    expect(result.routes.map((r) => r.name)).toEqual(['GET /api/profile']);
    expect(result.strategies?.[1]).toEqual({
      surface: 'server',
      strategy: 'agentic',
      reason: expect.stringContaining('WARNING: the agentic scan of this surface failed'),
    });
  });

  it('scales mixed-mode progress fractions into disjoint slices after the recon', async () => {
    const fractions: number[] = [];
    const deps = fakeDeps({ recon: recon() });
    deps.fast.generate.mockImplementation(async (opts: { onProgress?: (p: Progress) => void }) => {
      opts.onProgress?.({ message: 'fast working', fraction: 0.5 });
      return summary({ routes: [route('GET', '/a')] });
    });
    deps.agentic.generate.mockImplementation(async (opts: { onProgress?: (p: Progress) => void }) => {
      opts.onProgress?.({ message: 'agentic working', fraction: 0.5 });
      return summary({ routes: [route('GET', '/b')] });
    });
    await mixedRun(deps, ({ fraction }) => fractions.push(fraction));
    // fast slice [0.15, 0.55] at 0.5 → 0.35; agentic slice [0.55, 0.95] at 0.5 → 0.75
    expect(fractions).toContain(0.15 + 0.4 * 0.5);
    expect(fractions).toContain(0.55 + 0.4 * 0.5);
  });
});
