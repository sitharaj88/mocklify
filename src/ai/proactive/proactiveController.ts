import * as vscode from 'vscode';
import type { MockServerManager } from '../../core/MockServerManager.js';
import type { AiService } from '../AiService.js';
import { ScanOrchestrator, isScanCancellation } from '../ScanOrchestrator.js';
import { deriveScanThreadId, hasResumableScan } from '../agent/scanGraph.js';
import {
  createScanMemoryStore,
  mergeScanMemory,
  buildScanMemoryFromSummary,
} from '../scan/scanMemory.js';
import { buildDriftProposal, type DriftReport } from './driftProposal.js';
import {
  diffRescan,
  rescanFingerprint,
  buildRescanNotificationText,
  buildRescanChatPrompt,
  type RescanDiff,
} from './rescanDiffer.js';
import { RescanScheduler, type RescanSkipReason } from './rescanScheduler.js';
import {
  NotificationLedger,
  DRIFT_COOLDOWN_MS,
  RESCAN_COOLDOWN_MS,
} from './notificationLedger.js';
import { sharedScanActivity } from './scanActivity.js';

/**
 * Phase 4 proactive-agents adapter — the ONE vscode-importing module for the
 * proactive flows (same adapter pattern as DriftWatcher.ts and
 * StatusBarController.ts; all logic lives in the pure ./proactive modules).
 *
 * Part A: DriftWatcher reports → rate-limited notification → AI-chat prefill.
 * Part B: scheduled unattended background re-scans → diff → notification →
 * AI-chat prefill. Both are opt-in via settings (default off) and
 * propose-only: nothing is sent or mutated until the user presses Send and
 * approves the agent's confirm cards.
 */
export interface ProactiveControllerDeps {
  manager: MockServerManager;
  ai: AiService;
  /** WebViewManager.showChat bound by extension.ts — opens chat + prefills. */
  openChat(prefill: string): Promise<void>;
}

export class ProactiveController implements vscode.Disposable {
  private readonly ledger = new NotificationLedger();
  private scheduler: RescanScheduler | undefined;
  private runCts: vscode.CancellationTokenSource | undefined;
  private statusItem: vscode.StatusBarItem | undefined;
  private configListener: vscode.Disposable | undefined;
  private activityUnsub: (() => void) | undefined;
  private disposed = false;

  constructor(private readonly deps: ProactiveControllerDeps) {}

  /** Build + arm the scheduler and register the settings listener. */
  start(): void {
    this.scheduler = new RescanScheduler({
      intervalMs: () => this.readIntervalMs(),
      shouldSkip: () => this.shouldSkipTick(),
      run: () => this.runBackgroundScan(),
      cancelRun: () => this.runCts?.cancel(),
      log: (line) => console.warn(line),
    });
    this.scheduler.start();
    this.configListener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('mocklify.ai.scheduledScan.intervalMinutes')) {
        this.scheduler?.refresh();
      }
    });
    // A user-initiated scan preempts the background run: both use the same
    // checkpoint thread, and two orchestrated scans must never interleave.
    // The scheduler's own run is tracked with background:true so it does not
    // cancel itself.
    this.activityUnsub = sharedScanActivity.onUserScanStart(() => {
      this.runCts?.cancel();
    });
  }

  /** Fire-and-forget drift hand-off from DriftWatcher; never throws. */
  handleDriftReport(report: DriftReport): void {
    void this.proposeDrift(report).catch(() => {
      // Proactive proposals are best-effort; never surface errors on save.
    });
  }

  dispose(): void {
    this.disposed = true;
    this.scheduler?.dispose();
    this.scheduler = undefined;
    this.runCts?.cancel();
    this.configListener?.dispose();
    this.configListener = undefined;
    this.activityUnsub?.();
    this.activityUnsub = undefined;
    this.statusItem?.dispose();
    this.statusItem = undefined;
  }

  /** Raw configured interval in ms; sub-minimum clamping is the scheduler's job. */
  private readIntervalMs(): number {
    const minutes = vscode.workspace
      .getConfiguration('mocklify')
      .get<number>('ai.scheduledScan.intervalMinutes', 0);
    return Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : 0;
  }

  private async shouldSkipTick(): Promise<RescanSkipReason | null> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) {
      return 'no-workspace';
    }
    if (sharedScanActivity.isActive()) {
      return 'scan-running';
    }
    try {
      // A user's interrupted scan left checkpoints — the background run must
      // not clobber them.
      if (await hasResumableScan(root)) {
        return 'resume-pending';
      }
    } catch {
      // best-effort
    }
    if (!(await this.deps.ai.isAvailable())) {
      return 'provider-unavailable';
    }
    return null;
  }

  private runBackgroundScan(): Promise<void> {
    return sharedScanActivity.track(async () => {
      if (this.disposed) {
        return; // disposal raced the tick's skip-check
      }
      const root = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!root) {
        return; // raced since shouldSkip
      }
      this.runCts = new vscode.CancellationTokenSource();
      const item = this.ensureStatusItem();
      item.show();
      try {
        const summary = await new ScanOrchestrator(this.deps.ai).generate({
          token: this.runCts.token,
          onProgress: ({ message, fraction }) => {
            item.tooltip = `Mocklify background scan: ${message} (${Math.round(fraction * 100)}%)`;
          },
          threadId: deriveScanThreadId(root.fsPath),
          // NO onQuestion → ask_user is never offered (unattended per GenerateOptions doc)
          // NO resume    → fresh run; 'resume-pending' skip protects user checkpoints
        });
        // Keep scan memory fresh even on fast/census strategies (graph runs already
        // persisted richer memory; mergeScanMemory unions rather than clobbers).
        const store = createScanMemoryStore(root);
        const prev = await store.load();
        await store.save(mergeScanMemory(prev, buildScanMemoryFromSummary(summary, [])));

        const servers = await this.deps.manager.getServers();
        const diff = diffRescan(
          summary.routes,
          servers.map((s) => ({
            name: s.name,
            routes: s.routes
              .filter((r) => r.enabled)
              .map((r) => ({ method: r.method, path: r.path })),
          })),
          prev,
          summary.surfaces?.map((s) => ({ name: s.name, rootPath: s.rootPath ?? '' }))
        );
        if (!diff.notify) {
          console.log(
            `Mocklify: scheduled scan finished — mocks are in sync (${summary.routes.length} scanned route(s), no new endpoints).`
          );
          return;
        }
        const fingerprint = rescanFingerprint(diff);
        if (!this.ledger.tryNotify(fingerprint, RESCAN_COOLDOWN_MS)) {
          console.log('Mocklify: scheduled scan finding suppressed (cooldown).');
          return;
        }
        // DETACHED on purpose: an action notification the user never clicks
        // keeps its promise pending indefinitely — awaiting it here would hold
        // the scheduler's run() (and the shared scan gate) open and stall
        // every future scheduled scan.
        void this.offerRescanReview(diff, fingerprint);
      } catch (error) {
        if (isScanCancellation(error) || this.runCts?.token.isCancellationRequested) {
          return; // disposal — silent
        }
        throw error; // scheduler logs + backoffs
      } finally {
        item.hide();
        this.runCts?.dispose();
        this.runCts = undefined;
      }
    }, { background: true });
  }

  /** Detached notification flow — see runBackgroundScan; never throws. */
  private async offerRescanReview(diff: RescanDiff, fingerprint: string): Promise<void> {
    try {
      const action = await vscode.window.showInformationMessage(
        buildRescanNotificationText(diff),
        'Review in AI Chat',
        'Dismiss'
      );
      if (this.disposed) {
        return; // clicked after deactivation — nothing to open
      }
      if (action === 'Review in AI Chat') {
        await this.deps.openChat(buildRescanChatPrompt(diff));
      } else if (action === 'Dismiss') {
        this.ledger.mute(fingerprint);
      }
    } catch {
      // Proactive proposals are best-effort; never surface errors.
    }
  }

  private async proposeDrift(report: DriftReport): Promise<void> {
    if (this.disposed) {
      return;
    }
    const servers = await this.deps.manager.getServers();
    const proposal = buildDriftProposal(
      report,
      servers.map((s) => ({
        name: s.name,
        routePaths: s.routes.map((r) => r.path),
      }))
    );
    if (!proposal) {
      return;
    }
    // Per-endpoint keys, not the set fingerprint: the missing set grows as
    // the user types (autosave), and a set-level identity would re-notify on
    // every save. Only a genuinely new endpoint may re-trigger; Ignore mutes
    // every endpoint it covered.
    if (!this.ledger.tryNotifyAny(proposal.endpointKeys, DRIFT_COOLDOWN_MS)) {
      return;
    }
    const action = await vscode.window.showInformationMessage(
      proposal.notificationText,
      'Fix in AI Chat',
      'Ignore for this session'
    );
    if (this.disposed) {
      return;
    }
    if (action === 'Fix in AI Chat') {
      await this.deps.openChat(proposal.chatPrompt);
    } else if (action === 'Ignore for this session') {
      this.ledger.muteAll(proposal.endpointKeys);
    }
  }

  private ensureStatusItem(): vscode.StatusBarItem {
    if (!this.statusItem) {
      this.statusItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        0
      );
      this.statusItem.text = '$(sync~spin) Mocklify: background scan…';
      this.statusItem.tooltip = 'Mocklify background scan in progress';
    }
    return this.statusItem;
  }
}
