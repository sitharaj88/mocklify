import * as vscode from 'vscode';
import { MockServerManager } from '../core/MockServerManager.js';
import { MockServerConfig, RouteConfig, DatabaseConnection } from '../types/core.js';
import { v4 as uuidv4 } from 'uuid';
import { AiUnavailableError, AiProviderId } from '../ai/providers/types.js';
import { MODEL_CATALOG, ModelProviderId } from '../ai/modelCatalog.js';
import type { MockGenerator } from '../ai/MockGenerator.js';
import type { AiService } from '../ai/AiService.js';
import type { ApiKeyManager } from '../ai/providers/ApiKeyManager.js';

const MODEL_SETTINGS: Record<string, string> = {
  claude: 'ai.claudeModel',
  openai: 'ai.openaiModel',
  gemini: 'ai.geminiModel',
};

const BASE_URL_SETTINGS: Record<string, string> = {
  claude: 'ai.claudeBaseUrl',
  openai: 'ai.openaiBaseUrl',
  gemini: 'ai.geminiBaseUrl',
};

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
    private manager: MockServerManager,
    private mockGenerator?: MockGenerator,
    private aiService?: AiService,
    private apiKeys?: ApiKeyManager
  ) {
    // Load databases from storage
    this.databases = context.globalState.get('mocklify.databases', []);
  }

  async show(): Promise<void> {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'mocklifyDashboard',
      'Mocklify Dashboard',
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' 'unsafe-eval'; worker-src blob:; font-src ${webview.cspSource} data:; img-src ${webview.cspSource} https: data:; connect-src ${webview.cspSource};">
  <link rel="stylesheet" href="${styleUri}">
  <title>Mocklify Dashboard</title>
</head>
<body>
  <div id="root">
    <div style="display: flex; align-items: center; justify-content: center; height: 100vh; color: #ccc; font-family: sans-serif;">
      <div style="text-align: center;">
        <div style="font-size: 24px; margin-bottom: 10px;">Loading Mocklify Dashboard...</div>
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

      case 'testDatabase':
        if (message.databaseId) {
          await this.testDatabase(message.databaseId);
        }
        break;

      case 'clearLogs':
        this.manager.clearLogs(message.serverId);
        await this.sendState();
        break;

      // AI configuration
      case 'getAiConfig':
        await this.sendAiConfig();
        break;

      case 'setAiProvider':
        await vscode.workspace
          .getConfiguration('mocklify')
          .update(
            'ai.provider',
            (message.data as { provider: string }).provider,
            vscode.ConfigurationTarget.Global
          );
        await this.sendAiConfig();
        break;

      case 'setAiModel': {
        const { provider, model } = message.data as { provider: string; model: string };
        const setting = MODEL_SETTINGS[provider];
        if (setting && model.trim()) {
          await vscode.workspace
            .getConfiguration('mocklify')
            .update(setting, model.trim(), vscode.ConfigurationTarget.Global);
        }
        await this.sendAiConfig();
        break;
      }

      case 'setAiBaseUrl': {
        // Empty string is a valid value: it resets to the provider's official API.
        const { provider, baseUrl } = message.data as { provider: string; baseUrl: string };
        const setting = BASE_URL_SETTINGS[provider];
        if (setting) {
          await vscode.workspace
            .getConfiguration('mocklify')
            .update(setting, baseUrl.trim(), vscode.ConfigurationTarget.Global);
        }
        await this.sendAiConfig();
        break;
      }

      case 'setAiApiKey': {
        const { provider, key } = message.data as { provider: AiProviderId; key: string };
        if (key.trim() && this.apiKeys) {
          await this.apiKeys.setKey(provider, key.trim());
          this.sendSuccess(`${provider} API key saved`);
        }
        await this.sendAiConfig();
        break;
      }

      case 'clearAiApiKey': {
        const { provider } = message.data as { provider: AiProviderId };
        await this.apiKeys?.deleteKey(provider);
        await this.sendAiConfig();
        break;
      }

      case 'testAiProvider':
        await this.testAiProvider();
        break;

      // AI generation
      case 'aiGenerateServer':
        await this.aiGenerateServer(
          message.data as { description: string; autoStart?: boolean }
        );
        break;

      case 'aiGenerateRoutes':
        if (message.serverId) {
          await this.aiGenerateRoutes(
            message.serverId,
            message.data as { description: string }
          );
        }
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
    await this.context.globalState.update('mocklify.databases', this.databases);
    await this.sendState();
    this.sendSuccess('Database connection added');
  }

  private async updateDatabase(data: DatabaseConnection): Promise<void> {
    const index = this.databases.findIndex((d) => d.id === data.id);
    if (index !== -1) {
      this.databases[index] = data;
      await this.context.globalState.update('mocklify.databases', this.databases);
      await this.sendState();
      this.sendSuccess('Database connection updated');
    }
  }

  private async deleteDatabase(databaseId: string): Promise<void> {
    this.databases = this.databases.filter((d) => d.id !== databaseId);
    await this.context.globalState.update('mocklify.databases', this.databases);
    await this.sendState();
    this.sendSuccess('Database connection deleted');
  }

  private async testDatabase(databaseId: string): Promise<void> {
    const database = this.databases.find((d) => d.id === databaseId);
    if (!database) {
      this.sendError('Database connection not found');
      return;
    }

    try {
      if (database.type === 'json') {
        const filePath = (database.config as { filePath?: string }).filePath;
        if (filePath) {
          const fs = await import('fs');
          const path = await import('path');
          const workspaceFolders = vscode.workspace.workspaceFolders;
          const basePath = workspaceFolders?.[0]?.uri.fsPath || '';
          const fullPath = path.resolve(basePath, filePath);
          if (fs.existsSync(fullPath)) {
            const content = fs.readFileSync(fullPath, 'utf-8');
            JSON.parse(content);
            this.sendSuccess('Connection successful! JSON file is valid.');
          } else {
            this.sendError(`File not found: ${filePath}`);
          }
        } else {
          this.sendError('No file path configured');
        }
      } else {
        this.sendSuccess(`Connection test for ${database.type} is not yet implemented.`);
      }
    } catch (error) {
      this.sendError(error instanceof Error ? error.message : 'Connection test failed');
    }
  }

  private sendError(message: string): void {
    this.panel?.webview.postMessage({ type: 'error', message });
    vscode.window.showErrorMessage(message);
  }

  private sendSuccess(message: string): void {
    this.panel?.webview.postMessage({ type: 'success', message });
  }

  // AI configuration implementations
  private async sendAiConfig(): Promise<void> {
    if (!this.aiService) {
      return;
    }

    const config = vscode.workspace.getConfiguration('mocklify');
    const providers = await Promise.all(
      this.aiService.getAllProviders().map(async (p) => ({
        id: p.id,
        label: p.label,
        available: await p.isAvailable(),
        requiresKey: p.id !== 'copilot',
        hasKey: p.id !== 'copilot' ? ((await this.apiKeys?.hasKey(p.id)) ?? false) : false,
        model: MODEL_SETTINGS[p.id] ? config.get<string>(MODEL_SETTINGS[p.id]) : undefined,
        baseUrl: BASE_URL_SETTINGS[p.id] ? config.get<string>(BASE_URL_SETTINGS[p.id], '') : undefined,
        models:
          p.id in MODEL_CATALOG ? MODEL_CATALOG[p.id as ModelProviderId].models : undefined,
      }))
    );

    this.panel?.webview.postMessage({
      type: 'aiConfig',
      provider: this.aiService.getConfiguredProviderId(),
      activeLabel: await this.aiService.getActiveProviderLabel(),
      providers,
    });
  }

  private async testAiProvider(): Promise<void> {
    if (!this.aiService) {
      return;
    }
    try {
      const provider = await this.aiService.resolveProvider();
      const start = Date.now();
      const reply = await this.aiService.sendRequest(
        'Reply with exactly the word OK and nothing else.',
        { justification: 'Mocklify is testing your AI provider configuration.' }
      );
      const seconds = ((Date.now() - start) / 1000).toFixed(1);
      this.panel?.webview.postMessage({
        type: 'aiTestResult',
        ok: true,
        message: `${provider.label} responded in ${seconds}s — AI is working. Reply: "${reply.trim().slice(0, 60)}"`,
      });
    } catch (error) {
      this.panel?.webview.postMessage({
        type: 'aiTestResult',
        ok: false,
        message: this.describeAiError(error),
      });
    }
  }

  // AI generation implementations
  private async aiGenerateServer(data: {
    description: string;
    autoStart?: boolean;
  }): Promise<void> {
    if (!this.mockGenerator) {
      this.sendAiStatus('error', 'AI features are not available in this session.');
      return;
    }
    if (!data.description?.trim()) {
      this.sendAiStatus('error', 'Please describe the API you want to mock.');
      return;
    }

    this.sendAiStatus('generating', undefined, await this.aiService?.getActiveProviderLabel());

    try {
      const config = vscode.workspace.getConfiguration('mocklify');
      const defaultPort = config.get<number>('defaultPort', 3000);
      const servers = await this.manager.getServers();
      const usedPorts = new Set(servers.map((s) => s.port));
      let freePort = defaultPort;
      while (usedPorts.has(freePort)) {
        freePort++;
      }

      const generated = await this.mockGenerator.generateServer(data.description, {
        defaultPort: freePort,
      });
      if (usedPorts.has(generated.port)) {
        generated.port = freePort;
      }

      const server = await this.manager.createServer(generated.name, generated.port);
      for (const route of generated.routes) {
        await this.manager.addRoute(server.id, route);
      }

      if (data.autoStart) {
        try {
          await this.manager.startServer(server.id);
        } catch (error) {
          // Server was created; surface the start failure without failing generation
          this.sendError(
            `Server created, but failed to start: ${error instanceof Error ? error.message : 'unknown error'}`
          );
        }
      }

      await this.sendState();
      this.panel?.webview.postMessage({
        type: 'aiStatus',
        status: 'done',
        serverId: server.id,
        serverName: server.name,
        port: server.port,
        routeCount: generated.routes.length,
      });
    } catch (error) {
      this.sendAiStatus('error', this.describeAiError(error));
    }
  }

  private async aiGenerateRoutes(
    serverId: string,
    data: { description: string }
  ): Promise<void> {
    if (!this.mockGenerator) {
      this.sendAiStatus('error', 'AI features are not available in this session.');
      return;
    }
    if (!data.description?.trim()) {
      this.sendAiStatus('error', 'Please describe the route(s) you want to add.');
      return;
    }

    const server = await this.manager.getServer(serverId);
    if (!server) {
      this.sendAiStatus('error', 'Server not found.');
      return;
    }

    this.sendAiStatus('generating', undefined, await this.aiService?.getActiveProviderLabel());

    try {
      const routes = await this.mockGenerator.generateRoutes(data.description, server);
      for (const route of routes) {
        await this.manager.addRoute(serverId, route);
      }

      await this.sendState();
      this.panel?.webview.postMessage({
        type: 'aiStatus',
        status: 'done',
        serverId,
        serverName: server.name,
        port: server.port,
        routeCount: routes.length,
      });
    } catch (error) {
      this.sendAiStatus('error', this.describeAiError(error));
    }
  }

  private sendAiStatus(
    status: 'generating' | 'done' | 'error',
    message?: string,
    provider?: string
  ): void {
    this.panel?.webview.postMessage({ type: 'aiStatus', status, message, provider });
  }

  private describeAiError(error: unknown): string {
    if (error instanceof AiUnavailableError) {
      return error.message;
    }
    return error instanceof Error ? error.message : 'AI generation failed';
  }

  // Import/Export implementations
  private async importOpenApi(serverId: string, data: { content: string }): Promise<void> {
    try {
      const openApiService = this.manager.getOpenApiService();
      const result = openApiService.importFromString(data.content, {
        generateFakeData: true,
        includeExamples: true,
      });

      if (!result.success) {
        this.sendError(result.errors.join(', ') || 'Failed to import OpenAPI spec');
        return;
      }

      for (const route of result.routes) {
        await this.manager.addRoute(serverId, route);
      }

      await this.sendState();
      this.sendSuccess(`Imported ${result.routes.length} routes from OpenAPI spec`);
    } catch (error) {
      this.sendError(error instanceof Error ? error.message : 'Failed to import OpenAPI spec');
    }
  }

  private async importPostman(serverId: string, data: { content: string }): Promise<void> {
    try {
      const postmanService = this.manager.getPostmanService();
      const result = postmanService.importFromString(data.content, {
        includeExamples: true,
        convertVariables: true,
      });

      if (!result.success) {
        this.sendError(result.errors.join(', ') || 'Failed to import Postman collection');
        return;
      }

      for (const route of result.routes) {
        await this.manager.addRoute(serverId, route);
      }

      await this.sendState();
      this.sendSuccess(`Imported ${result.routes.length} routes from Postman collection`);
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
      
      const content = exportService.exportServerToJson(server, { pretty: true });

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
        const server = serverId ? await this.manager.getServer(serverId) : null;
        content = JSON.stringify(exportService.exportLogsToHar(logs, server?.port), null, 2);
        extension = 'har';
      }
      
      this.panel?.webview.postMessage({
        type: 'exportResult',
        format,
        content,
        filename: `mocklify-logs.${extension}`,
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
        filterPaths: data.pathFilter ? [data.pathFilter] : undefined,
      });

      recordingManager.startRecording(session.id);

      this.sendRecordingStatus(serverId);
      this.sendSuccess('Recording started');
    } catch (error) {
      this.sendError(error instanceof Error ? error.message : 'Failed to start recording');
    }
  }

  private async stopRecording(serverId: string, data: { action: string }): Promise<void> {
    try {
      const recordingManager = this.manager.getRecordingManager();
      const session = this.findSessionForServer(serverId);

      if (!session) {
        this.sendError('No active recording session');
        return;
      }

      await recordingManager.stopRecording(session.id);
      const recordings = session.requests;

      if (data.action === 'generate' && recordings.length > 0) {
        const routes = session.generateRoutes({ deduplicatePaths: true, extractPathParams: true });
        for (const route of routes) {
          await this.manager.addRoute(serverId, route);
        }
        this.sendSuccess(`Generated ${routes.length} routes from recordings`);
        await recordingManager.deleteSession(session.id);
      } else if (data.action === 'save') {
        // stopRecording already persisted the session to .mocklify/recordings
        this.sendSuccess('Recordings saved');
      } else {
        await recordingManager.deleteSession(session.id);
      }

      await this.sendState();
      this.sendRecordingStatus(serverId);
    } catch (error) {
      this.sendError(error instanceof Error ? error.message : 'Failed to stop recording');
    }
  }

  private sendRecordingStatus(serverId: string): void {
    const session = this.findSessionForServer(serverId);

    this.panel?.webview.postMessage({
      type: 'recordingStatus',
      serverId,
      isRecording: session?.state.status === 'recording',
      recordingCount: session?.requests.length || 0,
      targetUrl: session?.config.targetUrl,
    });
  }

  /** Recording sessions are created with the server id as their name. */
  private findSessionForServer(serverId: string) {
    const recordingManager = this.manager.getRecordingManager();
    return (
      recordingManager
        .getAllSessions()
        .find((s) => s.config.name === serverId && s.state.status !== 'stopped') ??
      recordingManager.getActiveSession()
    );
  }

  private async searchRoutes(data: { query: string; serverId?: string }): Promise<void> {
    const servers = await this.manager.getServers();
    const results: { serverId: string; serverName: string; routes: RouteConfig[] }[] = [];
    
    const query = data.query.toLowerCase();
    
    for (const server of servers) {
      if (data.serverId && server.id !== data.serverId) continue;
      
      const matchingRoutes = server.routes.filter((route) => {
        const methods = Array.isArray(route.method) ? route.method : [route.method];
        return (
          route.name.toLowerCase().includes(query) ||
          route.path.toLowerCase().includes(query) ||
          methods.some((m) => m.toLowerCase().includes(query)) ||
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
