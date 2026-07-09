import { describe, it, expect } from 'vitest';
import {
  deriveScanThreadId,
  hasResumableScan,
  runScanGraph,
  type LoopCancellation,
  type ScanGraphAi,
  type ScanGraphDeps,
} from '../src/ai/agent/scanGraph';
import { createInMemoryCheckpointStorage } from '../src/ai/agent/graphRuntime';
import type { AiToolDefinition, AiToolExecutor, AiToolLoopOptions } from '../src/ai/providers/types';
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
  return { appName: 'Shop', profiles: roots.map(profile), files: roots.map((r) => reconFile(`${r}/src/api.ts`)), scannedFileCount: 42 };
}
function rawRoute(name: string, path: string): Record<string, unknown> {
  return { name, enabled: true, method: 'GET', path, response: { type: 'static', statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: { contentType: 'application/json', content: { ok: name } } }, tags: ['things'] };
}
function fakeTools(): WorkspaceTools {
  return { definitions: [{ name: 'read_file', description: 'r', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } }], execute: async () => 'contents', stats: () => ({ toolCalls: 0, bytesRead: 0, filesRead: 0 }) } as WorkspaceTools;
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
function fakeUserToken() {
  let cancelled = false;
  const listeners: Array<(e: unknown) => unknown> = [];
  return {
    token: { get isCancellationRequested() { return cancelled; }, onCancellationRequested(l: (e: unknown) => unknown) { listeners.push(l); return { dispose: () => undefined }; } },
    cancel: () => { cancelled = true; listeners.forEach((l) => l(undefined)); },
  };
}
function surfaceFromPrompt(prompt: string): string {
  return /### Surface "([^"]+)"/.exec(prompt)?.[1] ?? '';
}

class FakeAi implements ScanGraphAi {
  exploreCounts = new Map<string, number>();
  onExplore: (surface: string, execute: AiToolExecutor, options?: AiToolLoopOptions) => Promise<string> = async () => 'done';
  async runToolLoop(prompt: string, tools: AiToolDefinition[], execute: AiToolExecutor, options?: AiToolLoopOptions): Promise<string> {
    if (tools.some((t) => t.name === 'submit_verdicts')) return 'done';
    const surface = surfaceFromPrompt(prompt) || 'census';
    this.exploreCounts.set(surface, (this.exploreCounts.get(surface) ?? 0) + 1);
    return this.onExplore(surface, execute, options);
  }
  async sendJsonRequest<T = unknown>(): Promise<T> { throw new Error('unexpected'); }
}

describe('user cancellation while a provider returns gracefully', () => {
  it('does not mark the cancelled surface as completed in the checkpoint', async () => {
    const ai = new FakeAi();
    const user = fakeUserToken();
    ai.onExplore = async (surface, execute, options) => {
      if (surface === 'apps/a') {
        // finishes quickly
        await execute({ name: 'submit_routes', input: { routes: [rawRoute('a', '/api/a')] } });
        return 'done';
      }
      // apps/b: user cancels mid-loop; provider returns lastText gracefully
      // (CopilotService/ClaudeProvider behavior — no throw).
      while (!options?.token?.isCancellationRequested) {
        await sleep(5);
      }
      return ''; // graceful return, nothing submitted
    };
    const storage = createInMemoryCheckpointStorage();
    const deps: ScanGraphDeps = { ai, recon: async () => reconOf(['apps/a', 'apps/b']), census: async () => 'census', createTools: () => fakeTools(), memory: { load: async () => null, save: async () => undefined }, createLoopCancellation: fakeLoopCancellation, storage };

    setTimeout(() => user.cancel(), 50);
    let outcome: string;
    try {
      const s = await runScanGraph(ai, { deps, threadId: deriveScanThreadId('/ws'), token: user.token as never });
      outcome = `completed: ${s.routes.map((r) => r.path).join(',')}`;
    } catch (e) {
      outcome = `threw: ${(e as Error).name}: ${(e as Error).message}`;
    }
    console.log('outcome:', outcome);
    const info = await hasResumableScan('/ws', { storage });
    console.log('resumable info:', info);
    expect(info).not.toBeNull();
    // apps/b must NOT be counted completed
    expect(info?.completedSurfaces).toBe(1);
  });
});
