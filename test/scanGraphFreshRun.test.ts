import { describe, it, expect } from 'vitest';
import {
  runScanGraph,
  type LoopCancellation,
  type ScanGraphAi,
  type ScanGraphDeps,
} from '../src/ai/agent/scanGraph';
import { createInMemoryCheckpointStorage } from '../src/ai/agent/graphRuntime';
import type {
  AiToolDefinition,
  AiToolExecutor,
  AiToolLoopOptions,
} from '../src/ai/providers/types';
import type { ReconFile, WorkspaceRecon } from '../src/ai/CodebaseMockGenerator';
import type { ProjectProfile } from '../src/ai/scan/projectProfile';
import type { WorkspaceTools } from '../src/ai/agent/workspaceTools';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function profile(rootPath: string): ProjectProfile {
  return { rootPath, kind: 'web', frameworks: ['react'], direction: 'consumes', confidence: 'high', specFiles: [], evidence: [] } as ProjectProfile;
}
function reconFile(path: string, score = 40): ReconFile {
  return { path, score, snippet: `fetch('/api/things')`, clientScore: score, serverScore: 0, importPaths: [], typeNames: [] } as ReconFile;
}
function reconOf(roots: string[]): WorkspaceRecon {
  return { appName: 'Shop', profiles: roots.map(profile), files: roots.map((r) => reconFile(r === '' ? 'src/api.ts' : `${r}/src/api.ts`)), scannedFileCount: 42 };
}
function rawRoute(name: string, path: string): Record<string, unknown> {
  return { name, enabled: true, method: 'GET', path, response: { type: 'static', statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: { contentType: 'application/json', content: { ok: name } } }, tags: ['things'] };
}
function fakeTools(): WorkspaceTools {
  return { definitions: [{ name: 'read_file', description: 'read a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } }], execute: async () => 'contents', stats: () => ({ toolCalls: 0, bytesRead: 0, filesRead: 0 }) } as WorkspaceTools;
}
function fakeLoopCancellation(): LoopCancellation {
  let cancelled = false;
  const listeners: Array<(e: unknown) => unknown> = [];
  return {
    token: { get isCancellationRequested() { return cancelled; }, onCancellationRequested(l: (e: unknown) => unknown) { listeners.push(l); return { dispose: () => undefined }; } } as never,
    cancel: () => { if (!cancelled) { cancelled = true; listeners.forEach((l) => l(undefined)); } },
    dispose: () => undefined,
  };
}
function surfaceFromPrompt(prompt: string): string {
  return /### Surface "([^"]+)"/.exec(prompt)?.[1] ?? '';
}

class FakeAi implements ScanGraphAi {
  exploreCounts = new Map<string, number>();
  onExplore: (surface: string, execute: AiToolExecutor) => Promise<string> = async () => 'done';
  async runToolLoop(prompt: string, tools: AiToolDefinition[], execute: AiToolExecutor, _o?: AiToolLoopOptions): Promise<string> {
    if (tools.some((t) => t.name === 'submit_verdicts')) {
      const keys = [...prompt.matchAll(/routeKey "([^"]+)"/g)].map((m) => m[1]);
      await execute({ name: 'submit_verdicts', input: { verdicts: keys.map((routeKey) => ({ routeKey, verdict: 'confirmed' })) } });
      return 'done';
    }
    const surface = surfaceFromPrompt(prompt) || 'census';
    this.exploreCounts.set(surface, (this.exploreCounts.get(surface) ?? 0) + 1);
    await sleep(5);
    return this.onExplore(surface, execute);
  }
  async sendJsonRequest<T = unknown>(): Promise<T> { throw new Error('unexpected repair'); }
}

function makeDeps(ai: FakeAi, recon: WorkspaceRecon, storage: ReturnType<typeof createInMemoryCheckpointStorage>): ScanGraphDeps {
  return { ai, recon: async () => recon, census: async () => 'census', createTools: () => fakeTools(), memory: { load: async () => null, save: async () => undefined }, createLoopCancellation: fakeLoopCancellation, storage };
}

describe('fresh scan on a thread whose earlier WAVE was checkpointed', () => {
  it('re-explores wave-1 surfaces on Start Fresh', async () => {
    // 4 surfaces => wave 1 = a,b,c; wave 2 = d. Abort during wave 2, so wave 1
    // results ARE committed in a checkpoint.
    const roots = ['apps/a', 'apps/b', 'apps/c', 'apps/d'];
    const ai = new FakeAi();
    let firstRun = true;
    ai.onExplore = async (surface, execute) => {
      if (surface === 'apps/d' && firstRun) {
        const abort = new Error('The scan was cancelled.');
        abort.name = 'AbortError';
        throw abort;
      }
      await execute({
        name: 'submit_routes',
        input: { routes: [rawRoute(`${firstRun ? 'OLD' : 'NEW'} ${surface}`, `/api/${firstRun ? 'old' : 'new'}-${surface.replace(/\W+/g, '-')}`)] },
      });
      return 'done';
    };
    const storage = createInMemoryCheckpointStorage();
    const deps = makeDeps(ai, reconOf(roots), storage);

    await expect(runScanGraph(ai, { deps, threadId: 'ws-thread' })).rejects.toThrow();
    console.log('run1 explore counts:', [...ai.exploreCounts.entries()]);

    firstRun = false;
    const summary = await runScanGraph(ai, { deps, threadId: 'ws-thread' });
    console.log('explore counts after fresh run:', [...ai.exploreCounts.entries()]);
    console.log('final routes:', summary.routes.map((r) => r.path).sort());

    expect(ai.exploreCounts.get('apps/a')).toBe(2);
    expect(summary.routes.map((r) => r.path).sort()).toEqual([
      '/api/new-apps-a', '/api/new-apps-b', '/api/new-apps-c', '/api/new-apps-d',
    ]);
  });
});
