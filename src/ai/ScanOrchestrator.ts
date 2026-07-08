import type * as vscode from 'vscode';
import type { AiService } from './AiService.js';
import {
  CodebaseMockGenerator,
  collectWorkspaceRecon,
  type CodebaseScanProgress,
  type CodebaseScanSummary,
  type ScanStrategy,
  type ScanStrategyReport,
  type WorkspaceRecon,
} from './CodebaseMockGenerator.js';
import {
  AgenticScanner,
  LOW_CONFIDENCE_SEED_SCORE,
  type AgenticScanSummary,
} from './AgenticScanner.js';
import { AgenticScanUnavailableError } from './providers/types.js';
import { dedupeRoutes } from './scan/heuristics.js';
import type { ProjectProfile } from './scan/projectProfile.js';

/**
 * The modern scan entry point: runs the shared recon (workspace profiles +
 * deterministic seed scan) ONCE, decides the best strategy per API surface —
 * 'spec' (an importable spec exists), 'agentic' (tool-capable provider),
 * 'fast' (one-shot chunked prompts), or 'census' (zero seeds, no tools) —
 * then delegates to CodebaseMockGenerator / AgenticScanner with the shared
 * recon and merges their summaries. The per-surface decisions land on the
 * summary's `strategies` field so the command layer can explain them and act
 * on 'spec' entries (the actual spec import stays a command-layer offer).
 *
 * decideStrategy and the merge/partition helpers are pure and exported for
 * exhaustive unit tests; vscode is only touched lazily (config read) so the
 * module imports cleanly under vitest.
 */

/** The mocklify.ai.scanMode values the orchestrator understands. */
export const SCAN_MODES = ['auto', 'fast', 'agentic'] as const;
export type ScanMode = (typeof SCAN_MODES)[number];

/** Progress fraction where the shared recon ends and strategy work begins. */
const RECON_END_FRACTION = 0.14;

/** Progress copy logged when 'fast' auto-escalates to agentic exploration. */
export const AGENTIC_ESCALATION_MESSAGE = 'No known patterns — switching to agentic exploration';

/**
 * Whether a surface's seed set is too thin to trust a one-shot fast scan:
 * no seeds at all, or none above the agentic scanner's low-confidence bar.
 * (Kept exported for back-compat; explicit scanMode 'fast' no longer
 * escalates on low-confidence seeds — only on a zero-seed workspace.)
 */
export function isLowConfidenceSeeds(seedFileCount: number, topSeedScore: number): boolean {
  return seedFileCount === 0 || topSeedScore < LOW_CONFIDENCE_SEED_SCORE;
}

// ---------------------------------------------------------------------------
// Strategy decision (pure)
// ---------------------------------------------------------------------------

export interface StrategyInput {
  /** Effective mocklify.ai.scanMode ('auto' recommended). */
  scanMode: ScanMode;
  /** Whether the resolved provider can run tool loops. */
  providerSupportsTools: boolean;
  /** Spec files (OpenAPI/proto/GraphQL/Postman) found for this surface. */
  specFiles: readonly string[];
  /** Seed-scan hits assigned to this surface. */
  seedFileCount: number;
  /** Best seed score on this surface (0 when none). */
  topSeedScore: number;
  /** Seed-scan hits across the whole workspace (census trigger). */
  workspaceSeedFileCount: number;
}

export interface StrategyDecision {
  /** The reported strategy — 'spec' when an importable spec exists. */
  strategy: ScanStrategy;
  /**
   * How the surface is actually scanned. 'spec' surfaces still get scanned
   * (the import is only an offer the user may decline), so this is never
   * 'spec'.
   */
  executeAs: Exclude<ScanStrategy, 'spec'>;
  reason: string;
}

function baseExecution(input: StrategyInput): { executeAs: StrategyDecision['executeAs']; reason: string } {
  if (!input.providerSupportsTools) {
    if (input.workspaceSeedFileCount === 0) {
      return {
        executeAs: 'census',
        reason:
          'No API patterns matched anywhere and the provider cannot explore with tools — one-shot census scan of the most promising file heads.',
      };
    }
    if (input.seedFileCount === 0) {
      return {
        executeAs: 'fast',
        reason: 'No seed files matched this surface — covered by the workspace fast scan.',
      };
    }
    if (input.scanMode === 'agentic') {
      return {
        executeAs: 'fast',
        reason: 'scanMode is "agentic" but the active provider does not support tool use — using the fast scan.',
      };
    }
    return {
      executeAs: 'fast',
      reason: 'Deterministic seed files found — fast chunked scan (provider has no tool support).',
    };
  }

  switch (input.scanMode) {
    case 'agentic':
      return { executeAs: 'agentic', reason: 'scanMode is "agentic" and the provider supports tool use.' };
    case 'auto':
      return {
        executeAs: 'agentic',
        reason: 'auto: the provider supports tool use — agentic exploration gives the most accurate routes.',
      };
    case 'fast':
      // Explicit 'fast' is a cost/latency control: escalate to the expensive
      // agentic exploration ONLY when the whole workspace has zero seeds (the
      // documented "no known patterns match" case). Weak seeds still run the
      // cheap one-shot scan, and a seedless sub-surface in a workspace WITH
      // seeds is covered by the workspace fast scan — same treatment as the
      // no-tools branch above.
      if (input.workspaceSeedFileCount === 0) {
        return { executeAs: 'agentic', reason: AGENTIC_ESCALATION_MESSAGE };
      }
      if (input.seedFileCount === 0) {
        return {
          executeAs: 'fast',
          reason: 'No seed files matched this surface — covered by the workspace fast scan.',
        };
      }
      return { executeAs: 'fast', reason: 'Deterministic seed files found — fast chunked scan (scanMode "fast").' };
  }
}

/**
 * Pick the scan strategy for one API surface:
 *
 * - Spec file(s) present → reported strategy 'spec' (the command layer offers
 *   the import); the surface is still scanned via the base decision below.
 * - scanMode 'agentic' + tool-capable provider → 'agentic'.
 * - scanMode 'fast' → 'fast', EXCEPT a zero-seed WORKSPACE with a
 *   tool-capable provider → auto-escalate to 'agentic' recon.
 * - scanMode 'auto' → spec > agentic-if-supported > fast.
 * - Provider without tool support → always 'fast'; a workspace with zero
 *   seeds anywhere → 'census' (one-shot census-chunk prompt).
 */
export function decideStrategy(input: StrategyInput): StrategyDecision {
  const base = baseExecution(input);
  if (input.specFiles.length > 0) {
    return {
      strategy: 'spec',
      executeAs: base.executeAs,
      reason: `API spec found (${input.specFiles[0]}) — importing it gives exact routes; the scan still runs (${base.executeAs}) in case the import is declined.`,
    };
  }
  return { strategy: base.executeAs, executeAs: base.executeAs, reason: base.reason };
}

// ---------------------------------------------------------------------------
// Surface views over the shared recon (pure)
// ---------------------------------------------------------------------------

/** Per-surface aggregate of the shared recon used for strategy decisions. */
export interface SurfaceReconView {
  name: string;
  /** Workspace-relative project root; '' for the workspace root. */
  rootPath: string;
  specFiles: string[];
  seedFileCount: number;
  topSeedScore: number;
}

/**
 * Assign files to profiles: deepest enclosing root wins, orphans go to the
 * first profile — the same rule AgenticScanner.buildSurfaceSeeds uses, so
 * strategy decisions and the agentic mission see identical groupings.
 * Returns [] when there are no profiles.
 */
export function assignFilesToProfiles<T extends { path: string }>(
  profiles: readonly Pick<ProjectProfile, 'rootPath'>[],
  files: readonly T[]
): T[][] {
  const buckets: T[][] = profiles.map(() => []);
  if (profiles.length === 0) {
    return buckets;
  }
  for (const file of files) {
    let best = -1;
    for (let i = 0; i < profiles.length; i++) {
      const root = profiles[i].rootPath;
      if (root === '' || file.path === root || file.path.startsWith(`${root}/`)) {
        if (best === -1 || root.length > profiles[best].rootPath.length) {
          best = i;
        }
      }
    }
    buckets[best === -1 ? 0 : best].push(file);
  }
  return buckets;
}

/**
 * One strategy-decision view per detected project (or a single default view
 * named after the workspace when profiling found nothing).
 */
export function buildSurfaceViews(
  profiles: readonly Pick<ProjectProfile, 'rootPath' | 'specFiles'>[],
  files: readonly { path: string; score: number }[],
  appName: string
): SurfaceReconView[] {
  const topScore = (bucket: readonly { score: number }[]): number =>
    bucket.reduce((max, file) => Math.max(max, file.score), 0);
  if (profiles.length === 0) {
    return [
      {
        name: appName,
        rootPath: '',
        specFiles: [],
        seedFileCount: files.length,
        topSeedScore: topScore(files),
      },
    ];
  }
  const buckets = assignFilesToProfiles(profiles, files);
  return profiles.map((profile, i) => ({
    name: profile.rootPath === '' ? appName : profile.rootPath,
    rootPath: profile.rootPath,
    specFiles: [...profile.specFiles],
    seedFileCount: buckets[i].length,
    topSeedScore: topScore(buckets[i]),
  }));
}

/**
 * Restrict a shared recon to the surfaces rooted at `rootPaths` (mixed-mode
 * execution: each scanner only sees its own surfaces' profiles and seeds).
 * A profile-less recon (single default surface) is returned unchanged.
 */
export function filterReconForRoots(
  recon: WorkspaceRecon,
  rootPaths: readonly string[]
): WorkspaceRecon {
  if (recon.profiles.length === 0) {
    return recon;
  }
  const keep = new Set(rootPaths);
  const buckets = assignFilesToProfiles(recon.profiles, recon.files);
  return {
    ...recon,
    profiles: recon.profiles.filter((profile) => keep.has(profile.rootPath)),
    files: recon.profiles.flatMap((profile, i) => (keep.has(profile.rootPath) ? buckets[i] : [])),
  };
}

// ---------------------------------------------------------------------------
// Summary merging (pure)
// ---------------------------------------------------------------------------

/**
 * Merge summaries produced by different strategies over disjoint surface
 * sets: routes are concatenated and deduped, counts recomputed/summed,
 * surfaces and spec files unioned. scannedFileCount is the max — both
 * scanners started from the same shared recon.
 */
export function mergeScanSummaries(summaries: CodebaseScanSummary[]): CodebaseScanSummary {
  if (summaries.length === 0) {
    throw new Error('No scan summaries to merge.');
  }
  if (summaries.length === 1) {
    return summaries[0];
  }
  const routes = dedupeRoutes(summaries.flatMap((summary) => summary.routes));
  const negativeCount = routes.filter((route) => route.tags?.includes('negative')).length;
  const surfaces = summaries.flatMap((summary) => summary.surfaces ?? []);
  const specFiles = [...new Set(summaries.flatMap((summary) => summary.specFiles ?? []))];
  return {
    scannedFileCount: Math.max(...summaries.map((summary) => summary.scannedFileCount)),
    matchedFileCount: summaries.reduce((sum, summary) => sum + summary.matchedFileCount, 0),
    chunkCount: summaries.reduce((sum, summary) => sum + summary.chunkCount, 0),
    routes,
    positiveCount: routes.length - negativeCount,
    negativeCount,
    repairedCount: summaries.reduce((sum, summary) => sum + summary.repairedCount, 0),
    droppedCount: summaries.reduce((sum, summary) => sum + summary.droppedCount, 0),
    ...(surfaces.length > 0 ? { surfaces } : {}),
    ...(specFiles.length > 0 ? { specFiles } : {}),
  };
}

// ---------------------------------------------------------------------------
// The orchestrator
// ---------------------------------------------------------------------------

interface GenerateOptions {
  token?: vscode.CancellationToken;
  onProgress?: (progress: CodebaseScanProgress) => void;
}

/** Injectable collaborators — real instances by default, fakes in tests. */
export interface ScanOrchestratorDeps {
  fast: {
    generate(options?: GenerateOptions & { recon?: WorkspaceRecon }): Promise<CodebaseScanSummary>;
  };
  agentic: {
    generate(options?: GenerateOptions & { recon?: WorkspaceRecon }): Promise<AgenticScanSummary>;
  };
  recon: (options?: GenerateOptions) => Promise<WorkspaceRecon>;
}

function isCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === 'Canceled';
}

function isAgenticUnavailable(error: unknown): boolean {
  return (
    error instanceof AgenticScanUnavailableError ||
    (error instanceof Error && error.name === 'AgenticScanUnavailableError')
  );
}

/**
 * Mark the strategy entries of agentic surfaces whose scan failed (and could
 * not be recovered) so the user-facing report never claims a surface was
 * scanned agentically when nothing scanned it at all.
 */
function annotateFailedAgenticStrategies(
  strategies: ScanStrategyReport[],
  decisions: StrategyDecision[]
): void {
  for (let i = 0; i < strategies.length; i++) {
    if (decisions[i].executeAs === 'agentic') {
      strategies[i] = {
        ...strategies[i],
        reason: `${strategies[i].reason} WARNING: the agentic scan of this surface failed — its routes are missing from the result.`,
      };
    }
  }
}

/** Map a scanner's 0..1 progress into a [lo, hi] slice of the whole scan. */
function scaledProgress(
  onProgress: ((progress: CodebaseScanProgress) => void) | undefined,
  lo: number,
  hi: number
): ((progress: CodebaseScanProgress) => void) | undefined {
  if (!onProgress) {
    return undefined;
  }
  return ({ message, fraction }) =>
    onProgress({ message, fraction: lo + (hi - lo) * Math.min(1, Math.max(0, fraction)) });
}

function readConfiguredScanMode(): ScanMode {
  // Lazy so the pure exports above stay importable outside the extension host.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const vsc: typeof import('vscode') = require('vscode');
  const mode = vsc.workspace.getConfiguration('mocklify').get<string>('ai.scanMode', 'auto');
  return mode === 'fast' || mode === 'agentic' ? mode : 'auto';
}

export class ScanOrchestrator {
  private deps: ScanOrchestratorDeps;

  constructor(
    private ai: AiService,
    deps?: Partial<ScanOrchestratorDeps>
  ) {
    this.deps = {
      fast: deps?.fast ?? new CodebaseMockGenerator(ai),
      agentic: deps?.agentic ?? new AgenticScanner(ai),
      recon: deps?.recon ?? collectWorkspaceRecon,
    };
  }

  /**
   * Run the orchestrated scan: shared recon once, per-surface strategy
   * selection, delegated execution, merged summary with `strategies`.
   * `scanMode` overrides the mocklify.ai.scanMode setting (tests/callers).
   */
  async generate(
    options?: GenerateOptions & { scanMode?: ScanMode }
  ): Promise<CodebaseScanSummary> {
    const report = (message: string, fraction: number) =>
      options?.onProgress?.({ message, fraction });
    const scanMode = options?.scanMode ?? readConfiguredScanMode();

    // Provider capability first — resolveProvider throws user-facing guidance
    // when no provider is available at all.
    const provider = await this.ai.resolveProvider();
    const providerSupportsTools = typeof provider.runToolLoop === 'function';

    // Shared recon — computed exactly once, then handed to every scanner.
    const recon = await this.deps.recon({
      token: options?.token,
      onProgress: options?.onProgress,
    });

    const views = buildSurfaceViews(recon.profiles, recon.files, recon.appName);
    const decide = (tools: boolean): StrategyDecision[] =>
      views.map((view) =>
        decideStrategy({
          scanMode,
          providerSupportsTools: tools,
          specFiles: view.specFiles,
          seedFileCount: view.seedFileCount,
          topSeedScore: view.topSeedScore,
          workspaceSeedFileCount: recon.files.length,
        })
      );

    try {
      return await this.execute(views, decide(providerSupportsTools), recon, options, report);
    } catch (error) {
      // The provider lost tool support between the capability check and the
      // loop (e.g. Copilot model change) — re-plan without tools and rerun.
      if (!isAgenticUnavailable(error)) {
        throw error;
      }
      report('The provider cannot run the agentic scan — falling back to the fast scan…', RECON_END_FRACTION);
      return await this.execute(views, decide(false), recon, options, report);
    }
  }

  private async execute(
    views: SurfaceReconView[],
    decisions: StrategyDecision[],
    recon: WorkspaceRecon,
    options: GenerateOptions | undefined,
    report: (message: string, fraction: number) => void
  ): Promise<CodebaseScanSummary> {
    const strategies: ScanStrategyReport[] = views.map((view, i) => ({
      surface: view.name,
      strategy: decisions[i].strategy,
      reason: decisions[i].reason,
    }));
    if (decisions.some((decision) => decision.reason === AGENTIC_ESCALATION_MESSAGE)) {
      report(AGENTIC_ESCALATION_MESSAGE, RECON_END_FRACTION);
    } else {
      const plan = strategies.map((entry) => `${entry.surface} → ${entry.strategy}`).join(', ');
      report(`Scan plan: ${plan}`, RECON_END_FRACTION);
    }

    const agenticRoots = views
      .filter((_, i) => decisions[i].executeAs === 'agentic')
      .map((view) => view.rootPath);
    const otherRoots = views
      .filter((_, i) => decisions[i].executeAs !== 'agentic')
      .map((view) => view.rootPath);

    // Single-strategy workspaces: one delegated call with the full recon.
    if (agenticRoots.length === 0) {
      const summary = await this.deps.fast.generate({
        token: options?.token,
        onProgress: options?.onProgress,
        recon,
      });
      return { ...summary, strategies };
    }
    if (otherRoots.length === 0) {
      const summary = await this.deps.agentic.generate({
        token: options?.token,
        onProgress: options?.onProgress,
        recon,
      });
      return { ...summary, strategies };
    }

    // Mixed strategies: each scanner gets only its surfaces' recon slice;
    // one branch failing must not lose the other's routes.
    const summaries: CodebaseScanSummary[] = [];
    let firstError: unknown;
    try {
      summaries.push(
        await this.deps.fast.generate({
          token: options?.token,
          onProgress: scaledProgress(options?.onProgress, 0.15, 0.55),
          recon: filterReconForRoots(recon, otherRoots),
        })
      );
    } catch (error) {
      if (isCancellation(error)) {
        throw error;
      }
      firstError = error;
      console.error('Mocklify: fast branch of the orchestrated scan failed:', error);
    }
    try {
      summaries.push(
        await this.deps.agentic.generate({
          token: options?.token,
          onProgress: scaledProgress(options?.onProgress, 0.55, 0.95),
          recon: filterReconForRoots(recon, agenticRoots),
        })
      );
    } catch (error) {
      if (isCancellation(error)) {
        throw error;
      }
      // Nothing salvaged yet → let the caller's no-tools fallback re-plan.
      if (isAgenticUnavailable(error) && summaries.length === 0) {
        throw error;
      }
      if (isAgenticUnavailable(error)) {
        // The provider lost tool support after the fast branch already
        // succeeded — deterministically recoverable: rescan the agentic
        // surfaces with the fast scanner instead of silently dropping them.
        report('The provider cannot run the agentic scan — falling back to the fast scan…', 0.55);
        try {
          summaries.push(
            await this.deps.fast.generate({
              token: options?.token,
              onProgress: scaledProgress(options?.onProgress, 0.55, 0.95),
              recon: filterReconForRoots(recon, agenticRoots),
            })
          );
          for (let i = 0; i < views.length; i++) {
            if (decisions[i].executeAs === 'agentic') {
              strategies[i] = {
                surface: views[i].name,
                // A 'spec' report stays 'spec' — the import offer is unaffected.
                strategy: decisions[i].strategy === 'spec' ? 'spec' : 'fast',
                reason:
                  'The provider lost tool support mid-scan — this surface was rescanned with the fast scan.',
              };
            }
          }
        } catch (fallbackError) {
          if (isCancellation(fallbackError)) {
            throw fallbackError;
          }
          firstError ??= fallbackError;
          console.error('Mocklify: fast fallback for the agentic surfaces failed:', fallbackError);
          annotateFailedAgenticStrategies(strategies, decisions);
        }
      } else {
        firstError ??= error;
        console.error('Mocklify: agentic branch of the orchestrated scan failed:', error);
        // Keep the report honest: these surfaces were NOT scanned agentically.
        annotateFailedAgenticStrategies(strategies, decisions);
      }
    }
    if (summaries.length === 0) {
      throw firstError;
    }
    report('Assembling mock server…', 0.95);
    return { ...mergeScanSummaries(summaries), strategies };
  }
}
