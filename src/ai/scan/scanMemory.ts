import { z } from 'zod';
import type * as vscode from 'vscode';
import type { ApiDirection } from './projectProfile.js';
import type { CodebaseScanSummary, ScanSurface } from '../CodebaseMockGenerator.js';
import { validateWorkspacePath } from '../agent/workspaceTools.js';

/**
 * Workspace scan memory — what previous scans learned about this codebase,
 * persisted at .mocklify/scan-memory.json so later scans can skip
 * rediscovering the API layer, model locations, and project conventions.
 *
 * Everything here is pure except createScanMemoryStore, which lazily
 * requires('vscode') (workspaceTools adapter pattern) so the module stays
 * vitest-importable.
 *
 * SECURITY: describeScanMemory output is injected into future agent prompts,
 * and .mocklify/scan-memory.json is a workspace file anyone (or any tool) can
 * edit. Every string is therefore sanitized ON LOAD — control characters and
 * newlines collapse to single spaces (single-line clamp), lengths are capped,
 * and paths are confined to workspace-relative form — so a tampered memory
 * file cannot smuggle multi-line prompt-injection payloads into scans.
 */

export const SCAN_MEMORY_VERSION = 1 as const;
export const SCAN_MEMORY_RELATIVE_PATH = '.mocklify/scan-memory.json';

export const MEMORY_MAX_SURFACES = 16;
export const MEMORY_MAX_PATHS_PER_LIST = 12;
export const MEMORY_MAX_NOTES = 20;
export const MEMORY_NOTE_MAX_CHARS = 300;
/** Cap for short fields: names, root paths, convention descriptions, paths. */
export const MEMORY_FIELD_MAX_CHARS = 160;
/** describeScanMemory shows at most this many paths per list. */
export const DESCRIBE_MAX_PATHS = 3;
/** Hard ceiling on the prompt block describeScanMemory returns. */
export const DESCRIBE_MAX_CHARS = 2000;

export interface ScanMemoryConventions {
  auth?: string;
  errorShape?: string;
  basePath?: string;
}

export interface ScanMemorySurface {
  name: string;
  /** Workspace-relative project root; '' when the project is the workspace root. */
  rootPath: string;
  direction: ApiDirection;
  /** Workspace-relative directories (or files) where API code was found. */
  apiLayerPaths: string[];
  /** Workspace-relative directories (or files) where models/DTOs were found. */
  modelPaths: string[];
  conventions: ScanMemoryConventions;
}

export interface ScanMemory {
  version: typeof SCAN_MEMORY_VERSION;
  updatedAt: string;
  surfaces: ScanMemorySurface[];
  notes: string[];
}

// ---------------------------------------------------------------------------
// Sanitization (applied on LOAD and on build/merge — never trust the file)
// ---------------------------------------------------------------------------

/**
 * Single-line clamp: control characters (including newlines and Unicode line
 * separators) collapse to single spaces, whitespace runs collapse, and the
 * result is trimmed and capped. This is what makes a note like
 * "IGNORE ALL PREVIOUS INSTRUCTIONS\n\n## New mission" inert — it can no
 * longer break out of its list-item line in the prompt block.
 */
export function sanitizeMemoryLine(raw: unknown, maxChars = MEMORY_FIELD_MAX_CHARS): string {
  if (typeof raw !== 'string') {
    return '';
  }
  return raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}

/**
 * Confine a remembered path to workspace-relative form: absolute prefixes
 * (leading "/", drive letters) are stripped, and anything that still fails
 * workspace-path validation (traversal, encoded tricks, null bytes) is
 * dropped entirely (undefined).
 */
export function sanitizeMemoryPath(raw: unknown): string | undefined {
  const line = sanitizeMemoryLine(raw, MEMORY_FIELD_MAX_CHARS);
  if (line === '') {
    return undefined;
  }
  const relative = line
    .replace(/\\/g, '/')
    .replace(/^[a-zA-Z]:\//, '')
    .replace(/^\/+/, '');
  const validated = validateWorkspacePath(relative);
  return validated.ok ? validated.path : undefined;
}

function sanitizePathList(raw: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const entry of raw) {
    const path = sanitizeMemoryPath(entry);
    if (path !== undefined && !out.includes(path)) {
      out.push(path);
    }
    if (out.length >= MEMORY_MAX_PATHS_PER_LIST) {
      break;
    }
  }
  return out;
}

function sanitizeConventions(raw: ScanMemoryConventions): ScanMemoryConventions {
  const out: ScanMemoryConventions = {};
  const auth = sanitizeMemoryLine(raw.auth);
  const errorShape = sanitizeMemoryLine(raw.errorShape);
  const basePath = sanitizeMemoryLine(raw.basePath);
  if (auth !== '') {
    out.auth = auth;
  }
  if (errorShape !== '') {
    out.errorShape = errorShape;
  }
  if (basePath !== '') {
    out.basePath = basePath;
  }
  return out;
}

function sanitizeSurface(raw: ScanMemorySurface): ScanMemorySurface | undefined {
  const name = sanitizeMemoryLine(raw.name);
  if (name === '') {
    return undefined;
  }
  // Root path '' (workspace root) is valid — only non-empty roots are confined.
  const rootRaw = sanitizeMemoryLine(raw.rootPath);
  const rootPath = rootRaw === '' ? '' : sanitizeMemoryPath(rootRaw) ?? '';
  return {
    name,
    rootPath,
    direction: raw.direction,
    apiLayerPaths: sanitizePathList(raw.apiLayerPaths),
    modelPaths: sanitizePathList(raw.modelPaths),
    conventions: sanitizeConventions(raw.conventions),
  };
}

/** Enforce every clamp and cap on a structurally valid memory document. */
export function sanitizeScanMemory(raw: ScanMemory): ScanMemory {
  const surfaces: ScanMemorySurface[] = [];
  for (const surface of raw.surfaces) {
    const clean = sanitizeSurface(surface);
    if (clean !== undefined) {
      surfaces.push(clean);
    }
    if (surfaces.length >= MEMORY_MAX_SURFACES) {
      break;
    }
  }
  const notes: string[] = [];
  for (const note of raw.notes) {
    const clean = sanitizeMemoryLine(note, MEMORY_NOTE_MAX_CHARS);
    if (clean !== '' && !notes.includes(clean)) {
      notes.push(clean);
    }
    if (notes.length >= MEMORY_MAX_NOTES) {
      break;
    }
  }
  return {
    version: SCAN_MEMORY_VERSION,
    updatedAt: sanitizeMemoryLine(raw.updatedAt, 40),
    surfaces,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Schema (forward-compatible: unknown fields dropped, bad entries skipped)
// ---------------------------------------------------------------------------

const conventionsSchema = z
  .object({
    auth: z.string().optional(),
    errorShape: z.string().optional(),
    basePath: z.string().optional(),
  })
  .default({});

const surfaceSchema = z.object({
  name: z.string().min(1),
  rootPath: z.string().default(''),
  direction: z.enum(['consumes', 'serves', 'both']).catch('consumes'),
  apiLayerPaths: z.array(z.string()).default([]),
  modelPaths: z.array(z.string()).default([]),
  conventions: conventionsSchema,
});

/**
 * Top level requires the exact version literal (any other version → null so
 * a future format is never half-read); everything else is lenient — unknown
 * fields drop (zod strips them), and malformed surfaces/notes are skipped
 * individually rather than rejecting the whole document.
 */
const memorySchema = z.object({
  version: z.literal(SCAN_MEMORY_VERSION),
  updatedAt: z.string().default(''),
  surfaces: z.array(z.unknown()).default([]),
  notes: z.array(z.unknown()).default([]),
});

/**
 * Parse + validate + sanitize raw scan-memory.json text. Returns null for
 * anything that is not a version-1 memory document (invalid JSON, wrong
 * version, non-object). Individually malformed surfaces or notes are dropped,
 * not fatal.
 */
export function parseScanMemory(raw: string): ScanMemory | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const top = memorySchema.safeParse(json);
  if (!top.success) {
    return null;
  }
  const surfaces: ScanMemorySurface[] = [];
  for (const entry of top.data.surfaces) {
    const parsed = surfaceSchema.safeParse(entry);
    if (parsed.success) {
      surfaces.push(parsed.data);
    }
  }
  const notes = top.data.notes.filter((n): n is string => typeof n === 'string');
  return sanitizeScanMemory({
    version: SCAN_MEMORY_VERSION,
    updatedAt: top.data.updatedAt,
    surfaces,
    notes,
  });
}

/**
 * Load scan memory through an injected reader (given the workspace-relative
 * path, returns file text or undefined/null when absent). Any read error,
 * missing file, or invalid content yields null — callers always get a
 * validated, sanitized document or nothing.
 */
export async function loadScanMemory(
  read: (relativePath: string) => Promise<string | null | undefined>
): Promise<ScanMemory | null> {
  let raw: string | null | undefined;
  try {
    raw = await read(SCAN_MEMORY_RELATIVE_PATH);
  } catch {
    return null;
  }
  if (typeof raw !== 'string' || raw === '') {
    return null;
  }
  return parseScanMemory(raw);
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

const surfaceKey = (s: ScanMemorySurface): string =>
  `${s.rootPath} ${s.name.toLowerCase()}`;

function mergePathLists(next: readonly string[], prev: readonly string[]): string[] {
  const out: string[] = [];
  for (const path of [...next, ...prev]) {
    if (!out.includes(path)) {
      out.push(path);
    }
    if (out.length >= MEMORY_MAX_PATHS_PER_LIST) {
      break;
    }
  }
  return out;
}

function mergeSurface(prev: ScanMemorySurface, next: ScanMemorySurface): ScanMemorySurface {
  return {
    name: next.name,
    rootPath: next.rootPath,
    direction: next.direction,
    apiLayerPaths: mergePathLists(next.apiLayerPaths, prev.apiLayerPaths),
    modelPaths: mergePathLists(next.modelPaths, prev.modelPaths),
    conventions: {
      ...(prev.conventions.auth || next.conventions.auth
        ? { auth: next.conventions.auth ?? prev.conventions.auth }
        : {}),
      ...(prev.conventions.errorShape || next.conventions.errorShape
        ? { errorShape: next.conventions.errorShape ?? prev.conventions.errorShape }
        : {}),
      ...(prev.conventions.basePath || next.conventions.basePath
        ? { basePath: next.conventions.basePath ?? prev.conventions.basePath }
        : {}),
    },
  };
}

/**
 * Merge a fresh memory document over a previous one. Surfaces are keyed by
 * rootPath + case-insensitive name; on a key collision the newest surface
 * wins field-by-field (paths union with new entries first, conventions fall
 * back to the previous value only when the new scan learned nothing). New
 * surfaces lead the order, then surviving previous ones; notes likewise.
 * All caps are enforced on the result. Either side may be null.
 */
export function mergeScanMemory(
  prev: ScanMemory | null,
  next: ScanMemory | null
): ScanMemory {
  const base: ScanMemory = prev ?? {
    version: SCAN_MEMORY_VERSION,
    updatedAt: '',
    surfaces: [],
    notes: [],
  };
  if (next === null) {
    return sanitizeScanMemory(base);
  }
  const prevByKey = new Map(base.surfaces.map((s) => [surfaceKey(s), s]));
  const surfaces: ScanMemorySurface[] = [];
  const seen = new Set<string>();
  for (const surface of next.surfaces) {
    const key = surfaceKey(surface);
    const old = prevByKey.get(key);
    surfaces.push(old === undefined ? surface : mergeSurface(old, surface));
    seen.add(key);
  }
  for (const surface of base.surfaces) {
    if (!seen.has(surfaceKey(surface))) {
      surfaces.push(surface);
    }
  }
  return sanitizeScanMemory({
    version: SCAN_MEMORY_VERSION,
    updatedAt: next.updatedAt !== '' ? next.updatedAt : new Date().toISOString(),
    surfaces,
    notes: [...next.notes, ...base.notes],
  });
}

// ---------------------------------------------------------------------------
// Describe (prompt block)
// ---------------------------------------------------------------------------

function describeSurface(surface: ScanMemorySurface): string {
  const parts: string[] = [];
  if (surface.apiLayerPaths.length > 0) {
    const extra = surface.apiLayerPaths.length - DESCRIBE_MAX_PATHS;
    parts.push(
      `API layer at ${surface.apiLayerPaths.slice(0, DESCRIBE_MAX_PATHS).join(', ')}${
        extra > 0 ? ` (+${extra} more)` : ''
      }`
    );
  }
  if (surface.modelPaths.length > 0) {
    const extra = surface.modelPaths.length - DESCRIBE_MAX_PATHS;
    parts.push(
      `models at ${surface.modelPaths.slice(0, DESCRIBE_MAX_PATHS).join(', ')}${
        extra > 0 ? ` (+${extra} more)` : ''
      }`
    );
  }
  if (surface.conventions.auth !== undefined) {
    parts.push(`auth via ${surface.conventions.auth}`);
  }
  if (surface.conventions.errorShape !== undefined) {
    parts.push(`errors shaped like ${surface.conventions.errorShape}`);
  }
  if (surface.conventions.basePath !== undefined) {
    parts.push(`base path ${surface.conventions.basePath}`);
  }
  const detail = parts.length > 0 ? `: ${parts.join('; ')}` : '';
  const root = surface.rootPath !== '' ? `, root ${surface.rootPath}/` : '';
  return `- "${surface.name}" (${surface.direction}${root})${detail}`;
}

/**
 * Compact prompt block summarizing what previous scans learned, or '' when
 * there is nothing worth saying. One line per surface plus one per note —
 * every field was single-line-clamped on load, so nothing in here can open a
 * new prompt section. Hard-capped at DESCRIBE_MAX_CHARS.
 */
export function describeScanMemory(mem: ScanMemory | null): string {
  if (mem === null || (mem.surfaces.length === 0 && mem.notes.length === 0)) {
    return '';
  }
  const lines = ['Previous scans learned:'];
  for (const surface of mem.surfaces) {
    lines.push(describeSurface(surface));
  }
  for (const note of mem.notes) {
    lines.push(`- Note: ${note}`);
  }
  const block = lines.join('\n');
  return block.length > DESCRIBE_MAX_CHARS ? block.slice(0, DESCRIBE_MAX_CHARS) : block;
}

// ---------------------------------------------------------------------------
// Build from a completed scan
// ---------------------------------------------------------------------------

const MODEL_PATH_PATTERN =
  /(^|\/)(models?|dtos?|entities|entity|schemas?|types|domain)($|\/)|(model|dto|entity|schema)s?\.[a-z]+$/i;

/** Directory of a workspace-relative file path ('' at the root). */
function dirOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

/** Longest common URL-path prefix (whole segments) across route paths. */
export function commonBasePath(paths: readonly string[]): string | undefined {
  if (paths.length < 2) {
    return undefined;
  }
  const segmented = paths.map((p) => p.split('?')[0].split('/').filter((s) => s !== ''));
  let prefix = segmented[0];
  for (const segments of segmented.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < segments.length && prefix[i] === segments[i]) {
      i++;
    }
    prefix = prefix.slice(0, i);
    if (prefix.length === 0) {
      return undefined;
    }
  }
  // A prefix that swallows every path whole ("/users" from /users, /users) is
  // a route, not a base path — require at least one path to continue past it.
  const informative = segmented.some((s) => s.length > prefix.length);
  return informative ? `/${prefix.join('/')}` : undefined;
}

function detectAuthConvention(routes: ScanSurface['routes']): string | undefined {
  for (const route of routes) {
    const haystack = JSON.stringify([route.matcher ?? {}, route.response.headers ?? {}]);
    if (/bearer/i.test(haystack)) {
      return 'Bearer tokens';
    }
    if (/x-api-key|api[-_]?key/i.test(haystack)) {
      return 'API key header';
    }
    if (/authorization/i.test(haystack)) {
      return 'Authorization header';
    }
  }
  return undefined;
}

function detectErrorShape(routes: ScanSurface['routes']): string | undefined {
  for (const route of routes) {
    if (route.response.statusCode < 400) {
      continue;
    }
    const content = route.response.body?.content;
    if (content !== null && typeof content === 'object' && !Array.isArray(content)) {
      const keys = Object.keys(content).slice(0, 4);
      if (keys.length > 0) {
        return `{${keys.join(', ')}}`;
      }
    }
  }
  return undefined;
}

/** Explored directories under a surface root, most-visited first. */
function rankDirs(paths: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const dir = dirOf(path);
    if (dir !== '') {
      counts.set(dir, (counts.get(dir) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([dir]) => dir);
}

/**
 * Derive a memory document from a completed scan: one memory surface per
 * summary surface, with the files the agent actually explored attributed to
 * surfaces by longest rootPath prefix and split into model directories
 * (name matches model/dto/entity/schema vocabulary) vs API-layer
 * directories. Conventions (auth vocabulary, error body shape, common base
 * path) are inferred from the surface's accepted routes. Spec files and a
 * no-API-surface conclusion become notes. Output is fully sanitized.
 */
export function buildScanMemoryFromSummary(
  summary: CodebaseScanSummary,
  exploredPaths: readonly string[]
): ScanMemory {
  const surfaces = summary.surfaces ?? [];
  const cleanExplored = exploredPaths
    .map((p) => sanitizeMemoryPath(p))
    .filter((p): p is string => p !== undefined);

  // Attribute each explored file to the surface with the longest matching root.
  const roots = surfaces.map((s) => s.rootPath ?? '');
  const bySurface = new Map<number, string[]>();
  for (const path of cleanExplored) {
    let best = -1;
    let bestLen = -1;
    for (let i = 0; i < roots.length; i++) {
      const root = roots[i];
      const matches = root === '' || path === root || path.startsWith(`${root}/`);
      if (matches && root.length > bestLen) {
        best = i;
        bestLen = root.length;
      }
    }
    if (best !== -1) {
      const list = bySurface.get(best) ?? [];
      list.push(path);
      bySurface.set(best, list);
    }
  }

  const memorySurfaces: ScanMemorySurface[] = surfaces.map((surface, i) => {
    const explored = bySurface.get(i) ?? [];
    const modelFiles = explored.filter((p) => MODEL_PATH_PATTERN.test(p));
    const apiFiles = explored.filter((p) => !MODEL_PATH_PATTERN.test(p));
    const conventions: ScanMemoryConventions = {};
    const auth = detectAuthConvention(surface.routes);
    const errorShape = detectErrorShape(surface.routes);
    const basePath = commonBasePath(surface.routes.map((r) => r.path));
    if (auth !== undefined) {
      conventions.auth = auth;
    }
    if (errorShape !== undefined) {
      conventions.errorShape = errorShape;
    }
    if (basePath !== undefined) {
      conventions.basePath = basePath;
    }
    return {
      name: surface.name,
      rootPath: surface.rootPath ?? '',
      direction: surface.direction,
      apiLayerPaths: rankDirs(apiFiles),
      modelPaths: rankDirs(modelFiles),
      conventions,
    };
  });

  const notes: string[] = [];
  if (summary.specFiles !== undefined && summary.specFiles.length > 0) {
    notes.push(`API spec files present: ${summary.specFiles.slice(0, 5).join(', ')}`);
  }
  if (summary.noApiSurfaceReason !== undefined) {
    notes.push(`A previous scan found no API surface: ${summary.noApiSurfaceReason}`);
  }

  return sanitizeScanMemory({
    version: SCAN_MEMORY_VERSION,
    updatedAt: new Date().toISOString(),
    surfaces: memorySurfaces,
    notes,
  });
}

// ---------------------------------------------------------------------------
// vscode adapter (lazy — the pure exports above stay importable in vitest)
// ---------------------------------------------------------------------------

export interface ScanMemoryStore {
  /** Validated + sanitized memory, or null (absent file, tampered content). */
  load(): Promise<ScanMemory | null>;
  /** Persist (sanitized) to .mocklify/scan-memory.json; failures are silent. */
  save(mem: ScanMemory): Promise<void>;
}

/**
 * File-backed store for one workspace root. Reads and writes only
 * SCAN_MEMORY_RELATIVE_PATH via vscode.workspace.fs.
 */
export function createScanMemoryStore(workspaceRoot: vscode.Uri): ScanMemoryStore {
  // Lazy so the pure exports above stay importable outside the extension host.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const vs: typeof import('vscode') = require('vscode');
  const fileUri = vs.Uri.joinPath(workspaceRoot, ...SCAN_MEMORY_RELATIVE_PATH.split('/'));

  return {
    load: () =>
      loadScanMemory(async () =>
        Buffer.from(await vs.workspace.fs.readFile(fileUri)).toString('utf-8')
      ),
    save: async (mem) => {
      try {
        const clean = sanitizeScanMemory(mem);
        const dir = vs.Uri.joinPath(workspaceRoot, '.mocklify');
        await vs.workspace.fs.createDirectory(dir);
        await vs.workspace.fs.writeFile(
          fileUri,
          Buffer.from(`${JSON.stringify(clean, null, 2)}\n`, 'utf-8')
        );
      } catch {
        // Memory is an optimization — never fail a scan over it.
      }
    },
  };
}
