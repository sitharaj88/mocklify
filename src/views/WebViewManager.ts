import * as vscode from 'vscode';
import { MockServerManager } from '../core/MockServerManager.js';
import { MockServerConfig, RouteConfig, DatabaseConnection } from '../types/core.js';
import { v4 as uuidv4 } from 'uuid';

interface MessageToExtension {
  type: string;
  data?: unknown;
  serverId?: string;
  routeId?: string;
  databaseId?: string;
}

export class WebViewManager {
  private panel: vscode.WebviewPanel | undefined;
  private disposables: vscode.Disposable[] = [];
  private databases: DatabaseConnection[] = [];

  constructor(
    private context: vscode.ExtensionContext,
    private manager: MockServerManager
  ) {
    // Load databases from storage
    this.databases = context.globalState.get('mockserver.databases', []);
  }

  async show(): Promise<void> {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'mockServerDashboard',
      'Mock Server Dashboard',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'dist'),
        ],
      }
    );

    this.panel.webview.html = this.getWebviewContent();

    // Handle messages from webview
    this.panel.webview.onDidReceiveMessage(
      (message) => this.handleMessage(message),
      undefined,
      this.disposables
    );

    // Subscribe to server events
    const eventDisposable = this.manager.onEvent((event) => {
      if (event.type === 'server:started' || event.type === 'server:stopped') {
        this.sendState();
      } else if (event.type === 'request:received') {
        this.panel?.webview.postMessage({
          type: 'logEntry',
          entry: event.entry,
        });
      }
    });
    this.disposables.push(eventDisposable);

    // Subscribe to server changes
    const changeDisposable = this.manager.onDidChangeServers(() => {
      this.sendState();
    });
    this.disposables.push(changeDisposable);

    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.disposables.forEach((d) => d.dispose());
      this.disposables = [];
    });
  }

  private getWebviewContent(): string {
    const webview = this.panel!.webview;

    // Get URIs for assets
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'dist', 'assets', 'main.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'dist', 'assets', 'main.css')
    );

    const nonce = this.getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' 'unsafe-eval'; font-src ${webview.cspSource} data:; img-src ${webview.cspSource} https: data:; connect-src ${webview.cspSource};">
  <link rel="stylesheet" href="${styleUri}">
  <title>Mock Server Dashboard</title>
</head>
<body>
  <div id="root">
    <div style="display: flex; align-items: center; justify-content: center; height: 100vh; color: #ccc; font-family: sans-serif;">
      <div style="text-align: center;">
        <div style="font-size: 24px; margin-bottom: 10px;">Loading Mock Server Dashboard...</div>
        <div style="font-size: 12px; color: #888;">If this message persists, check Developer Tools (Help > Toggle Developer Tools) for errors.</div>
      </div>
    </div>
  </div>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private async handleMessage(message: MessageToExtension): Promise<void> {
    switch (message.type) {
      case 'ready':
      case 'getState':
        await this.sendState();
        break;

      case 'createServer':
        await this.createServer(message.data as Partial<MockServerConfig>);
        break;

      case 'updateServer':
        await this.updateServer(message.data as MockServerConfig);
        break;

      case 'deleteServer':
        if (message.serverId) {
          await this.manager.deleteServer(message.serverId);
        }
        break;

      case 'startServer':
        if (message.serverId) {
          try {
            await this.manager.startServer(message.serverId);
          } catch (error) {
            this.sendError(error instanceof Error ? error.message : 'Failed to start server');
          }
        }
        break;

      case 'stopServer':
        if (message.serverId) {
          try {
            await this.manager.stopServer(message.serverId);
          } catch (error) {
            this.sendError(error instanceof Error ? error.message : 'Failed to stop server');
          }
        }
        break;

      case 'createRoute':
        if (message.serverId) {
          await this.createRoute(message.serverId, message.data as Partial<RouteConfig>);
        }
        break;

      case 'updateRoute':
        if (message.serverId && message.routeId) {
          await this.manager.updateRoute(
            message.serverId,
            message.routeId,
            message.data as Partial<RouteConfig>
          );
        }
        break;

      case 'deleteRoute':
        if (message.serverId && message.routeId) {
          await this.manager.deleteRoute(message.serverId, message.routeId);
        }
        break;

      case 'createDatabase':
        await this.createDatabase(message.data as Partial<DatabaseConnection>);
        break;

      case 'updateDatabase':
        await this.updateDatabase(message.data as DatabaseConnection);
        break;

      case 'deleteDatabase':
        if (message.databaseId) {
          await this.deleteDatabase(message.databaseId);
        }
        break;

      case 'clearLogs':
        this.manager.clearLogs(message.serverId);
        await this.sendState();
        break;
    }
  }

  private async sendState(): Promise<void> {
    const servers = await this.manager.getServers();
    const serverStates: Record<string, unknown> = {};

    for (const server of servers) {
      const state = this.manager.getServerState(server.id);
      if (state) {
        serverStates[server.id] = state;
      }
    }

    const logs = this.manager.getLogEntries(undefined, 100);

    this.panel?.webview.postMessage({
      type: 'state',
      data: {
        servers,
        serverStates,
        databases: this.databases,
        logs,
      },
    });
  }

  private async createServer(data: Partial<MockServerConfig>): Promise<void> {
    try {
      await this.manager.createServer(
        data.name || 'New Server',
        data.port || 3000,
        data.protocol || 'http'
      );
      this.sendSuccess('Server created successfully');
    } catch (error) {
      this.sendError(error instanceof Error ? error.message : 'Failed to create server');
    }
  }

  private async updateServer(data: MockServerConfig): Promise<void> {
    try {
      const server = await this.manager.getServer(data.id);
      if (server) {
        await this.sendState();
        this.sendSuccess('Server updated successfully');
      }
    } catch (error) {
      this.sendError(error instanceof Error ? error.message : 'Failed to update server');
    }
  }

  private async createRoute(serverId: string, data: Partial<RouteConfig>): Promise<void> {
    try {
      await this.manager.addRoute(serverId, {
        name: data.name || 'New Route',
        enabled: data.enabled ?? true,
        method: data.method || 'GET',
        path: data.path || '/',
        response: data.response || {
          type: 'static',
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: { contentType: 'application/json', content: {} },
        },
        matcher: data.matcher,
        delay: data.delay,
        priority: data.priority,
      });
      this.sendSuccess('Route created successfully');
    } catch (error) {
      this.sendError(error instanceof Error ? error.message : 'Failed to create route');
    }
  }

  private async createDatabase(data: Partial<DatabaseConnection>): Promise<void> {
    const database: DatabaseConnection = {
      id: uuidv4(),
      name: data.name || 'New Database',
      type: data.type || 'json',
      config: data.config || { filePath: './data/db.json', collections: [] },
      enabled: data.enabled ?? true,
    };

    this.databases.push(database);
    await this.context.globalState.update('mockserver.databases', this.databases);
    await this.sendState();
    this.sendSuccess('Database connection added');
  }

  private async updateDatabase(data: DatabaseConnection): Promise<void> {
    const index = this.databases.findIndex((d) => d.id === data.id);
    if (index !== -1) {
      this.databases[index] = data;
      await this.context.globalState.update('mockserver.databases', this.databases);
      await this.sendState();
      this.sendSuccess('Database connection updated');
    }
  }

  private async deleteDatabase(databaseId: string): Promise<void> {
    this.databases = this.databases.filter((d) => d.id !== databaseId);
    await this.context.globalState.update('mockserver.databases', this.databases);
    await this.sendState();
    this.sendSuccess('Database connection deleted');
  }

  private sendError(message: string): void {
    this.panel?.webview.postMessage({ type: 'error', message });
    vscode.window.showErrorMessage(message);
  }

  private sendSuccess(message: string): void {
    this.panel?.webview.postMessage({ type: 'success', message });
  }

  private getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  dispose(): void {
    this.panel?.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
