import * as vscode from 'vscode';
import { MockServerManager } from './core/MockServerManager.js';
import {
  MockServerTreeViewProvider,
  RequestLogsTreeViewProvider,
} from './views/TreeViewProvider.js';
import { StatusBarController } from './views/StatusBarController.js';
import { CommandRegistry } from './commands/CommandRegistry.js';
import { WebViewManager } from './views/WebViewManager.js';

let manager: MockServerManager | undefined;
let statusBarController: StatusBarController | undefined;
let webViewManager: WebViewManager | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('Specter extension is now active');

  // Get workspace root
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  // Create manager
  manager = new MockServerManager(workspaceRoot);

  try {
    // Initialize manager (loads configurations)
    await manager.initialize();
  } catch (error) {
    console.error('Failed to initialize Specter manager:', error);
    // Continue anyway - the user can still create servers
  }

  // Create WebView manager
  webViewManager = new WebViewManager(context, manager);

  // Create tree view providers
  const serversTreeProvider = new MockServerTreeViewProvider(manager);
  const logsTreeProvider = new RequestLogsTreeViewProvider(manager);

  // Register tree views
  const serversTreeView = vscode.window.createTreeView('specterServers', {
    treeDataProvider: serversTreeProvider,
    showCollapseAll: true,
  });

  const logsTreeView = vscode.window.createTreeView('specterLogs', {
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
    vscode.commands.registerCommand('specter.openDashboard', () => {
      webViewManager?.show();
    })
  );

  // Watch for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('specter')) {
        // Reload configuration settings
        console.log('Specter configuration changed');
      }
    })
  );

  // Show welcome message if no servers configured
  const servers = await manager.getServers();
  if (servers.length === 0 && workspaceRoot) {
    const action = await vscode.window.showInformationMessage(
      'Specter: No servers configured. Open Dashboard to get started.',
      'Open Dashboard',
      'Create Server'
    );
    if (action === 'Open Dashboard') {
      webViewManager?.show();
    } else if (action === 'Create Server') {
      vscode.commands.executeCommand('specter.createServer');
    }
  }
}

export async function deactivate(): Promise<void> {
  console.log('Specter extension is deactivating');

  // Clean up WebView
  if (webViewManager) {
    webViewManager.dispose();
  }

  // Stop all servers
  if (manager) {
    await manager.dispose();
  }
}
