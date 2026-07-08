import type * as vscode from 'vscode';
import { SCAN_EXCLUDE_GLOB } from './heuristics.js';
import { ECOSYSTEMS, manifestRulesForFile, matchesManifestFile } from './ecosystems.js';

/**
 * Project profiling: figure out what kind of project(s) a workspace contains
 * before any scanning starts. The detection functions are pure — they take
 * file lists plus manifest contents and never touch disk — so they are fully
 * unit-testable; only profileWorkspace at the bottom talks to vscode (behind
 * a lazy require, same pattern as workspaceTools).
 */

export type ProjectKind =
  | 'web'
  | 'mobile-android'
  | 'mobile-ios'
  | 'kmp'
  | 'react-native'
  | 'flutter'
  | 'ionic-capacitor'
  | 'backend'
  | 'library'
  | 'unknown';

export type ApiDirection = 'consumes' | 'serves' | 'both';

export interface ProjectProfile {
  /** Workspace-relative subproject root; '' when the project is the workspace root. */
  rootPath: string;
  kind: ProjectKind;
  frameworks: string[];
  direction: ApiDirection;
  confidence: 'high' | 'medium' | 'low';
  /** API spec files (OpenAPI/Swagger, proto, GraphQL, Postman) relevant to this project. */
  specFiles: string[];
  evidence: string[];
}

export interface ProfileInputFile {
  path: string;
  /** Provided for manifest files only; the caller does all I/O. */
  content?: string;
}

// ---------------------------------------------------------------------------
// Path helpers (pure, '/'-separated workspace-relative paths)
// ---------------------------------------------------------------------------

const EXCLUDED_DIR_SEGMENTS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  '.git',
  'target',
  'Pods',
  'vendor',
  '.mocklify',
  'coverage',
  '__pycache__',
]);

function normalizePath(raw: string): string {
  return raw.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
}

function isExcludedPath(path: string): boolean {
  return path
    .split('/')
    .slice(0, -1)
    .some((segment) => EXCLUDED_DIR_SEGMENTS.has(segment));
}

function dirnameOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

function basenameOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}

/** True when `path` is inside directory `dir` ('' means the workspace root). */
function isInsideDir(dir: string, path: string): boolean {
  return dir === '' || path === dir || path.startsWith(`${dir}/`);
}

/** True when directory `child` is strictly below directory `ancestor`. */
function isStrictSubdir(ancestor: string, child: string): boolean {
  return ancestor !== child && (ancestor === '' || child.startsWith(`${ancestor}/`));
}

function describeDir(dir: string): string {
  return dir === '' ? 'workspace root' : `${dir}/`;
}

// ---------------------------------------------------------------------------
// Spec file discovery
// ---------------------------------------------------------------------------

const SPEC_NAME_PATTERNS: RegExp[] = [
  /^(openapi|swagger)[\w.-]*\.(json|ya?ml)$/i,
  /\.proto$/i,
  /\.(graphql|gql)$/i,
  /postman_collection\.json$/i,
];

/**
 * Filter a path list down to API specification files: OpenAPI/Swagger
 * documents, protobuf schemas, GraphQL schemas, and Postman collections.
 * These power the spec-first import shortcut.
 */
export function findSpecFiles(paths: string[]): string[] {
  const results: string[] = [];
  for (const raw of paths) {
    const path = normalizePath(raw);
    if (path === '' || isExcludedPath(path)) {
      continue;
    }
    const name = basenameOf(path);
    const inSpecDir =
      /\.(json|ya?ml)$/i.test(name) && /(^|\/)(openapi|swagger)(\/|$)/i.test(dirnameOf(path));
    if ((SPEC_NAME_PATTERNS.some((p) => p.test(name)) || inSpecDir) && !results.includes(path)) {
      results.push(path);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Manifest classification tables — derived from the ecosystem registry
// ---------------------------------------------------------------------------

interface FrameworkRule {
  test: RegExp;
  name: string;
}

/**
 * Framework rules for a manifest file, in registry order, optionally
 * narrowed by the owning pack's direction/kind. Computed on demand so packs
 * added via registerEcosystem participate in profiling too.
 */
function frameworkRulesFor(
  fileName: string,
  filter?: { direction?: ApiDirection; kind?: ProjectKind }
): FrameworkRule[] {
  const rules: FrameworkRule[] = [];
  for (const rule of manifestRulesForFile(fileName, filter)) {
    if (rule.contentPattern !== undefined) {
      rules.push({ test: rule.contentPattern, name: rule.framework });
    }
  }
  return rules;
}

const nodeBackendDeps = (): FrameworkRule[] =>
  frameworkRulesFor('package.json', { direction: 'serves' });
const nodeWebDeps = (): FrameworkRule[] =>
  frameworkRulesFor('package.json', { direction: 'consumes', kind: 'web' });
const goFrameworks = (): FrameworkRule[] => frameworkRulesFor('go.mod');
const pythonFrameworks = (): FrameworkRule[] => frameworkRulesFor('requirements.txt');
const androidHttpLibs = (): FrameworkRule[] =>
  frameworkRulesFor('build.gradle', { direction: 'consumes' });
const iosHttpLibs = (): FrameworkRule[] => frameworkRulesFor('Podfile');

/** Manifest content pattern of a specific pack — the registry must have it. */
function requiredPattern(packId: string, fileName: string): RegExp {
  const pack = ECOSYSTEMS.find((p) => p.id === packId);
  const rule = pack?.manifestRules.find(
    (r) => matchesManifestFile(r.file, fileName) && r.contentPattern !== undefined
  );
  if (!rule?.contentPattern) {
    throw new Error(`ecosystem registry is missing the '${packId}' manifest rule for ${fileName}`);
  }
  return rule.contentPattern;
}

function matchedFrameworks(rules: FrameworkRule[], probe: (rule: FrameworkRule) => boolean): string[] {
  const names: string[] = [];
  for (const rule of rules) {
    if (probe(rule) && !names.includes(rule.name)) {
      names.push(rule.name);
    }
  }
  return names;
}

function contentFrameworks(rules: FrameworkRule[], text: string): string[] {
  return matchedFrameworks(rules, (rule) => rule.test.test(text));
}

// ---------------------------------------------------------------------------
// Candidate collection
// ---------------------------------------------------------------------------

const GRADLE_NAMES = new Set([
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
]);

const SIMPLE_MANIFEST_NAMES = new Set([
  'package.json',
  'pubspec.yaml',
  'pom.xml',
  'go.mod',
  'requirements.txt',
  'pyproject.toml',
  'Gemfile',
  'composer.json',
  'Package.swift',
  'Podfile',
]);

interface Candidate {
  dir: string;
  names: Map<string, string | undefined>;
  hasGradle: boolean;
  gradleTexts: string[];
  hasPom: boolean;
  pomTexts: string[];
  hasCsproj: boolean;
  csprojTexts: string[];
  hasXcodeproj: boolean;
  hasAndroidManifest: boolean;
  androidManifestPath?: string;
  hasCommonMain: boolean;
  hasPodspec: boolean;
}

function newCandidate(dir: string): Candidate {
  return {
    dir,
    names: new Map(),
    hasGradle: false,
    gradleTexts: [],
    hasPom: false,
    pomTexts: [],
    hasCsproj: false,
    csprojTexts: [],
    hasXcodeproj: false,
    hasAndroidManifest: false,
    hasCommonMain: false,
    hasPodspec: false,
  };
}

function parseJsonObject(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function depKeys(pkg: Record<string, unknown>): string[] {
  const keys: string[] = [];
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const section = pkg[field];
    if (typeof section === 'object' && section !== null) {
      for (const key of Object.keys(section)) {
        if (!keys.includes(key)) {
          keys.push(key);
        }
      }
    }
  }
  return keys;
}

function makeProfile(
  rootPath: string,
  kind: ProjectKind,
  frameworks: string[],
  direction: ApiDirection,
  confidence: 'high' | 'medium' | 'low',
  evidence: string[]
): ProjectProfile {
  return { rootPath, kind, frameworks, direction, confidence, specFiles: [], evidence };
}

// ---------------------------------------------------------------------------
// Per-ecosystem classification
// ---------------------------------------------------------------------------

function classifyNode(candidate: Candidate, hasNestedNodeProjects: boolean): ProjectProfile | undefined {
  const at = candidate.dir === '' ? 'package.json' : `${candidate.dir}/package.json`;
  const pkg = parseJsonObject(candidate.names.get('package.json'));
  if (!pkg) {
    return makeProfile(candidate.dir, 'unknown', [], 'consumes', 'low', [
      `${at} present but its content was not readable`,
    ]);
  }
  const deps = depKeys(pkg);
  const has = (re: RegExp): boolean => deps.some((d) => re.test(d));

  if (has(/^react-native$/) || has(/^expo$/)) {
    const frameworks = has(/^expo$/) ? ['Expo'] : [];
    const dep = has(/^react-native$/) ? 'react-native' : 'expo';
    return makeProfile(candidate.dir, 'react-native', frameworks, 'consumes', 'high', [
      `${at} depends on ${dep}`,
    ]);
  }

  if (has(/^@capacitor\//)) {
    const frameworks: string[] = [];
    if (has(/^@ionic\/react$/) || has(/^(react|react-dom)$/)) {
      frameworks.push('React');
    } else if (has(/^@ionic\/angular$/) || has(/^@angular\/core$/)) {
      frameworks.push('Angular');
    } else if (has(/^@ionic\/vue$/) || has(/^vue$/)) {
      frameworks.push('Vue');
    }
    const hasIonic = has(/^@ionic\//);
    return makeProfile(
      candidate.dir,
      'ionic-capacitor',
      frameworks,
      'consumes',
      hasIonic ? 'high' : 'medium',
      [`${at} depends on ${hasIonic ? '@ionic/* and @capacitor/*' : '@capacitor/*'}`]
    );
  }

  if (has(/^next$/)) {
    return makeProfile(candidate.dir, 'web', ['Next.js'], 'both', 'high', [
      `${at} depends on next (fullstack: pages consume APIs, API routes serve them)`,
    ]);
  }

  const backend = matchedFrameworks(nodeBackendDeps(), (rule) => has(rule.test));
  const web = matchedFrameworks(nodeWebDeps(), (rule) => has(rule.test));
  if (backend.length > 0 && web.length > 0) {
    return makeProfile(candidate.dir, 'web', [...web, ...backend], 'both', 'medium', [
      `${at} mixes client (${web.join(', ')}) and server (${backend.join(', ')}) dependencies`,
    ]);
  }
  if (backend.length > 0) {
    return makeProfile(candidate.dir, 'backend', backend, 'serves', 'high', [
      `${at} depends on ${backend.join(', ')}`,
    ]);
  }
  if (web.length > 0) {
    return makeProfile(candidate.dir, 'web', web, 'consumes', 'high', [
      `${at} depends on ${web.join(', ')}`,
    ]);
  }
  if (pkg.workspaces !== undefined && hasNestedNodeProjects) {
    return undefined; // monorepo aggregator root — subprojects carry the profiles
  }
  return makeProfile(candidate.dir, 'library', [], 'consumes', 'low', [
    `${at} has no recognizable app or server framework dependencies`,
  ]);
}

function classifyGradle(candidate: Candidate): ProjectProfile {
  const text = candidate.gradleTexts.join('\n');
  const at = describeDir(candidate.dir);
  const multiplatform = /multiplatform/i.test(text);
  // Multi-module folding merges every module's build text into this
  // candidate, so an app family and a server family can both match. Picking
  // one direction would silently drop the other API surface — report 'both'.
  const serverFamily = requiredPattern('spring', 'build.gradle').test(text)
    ? 'Spring Boot'
    : requiredPattern('ktor-server', 'build.gradle').test(text)
      ? 'Ktor server'
      : undefined;
  if (multiplatform || candidate.hasCommonMain) {
    const frameworks = /io\.ktor/.test(text) ? ['Ktor'] : [];
    const evidence = multiplatform
      ? [`Gradle build at ${at} applies the Kotlin Multiplatform plugin`]
      : [
          `commonMain source set${candidate.hasPodspec ? ' and .podspec' : ''} under ${at} indicates Kotlin Multiplatform`,
        ];
    if (serverFamily) {
      evidence.push(`a module in this build also uses ${serverFamily}, so it serves an API too`);
    }
    return makeProfile(
      candidate.dir,
      'kmp',
      frameworks,
      serverFamily ? 'both' : 'consumes',
      multiplatform ? 'high' : 'medium',
      evidence
    );
  }
  const androidPlugin = /com\.android\.application/.test(text);
  const android = candidate.hasAndroidManifest || androidPlugin;
  if (serverFamily === 'Spring Boot') {
    if (android) {
      const evidence = [`Gradle build at ${at} mixes Spring Boot and Android application modules`];
      if (candidate.androidManifestPath) {
        evidence.push(`AndroidManifest.xml at ${candidate.androidManifestPath}`);
      }
      return makeProfile(
        candidate.dir,
        'backend',
        ['Spring Boot', ...contentFrameworks(androidHttpLibs(), text)],
        'both',
        'medium',
        evidence
      );
    }
    return makeProfile(candidate.dir, 'backend', ['Spring Boot'], 'serves', 'high', [
      `Gradle build at ${at} uses Spring Boot`,
    ]);
  }
  if (android) {
    const evidence: string[] = [];
    if (candidate.androidManifestPath) {
      evidence.push(`AndroidManifest.xml at ${candidate.androidManifestPath}`);
    }
    if (androidPlugin) {
      evidence.push(`Gradle build at ${at} applies com.android.application`);
    }
    return makeProfile(
      candidate.dir,
      'mobile-android',
      contentFrameworks(androidHttpLibs(), text),
      'consumes',
      candidate.hasAndroidManifest ? 'high' : 'medium',
      evidence
    );
  }
  return makeProfile(candidate.dir, 'library', [], 'consumes', 'low', [
    `Gradle build at ${at} without Android or server markers`,
  ]);
}

function classifyPom(candidate: Candidate): ProjectProfile {
  const text = candidate.pomTexts.join('\n');
  const at = describeDir(candidate.dir);
  if (requiredPattern('spring', 'pom.xml').test(text)) {
    return makeProfile(candidate.dir, 'backend', ['Spring Boot'], 'serves', 'high', [
      `pom.xml at ${at} uses Spring Boot`,
    ]);
  }
  return makeProfile(candidate.dir, 'library', [], 'consumes', 'low', [
    `pom.xml at ${at} without Spring Boot`,
  ]);
}

function classifyIos(candidate: Candidate): ProjectProfile {
  const markers: string[] = [];
  if (candidate.hasXcodeproj) {
    markers.push('Xcode project');
  }
  if (candidate.names.has('Podfile')) {
    markers.push('Podfile');
  }
  if (candidate.names.has('Package.swift')) {
    markers.push('Package.swift');
  }
  const text = `${candidate.names.get('Podfile') ?? ''}\n${candidate.names.get('Package.swift') ?? ''}`;
  const packageSwiftOnly = !candidate.hasXcodeproj && !candidate.names.has('Podfile');
  return makeProfile(
    candidate.dir,
    'mobile-ios',
    contentFrameworks(iosHttpLibs(), text),
    'consumes',
    packageSwiftOnly ? 'medium' : 'high',
    [`${markers.join(' + ')} at ${describeDir(candidate.dir)}`]
  );
}

function classifyFlutter(candidate: Candidate): ProjectProfile {
  const raw = candidate.names.get('pubspec.yaml') ?? '';
  const at = describeDir(candidate.dir);
  const usesFlutter = /(^|\n)\s*flutter\s*:/.test(raw) || /sdk:\s*flutter/.test(raw);
  const frameworks = contentFrameworks(frameworkRulesFor('pubspec.yaml'), raw);
  return makeProfile(candidate.dir, 'flutter', frameworks, 'consumes', usesFlutter ? 'high' : 'medium', [
    usesFlutter ? `pubspec.yaml at ${at} uses the Flutter SDK` : `pubspec.yaml at ${at} (Dart package)`,
  ]);
}

function classifyGo(candidate: Candidate): ProjectProfile {
  const text = candidate.names.get('go.mod') ?? '';
  const at = describeDir(candidate.dir);
  const frameworks = contentFrameworks(goFrameworks(), text);
  if (frameworks.length > 0) {
    return makeProfile(candidate.dir, 'backend', frameworks, 'serves', 'high', [
      `go.mod at ${at} requires ${frameworks.join(', ')}`,
    ]);
  }
  return makeProfile(candidate.dir, 'unknown', [], 'consumes', 'low', [
    `go.mod at ${at} without a recognized web framework`,
  ]);
}

function classifyPython(candidate: Candidate): ProjectProfile {
  const text = `${candidate.names.get('requirements.txt') ?? ''}\n${candidate.names.get('pyproject.toml') ?? ''}`;
  const at = describeDir(candidate.dir);
  const frameworks = contentFrameworks(pythonFrameworks(), text);
  if (frameworks.length > 0) {
    return makeProfile(candidate.dir, 'backend', frameworks, 'serves', 'high', [
      `Python dependencies at ${at} include ${frameworks.join(', ')}`,
    ]);
  }
  return makeProfile(candidate.dir, 'unknown', [], 'consumes', 'low', [
    `Python project at ${at} without a recognized web framework`,
  ]);
}

function classifyRuby(candidate: Candidate): ProjectProfile {
  const text = candidate.names.get('Gemfile') ?? '';
  const at = describeDir(candidate.dir);
  if (requiredPattern('rails', 'Gemfile').test(text)) {
    return makeProfile(candidate.dir, 'backend', ['Rails'], 'serves', 'high', [
      `Gemfile at ${at} includes rails`,
    ]);
  }
  return makeProfile(candidate.dir, 'unknown', [], 'consumes', 'low', [
    `Gemfile at ${at} without rails`,
  ]);
}

function classifyCsproj(candidate: Candidate): ProjectProfile {
  const text = candidate.csprojTexts.join('\n');
  const at = describeDir(candidate.dir);
  if (requiredPattern('aspnet', 'project.csproj').test(text)) {
    return makeProfile(candidate.dir, 'backend', ['ASP.NET Core'], 'serves', 'high', [
      `.csproj at ${at} targets ASP.NET Core`,
    ]);
  }
  return makeProfile(candidate.dir, 'library', [], 'consumes', 'low', [
    `.csproj at ${at} without ASP.NET Core`,
  ]);
}

function classifyComposer(candidate: Candidate): ProjectProfile {
  const at = describeDir(candidate.dir);
  const pkg = parseJsonObject(candidate.names.get('composer.json'));
  const requires =
    pkg && typeof pkg.require === 'object' && pkg.require !== null ? Object.keys(pkg.require) : [];
  const laravelPattern = requiredPattern('laravel', 'composer.json');
  if (requires.some((key) => laravelPattern.test(key))) {
    return makeProfile(candidate.dir, 'backend', ['Laravel'], 'serves', 'high', [
      `composer.json at ${at} requires laravel/framework`,
    ]);
  }
  if (requires.some((key) => key.startsWith('symfony/'))) {
    return makeProfile(candidate.dir, 'backend', ['Symfony'], 'serves', 'high', [
      `composer.json at ${at} requires symfony packages`,
    ]);
  }
  return makeProfile(candidate.dir, 'unknown', [], 'consumes', 'low', [
    `composer.json at ${at} without a recognized framework`,
  ]);
}

function classifyCandidate(candidate: Candidate, hasNestedNodeProjects: boolean): ProjectProfile | undefined {
  if (candidate.names.has('pubspec.yaml')) {
    return classifyFlutter(candidate);
  }
  if (candidate.names.has('package.json')) {
    const profile = classifyNode(candidate, hasNestedNodeProjects);
    if (profile) {
      return profile;
    }
  }
  if (candidate.hasGradle) {
    return classifyGradle(candidate);
  }
  if (candidate.hasPom) {
    return classifyPom(candidate);
  }
  if (candidate.hasXcodeproj || candidate.names.has('Podfile') || candidate.names.has('Package.swift')) {
    return classifyIos(candidate);
  }
  if (candidate.names.has('go.mod')) {
    return classifyGo(candidate);
  }
  if (candidate.names.has('requirements.txt') || candidate.names.has('pyproject.toml')) {
    return classifyPython(candidate);
  }
  if (candidate.names.has('Gemfile')) {
    return classifyRuby(candidate);
  }
  if (candidate.hasCsproj) {
    return classifyCsproj(candidate);
  }
  if (candidate.names.has('composer.json')) {
    return classifyComposer(candidate);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// detectProjects
// ---------------------------------------------------------------------------

/** Kinds that own their nested native shells (android/, ios/, iosApp/, …). */
const CONTAINER_KINDS = new Set<ProjectKind>(['react-native', 'flutter', 'ionic-capacitor', 'kmp']);

const NATIVE_SHELL_DIRS = [
  'android',
  'ios',
  'macos',
  'windows',
  'linux',
  'androidApp',
  'iosApp',
  'desktopApp',
];

/**
 * Detect the project(s) present in a workspace from a file list. `content`
 * is expected only on manifest files (package.json, gradle files, pubspec,
 * go.mod, …); everything else contributes structure only. Returns one
 * profile per detected subproject — a react-native/flutter/ionic app with
 * android/ and ios/ shells is ONE project — or a single low-confidence
 * `unknown` profile when nothing is recognizable.
 */
export function detectProjects(files: ProfileInputFile[]): ProjectProfile[] {
  const candidates = new Map<string, Candidate>();
  const ensure = (dir: string): Candidate => {
    let candidate = candidates.get(dir);
    if (!candidate) {
      candidate = newCandidate(dir);
      candidates.set(dir, candidate);
    }
    return candidate;
  };

  const allPaths: string[] = [];
  const androidManifestPaths: string[] = [];
  const commonMainDirs: string[] = [];
  const podspecDirs: string[] = [];

  for (const file of files) {
    const path = normalizePath(file.path);
    if (path === '' || isExcludedPath(path)) {
      continue;
    }
    allPaths.push(path);
    const segments = path.split('/');
    const name = segments[segments.length - 1];

    const xcodeIndex = segments.findIndex((s) => s.endsWith('.xcodeproj'));
    if (xcodeIndex >= 0) {
      ensure(segments.slice(0, xcodeIndex).join('/')).hasXcodeproj = true;
      continue;
    }
    const commonMainIndex = segments.findIndex(
      (s, i) => s === 'commonMain' && segments[i - 1] === 'src'
    );
    if (commonMainIndex >= 1) {
      commonMainDirs.push(segments.slice(0, commonMainIndex - 1).join('/'));
    }
    if (name === 'AndroidManifest.xml') {
      androidManifestPaths.push(path);
      continue;
    }
    if (name.endsWith('.podspec')) {
      podspecDirs.push(dirnameOf(path));
      continue;
    }

    const dir = dirnameOf(path);
    if (GRADLE_NAMES.has(name)) {
      const candidate = ensure(dir);
      candidate.names.set(name, file.content);
      candidate.hasGradle = true;
      if (file.content) {
        candidate.gradleTexts.push(file.content);
      }
    } else if (name === 'pom.xml') {
      const candidate = ensure(dir);
      candidate.names.set(name, file.content);
      candidate.hasPom = true;
      if (file.content) {
        candidate.pomTexts.push(file.content);
      }
    } else if (name.endsWith('.csproj')) {
      const candidate = ensure(dir);
      candidate.hasCsproj = true;
      if (file.content) {
        candidate.csprojTexts.push(file.content);
      }
    } else if (SIMPLE_MANIFEST_NAMES.has(name)) {
      ensure(dir).names.set(name, file.content);
    }
  }

  // Fold multi-module Gradle/Maven builds into their topmost root so an
  // Android app with root settings.gradle + app/build.gradle is one project.
  for (const marker of ['gradle', 'pom'] as const) {
    const flag = marker === 'gradle' ? 'hasGradle' : 'hasPom';
    const texts = marker === 'gradle' ? 'gradleTexts' : 'pomTexts';
    const dirs = [...candidates.values()].filter((c) => c[flag]).map((c) => c.dir);
    const roots = dirs.filter((dir) => !dirs.some((other) => isStrictSubdir(other, dir)));
    for (const dir of dirs) {
      if (roots.includes(dir)) {
        continue;
      }
      const root = roots.find((r) => isStrictSubdir(r, dir));
      const child = candidates.get(dir);
      if (root === undefined || !child) {
        continue;
      }
      const rootCandidate = ensure(root);
      rootCandidate[texts].push(...child[texts]);
      child[flag] = false;
      child[texts] = [];
      for (const name of [...child.names.keys()]) {
        if ((marker === 'gradle' && GRADLE_NAMES.has(name)) || (marker === 'pom' && name === 'pom.xml')) {
          child.names.delete(name);
        }
      }
      if (child.names.size === 0 && !child.hasXcodeproj && !child.hasCsproj) {
        candidates.delete(dir);
      }
    }
  }

  // Attach structural hints to the deepest enclosing Gradle root.
  const gradleCandidates = [...candidates.values()].filter((c) => c.hasGradle);
  const deepestGradleFor = (path: string): Candidate | undefined => {
    let best: Candidate | undefined;
    for (const candidate of gradleCandidates) {
      if (isInsideDir(candidate.dir, path) && (!best || candidate.dir.length > best.dir.length)) {
        best = candidate;
      }
    }
    return best;
  };
  for (const manifestPath of androidManifestPaths) {
    const owner = deepestGradleFor(manifestPath);
    if (owner) {
      owner.hasAndroidManifest = true;
      owner.androidManifestPath = owner.androidManifestPath ?? manifestPath;
    }
  }
  for (const dir of commonMainDirs) {
    const owner = deepestGradleFor(dir);
    if (owner) {
      owner.hasCommonMain = true;
    }
  }
  for (const dir of podspecDirs) {
    const owner = deepestGradleFor(dir);
    if (owner) {
      owner.hasPodspec = true;
    }
  }

  const nodeDirs = [...candidates.values()]
    .filter((c) => c.names.has('package.json'))
    .map((c) => c.dir);
  let profiles: ProjectProfile[] = [];
  for (const candidate of candidates.values()) {
    const hasNestedNode = nodeDirs.some((dir) => isStrictSubdir(candidate.dir, dir));
    const profile = classifyCandidate(candidate, hasNestedNode);
    if (profile) {
      profiles.push(profile);
    }
  }

  // A cross-platform app owns its native shells: fold android/, ios/, … back
  // into the container instead of reporting them as separate projects.
  const containers = profiles.filter((p) => CONTAINER_KINDS.has(p.kind));
  profiles = profiles.filter((profile) => {
    for (const container of containers) {
      if (container === profile) {
        continue;
      }
      for (const shell of NATIVE_SHELL_DIRS) {
        const shellDir = container.rootPath === '' ? shell : `${container.rootPath}/${shell}`;
        if (profile.rootPath === shellDir || profile.rootPath.startsWith(`${shellDir}/`)) {
          const note = `${shellDir}/ is the native shell of this app`;
          if (!container.evidence.includes(note)) {
            container.evidence.push(note);
          }
          return false;
        }
      }
    }
    return true;
  });

  const specs = findSpecFiles(allPaths);
  if (profiles.length === 0) {
    if (allPaths.length === 0) {
      return [];
    }
    const fallback = makeProfile('', 'unknown', [], 'consumes', 'low', [
      'no recognizable project manifests found',
    ]);
    fallback.specFiles = specs;
    return [fallback];
  }

  for (const spec of specs) {
    let best: ProjectProfile | undefined;
    for (const profile of profiles) {
      if (
        isInsideDir(profile.rootPath, spec) &&
        (!best || profile.rootPath.length > best.rootPath.length)
      ) {
        best = profile;
      }
    }
    if (best) {
      best.specFiles.push(spec);
    } else {
      // Shared spec outside every project root — relevant to all of them.
      for (const profile of profiles) {
        profile.specFiles.push(spec);
      }
    }
  }

  profiles.sort((a, b) => {
    const depthA = a.rootPath === '' ? 0 : a.rootPath.split('/').length;
    const depthB = b.rootPath === '' ? 0 : b.rootPath.split('/').length;
    return depthA - depthB || a.rootPath.localeCompare(b.rootPath);
  });
  return profiles;
}

// ---------------------------------------------------------------------------
// describeProfiles
// ---------------------------------------------------------------------------

const KIND_LABELS: Record<ProjectKind, string> = {
  web: 'Web app',
  'mobile-android': 'Android app',
  'mobile-ios': 'iOS app',
  kmp: 'Kotlin Multiplatform app',
  'react-native': 'React Native app',
  flutter: 'Flutter app',
  'ionic-capacitor': 'Ionic/Capacitor app',
  backend: 'Backend service',
  library: 'Library',
  unknown: 'Unrecognized project',
};

function profileLabel(profile: ProjectProfile): string {
  if (profile.kind === 'backend') {
    return profile.frameworks.length > 0 ? `${profile.frameworks[0]} backend` : KIND_LABELS.backend;
  }
  const label = KIND_LABELS[profile.kind];
  return profile.frameworks.length > 0 ? `${label} (${profile.frameworks.join(', ')})` : label;
}

/** Compact one-line inventory of the detected projects and spec files. */
export function describeProfiles(profiles: ProjectProfile[]): string {
  if (profiles.length === 0) {
    return 'Detected: no recognizable projects.';
  }
  const parts = profiles.map(
    (p) => `${profileLabel(p)} at ${describeDir(p.rootPath)} [${p.direction}]`
  );
  const seen: string[] = [];
  for (const profile of profiles) {
    for (const spec of profile.specFiles) {
      if (!seen.includes(spec)) {
        seen.push(spec);
        parts.push(`${basenameOf(spec)} found at ${spec}`);
      }
    }
  }
  return `Detected: ${parts.join('; ')}`;
}

// ---------------------------------------------------------------------------
// vscode adapter
// ---------------------------------------------------------------------------

export const MANIFEST_MAX_BYTES = 64 * 1024;
export const PROFILE_MAX_MANIFESTS = 300;
export const PROFILE_MAX_SPECS = 100;

const PROFILE_MANIFEST_GLOB =
  '**/{package.json,build.gradle,build.gradle.kts,settings.gradle,settings.gradle.kts,pubspec.yaml,go.mod,requirements.txt,pyproject.toml,pom.xml,Gemfile,composer.json,Package.swift,Podfile,*.csproj,*.podspec,AndroidManifest.xml}';
const PROFILE_XCODEPROJ_GLOB = '**/*.xcodeproj/project.pbxproj';
const PROFILE_COMMON_MAIN_GLOB = '**/src/commonMain/**';
const PROFILE_SPEC_GLOBS = [
  '**/{openapi,swagger}*.{json,yaml,yml}',
  '**/*.{proto,graphql,gql}',
  '**/*postman_collection*.json',
];

const CONTENT_MANIFEST_NAMES = new Set([
  ...SIMPLE_MANIFEST_NAMES,
  ...GRADLE_NAMES,
]);

function manifestNeedsContent(name: string): boolean {
  return CONTENT_MANIFEST_NAMES.has(name) || name.endsWith('.csproj');
}

/**
 * Profile the projects in a workspace folder. Thin vscode adapter: bounded
 * findFiles for manifests/spec files (respecting SCAN_EXCLUDE_GLOB), reads
 * only manifest files capped at MANIFEST_MAX_BYTES each, then hands
 * everything to the pure detectProjects above.
 */
export async function profileWorkspace(workspaceRoot: vscode.Uri): Promise<ProjectProfile[]> {
  // Lazy so the pure exports above stay importable outside the extension host.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const vs: typeof import('vscode') = require('vscode');

  const find = (glob: string, max: number): Thenable<vscode.Uri[]> =>
    vs.workspace.findFiles(new vs.RelativePattern(workspaceRoot, glob), SCAN_EXCLUDE_GLOB, max);

  const [manifests, xcodeprojs, commonMain, ...specLists] = await Promise.all([
    find(PROFILE_MANIFEST_GLOB, PROFILE_MAX_MANIFESTS),
    find(PROFILE_XCODEPROJ_GLOB, 25),
    find(PROFILE_COMMON_MAIN_GLOB, 10),
    ...PROFILE_SPEC_GLOBS.map((glob) => find(glob, PROFILE_MAX_SPECS)),
  ]);

  const rootPath = workspaceRoot.path.endsWith('/') ? workspaceRoot.path : `${workspaceRoot.path}/`;
  const relative = (uri: vscode.Uri): string =>
    uri.path.startsWith(rootPath) ? uri.path.slice(rootPath.length) : uri.path;

  const files: ProfileInputFile[] = [];
  for (const uri of manifests) {
    const path = relative(uri);
    let content: string | undefined;
    if (manifestNeedsContent(basenameOf(path))) {
      try {
        const data = await vs.workspace.fs.readFile(uri);
        content = Buffer.from(data.slice(0, MANIFEST_MAX_BYTES)).toString('utf-8');
      } catch {
        // Unreadable manifest — profile from structure alone.
      }
    }
    files.push(content === undefined ? { path } : { path, content });
  }
  for (const uri of [...xcodeprojs, ...commonMain, ...specLists.flat()]) {
    files.push({ path: relative(uri) });
  }
  return detectProjects(files);
}
