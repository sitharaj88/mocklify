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

let manager: MockServerManager | undefined;
let statusBarController: StatusBarController | undefined;
let webViewManager: WebViewManager | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('Mocklify extension is now active');

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
    })
  );

  // AI features: @mocklify chat participant, Copilot agent tools, and AI commands
  new MocklifyChatParticipant(context, manager, aiService, mockGenerator, docsGenerator);
  registerLanguageModelTools(context, manager);
  registerAiCommands(context, manager, aiService, apiKeyManager, mockGenerator, docsGenerator);

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
