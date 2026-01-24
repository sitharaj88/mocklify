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
    this.databases = context.globalState.get('specter.databases', []);
  }

  async show(): Promise<void> {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'specterDashboard',
      'Specter Dashboard',
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
  <title>Specter Dashboard</title>
</head>
<body>
  <div id="root">
    <div style="display: flex; align-items: center; justify-content: center; height: 100vh; color: #ccc; font-family: sans-serif;">
      <div style="text-align: center;">
        <div style="font-size: 24px; margin-bottom: 10px;">Loading Specter Dashboard...</div>
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

      // Import/Export handlers
      case 'importOpenApi':
        await this.importOpenApi(message.serverId!, message.data as { content: string });
        break;

      case 'importPostman':
        await this.importPostman(message.serverId!, message.data as { content: string });
        break;

      case 'exportServer':
        if (message.serverId) {
          await this.exportServer(message.serverId);
        }
        break;

      case 'exportLogs':
        await this.exportLogs(message.serverId, message.data as { format: string } | undefined);
        break;

      // Recording handlers
      case 'startRecording':
        if (message.serverId) {
          await this.startRecording(message.serverId, message.data as { targetUrl: string; pathFilter?: string });
        }
        break;

      case 'stopRecording':
        if (message.serverId) {
          await this.stopRecording(message.serverId, message.data as { action: string });
        }
        break;

      case 'getRecordingStatus':
        if (message.serverId) {
          this.sendRecordingStatus(message.serverId);
        }
        break;

      // Search/filter - handled on frontend, but can request filtered data
      case 'searchRoutes':
        await this.searchRoutes(message.data as { query: string; serverId?: string });
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
    await this.context.globalState.update('specter.databases', this.databases);
    await this.sendState();
    this.sendSuccess('Database connection added');
  }

  private async updateDatabase(data: DatabaseConnection): Promise<void> {
    const index = this.databases.findIndex((d) => d.id === data.id);
    if (index !== -1) {
      this.databases[index] = data;
      await this.context.globalState.update('specter.databases', this.databases);
      await this.sendState();
      this.sendSuccess('Database connection updated');
    }
  }

  private async deleteDatabase(databaseId: string): Promise<void> {
    this.databases = this.databases.filter((d) => d.id !== databaseId);
    await this.context.globalState.update('specter.databases', this.databases);
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

  // Import/Export implementations
  private async importOpenApi(serverId: string, data: { content: string }): Promise<void> {
    try {
      const openApiService = this.manager.getOpenApiService();
      const routes = openApiService.parseSpec(data.content);
      
      for (const route of routes) {
        await this.manager.addRoute(serverId, route);
      }
      
      await this.sendState();
      this.sendSuccess(`Imported ${routes.length} routes from OpenAPI spec`);
    } catch (error) {
      this.sendError(error instanceof Error ? error.message : 'Failed to import OpenAPI spec');
    }
  }

  private async importPostman(serverId: string, data: { content: string }): Promise<void> {
    try {
      const postmanService = this.manager.getPostmanService();
      const routes = postmanService.parseCollection(data.content);
      
      for (const route of routes) {
        await this.manager.addRoute(serverId, route);
      }
      
      await this.sendState();
      this.sendSuccess(`Imported ${routes.length} routes from Postman collection`);
    } catch (error) {
      this.sendError(error instanceof Error ? error.message : 'Failed to import Postman collection');
    }
  }

  private async exportServer(serverId: string): Promise<void> {
    try {
      const exportService = this.manager.getExportService();
      const server = await this.manager.getServer(serverId);
      
      if (!server) {
        this.sendError('Server not found');
        return;
      }
      
      const routes: RouteConfig[] = [];
      for (const route of server.routes) {
        routes.push(route);
      }
      
      const content = exportService.exportServerConfig({
        name: server.name,
        port: server.port,
        routes,
      });
      
      this.panel?.webview.postMessage({
        type: 'exportResult',
        format: 'json',
        content,
        filename: `${server.name.replace(/\s+/g, '-')}-config.json`,
      });
    } catch (error) {
      this.sendError(error instanceof Error ? error.message : 'Failed to export server');
    }
  }

  private async exportLogs(serverId: string | undefined, data?: { format: string }): Promise<void> {
    try {
      const exportService = this.manager.getExportService();
      const logs = this.manager.getLogEntries(serverId);
      const format = data?.format || 'har';
      
      let content: string;
      let extension: string;
      
      if (format === 'curl') {
        const server = serverId ? await this.manager.getServer(serverId) : null;
        content = exportService.exportLogsToCurl(logs, server?.port || 3000);
        extension = 'sh';
      } else {
        content = exportService.exportLogsToHar(logs);
        extension = 'har';
      }
      
      this.panel?.webview.postMessage({
        type: 'exportResult',
        format,
        content,
        filename: `specter-logs.${extension}`,
      });
    } catch (error) {
      this.sendError(error instanceof Error ? error.message : 'Failed to export logs');
    }
  }

  // Recording implementations
  private async startRecording(
    serverId: string,
    data: { targetUrl: string; pathFilter?: string }
  ): Promise<void> {
    try {
      const recordingManager = this.manager.getRecordingManager();
      
      const session = recordingManager.createSession(serverId, data.targetUrl, {
        pathFilter: data.pathFilter ? new RegExp(data.pathFilter) : undefined,
      });
      
      session.start();
      
      this.sendRecordingStatus(serverId);
      this.sendSuccess('Recording started');
    } catch (error) {
      this.sendError(error instanceof Error ? error.message : 'Failed to start recording');
    }
  }

  private async stopRecording(serverId: string, data: { action: string }): Promise<void> {
    try {
      const recordingManager = this.manager.getRecordingManager();
      const session = recordingManager.getSession(serverId);
      
      if (!session) {
        this.sendError('No active recording session');
        return;
      }
      
      session.stop();
      const recordings = session.getRecordings();
      
      if (data.action === 'generate' && recordings.length > 0) {
        const routes = session.generateRoutes();
        for (const route of routes) {
          await this.manager.addRoute(serverId, route);
        }
        this.sendSuccess(`Generated ${routes.length} routes from recordings`);
      } else if (data.action === 'save') {
        await recordingManager.saveSession(serverId);
        this.sendSuccess('Recordings saved');
      }
      
      recordingManager.deleteSession(serverId);
      await this.sendState();
      this.sendRecordingStatus(serverId);
    } catch (error) {
      this.sendError(error instanceof Error ? error.message : 'Failed to stop recording');
    }
  }

  private sendRecordingStatus(serverId: string): void {
    const recordingManager = this.manager.getRecordingManager();
    const session = recordingManager.getSession(serverId);
    
    this.panel?.webview.postMessage({
      type: 'recordingStatus',
      serverId,
      isRecording: session?.isRecording() || false,
      recordingCount: session?.getRecordings().length || 0,
      targetUrl: session ? (session as { targetUrl?: string }).targetUrl : undefined,
    });
  }

  private async searchRoutes(data: { query: string; serverId?: string }): Promise<void> {
    const servers = await this.manager.getServers();
    const results: { serverId: string; serverName: string; routes: RouteConfig[] }[] = [];
    
    const query = data.query.toLowerCase();
    
    for (const server of servers) {
      if (data.serverId && server.id !== data.serverId) continue;
      
      const matchingRoutes = server.routes.filter((route) => {
        return (
          route.name.toLowerCase().includes(query) ||
          route.path.toLowerCase().includes(query) ||
          route.method.toLowerCase().includes(query) ||
          (route.tags && route.tags.some((tag) => tag.toLowerCase().includes(query)))
        );
      });
      
      if (matchingRoutes.length > 0) {
        results.push({
          serverId: server.id,
          serverName: server.name,
          routes: matchingRoutes,
        });
      }
    }
    
    this.panel?.webview.postMessage({
      type: 'searchResults',
      query: data.query,
      results,
    });
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
