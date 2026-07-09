import { describe, it, expect, vi } from 'vitest';
import { Annotation, START, END, StateGraph } from '@langchain/langgraph';
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import {
  askHuman,
  cancellationTokenToAbortSignal,
  createFileCheckpointStorage,
  createInMemoryCheckpointStorage,
  createScanGraphRuntime,
  humanizeNodeName,
  sanitizeThreadId,
  toHumanQuestion,
  FileCheckpointSaver,
  GraphRuntimeError,
  MAX_CHECKPOINT_FILES,
  type CancellationTokenLike,
  type CheckpointFsAdapter,
  type CheckpointStorage,
  type GraphProgressEvent,
  type HumanQuestion,
} from '../src/ai/agent/graphRuntime';
import type { Checkpoint, CheckpointMetadata } from '@langchain/langgraph';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMemoryFs(): {
  files: Map<string, { data: Uint8Array; mtime: number }>;
  adapter: CheckpointFsAdapter;
} {
  const files = new Map<string, { data: Uint8Array; mtime: number }>();
  let clock = 0;
  const adapter: CheckpointFsAdapter = {
    async ensureDir() {
      // no-op for memory
    },
    async readFile(name) {
      const file = files.get(name);
      if (!file) {
        throw new Error(`ENOENT: ${name}`);
      }
      return file.data;
    },
    async writeFile(name, data) {
      files.set(name, { data, mtime: ++clock });
    },
    async deleteFile(name) {
      if (!files.delete(name)) {
        throw new Error(`ENOENT: ${name}`);
      }
    },
    async listFiles() {
      return [...files.entries()].map(([name, f]) => ({
        name,
        mtime: f.mtime,
        size: f.data.length,
      }));
    },
  };
  return { files, adapter };
}

let checkpointCounter = 0;

/** Minimal valid Checkpoint; ids sort lexicographically by creation order. */
function makeCheckpoint(payload: unknown = 'x'): Checkpoint {
  checkpointCounter += 1;
  return {
    v: 4,
    id: `00000000-0000-6000-8000-${String(checkpointCounter).padStart(12, '0')}`,
    ts: new Date().toISOString(),
    channel_values: { data: payload },
    channel_versions: { data: 1 },
    versions_seen: {},
  };
}

const META: CheckpointMetadata = { source: 'input', step: -1, parents: {} };

function threadConfig(threadId: string, checkpointId?: string) {
  return {
    configurable: {
      thread_id: threadId,
      checkpoint_ns: '',
      ...(checkpointId ? { checkpoint_id: checkpointId } : {}),
    },
  };
}

class FakeCancellationToken implements CancellationTokenLike {
  isCancellationRequested = false;
  private listeners = new Set<(e: unknown) => unknown>();

  onCancellationRequested(listener: (e: unknown) => unknown) {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  cancel(): void {
    this.isCancellationRequested = true;
    for (const listener of this.listeners) {
      listener(undefined);
    }
  }
}

// ---------------------------------------------------------------------------
// sanitizeThreadId / humanizeNodeName / toHumanQuestion
// ---------------------------------------------------------------------------

describe('sanitizeThreadId', () => {
  it('strips path separators and traversal', () => {
    expect(sanitizeThreadId('../../etc/passwd')).not.toContain('/');
    expect(sanitizeThreadId('../../etc/passwd').startsWith('.')).toBe(false);
    expect(sanitizeThreadId('a/b\\c:d')).toBe('a_b_c_d');
  });

  it('bounds length and never returns empty', () => {
    expect(sanitizeThreadId('x'.repeat(500))).toHaveLength(100);
    expect(sanitizeThreadId('')).toBe('thread');
    expect(sanitizeThreadId('///')).toBe('___');
  });

  it('keeps safe ids unchanged', () => {
    expect(sanitizeThreadId('scan-abc123_v2.final')).toBe('scan-abc123_v2.final');
  });
});

describe('humanizeNodeName', () => {
  it('splits camelCase and snake_case into a sentence', () => {
    expect(humanizeNodeName('analyzeProjectShape')).toBe('Analyze project shape');
    expect(humanizeNodeName('submit_routes')).toBe('Submit routes');
    expect(humanizeNodeName('recon')).toBe('Recon');
  });
});

describe('toHumanQuestion', () => {
  it('passes through a well-formed question', () => {
    const q = toHumanQuestion({ id: 'q1', question: 'Which surface?', options: ['a', 'b'] });
    expect(q).toEqual({ id: 'q1', question: 'Which surface?', options: ['a', 'b'], freeText: undefined });
  });

  it('fills a missing id and drops non-string options', () => {
    const q = toHumanQuestion({ question: 'Pick one', options: ['a', 42, 'b'] });
    expect(q.id).toMatch(/^question-\d+$/);
    expect(q.options).toEqual(['a', 'b']);
  });

  it('wraps arbitrary values as free-text questions without throwing', () => {
    const q = toHumanQuestion('plain string');
    expect(q.question).toBe('plain string');
    expect(q.freeText).toBe(true);
    expect(toHumanQuestion(null).question).toBe('');
  });
});

// ---------------------------------------------------------------------------
// createFileCheckpointStorage (pure impl over injected fs)
// ---------------------------------------------------------------------------

describe('createFileCheckpointStorage', () => {
  it('round-trips write/read/delete/list', async () => {
    const { adapter } = makeMemoryFs();
    const storage = createFileCheckpointStorage(adapter);
    await storage.write('t1', '{"hello":"world"}');
    expect(await storage.read('t1')).toBe('{"hello":"world"}');
    const entries = await storage.list();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('t1');
    expect(entries[0].size).toBeGreaterThan(0);
    await storage.delete('t1');
    expect(await storage.read('t1')).toBeUndefined();
    expect(await storage.list()).toHaveLength(0);
  });

  it('sanitizes ids consistently across operations', async () => {
    const { files, adapter } = makeMemoryFs();
    const storage = createFileCheckpointStorage(adapter);
    await storage.write('a/b:c', 'data');
    expect([...files.keys()]).toEqual(['a_b_c.json']);
    expect(await storage.read('a/b:c')).toBe('data');
  });

  it('never throws on missing reads or double deletes', async () => {
    const { adapter } = makeMemoryFs();
    const storage = createFileCheckpointStorage(adapter);
    expect(await storage.read('nope')).toBeUndefined();
    await expect(storage.delete('nope')).resolves.toBeUndefined();
  });

  it('returns [] from list when the directory listing fails', async () => {
    const { adapter } = makeMemoryFs();
    adapter.listFiles = async () => {
      throw new Error('EACCES');
    };
    const storage = createFileCheckpointStorage(adapter);
    expect(await storage.list()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// FileCheckpointSaver
// ---------------------------------------------------------------------------

describe('FileCheckpointSaver', () => {
  it('round-trips a checkpoint plus pending writes across saver instances', async () => {
    const storage = createInMemoryCheckpointStorage();
    const saver1 = new FileCheckpointSaver(storage);
    const cp = makeCheckpoint({ routes: ['GET /users'] });
    const returned = await saver1.put(threadConfig('t1'), cp, META, {});
    expect(returned.configurable?.checkpoint_id).toBe(cp.id);
    await saver1.putWrites(threadConfig('t1', cp.id), [['data', { next: true }]], 'task-1');

    // A fresh saver over the same storage proves persistence (not just cache).
    const saver2 = new FileCheckpointSaver(storage);
    const tuple = await saver2.getTuple(threadConfig('t1'));
    expect(tuple).toBeDefined();
    expect(tuple?.checkpoint.id).toBe(cp.id);
    expect(tuple?.checkpoint.channel_values).toEqual({ data: { routes: ['GET /users'] } });
    expect(tuple?.metadata).toEqual(META);
    expect(tuple?.pendingWrites).toEqual([['task-1', 'data', { next: true }]]);
    expect(tuple?.parentConfig).toBeUndefined();
  });

  it('returns the newest checkpoint when no id is requested, with parentConfig', async () => {
    const storage = createInMemoryCheckpointStorage();
    const saver = new FileCheckpointSaver(storage);
    const first = makeCheckpoint('one');
    const second = makeCheckpoint('two');
    const config1 = await saver.put(threadConfig('t1'), first, META, {});
    await saver.put(config1, second, META, {});

    const latest = await saver.getTuple(threadConfig('t1'));
    expect(latest?.checkpoint.id).toBe(second.id);
    expect(latest?.parentConfig?.configurable?.checkpoint_id).toBe(first.id);

    const byId = await saver.getTuple(threadConfig('t1', first.id));
    expect(byId?.checkpoint.id).toBe(first.id);
  });

  it('lists checkpoints newest-first with limit and before', async () => {
    const saver = new FileCheckpointSaver(createInMemoryCheckpointStorage());
    const cps = [makeCheckpoint(1), makeCheckpoint(2), makeCheckpoint(3)];
    let config = threadConfig('t1');
    for (const cp of cps) {
      config = (await saver.put(config, cp, META, {})) as ReturnType<typeof threadConfig>;
    }
    const all: string[] = [];
    for await (const tuple of saver.list(threadConfig('t1'))) {
      all.push(tuple.checkpoint.id);
    }
    expect(all).toEqual([cps[2].id, cps[1].id, cps[0].id]);

    const limited: string[] = [];
    for await (const tuple of saver.list(threadConfig('t1'), { limit: 1 })) {
      limited.push(tuple.checkpoint.id);
    }
    expect(limited).toEqual([cps[2].id]);

    const before: string[] = [];
    for await (const tuple of saver.list(threadConfig('t1'), {
      before: threadConfig('t1', cps[1].id),
    })) {
      before.push(tuple.checkpoint.id);
    }
    expect(before).toEqual([cps[0].id]);
  });

  it('evicts oldest checkpoints when the thread file exceeds the size cap', async () => {
    const storage = createInMemoryCheckpointStorage();
    const warnings: string[] = [];
    const saver = new FileCheckpointSaver(storage, {
      maxFileBytes: 3000,
      onWarning: (m) => warnings.push(m),
    });
    const cps = Array.from({ length: 5 }, (_, i) => makeCheckpoint(`${i}-${'x'.repeat(800)}`));
    let config = threadConfig('big');
    for (const cp of cps) {
      config = (await saver.put(config, cp, META, {})) as ReturnType<typeof threadConfig>;
    }
    const raw = await storage.read('big');
    expect(raw).toBeDefined();
    expect(new TextEncoder().encode(raw as string).length).toBeLessThanOrEqual(3000);

    // Newest survives; oldest were evicted.
    const fresh = new FileCheckpointSaver(storage, { maxFileBytes: 3000 });
    expect((await fresh.getTuple(threadConfig('big')))?.checkpoint.id).toBe(cps[4].id);
    expect(await fresh.getTuple(threadConfig('big', cps[0].id))).toBeUndefined();
  });

  it('keeps a single oversized checkpoint in memory only, with a warning', async () => {
    const storage = createInMemoryCheckpointStorage();
    const warnings: string[] = [];
    const saver = new FileCheckpointSaver(storage, {
      maxFileBytes: 300,
      onWarning: (m) => warnings.push(m),
    });
    const huge = makeCheckpoint('y'.repeat(5000));
    await expect(saver.put(threadConfig('t1'), huge, META, {})).resolves.toBeDefined();
    expect(warnings.some((w) => w.includes('kept in memory only'))).toBe(true);
    // Same-run cache still serves it...
    expect((await saver.getTuple(threadConfig('t1')))?.checkpoint.id).toBe(huge.id);
    // ...but nothing was persisted: a fresh saver starts fresh.
    expect(await storage.read('t1')).toBeUndefined();
    const fresh = new FileCheckpointSaver(storage, { maxFileBytes: 300 });
    expect(await fresh.getTuple(threadConfig('t1'))).toBeUndefined();
  });

  it('degrades to fresh start on corrupt checkpoint files (never throws)', async () => {
    const storage = createInMemoryCheckpointStorage();
    await storage.write('bad', 'not json {{{');
    const warnings: string[] = [];
    const saver = new FileCheckpointSaver(storage, { onWarning: (m) => warnings.push(m) });
    await expect(saver.getTuple(threadConfig('bad'))).resolves.toBeUndefined();
    expect(warnings.some((w) => w.includes('corrupt'))).toBe(true);
  });

  it('degrades to fresh start on wrong-shape and oversized files', async () => {
    const storage = createInMemoryCheckpointStorage();
    await storage.write('shape', JSON.stringify({ v: 99, nonsense: true }));
    const saver = new FileCheckpointSaver(storage);
    expect(await saver.getTuple(threadConfig('shape'))).toBeUndefined();

    const storage2 = createInMemoryCheckpointStorage();
    await storage2.write('fat', 'a'.repeat(600));
    const saver2 = new FileCheckpointSaver(storage2, { maxFileBytes: 500 });
    expect(await saver2.getTuple(threadConfig('fat'))).toBeUndefined();
  });

  it('swallows storage write failures and keeps serving from memory', async () => {
    const storage = createInMemoryCheckpointStorage();
    const failing: CheckpointStorage = {
      ...storage,
      write: async () => {
        throw new Error('disk full');
      },
    };
    const warnings: string[] = [];
    const saver = new FileCheckpointSaver(failing, { onWarning: (m) => warnings.push(m) });
    const cp = makeCheckpoint('v');
    await expect(saver.put(threadConfig('t1'), cp, META, {})).resolves.toBeDefined();
    expect(warnings.some((w) => w.includes('disk full'))).toBe(true);
    expect((await saver.getTuple(threadConfig('t1')))?.checkpoint.id).toBe(cp.id);
  });

  it(`keeps at most ${MAX_CHECKPOINT_FILES} thread files, evicting oldest`, async () => {
    const storage = createInMemoryCheckpointStorage();
    const saver = new FileCheckpointSaver(storage);
    for (let i = 1; i <= 7; i++) {
      await saver.put(threadConfig(`thread-${i}`), makeCheckpoint(i), META, {});
    }
    const remaining = (await storage.list()).map((e) => e.id).sort();
    expect(remaining).toHaveLength(MAX_CHECKPOINT_FILES);
    expect(remaining).toEqual(['thread-3', 'thread-4', 'thread-5', 'thread-6', 'thread-7']);
  });

  it('deleteThread removes the persisted file and the cache entry', async () => {
    const storage = createInMemoryCheckpointStorage();
    const saver = new FileCheckpointSaver(storage);
    await saver.put(threadConfig('gone'), makeCheckpoint('z'), META, {});
    expect(await storage.read('gone')).toBeDefined();
    await saver.deleteThread('gone');
    expect(await storage.read('gone')).toBeUndefined();
    expect(await saver.getTuple(threadConfig('gone'))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Cancellation bridge
// ---------------------------------------------------------------------------

describe('cancellationTokenToAbortSignal', () => {
  it('aborts the signal when the token fires', () => {
    const token = new FakeCancellationToken();
    const bridge = cancellationTokenToAbortSignal(token);
    expect(bridge.signal.aborted).toBe(false);
    token.cancel();
    expect(bridge.signal.aborted).toBe(true);
  });

  it('is immediately aborted for a pre-cancelled token', () => {
    const token = new FakeCancellationToken();
    token.cancel();
    const bridge = cancellationTokenToAbortSignal(token);
    expect(bridge.signal.aborted).toBe(true);
  });

  it('dispose unsubscribes so later cancellation does not abort', () => {
    const token = new FakeCancellationToken();
    const bridge = cancellationTokenToAbortSignal(token);
    bridge.dispose();
    token.cancel();
    expect(bridge.signal.aborted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createScanGraphRuntime — real StateGraph under vitest
// ---------------------------------------------------------------------------

const ScanState = Annotation.Root({
  steps: Annotation<string[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  answer: Annotation<string>,
});

function buildAskGraph() {
  return new StateGraph(ScanState)
    .addNode('plan', async () => ({ steps: ['plan'] }))
    .addNode('askSurface', async () => {
      const answer = await askHuman({
        id: 'surface',
        question: 'Which surface should I scan?',
        options: ['rest', 'graphql'],
      });
      return { answer, steps: ['askSurface'] };
    })
    .addNode('finish', async () => ({ steps: ['finish'] }))
    .addEdge(START, 'plan')
    .addEdge('plan', 'askSurface')
    .addEdge('askSurface', 'finish')
    .addEdge('finish', END);
}

describe('createScanGraphRuntime', () => {
  it('runs a 3-node graph through interrupt → onQuestion → resume', async () => {
    const questions: HumanQuestion[] = [];
    const progress: GraphProgressEvent[] = [];
    const runtime = createScanGraphRuntime({
      storage: createInMemoryCheckpointStorage(),
      threadId: 'ask-test',
      onQuestion: async (q) => {
        questions.push(q);
        return 'graphql';
      },
      onProgress: (e) => progress.push(e),
      nodeLabels: { plan: 'Planning the scan' },
    });

    const result = await runtime.run<typeof ScanState.State>(buildAskGraph(), { steps: [] });

    expect(result.answer).toBe('graphql');
    expect(result.steps).toEqual(['plan', 'askSurface', 'finish']);
    expect(questions).toHaveLength(1);
    expect(questions[0].question).toBe('Which surface should I scan?');
    expect(questions[0].options).toEqual(['rest', 'graphql']);

    const nodes = progress.map((p) => p.node);
    expect(nodes).toEqual(['plan', 'askSurface', 'finish']);
    expect(progress[0].label).toBe('Planning the scan'); // from the caller's map
    expect(progress[1].label).toBe('Ask surface'); // humanized fallback
  });

  it('persists checkpoints through the runtime checkpointer during the run', async () => {
    const storage = createInMemoryCheckpointStorage();
    const runtime = createScanGraphRuntime({
      storage,
      threadId: 'persist-test',
      onQuestion: () => 'rest',
    });
    await runtime.run(buildAskGraph(), { steps: [] });
    expect(await storage.read('persist-test')).toBeDefined();
    await runtime.deleteThread();
    expect(await storage.read('persist-test')).toBeUndefined();
  });

  it('rejects with a clear error when a question fires with no handler', async () => {
    const runtime = createScanGraphRuntime({ threadId: 'no-handler' });
    await expect(runtime.run(buildAskGraph(), { steps: [] })).rejects.toThrow(
      GraphRuntimeError
    );
    await expect(
      createScanGraphRuntime({ threadId: 'no-handler-2' }).run(buildAskGraph(), { steps: [] })
    ).rejects.toThrow(/no onQuestion handler/);
  });

  it('caps runaway question loops', async () => {
    const loopGraph = new StateGraph(ScanState)
      .addNode('nag', async () => {
        askHuman({ id: 'again', question: 'Are you sure?' });
        askHuman({ id: 'again2', question: 'Really sure?' });
        askHuman({ id: 'again3', question: 'Definitely?' });
        return { steps: ['nag'] };
      })
      .addEdge(START, 'nag')
      .addEdge('nag', END);
    const runtime = createScanGraphRuntime({
      threadId: 'nag-test',
      maxQuestionRounds: 2,
      onQuestion: () => 'yes',
    });
    await expect(runtime.run(loopGraph, { steps: [] })).rejects.toThrow(
      /more than 2 human questions/
    );
  });

  it('propagates cancellation into an in-flight node via config.signal', async () => {
    const token = new FakeCancellationToken();
    const sawSignal = vi.fn();
    const slowGraph = new StateGraph(ScanState)
      .addNode('slow', async (_state, config: LangGraphRunnableConfig) => {
        const signal = config.signal;
        sawSignal(signal instanceof AbortSignal);
        // Model AiService behavior: the in-flight call rejects on abort.
        await new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('AiService call aborted')), {
            once: true,
          });
        });
        return { steps: ['slow'] };
      })
      .addEdge(START, 'slow')
      .addEdge('slow', END);

    const runtime = createScanGraphRuntime({
      threadId: 'cancel-test',
      cancellationToken: token,
    });
    const running = runtime.run(slowGraph, { steps: [] });
    setTimeout(() => token.cancel(), 25);
    await expect(running).rejects.toThrow();
    expect(sawSignal).toHaveBeenCalledWith(true);
  });

  it('rejects immediately for a pre-cancelled token without starting the graph', async () => {
    const token = new FakeCancellationToken();
    token.cancel();
    const entered = vi.fn();
    const graph = new StateGraph(ScanState)
      .addNode('never', async () => {
        entered();
        return { steps: ['never'] };
      })
      .addEdge(START, 'never')
      .addEdge('never', END);
    const runtime = createScanGraphRuntime({ threadId: 'pre-cancel', cancellationToken: token });
    await expect(runtime.run(graph, { steps: [] })).rejects.toThrow(/cancelled/);
    expect(entered).not.toHaveBeenCalled();
  });

  it('accepts a pre-compiled graph and exposes its checkpointer for compile()', async () => {
    const runtime = createScanGraphRuntime({
      threadId: 'precompiled',
      onQuestion: () => 'rest',
    });
    const compiled = buildAskGraph().compile({ checkpointer: runtime.checkpointer });
    const result = await runtime.run<typeof ScanState.State>(compiled, { steps: [] });
    expect(result.answer).toBe('rest');
  });

  it('generates a thread id when none is provided', () => {
    const runtime = createScanGraphRuntime();
    expect(runtime.threadId).toMatch(/^scan-/);
  });
});
