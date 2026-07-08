import type * as vscode from 'vscode';
import { enumerateScanCandidates } from './enumerateFiles.js';
import { shouldScanPath } from './universalSignals.js';

/**
 * Workspace census: a compact, deterministic inventory of a workspace that an
 * exploration agent can plan from when the deterministic seed scan found no
 * (or only weak) API signals — the "no dead end" recon input. It answers:
 * what does this workspace LOOK like (directory tree, file-type histogram,
 * largest scannable files) and what does it SAY about itself (README head,
 * manifest heads)?
 *
 * buildWorkspaceCensus / describeCensus are pure — the caller supplies the
 * file list and a readHead function, so they are fully unit-testable. Only
 * censusWorkspace at the bottom touches vscode (behind a lazy require, same
 * pattern as workspaceTools/projectProfile).
 *
 * BOUNDED I/O CONTRACT: buildWorkspaceCensus never consumes more than
 * CENSUS_READ_BUDGET_BYTES (~256KB) of readHead output in total; each single
 * head is additionally capped at CENSUS_HEAD_MAX_BYTES, and readHead is never
 * called once the budget is exhausted.
 */

/** Total bytes of readHead output the census may consume. */
export const CENSUS_READ_BUDGET_BYTES = 256 * 1024;
/** Per-file cap on consumed readHead output. */
export const CENSUS_HEAD_MAX_BYTES = 32 * 1024;
/** Lines kept from the README head. */
export const CENSUS_README_LINES = 60;
/** Lines kept per manifest head. */
export const CENSUS_MANIFEST_LINES = 40;
/** Manifest files read at most. */
export const CENSUS_MAX_MANIFESTS = 8;
/** Directory levels rendered in the tree. */
export const CENSUS_TREE_DEPTH = 3;
/** Directory lines rendered at most (excluding the root line). */
export const CENSUS_TREE_MAX_LINES = 60;
/** Extensions kept in the histogram. */
export const CENSUS_TOP_EXTENSIONS = 20;
/** Paths kept in largestSourceFiles. */
export const CENSUS_LARGEST_FILES = 15;
/** File enumeration cap for the vscode adapter. */
export const CENSUS_MAX_FILES = 4000;
/** Files larger than this are never read for heads (BOUNDED I/O CONTRACT). */
export const CENSUS_READ_FILE_MAX_BYTES = 262_144;
/** fs.stat concurrency for the vscode adapter. */
const CENSUS_STAT_BATCH = 200;

export interface CensusExtension {
  /** Lowercased extension with leading dot, or '(none)' for extensionless files. */
  ext: string;
  files: number;
  bytes: number;
}

export interface CensusManifestHead {
  path: string;
  /** First CENSUS_MANIFEST_LINES lines of the manifest. */
  head: string;
}

export interface WorkspaceCensus {
  /** Unique files enumerated (post-normalization). */
  totalFiles: number;
  /** Rendered directory tree, top CENSUS_TREE_DEPTH levels with entry counts. */
  dirTree: string;
  /** Top CENSUS_TOP_EXTENSIONS extensions by file count. */
  extensionHistogram: CensusExtension[];
  /** Top CENSUS_LARGEST_FILES scannable files (shouldScanPath filter) by size. */
  largestSourceFiles: string[];
  /** First CENSUS_README_LINES lines of the shallowest README, when present. */
  readmeHead?: string;
  /** Up to CENSUS_MAX_MANIFESTS manifest heads, shallowest first. */
  manifestHeads: CensusManifestHead[];
}

export interface CensusInputFile {
  path: string;
  size: number;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function normalizePath(raw: string): string {
  return raw.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function basenameOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}

function depthOf(path: string): number {
  return path.split('/').length;
}

// ---------------------------------------------------------------------------
// Directory tree
// ---------------------------------------------------------------------------

interface DirNode {
  children: Map<string, DirNode>;
  /** Files anywhere in this subtree. */
  subtreeFiles: number;
}

function buildDirNodes(paths: string[]): DirNode {
  const makeNode = (): DirNode => ({ children: new Map(), subtreeFiles: 0 });
  const root = makeNode();
  for (const path of paths) {
    const segments = path.split('/');
    root.subtreeFiles++;
    let node = root;
    for (let i = 0; i < segments.length - 1; i++) {
      let child = node.children.get(segments[i]);
      if (!child) {
        child = makeNode();
        node.children.set(segments[i], child);
      }
      child.subtreeFiles++;
      node = child;
    }
  }
  return root;
}

/**
 * Render the top maxDepth directory levels with subtree entry counts,
 * alphabetically, truncated at maxLines directory lines with a trailing
 * ellipsis. The first line is the root with the total file count.
 */
export function renderDirTree(
  paths: string[],
  maxDepth = CENSUS_TREE_DEPTH,
  maxLines = CENSUS_TREE_MAX_LINES
): string {
  const root = buildDirNodes(paths);
  const lines: string[] = [`. (${root.subtreeFiles} files)`];
  let dirLines = 0;
  let truncated = false;
  const visit = (node: DirNode, depth: number): void => {
    if (truncated) {
      return;
    }
    for (const name of [...node.children.keys()].sort()) {
      if (dirLines >= maxLines) {
        truncated = true;
        return;
      }
      const child = node.children.get(name) as DirNode;
      lines.push(`${'  '.repeat(depth - 1)}${name}/ (${child.subtreeFiles} files)`);
      dirLines++;
      if (depth < maxDepth) {
        visit(child, depth + 1);
      }
      if (truncated) {
        return;
      }
    }
  };
  visit(root, 1);
  if (truncated) {
    lines.push('… (more directories not shown)');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Extension histogram
// ---------------------------------------------------------------------------

function extensionOf(path: string): string {
  const base = basenameOf(path);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? `.${base.slice(dot + 1).toLowerCase()}` : '(none)';
}

function buildExtensionHistogram(files: CensusInputFile[]): CensusExtension[] {
  const byExt = new Map<string, { files: number; bytes: number }>();
  for (const file of files) {
    const ext = extensionOf(file.path);
    const entry = byExt.get(ext);
    if (entry) {
      entry.files++;
      entry.bytes += Math.max(0, file.size);
    } else {
      byExt.set(ext, { files: 1, bytes: Math.max(0, file.size) });
    }
  }
  return [...byExt.entries()]
    .map(([ext, { files: count, bytes }]) => ({ ext, files: count, bytes }))
    .sort((a, b) => b.files - a.files || b.bytes - a.bytes || a.ext.localeCompare(b.ext))
    .slice(0, CENSUS_TOP_EXTENSIONS);
}

// ---------------------------------------------------------------------------
// README and manifest selection
// ---------------------------------------------------------------------------

const README_NAME_RE = /^readme(\.|$)/i;

/** Exact (lowercased) manifest basenames worth showing to a planning agent. */
const MANIFEST_BASENAMES = new Set([
  'package.json',
  'pubspec.yaml',
  'go.mod',
  'cargo.toml',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
  'requirements.txt',
  'pyproject.toml',
  'gemfile',
  'composer.json',
  'package.swift',
  'podfile',
  'makefile',
  'dockerfile',
  'cmakelists.txt',
  'mix.exs',
  'rebar.config',
  'build.sbt',
  'stack.yaml',
  'deno.json',
  'deno.jsonc',
  'project.clj',
  'meson.build',
  'build.zig',
  'dune-project',
]);

/** Manifest-ish extensions with variable basenames. */
const MANIFEST_SUFFIXES = ['.csproj', '.cabal', '.gemspec', '.rockspec', '.nimble', '.podspec'];

function isManifestPath(path: string): boolean {
  const base = basenameOf(path).toLowerCase();
  return MANIFEST_BASENAMES.has(base) || MANIFEST_SUFFIXES.some((s) => base.endsWith(s));
}

/** Shallowest README first; ties broken by path. */
export function pickReadmePath(paths: string[]): string | undefined {
  return paths
    .filter((path) => README_NAME_RE.test(basenameOf(path)) && shouldScanPath(path))
    .sort((a, b) => depthOf(a) - depthOf(b) || a.localeCompare(b))[0];
}

/** Up to maxManifests manifest paths, shallowest first, vendored dirs excluded. */
export function pickManifestPaths(paths: string[], maxManifests = CENSUS_MAX_MANIFESTS): string[] {
  return paths
    .filter((path) => isManifestPath(path) && shouldScanPath(path))
    .sort((a, b) => depthOf(a) - depthOf(b) || a.localeCompare(b))
    .slice(0, maxManifests);
}

function firstLines(text: string, maxLines: number): string {
  return text.split('\n').slice(0, maxLines).join('\n');
}

// ---------------------------------------------------------------------------
// buildWorkspaceCensus
// ---------------------------------------------------------------------------

/**
 * Build the census from an enumerated file list and a head reader. Pure aside
 * from the caller-supplied readHead; consumes at most CENSUS_READ_BUDGET_BYTES
 * of readHead output in total (CENSUS_HEAD_MAX_BYTES per file) and never calls
 * readHead once the budget is spent. A readHead failure skips that file.
 */
export async function buildWorkspaceCensus(
  files: CensusInputFile[],
  readHead: (path: string) => Promise<string>
): Promise<WorkspaceCensus> {
  const byPath = new Map<string, CensusInputFile>();
  for (const file of files) {
    const path = normalizePath(file.path);
    if (path !== '' && !byPath.has(path)) {
      byPath.set(path, { path, size: file.size });
    }
  }
  const unique = [...byPath.values()];
  const paths = unique.map((file) => file.path);

  let budget = CENSUS_READ_BUDGET_BYTES;
  const readCapped = async (path: string): Promise<string | undefined> => {
    if (budget <= 0) {
      return undefined;
    }
    let raw: string;
    try {
      raw = await readHead(path);
    } catch {
      return undefined; // unreadable — skip
    }
    const head = raw.slice(0, Math.min(CENSUS_HEAD_MAX_BYTES, budget));
    budget -= head.length;
    return head;
  };

  const readmePath = pickReadmePath(paths);
  let readmeHead: string | undefined;
  if (readmePath !== undefined) {
    const head = await readCapped(readmePath);
    if (head !== undefined && head !== '') {
      readmeHead = firstLines(head, CENSUS_README_LINES);
    }
  }

  const manifestHeads: CensusManifestHead[] = [];
  for (const path of pickManifestPaths(paths)) {
    const head = await readCapped(path);
    if (head !== undefined) {
      manifestHeads.push({ path, head: firstLines(head, CENSUS_MANIFEST_LINES) });
    }
  }

  const largestSourceFiles = unique
    .filter((file) => shouldScanPath(file.path))
    .sort((a, b) => b.size - a.size || a.path.localeCompare(b.path))
    .slice(0, CENSUS_LARGEST_FILES)
    .map((file) => file.path);

  return {
    totalFiles: unique.length,
    dirTree: renderDirTree(paths),
    extensionHistogram: buildExtensionHistogram(unique),
    largestSourceFiles,
    readmeHead,
    manifestHeads,
  };
}

// ---------------------------------------------------------------------------
// describeCensus
// ---------------------------------------------------------------------------

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Compact plain-text census block an exploration agent can plan from. */
export function describeCensus(census: WorkspaceCensus): string {
  const parts: string[] = [`## Workspace census (${census.totalFiles} files)`];
  parts.push(`### Directory tree (top ${CENSUS_TREE_DEPTH} levels)\n${census.dirTree}`);
  if (census.extensionHistogram.length > 0) {
    const rows = census.extensionHistogram
      .map((entry) => `- ${entry.ext}: ${entry.files} file(s), ${formatSize(entry.bytes)}`)
      .join('\n');
    parts.push(`### File types (top ${CENSUS_TOP_EXTENSIONS} by count)\n${rows}`);
  }
  if (census.largestSourceFiles.length > 0) {
    parts.push(
      `### Largest scannable files\n${census.largestSourceFiles.map((path) => `- ${path}`).join('\n')}`
    );
  }
  if (census.readmeHead !== undefined) {
    parts.push(`### README (first ${CENSUS_README_LINES} lines)\n${census.readmeHead}`);
  }
  for (const manifest of census.manifestHeads) {
    parts.push(`### Manifest: ${manifest.path}\n${manifest.head}`);
  }
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// vscode adapter
// ---------------------------------------------------------------------------

/**
 * Enumerate a workspace folder (bounded, SCAN_EXCLUDE_GLOB respected) and
 * build its census. Thin adapter: two-pass findFiles + batched stat for
 * sizes; readHead skips files over CENSUS_READ_FILE_MAX_BYTES (readFile has
 * no ranged read, so oversized files must not be materialized) and caps the
 * decoded head at CENSUS_HEAD_MAX_BYTES. All the logic lives in the pure
 * buildWorkspaceCensus above.
 */
export async function censusWorkspace(workspaceRoot: vscode.Uri): Promise<WorkspaceCensus> {
  // Lazy so the pure exports above stay importable outside the extension host.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const vs: typeof import('vscode') = require('vscode');

  // Two-pass enumeration (source extensions first, then everything else) so
  // asset-heavy repos cannot crowd source files out of the findFiles cap.
  const uris = await enumerateScanCandidates(CENSUS_MAX_FILES, workspaceRoot);
  const rootPath = workspaceRoot.path.endsWith('/') ? workspaceRoot.path : `${workspaceRoot.path}/`;
  const relative = (uri: vscode.Uri): string =>
    uri.path.startsWith(rootPath) ? uri.path.slice(rootPath.length) : uri.path;

  const files: CensusInputFile[] = [];
  for (let i = 0; i < uris.length; i += CENSUS_STAT_BATCH) {
    const batch = await Promise.all(
      uris.slice(i, i + CENSUS_STAT_BATCH).map(async (uri) => {
        let size = 0;
        try {
          size = (await vs.workspace.fs.stat(uri)).size;
        } catch {
          // Unreadable file — size stays 0; the path still shapes the tree.
        }
        return { path: relative(uri), size };
      })
    );
    files.push(...batch);
  }

  const readHead = async (path: string): Promise<string> => {
    const uri = vs.Uri.joinPath(workspaceRoot, ...path.split('/'));
    // BOUNDED I/O CONTRACT: readFile materializes the WHOLE file, so oversized
    // files (multi-MB READMEs/manifests) are skipped instead of read-then-cut.
    const stat = await vs.workspace.fs.stat(uri);
    if (stat.size > CENSUS_READ_FILE_MAX_BYTES) {
      throw new Error(`census head skipped: ${path} is ${stat.size} bytes`);
    }
    const data = await vs.workspace.fs.readFile(uri);
    return Buffer.from(data.slice(0, CENSUS_HEAD_MAX_BYTES)).toString('utf-8');
  };

  return buildWorkspaceCensus(files, readHead);
}
