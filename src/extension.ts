import * as vscode from 'vscode';
import { MockServerManager } from './core/MockServerManager.js';
import {
  MockServerTreeViewProvider,
  RequestLogsTreeViewProvider,
} from './views/TreeViewProvider.js';
import { StatusBarController } from './views/StatusBarController.js';
import { CommandRegistry } from './commands/CommandRegistry.js';
import { WebViewManager } from './views/WebViewManager.js';
import {
  CopilotService,
  AiService,
  ApiKeyManager,
  MockGenerator,
  DocumentationGenerator,
  MocklifyChatParticipant,
  registerLanguageModelTools,
  registerAiCommands,
} from './ai/index.js';
import { registerScenarioCommands } from './ai/ScenarioCommands.js';
import { activateDriftWatcher } from './ai/DriftWatcher.js';
import { ProactiveController } from './ai/proactive/proactiveController.js';
import { registerChaosCommands } from './core/ChaosCommands.js';
import { setExtensionVersion, getExtensionVersion } from './version.js';
import type { ContractConfig } from './types/core.js';
import {
  collectDiagnostics,
  buildDiagnosticsReport,
  formatForIssueUrl,
  recordError,
} from './services/DiagnosticsService.js';

let manager: MockServerManager | undefined;
let statusBarController: StatusBarController | undefined;
let webViewManager: WebViewManager | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('Mocklify extension is now active');

  setExtensionVersion((context.extension.packageJSON as { version?: string }).version ?? '');

  // Get workspace root
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  // Create manager
  manager = new MockServerManager(workspaceRoot);

  try {
    // Initialize manager (loads configurations)
    await manager.initialize();
  } catch (error) {
    console.error('Failed to initialize Mocklify manager:', error);
    // Continue anyway - the user can still create servers
  }

  // AI services (used by the dashboard, chat participant, and AI commands).
  // AiService routes requests to GitHub Copilot, Claude, OpenAI, or Gemini.
  const copilotService = new CopilotService();
  const apiKeyManager = new ApiKeyManager(context.secrets);
  const aiService = new AiService(copilotService, apiKeyManager);
  const mockGenerator = new MockGenerator(aiService);
  const docsGenerator = new DocumentationGenerator(aiService);

  // Create WebView manager
  webViewManager = new WebViewManager(context, manager, mockGenerator, aiService, apiKeyManager);

  // Create tree view providers
  const serversTreeProvider = new MockServerTreeViewProvider(manager);
  const logsTreeProvider = new RequestLogsTreeViewProvider(manager);

  // Register tree views
  const serversTreeView = vscode.window.createTreeView('mocklifyServers', {
    treeDataProvider: serversTreeProvider,
    showCollapseAll: true,
  });

  const logsTreeView = vscode.window.createTreeView('mocklifyLogs', {
    treeDataProvider: logsTreeProvider,
    showCollapseAll: false,
  });

  context.subscriptions.push(serversTreeView, logsTreeView);

  // Create status bar controller
  statusBarController = new StatusBarController(manager);
  context.subscriptions.push(statusBarController);

  // Register commands
  const commandRegistry = new CommandRegistry(context, manager, serversTreeProvider);
  commandRegistry.registerAll();

  // Register command to open dashboard
  context.subscriptions.push(
    vscode.commands.registerCommand('mocklify.openDashboard', () => {
      webViewManager?.show();
    }),
    vscode.commands.registerCommand('mocklify.openLogs', () => {
      vscode.commands.executeCommand('mocklifyLogs.focus');
    }),
    // mocklify.openChat is taken (Copilot Chat @mocklify); this opens the
    // dashboard's native AI chat tab.
    vscode.commands.registerCommand('mocklify.openAiChat', () => {
      void webViewManager?.showChat();
    })
  );

  // AI features: @mocklify chat participant, Copilot agent tools, and AI commands
  new MocklifyChatParticipant(context, manager, aiService, mockGenerator, docsGenerator);
  registerLanguageModelTools(context, manager);
  registerAiCommands(context, manager, aiService, apiKeyManager, mockGenerator, docsGenerator);
  registerScenarioCommands(context, manager);
  registerChaosCommands(context, manager);

  // Phase 4 proactive agents: drift → AI-chat proposals + scheduled background
  // re-scans. Both are opt-in (settings default off) and propose-only.
  const dashboard = webViewManager;
  const proactive = new ProactiveController({
    manager,
    ai: aiService,
    openChat: (prefill) => dashboard.showChat(prefill),
  });
  context.subscriptions.push(proactive);
  proactive.start();
  activateDriftWatcher(context, manager, (report) => proactive.handleDriftReport(report));

  // Stateful mocks: reset the in-memory collections (they re-seed lazily on
  // the next request, so no restart is needed).
  const mgr = manager;
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'mocklify.resetStatefulData',
      async (item?: { serverId?: string }) => {
        const allServers = await mgr.getServers();
        const statefulServers = allServers.filter((s) => s.routes.some((r) => r.stateful));
        const pool = statefulServers.length > 0 ? statefulServers : allServers;
        if (pool.length === 0) {
          vscode.window.showWarningMessage('Mocklify: No servers configured.');
          return;
        }

        let serverId = item?.serverId;
        if (!serverId) {
          if (pool.length === 1) {
            serverId = pool[0].id;
          } else {
            const states = mgr.getAllServerStates();
            const picked = await vscode.window.showQuickPick(
              pool.map((s) => ({
                label: s.name,
                description: `port ${s.port}${states.get(s.id)?.status === 'running' ? ' · running' : ''}`,
                id: s.id,
              })),
              { placeHolder: 'Reset stateful mock data for which server?' }
            );
            if (!picked) {
              return;
            }
            serverId = picked.id;
          }
        }

        try {
          mgr.resetStatefulData(serverId);
          const name = allServers.find((s) => s.id === serverId)?.name ?? serverId;
          vscode.window.showInformationMessage(
            `Mocklify: Stateful mock data reset for "${name}" — collections re-seed on the next request.`
          );
        } catch (error) {
          vscode.window.showErrorMessage(
            `Mocklify: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    )
  );

  // Contract validation: pick a server, an OpenAPI spec, and a mode. The engine
  // then validates matched requests against the spec (warn logs violations;
  // enforce returns 400). Choosing "Disable" clears the contract.
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'mocklify.configureContract',
      async (item?: { serverId?: string }) => {
        try {
          const servers = await mgr.getServers();
          if (servers.length === 0) {
            vscode.window.showWarningMessage('Mocklify: No servers configured. Create one first.');
            return;
          }

          let serverId = item?.serverId;
          if (!serverId) {
            const picked =
              servers.length === 1
                ? { id: servers[0].id }
                : await vscode.window.showQuickPick(
                    servers.map((s) => ({
                      label: s.name,
                      description: `port ${s.port}${s.contract ? ` · contract: ${s.contract.mode}` : ''}`,
                      id: s.id,
                    })),
                    { placeHolder: 'Configure contract validation for which server?' }
                  );
            if (!picked) {
              return;
            }
            serverId = picked.id;
          }

          const server = servers.find((s) => s.id === serverId);
          if (server && server.protocol !== 'http') {
            vscode.window.showWarningMessage(
              'Mocklify: Contract validation applies to HTTP servers only.'
            );
            return;
          }

          const specUri = await pickContractSpec(workspaceRoot);
          if (specUri === 'disable') {
            await mgr.setServerContract(serverId, undefined);
            vscode.window.showInformationMessage(
              `Mocklify: Contract validation disabled for "${server?.name ?? serverId}".`
            );
            return;
          }
          if (!specUri) {
            return;
          }

          const modePick = await vscode.window.showQuickPick(
            [
              {
                label: '$(warning) Warn',
                detail: 'Serve the normal response; record violations on the request log.',
                mode: 'warn' as const,
              },
              {
                label: '$(error) Enforce',
                detail: 'Reject violating requests with 400 before generating a response.',
                mode: 'enforce' as const,
              },
            ],
            { placeHolder: 'How should contract violations be handled?' }
          );
          if (!modePick) {
            return;
          }

          const specPath = workspaceRoot
            ? vscode.workspace.asRelativePath(specUri, false)
            : specUri.fsPath;
          const contract: ContractConfig = { specPath, mode: modePick.mode };
          await mgr.setServerContract(serverId, contract);
          vscode.window.showInformationMessage(
            `Mocklify: Contract validation (${modePick.mode}) enabled for "${server?.name ?? serverId}" against ${specPath}.`
          );
        } catch (error) {
          recordError(error);
          vscode.window.showErrorMessage(
            `Mocklify: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    ),

    // Report Issue: build a redacted diagnostics report and either copy it or
    // open a pre-filled GitHub issue. No secrets, paths, or bodies are included.
    vscode.commands.registerCommand('mocklify.reportIssue', async () => {
      try {
        const input = await collectDiagnostics({
          extensionVersion: getExtensionVersion(),
          workspaceRoot,
          getServers: () => mgr.getServers(),
          getServerStates: () => mgr.getAllServerStates().values(),
          getConfiguredProviderId: () => aiService.getConfiguredProviderId(),
          resolveProviderId: async () => {
            try {
              return (await aiService.resolveProvider()).id as
                | 'copilot'
                | 'claude'
                | 'openai'
                | 'gemini';
            } catch {
              return null;
            }
          },
        });
        const report = buildDiagnosticsReport(input);
        const repositoryUrl = (
          context.extension.packageJSON as { repository?: { url?: string } }
        ).repository?.url;

        const action = await vscode.window.showQuickPick(
          ['Copy report to clipboard', 'Open GitHub issue'],
          { placeHolder: 'Mocklify diagnostics report ready — no secrets or paths included.' }
        );
        if (action === 'Copy report to clipboard') {
          await vscode.env.clipboard.writeText(report);
          vscode.window.showInformationMessage('Mocklify: Diagnostics report copied to clipboard.');
        } else if (action === 'Open GitHub issue') {
          const url = formatForIssueUrl(report, { repositoryUrl });
          await vscode.env.openExternal(vscode.Uri.parse(url));
        }
      } catch (error) {
        vscode.window.showErrorMessage(
          `Mocklify: Could not build diagnostics report: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    })
  );

  // Watch for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('mocklify')) {
        // Reload configuration settings
        console.log('Mocklify configuration changed');
      }
    })
  );

  // Show welcome message if no servers configured
  const servers = await manager.getServers();
  if (servers.length === 0 && workspaceRoot) {
    const action = await vscode.window.showInformationMessage(
      'Mocklify: No servers configured. Open Dashboard to get started.',
      'Open Dashboard',
      'Create Server'
    );
    if (action === 'Open Dashboard') {
      webViewManager?.show();
    } else if (action === 'Create Server') {
      vscode.commands.executeCommand('mocklify.createServer');
    }
  }
}

/**
 * Offer OpenAPI/Swagger specs found in the workspace for contract validation,
 * with a Browse… escape hatch and a Disable option. Returns the chosen spec
 * Uri, the literal 'disable', or undefined when dismissed.
 */
async function pickContractSpec(
  workspaceRoot: string | undefined
): Promise<vscode.Uri | 'disable' | undefined> {
  const candidates = new Map<string, vscode.Uri>();
  if (workspaceRoot) {
    const exclude = '{**/node_modules/**,**/dist/**,**/out/**,**/build/**,**/.git/**}';
    for (const pattern of ['**/*{openapi,swagger}*.{json,yaml,yml}', '**/openapi.{json,yaml,yml}']) {
      for (const uri of await vscode.workspace.findFiles(pattern, exclude, 50)) {
        candidates.set(uri.fsPath, uri);
      }
    }
  }

  const BROWSE = '$(folder-opened) Browse…';
  const DISABLE = '$(circle-slash) Disable contract validation';
  const items: (vscode.QuickPickItem & { uri?: vscode.Uri; action?: 'browse' | 'disable' })[] = [
    ...[...candidates.values()].map((uri) => ({
      label: `$(file-code) ${vscode.workspace.asRelativePath(uri)}`,
      uri,
    })),
    { label: BROWSE, detail: 'Pick a spec file anywhere on disk', action: 'browse' as const },
    { label: DISABLE, detail: 'Turn off request validation for this server', action: 'disable' as const },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select an OpenAPI / Swagger spec to validate requests against',
  });
  if (!picked) {
    return undefined;
  }
  if (picked.action === 'disable') {
    return 'disable';
  }
  if (picked.uri) {
    return picked.uri;
  }
  const browsed = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { 'OpenAPI / Swagger': ['json', 'yaml', 'yml'] },
    title: 'Select an OpenAPI / Swagger spec',
    openLabel: 'Use for contract',
  });
  return browsed?.[0];
}

export async function deactivate(): Promise<void> {
  console.log('Mocklify extension is deactivating');

  // Clean up WebView
  if (webViewManager) {
    webViewManager.dispose();
  }

  // Stop all servers
  if (manager) {
    await manager.dispose();
  }
}
