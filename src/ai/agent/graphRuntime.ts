import type * as vscode from 'vscode';
import {
  BaseCheckpointSaver,
  Command,
  interrupt,
  isInterrupted,
  type Checkpoint,
  type CheckpointMetadata,
  type CheckpointTuple,
  type Interrupt,
  type LangGraphRunnableConfig,
} from '@langchain/langgraph';

/**
 * LangGraph runtime foundation for Mocklify scan graphs.
 *
 * LangGraph is ORCHESTRATION-ONLY in this codebase: this module wires
 * StateGraph plumbing (checkpointing, cancellation, interrupts, progress) and
 * knows nothing about models. Graph nodes are plain async functions that call
 * Mocklify's own AI layer; nothing model-related may ever live here.
 *
 * Pure logic — checkpoint file format, eviction, sanitization, the
 * cancellation bridge, and the run loop — is exported for unit tests; only
 * the thin adapter inside createVscodeCheckpointStorage touches vscode
 * (lazy require, same pattern as workspaceTools.ts).
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Workspace-relative directory where checkpoint files live. */
export const CHECKPOINT_DIR_SEGMENTS = ['.mocklify', 'checkpoints'] as const;
/** Hard cap on a single thread's checkpoint file. */
export const MAX_CHECKPOINT_FILE_BYTES = 2 * 1024 * 1024;
/** Keep at most this many thread checkpoint files; oldest are evicted. */
export const MAX_CHECKPOINT_FILES = 5;
/** Safety valve on interrupt→ask→resume cycles within a single run. */
export const DEFAULT_MAX_QUESTION_ROUNDS = 25;
/** Configurable key under which nodes find the caller's cancellation token. */
export const CONFIG_KEY_CANCELLATION_TOKEN = 'mocklify_cancellation_token';

/** Special LangGraph write channels keep fixed slots (mirrors WRITES_IDX_MAP). */
const WRITE_CHANNEL_IDX: Record<string, number> = {
  __error__: -1,
  __scheduled__: -2,
  __interrupt__: -3,
  __resume__: -4,
};

// ---------------------------------------------------------------------------
// Storage adapter
// ---------------------------------------------------------------------------

export interface CheckpointStorageEntry {
  id: string;
  mtime: number;
  size: number;
}

/**
 * Where serialized thread checkpoints live. Implementations must be
 * forgiving: read() returns undefined for missing/unreadable entries,
 * delete() swallows "not found", list() returns [] on failure. Only write()
 * may reject (the saver degrades to in-memory when it does).
 */
export interface CheckpointStorage {
  read(id: string): Promise<string | undefined>;
  write(id: string, data: string): Promise<void>;
  delete(id: string): Promise<void>;
  list(): Promise<CheckpointStorageEntry[]>;
}

/** Minimal file-system surface the pure storage impl is built on. */
export interface CheckpointFsAdapter {
  /** Create the checkpoint directory (recursive, idempotent). */
  ensureDir(): Promise<void>;
  /** Read a file by name within the checkpoint dir; throws if missing. */
  readFile(name: string): Promise<Uint8Array>;
  writeFile(name: string, data: Uint8Array): Promise<void>;
  deleteFile(name: string): Promise<void>;
  listFiles(): Promise<Array<{ name: string; mtime: number; size: number }>>;
}

/**
 * Turn a caller-supplied thread id into a safe file base name: no path
 * separators, no traversal, bounded length. Distinct ids can collide after
 * sanitization; callers use generated ids so this is acceptable.
 */
export function sanitizeThreadId(threadId: string): string {
  const cleaned = threadId.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_');
  const bounded = cleaned.slice(0, 100);
  return bounded === '' ? 'thread' : bounded;
}

const FILE_SUFFIX = '.json';

/** Pure storage impl over injected fs functions — unit-testable without vscode. */
export function createFileCheckpointStorage(fs: CheckpointFsAdapter): CheckpointStorage {
  const fileName = (id: string): string => `${sanitizeThreadId(id)}${FILE_SUFFIX}`;
  return {
    async read(id: string): Promise<string | undefined> {
      try {
        const bytes = await fs.readFile(fileName(id));
        return new TextDecoder().decode(bytes);
      } catch {
        return undefined;
      }
    },
    async write(id: string, data: string): Promise<void> {
      await fs.ensureDir();
      await fs.writeFile(fileName(id), new TextEncoder().encode(data));
    },
    async delete(id: string): Promise<void> {
      try {
        await fs.deleteFile(fileName(id));
      } catch {
        // already gone — fine
      }
    },
    async list(): Promise<CheckpointStorageEntry[]> {
      try {
        const files = await fs.listFiles();
        return files
          .filter((f) => f.name.endsWith(FILE_SUFFIX))
          .map((f) => ({
            id: f.name.slice(0, -FILE_SUFFIX.length),
            mtime: f.mtime,
            size: f.size,
          }));
      } catch {
        return [];
      }
    },
  };
}

/** In-memory storage — default when the caller does not need persistence. */
export function createInMemoryCheckpointStorage(): CheckpointStorage {
  const files = new Map<string, { data: string; mtime: number }>();
  let clock = 0;
  return {
    async read(id) {
      return files.get(sanitizeThreadId(id))?.data;
    },
    async write(id, data) {
      files.set(sanitizeThreadId(id), { data, mtime: ++clock });
    },
    async delete(id) {
      files.delete(sanitizeThreadId(id));
    },
    async list() {
      return [...files.entries()].map(([id, f]) => ({
        id,
        mtime: f.mtime,
        size: f.data.length,
      }));
    },
  };
}

/**
 * Checkpoint storage under `<workspaceRoot>/.mocklify/checkpoints` via
 * vscode.workspace.fs. Lazy-requires vscode so the rest of this module stays
 * importable under vitest.
 */
export function createVscodeCheckpointStorage(workspaceRoot: vscode.Uri): CheckpointStorage {
  // Lazy so the pure exports above stay importable outside the extension host.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const vs: typeof import('vscode') = require('vscode');
  const dir = vs.Uri.joinPath(workspaceRoot, ...CHECKPOINT_DIR_SEGMENTS);
  return createFileCheckpointStorage({
    async ensureDir() {
      await vs.workspace.fs.createDirectory(dir);
    },
    async readFile(name) {
      return await vs.workspace.fs.readFile(vs.Uri.joinPath(dir, name));
    },
    async writeFile(name, data) {
      await vs.workspace.fs.writeFile(vs.Uri.joinPath(dir, name), data);
    },
    async deleteFile(name) {
      await vs.workspace.fs.delete(vs.Uri.joinPath(dir, name), { useTrash: false });
    },
    async listFiles() {
      const entries = await vs.workspace.fs.readDirectory(dir);
      const files: Array<{ name: string; mtime: number; size: number }> = [];
      for (const [name, type] of entries) {
        if (type !== vs.FileType.File) {
          continue;
        }
        try {
          const stat = await vs.workspace.fs.stat(vs.Uri.joinPath(dir, name));
          files.push({ name, mtime: stat.mtime, size: stat.size });
        } catch {
          // raced with a delete — skip
        }
      }
      return files;
    },
  });
}

// ---------------------------------------------------------------------------
// Checkpointer
// ---------------------------------------------------------------------------

interface StoredCheckpoint {
  checkpointType: string;
  checkpoint: string;
  metadataType: string;
  metadata: string;
  parentId?: string;
}

interface ThreadFile {
  v: 1;
  /** checkpoint_ns -> checkpoint_id -> stored checkpoint */
  checkpoints: Record<string, Record<string, StoredCheckpoint>>;
  /** JSON.stringify([ns, checkpointId]) -> "<taskId>,<idx>" -> [taskId, channel, type, value] */
  writes: Record<string, Record<string, [string, string, string, string]>>;
}

function emptyThreadFile(): ThreadFile {
  return { v: 1, checkpoints: {}, writes: {} };
}

function isValidThreadFile(value: unknown): value is ThreadFile {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const file = value as Partial<ThreadFile>;
  return (
    file.v === 1 &&
    typeof file.checkpoints === 'object' &&
    file.checkpoints !== null &&
    !Array.isArray(file.checkpoints) &&
    typeof file.writes === 'object' &&
    file.writes !== null &&
    !Array.isArray(file.writes)
  );
}

function writesKey(ns: string, checkpointId: string): string {
  return JSON.stringify([ns, checkpointId]);
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

export interface FileCheckpointSaverOptions {
  maxFileBytes?: number;
  maxThreadFiles?: number;
  onWarning?: (message: string) => void;
}

type ListOptionsLike = {
  limit?: number;
  before?: LangGraphRunnableConfig;
  filter?: Record<string, unknown>;
};

/**
 * LangGraph checkpoint saver persisting one JSON file per thread through an
 * injected {@link CheckpointStorage}. Degradation rules (never throw into a
 * scan): corrupt or oversized files read as "no checkpoint" (fresh start);
 * files that would exceed the size cap evict their oldest checkpoints first;
 * a single checkpoint too big to fit stays in-memory only; storage write
 * failures are swallowed after warning. Oldest thread files beyond
 * {@link MAX_CHECKPOINT_FILES} are evicted on write.
 */
export class FileCheckpointSaver extends BaseCheckpointSaver {
  private readonly cache = new Map<string, ThreadFile>();
  private readonly prunedThreads = new Set<string>();
  private readonly maxFileBytes: number;
  private readonly maxThreadFiles: number;
  private readonly onWarning: (message: string) => void;

  constructor(
    private readonly storage: CheckpointStorage,
    options: FileCheckpointSaverOptions = {}
  ) {
    super();
    this.maxFileBytes = options.maxFileBytes ?? MAX_CHECKPOINT_FILE_BYTES;
    this.maxThreadFiles = options.maxThreadFiles ?? MAX_CHECKPOINT_FILES;
    this.onWarning = options.onWarning ?? (() => undefined);
  }

  private async loadThread(threadId: string): Promise<ThreadFile> {
    const cached = this.cache.get(threadId);
    if (cached) {
      return cached;
    }
    let file = emptyThreadFile();
    try {
      const raw = await this.storage.read(threadId);
      if (raw !== undefined) {
        if (utf8Length(raw) > this.maxFileBytes) {
          this.onWarning(
            `Checkpoint file for thread "${threadId}" exceeds ${this.maxFileBytes} bytes — starting fresh.`
          );
        } else {
          const parsed: unknown = JSON.parse(raw);
          if (isValidThreadFile(parsed)) {
            file = parsed;
          } else {
            this.onWarning(
              `Checkpoint file for thread "${threadId}" has an unexpected shape — starting fresh.`
            );
          }
        }
      }
    } catch {
      this.onWarning(`Checkpoint file for thread "${threadId}" is corrupt — starting fresh.`);
    }
    this.cache.set(threadId, file);
    return file;
  }

  private allCheckpointRefs(file: ThreadFile): Array<{ ns: string; id: string }> {
    const refs: Array<{ ns: string; id: string }> = [];
    for (const ns of Object.keys(file.checkpoints)) {
      for (const id of Object.keys(file.checkpoints[ns])) {
        refs.push({ ns, id });
      }
    }
    return refs;
  }

  /** Evict the oldest checkpoint (checkpoint ids are time-ordered uuid6). */
  private evictOldest(file: ThreadFile): boolean {
    const refs = this.allCheckpointRefs(file);
    if (refs.length <= 1) {
      return false;
    }
    refs.sort((a, b) => a.id.localeCompare(b.id));
    const oldest = refs[0];
    delete file.checkpoints[oldest.ns][oldest.id];
    if (Object.keys(file.checkpoints[oldest.ns]).length === 0) {
      delete file.checkpoints[oldest.ns];
    }
    delete file.writes[writesKey(oldest.ns, oldest.id)];
    return true;
  }

  private async persistThread(threadId: string): Promise<void> {
    const file = this.cache.get(threadId);
    if (!file) {
      return;
    }
    let json = JSON.stringify(file);
    while (utf8Length(json) > this.maxFileBytes) {
      if (!this.evictOldest(file)) {
        this.onWarning(
          `Checkpoint for thread "${threadId}" exceeds ${this.maxFileBytes} bytes even alone — kept in memory only.`
        );
        return;
      }
      json = JSON.stringify(file);
    }
    try {
      await this.storage.write(threadId, json);
    } catch (error) {
      this.onWarning(
        `Failed to persist checkpoint for thread "${threadId}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return;
    }
    await this.pruneThreadFiles(threadId);
  }

  /** Keep at most maxThreadFiles checkpoint files; evict oldest by mtime. */
  private async pruneThreadFiles(currentThreadId: string): Promise<void> {
    if (this.prunedThreads.has(currentThreadId)) {
      return;
    }
    this.prunedThreads.add(currentThreadId);
    try {
      const entries = await this.storage.list();
      if (entries.length <= this.maxThreadFiles) {
        return;
      }
      const currentId = sanitizeThreadId(currentThreadId);
      const sorted = [...entries].sort((a, b) => b.mtime - a.mtime);
      for (const entry of sorted.slice(this.maxThreadFiles)) {
        if (entry.id === currentId) {
          continue;
        }
        await this.storage.delete(entry.id);
      }
    } catch {
      // eviction is best-effort
    }
  }

  private async buildTuple(
    threadId: string,
    ns: string,
    checkpointId: string,
    stored: StoredCheckpoint,
    file: ThreadFile,
    config?: LangGraphRunnableConfig
  ): Promise<CheckpointTuple> {
    const checkpoint = (await this.serde.loadsTyped(
      stored.checkpointType,
      stored.checkpoint
    )) as Checkpoint;
    const metadata = (await this.serde.loadsTyped(
      stored.metadataType,
      stored.metadata
    )) as CheckpointMetadata;
    const writes = Object.values(file.writes[writesKey(ns, checkpointId)] ?? {});
    const pendingWrites = (await Promise.all(
      writes.map(async ([taskId, channel, type, value]) => [
        taskId,
        channel,
        await this.serde.loadsTyped(type, value),
      ])
    )) as CheckpointTuple['pendingWrites'];
    const tuple: CheckpointTuple = {
      config: config ?? {
        configurable: { thread_id: threadId, checkpoint_ns: ns, checkpoint_id: checkpointId },
      },
      checkpoint,
      metadata,
      pendingWrites,
    };
    if (stored.parentId !== undefined) {
      tuple.parentConfig = {
        configurable: { thread_id: threadId, checkpoint_ns: ns, checkpoint_id: stored.parentId },
      };
    }
    return tuple;
  }

  async getTuple(config: LangGraphRunnableConfig): Promise<CheckpointTuple | undefined> {
    try {
      const threadId = config.configurable?.thread_id as string | undefined;
      if (threadId === undefined) {
        return undefined;
      }
      const ns = (config.configurable?.checkpoint_ns as string | undefined) ?? '';
      const requestedId =
        (config.configurable?.checkpoint_id as string | undefined) ||
        (config.configurable?.thread_ts as string | undefined);
      const file = await this.loadThread(threadId);
      const checkpoints = file.checkpoints[ns];
      if (!checkpoints) {
        return undefined;
      }
      if (requestedId) {
        const stored = checkpoints[requestedId];
        if (!stored) {
          return undefined;
        }
        return await this.buildTuple(threadId, ns, requestedId, stored, file, config);
      }
      const latestId = Object.keys(checkpoints).sort((a, b) => b.localeCompare(a))[0];
      if (latestId === undefined) {
        return undefined;
      }
      return await this.buildTuple(threadId, ns, latestId, checkpoints[latestId], file);
    } catch (error) {
      // A checkpoint problem must never take down the scan — fresh start.
      this.onWarning(
        `Failed to read checkpoint: ${error instanceof Error ? error.message : String(error)}`
      );
      return undefined;
    }
  }

  async *list(
    config: LangGraphRunnableConfig,
    options?: ListOptionsLike
  ): AsyncGenerator<CheckpointTuple> {
    const { before, filter } = options ?? {};
    let limit = options?.limit;
    const configThreadId = config.configurable?.thread_id as string | undefined;
    const threadIds =
      configThreadId !== undefined
        ? [configThreadId]
        : (await this.storage.list()).map((entry) => entry.id);
    const configNs = config.configurable?.checkpoint_ns as string | undefined;
    const configCheckpointId = config.configurable?.checkpoint_id as string | undefined;
    const beforeId = before?.configurable?.checkpoint_id as string | undefined;

    for (const threadId of threadIds) {
      let file: ThreadFile;
      try {
        file = await this.loadThread(threadId);
      } catch {
        continue;
      }
      for (const ns of Object.keys(file.checkpoints)) {
        if (configNs !== undefined && ns !== configNs) {
          continue;
        }
        const sorted = Object.entries(file.checkpoints[ns]).sort((a, b) =>
          b[0].localeCompare(a[0])
        );
        for (const [checkpointId, stored] of sorted) {
          if (configCheckpointId && checkpointId !== configCheckpointId) {
            continue;
          }
          if (beforeId && checkpointId >= beforeId) {
            continue;
          }
          let tuple: CheckpointTuple;
          try {
            tuple = await this.buildTuple(threadId, ns, checkpointId, stored, file);
          } catch {
            continue; // corrupt entry — skip, never throw
          }
          if (
            filter &&
            !Object.entries(filter).every(
              ([key, value]) =>
                (tuple.metadata as Record<string, unknown> | undefined)?.[key] === value
            )
          ) {
            continue;
          }
          if (limit !== undefined) {
            if (limit <= 0) {
              return;
            }
            limit -= 1;
          }
          yield tuple;
        }
      }
    }
  }

  async put(
    config: LangGraphRunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: Record<string, string | number>
  ): Promise<LangGraphRunnableConfig> {
    const threadId = config.configurable?.thread_id as string | undefined;
    if (threadId === undefined) {
      throw new Error(
        'Failed to put checkpoint: the RunnableConfig is missing "thread_id" in "configurable".'
      );
    }
    const ns = (config.configurable?.checkpoint_ns as string | undefined) ?? '';
    const file = await this.loadThread(threadId);
    const [checkpointType, checkpointBytes] = await this.serde.dumpsTyped(checkpoint);
    const [metadataType, metadataBytes] = await this.serde.dumpsTyped(metadata);
    file.checkpoints[ns] ??= {};
    file.checkpoints[ns][checkpoint.id] = {
      checkpointType,
      checkpoint: new TextDecoder().decode(checkpointBytes),
      metadataType,
      metadata: new TextDecoder().decode(metadataBytes),
      parentId: config.configurable?.checkpoint_id as string | undefined,
    };
    await this.persistThread(threadId);
    return {
      configurable: { thread_id: threadId, checkpoint_ns: ns, checkpoint_id: checkpoint.id },
    };
  }

  async putWrites(
    config: LangGraphRunnableConfig,
    writes: Array<[string, unknown]>,
    taskId: string
  ): Promise<void> {
    const threadId = config.configurable?.thread_id as string | undefined;
    const checkpointId = config.configurable?.checkpoint_id as string | undefined;
    if (threadId === undefined || checkpointId === undefined) {
      throw new Error(
        'Failed to put writes: the RunnableConfig is missing "thread_id" or "checkpoint_id".'
      );
    }
    const ns = (config.configurable?.checkpoint_ns as string | undefined) ?? '';
    const file = await this.loadThread(threadId);
    const key = writesKey(ns, checkpointId);
    const existing = file.writes[key];
    file.writes[key] ??= {};
    for (let idx = 0; idx < writes.length; idx++) {
      const [channel, value] = writes[idx];
      const slot = WRITE_CHANNEL_IDX[channel] ?? idx;
      const innerKey = `${taskId},${slot}`;
      if (slot >= 0 && existing && innerKey in existing) {
        continue; // regular writes are immutable once stored
      }
      const [type, bytes] = await this.serde.dumpsTyped(value);
      file.writes[key][innerKey] = [taskId, channel, type, new TextDecoder().decode(bytes)];
    }
    await this.persistThread(threadId);
  }

  async deleteThread(threadId: string): Promise<void> {
    this.cache.delete(threadId);
    await this.storage.delete(threadId);
  }
}

// ---------------------------------------------------------------------------
// Cancellation bridge
// ---------------------------------------------------------------------------

export interface DisposableLike {
  dispose(): unknown;
}

/** Structural subset of vscode.CancellationToken — keeps this module vitest-importable. */
export interface CancellationTokenLike {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: (e: unknown) => unknown): DisposableLike;
}

export interface CancellationBridge {
  signal: AbortSignal;
  dispose(): void;
}

/**
 * Bridge a vscode.CancellationToken to an AbortSignal for graph.invoke/stream.
 * Dispose to unsubscribe once the run settles.
 */
export function cancellationTokenToAbortSignal(token: CancellationTokenLike): CancellationBridge {
  const controller = new AbortController();
  if (token.isCancellationRequested) {
    controller.abort();
    return { signal: controller.signal, dispose: () => undefined };
  }
  const subscription = token.onCancellationRequested(() => controller.abort());
  return {
    signal: controller.signal,
    dispose: () => {
      try {
        subscription.dispose();
      } catch {
        // token source already disposed — fine
      }
    },
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const error = new Error('The scan was cancelled.');
    error.name = 'AbortError';
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Human-question (interrupt) plumbing
// ---------------------------------------------------------------------------

export interface HumanQuestion {
  id: string;
  question: string;
  options?: string[];
  freeText?: boolean;
}

let questionCounter = 0;

/**
 * Pause the graph and ask the human a question. Call from inside a graph
 * node; the runtime surfaces the question via the caller's onQuestion
 * handler and resumes the node with the answer. Do not wrap in try/catch
 * (interrupt() propagates by throwing; see LangGraph docs).
 */
export function askHuman(question: HumanQuestion): string {
  const answer = interrupt<HumanQuestion, unknown>(question);
  if (typeof answer === 'string') {
    return answer;
  }
  return answer == null ? '' : String(answer);
}

/** Coerce an interrupt payload into a HumanQuestion (defensive: never throws). */
export function toHumanQuestion(value: unknown): HumanQuestion {
  if (typeof value === 'object' && value !== null) {
    const candidate = value as Partial<HumanQuestion>;
    if (typeof candidate.question === 'string' && candidate.question.trim() !== '') {
      return {
        id:
          typeof candidate.id === 'string' && candidate.id !== ''
            ? candidate.id
            : `question-${++questionCounter}`,
        question: candidate.question,
        options: Array.isArray(candidate.options)
          ? candidate.options.filter((o): o is string => typeof o === 'string')
          : undefined,
        freeText: typeof candidate.freeText === 'boolean' ? candidate.freeText : undefined,
      };
    }
  }
  return {
    id: `question-${++questionCounter}`,
    question: String(value ?? ''),
    freeText: true,
  };
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export interface GraphProgressEvent {
  /** Graph node name that just completed. */
  node: string;
  /** Human-friendly label (from the caller's map, or derived). */
  label: string;
}

/** "analyzeProjectShape" / "analyze_project_shape" → "Analyze project shape". */
export function humanizeNodeName(name: string): string {
  const spaced = name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return spaced === '' ? name : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

export type QuestionHandler = (question: HumanQuestion) => Promise<string> | string;

export interface ScanGraphRuntimeOptions {
  /** Where checkpoints persist. Defaults to in-memory (no persistence). */
  storage?: CheckpointStorage;
  /** Full checkpointer override; wins over `storage`. */
  checkpointer?: BaseCheckpointSaver;
  /** Thread id for checkpointing/resume. Defaults to a generated id. */
  threadId?: string;
  cancellationToken?: CancellationTokenLike;
  /** Answers askHuman() questions raised by graph nodes. */
  onQuestion?: QuestionHandler;
  /** Node-transition events. */
  onProgress?: (event: GraphProgressEvent) => void;
  /** node name → friendly label; unmapped names are humanized. */
  nodeLabels?: Record<string, string>;
  recursionLimit?: number;
  /** Cap on interrupt→ask→resume cycles per run. */
  maxQuestionRounds?: number;
  onWarning?: (message: string) => void;
}

/** A compiled LangGraph graph (structural — avoids the heavy generics). */
export interface CompiledGraphLike {
  stream(input: unknown, options?: Record<string, unknown>): Promise<AsyncIterable<unknown>>;
}

/** An uncompiled StateGraph builder. */
export interface CompilableGraphLike {
  compile(options?: { checkpointer?: BaseCheckpointSaver }): CompiledGraphLike;
}

export type RunnableGraph = CompiledGraphLike | CompilableGraphLike;

export interface ScanGraphRuntime {
  readonly checkpointer: BaseCheckpointSaver;
  readonly threadId: string;
  /**
   * Run a graph to completion, transparently handling askHuman interrupts
   * (via onQuestion) and cancellation (via the bridged AbortSignal). Returns
   * the final graph state values.
   */
  run<TResult = Record<string, unknown>>(graph: RunnableGraph, input: unknown): Promise<TResult>;
  /** Drop this runtime's persisted checkpoints. */
  deleteThread(): Promise<void>;
}

export class GraphRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphRuntimeError';
  }
}

function isCompilable(graph: RunnableGraph): graph is CompilableGraphLike {
  return (
    typeof (graph as Partial<CompilableGraphLike>).compile === 'function' &&
    typeof (graph as Partial<CompiledGraphLike>).stream !== 'function'
  );
}

function generateThreadId(): string {
  return `scan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const STREAM_MODES = ['updates', 'values'] as const;

function splitChunk(chunk: unknown): { mode: string; payload: unknown } | undefined {
  if (
    Array.isArray(chunk) &&
    chunk.length === 2 &&
    typeof chunk[0] === 'string' &&
    (STREAM_MODES as readonly string[]).includes(chunk[0])
  ) {
    return { mode: chunk[0], payload: chunk[1] };
  }
  return undefined;
}

/** LangGraph interrupt ids are XXH3 hashes; resume-by-id maps require this shape. */
const XXH3_ID = /^[0-9a-f]{32}$/;

/**
 * Create the thin, Mocklify-flavored runtime every scan graph uses: a
 * vscode-persisted checkpointer, CancellationToken→AbortSignal bridging,
 * interrupt→onQuestion→resume plumbing, and node-transition progress events.
 * Model-agnostic by design — nodes call Mocklify's own AI layer themselves.
 */
export function createScanGraphRuntime(options: ScanGraphRuntimeOptions = {}): ScanGraphRuntime {
  const onWarning = options.onWarning ?? (() => undefined);
  const checkpointer =
    options.checkpointer ??
    new FileCheckpointSaver(options.storage ?? createInMemoryCheckpointStorage(), { onWarning });
  const threadId = options.threadId ?? generateThreadId();
  const maxQuestionRounds = options.maxQuestionRounds ?? DEFAULT_MAX_QUESTION_ROUNDS;
  const nodeLabels = options.nodeLabels ?? {};

  const emitProgress = (node: string): void => {
    if (!options.onProgress || node.startsWith('__')) {
      return;
    }
    options.onProgress({ node, label: nodeLabels[node] ?? humanizeNodeName(node) });
  };

  const collectInterrupts = (payload: unknown, sink: Map<string, Interrupt>): void => {
    if (!isInterrupted(payload)) {
      return;
    }
    for (const item of payload.__interrupt__) {
      const key = typeof item.id === 'string' ? item.id : JSON.stringify(item.value ?? null);
      if (!sink.has(key)) {
        sink.set(key, item);
      }
    }
  };

  const run = async <TResult>(graph: RunnableGraph, input: unknown): Promise<TResult> => {
    const compiled = isCompilable(graph) ? graph.compile({ checkpointer }) : graph;
    const bridge = options.cancellationToken
      ? cancellationTokenToAbortSignal(options.cancellationToken)
      : undefined;
    const signal = bridge?.signal;
    try {
      let currentInput: unknown = input;
      let lastValues: unknown;
      for (let round = 0; round <= maxQuestionRounds; round++) {
        throwIfAborted(signal);
        const interrupts = new Map<string, Interrupt>();
        const stream = await compiled.stream(currentInput, {
          configurable: {
            thread_id: threadId,
            [CONFIG_KEY_CANCELLATION_TOKEN]: options.cancellationToken,
          },
          signal,
          streamMode: [...STREAM_MODES],
          ...(options.recursionLimit !== undefined
            ? { recursionLimit: options.recursionLimit }
            : {}),
        });
        for await (const chunk of stream) {
          const split = splitChunk(chunk);
          if (!split) {
            lastValues = chunk;
            continue;
          }
          if (split.mode === 'values') {
            lastValues = split.payload;
            collectInterrupts(split.payload, interrupts);
          } else if (split.mode === 'updates') {
            collectInterrupts(split.payload, interrupts);
            if (typeof split.payload === 'object' && split.payload !== null) {
              for (const node of Object.keys(split.payload)) {
                emitProgress(node);
              }
            }
          }
        }
        if (interrupts.size === 0) {
          return lastValues as TResult;
        }
        if (!options.onQuestion) {
          throw new GraphRuntimeError(
            'The graph asked a human question but no onQuestion handler was provided.'
          );
        }
        // Answer one question per round; remaining interrupts re-raise on resume.
        const first = [...interrupts.values()][0];
        const question = toHumanQuestion(first.value);
        throwIfAborted(signal);
        const answer = await options.onQuestion(question);
        throwIfAborted(signal);
        currentInput =
          typeof first.id === 'string' && XXH3_ID.test(first.id)
            ? new Command({ resume: { [first.id]: answer } })
            : new Command({ resume: answer });
      }
      throw new GraphRuntimeError(
        `The graph asked more than ${maxQuestionRounds} human questions in one run — aborting.`
      );
    } finally {
      bridge?.dispose();
    }
  };

  return {
    checkpointer,
    threadId,
    run,
    deleteThread: () => checkpointer.deleteThread(threadId),
  };
}
