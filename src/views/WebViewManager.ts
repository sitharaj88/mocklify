import * as vscode from 'vscode';
import { MockServerManager } from '../core/MockServerManager.js';
import { MockServerConfig, RouteConfig, DatabaseConnection } from '../types/core.js';
import { v4 as uuidv4 } from 'uuid';
import { OpenApiExportService } from '../services/OpenApiExportService.js';
import { buildApiDocsHtml, buildConfluenceStorageXhtml } from '../services/DocsExportService.js';
import {
  buildHttpFile,
  buildOpenApiYaml,
  buildPostmanCollection,
} from '../services/CollectionExportService.js';
import { AiUnavailableError, AiProviderId } from '../ai/providers/types.js';
import { MODEL_CATALOG, ModelProviderId } from '../ai/modelCatalog.js';
import { CENSUS_NO_ROUTES_MESSAGE, CodebaseScanProgress } from '../ai/CodebaseMockGenerator.js';
import {
  ScanOrchestrator,
  isScanCancellation,
  type OrchestratedScanSummary,
} from '../ai/ScanOrchestrator.js';
import {
  deriveScanThreadId,
  hasResumableScan,
  type ResumableScanInfo,
} from '../ai/agent/scanGraph.js';
import type { HumanQuestion } from '../ai/agent/graphRuntime.js';
import { offerSpecImport, importWorkspaceSpec } from '../ai/AiCommands.js';
import type { MockGenerator } from '../ai/MockGenerator.js';
import type { AiService } from '../ai/AiService.js';
import type { ApiKeyManager } from '../ai/providers/ApiKeyManager.js';

/**
 * Hard cap on mock servers auto-created (and auto-started) from one webview
 * scan — this flow has no per-surface confirmation dialog, so a scan that
 * somehow yields more surfaces than this falls back to a single combined
 * server instead of fanning out.
 */
const MAX_SURFACE_SERVERS = 8;

const MODEL_SETTINGS: Record<string, string> = {
  copilot: 'ai.copilotModel',
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
  private aiGenerationCts: vscode.CancellationTokenSource | undefined;
  /** Resolvers for ask_user questions currently shown in the dashboard. */
  private pendingScanAnswers = new Map<string, (answer: string) => void>();

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
    const version = (this.context.extension.packageJSON as { version?: string }).version ?? '';

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
  <script nonce="${nonce}">window.__MOCKLIFY_VERSION__ = ${JSON.stringify(version)};</script>
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
        // Copilot accepts '' = auto (best available); API providers need a model ID.
        if (setting && (model.trim() || provider === 'copilot')) {
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
          this.sendSuccess(
            baseUrl.trim()
              ? `${provider} endpoint saved — requests now go to ${baseUrl.trim()}`
              : `${provider} endpoint cleared — using the official API`
          );
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

      case 'aiGenerateFromCodebase':
        await this.aiGenerateFromCodebase(
          message.data as { autoStart?: boolean; resume?: 'resume' | 'fresh' } | undefined
        );
        break;

      case 'aiAnswerQuestion': {
        const { id, answer } = (message.data ?? {}) as { id?: string; answer?: string };
        const settle = typeof id === 'string' ? this.pendingScanAnswers.get(id) : undefined;
        if (settle) {
          settle(typeof answer === 'string' ? answer : '');
        }
        break;
      }

      case 'aiCancelGeneration':
        this.aiGenerationCts?.cancel();
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
          await this.exportServer(message.serverId, message.data as { format?: string } | undefined);
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
    const copilotModels = (await this.aiService.listCopilotModels()).map((m) => ({
      id: m.family,
      detail: m.name,
    }));
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
          p.id === 'copilot'
            ? copilotModels.length > 0
              ? copilotModels
              : undefined
            : p.id in MODEL_CATALOG
              ? MODEL_CATALOG[p.id as ModelProviderId].models
              : undefined,
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

  /**
   * Dashboard-driven codebase scan with live progress: streams scan/analyze
   * progress into the AI panel (message + fraction), delegates strategy
   * selection to the ScanOrchestrator (spec > agentic > fast > census per
   * surface, honoring the scanMode setting), and creates the server directly
   * (the panel's result card replaces the command flow's modal confirm).
   */
  private async aiGenerateFromCodebase(data?: {
    autoStart?: boolean;
    resume?: 'resume' | 'fresh';
  }): Promise<void> {
    if (!this.aiService) {
      this.sendAiStatus('error', 'AI features are not available in this session.');
      return;
    }
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!workspaceRoot) {
      this.sendAiStatus('error', 'Open a folder or workspace to scan for API calls.');
      return;
    }
    if (this.aiGenerationCts) {
      this.sendAiStatus('error', 'A generation is already running — cancel it first.');
      return;
    }

    // Resume flow: when the user has not decided yet and an interrupted
    // agentic scan left checkpoints behind, surface an inline Resume /
    // Start-fresh choice in the panel and wait for the answer round trip.
    if (!data?.resume) {
      const resumable = await this.detectResumableScan(workspaceRoot);
      if (resumable) {
        this.panel?.webview.postMessage({
          type: 'aiStatus',
          status: 'idle',
          resumable: {
            completedSurfaces: resumable.completedSurfaces,
            totalSurfaces: resumable.totalSurfaces,
            startedAt: resumable.startedAt,
          },
        });
        return;
      }
    }

    const provider = await this.aiService.getActiveProviderLabel();
    this.sendAiStatus('generating', 'Scanning workspace for API calls…', provider);

    this.aiGenerationCts = new vscode.CancellationTokenSource();
    const token = this.aiGenerationCts.token;

    try {
      const onProgress = ({ message, fraction }: CodebaseScanProgress) => {
        this.panel?.webview.postMessage({
          type: 'aiStatus',
          status: 'generating',
          message,
          fraction,
          provider,
        });
      };

      // Human-in-the-loop: agentic exploration may ask up to 2 short
      // questions per API surface — rendered as an inline card in the panel —
      // unless the user opted out via mocklify.ai.askQuestions.
      const askQuestions = vscode.workspace
        .getConfiguration('mocklify')
        .get<boolean>('ai.askQuestions', true);
      const onQuestion = askQuestions
        ? (question: HumanQuestion) => this.askDashboardQuestion(question, token, provider)
        : undefined;

      // The orchestrator runs recon once, picks the best strategy per API
      // surface (spec > agentic > fast > census, honoring the scanMode
      // setting), routes agentic surfaces through the LangGraph pipeline
      // (parallel exploration + critic verification), and falls back to the
      // fast scan itself when the provider cannot run tool loops.
      // Resuming goes through the orchestrator too: only the agentic slice is
      // checkpointed, so resuming the graph directly would drop every surface
      // the fast/spec strategies owned.
      let resumeThreadId: string | undefined;
      if (data?.resume === 'resume') {
        resumeThreadId = (await this.detectResumableScan(workspaceRoot))?.threadId;
      }
      const summary: OrchestratedScanSummary = await new ScanOrchestrator(this.aiService).generate({
        token,
        onProgress,
        onQuestion,
        threadId: resumeThreadId ?? deriveScanThreadId(workspaceRoot.fsPath),
        ...(resumeThreadId !== undefined ? { resume: true } : {}),
      });
      if (token.isCancellationRequested) {
        this.panel?.webview.postMessage({ type: 'aiStatus', status: 'idle' });
        return;
      }

      // Spec-first shortcut: an existing API spec gives exact routes without
      // inference — offer it (non-modal) before creating anything.
      if (summary.specFiles?.length) {
        onProgress({ message: 'Found an API spec file — waiting for your choice…', fraction: 0.95 });
        const choice = await offerSpecImport(summary.specFiles);
        if (choice === 'import' || choice === 'both') {
          await importWorkspaceSpec(summary.specFiles);
          if (choice === 'import') {
            this.panel?.webview.postMessage({ type: 'aiStatus', status: 'idle' });
            return;
          }
        }
      }

      // Zero-route agentic completion: the agent explored the workspace and
      // concluded there is nothing to mock — informational, never an error.
      if (summary.noApiSurfaceReason) {
        this.panel?.webview.postMessage({
          type: 'aiStatus',
          status: 'done',
          message: `Mocklify explored the workspace and found no API surface to mock: ${summary.noApiSurfaceReason}`,
        });
        return;
      }

      const servers = await this.manager.getServers();
      const usedPorts = new Set(servers.map((s) => s.port));
      let port = vscode.workspace.getConfiguration('mocklify').get<number>('defaultPort', 3000);
      const nextFreePort = (): number => {
        while (usedPorts.has(port)) {
          port++;
        }
        usedPorts.add(port);
        return port;
      };

      const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name ?? 'App';
      const surfaces = summary.surfaces ?? [];
      const created: { server: MockServerConfig; routeCount: number }[] = [];
      if (surfaces.length > 1 && surfaces.length <= MAX_SURFACE_SERVERS) {
        // Multi-surface workspace: one mock server per API surface.
        for (const surface of surfaces) {
          const server = await this.manager.createServer(
            `${surface.name} Mock API`,
            nextFreePort()
          );
          await this.manager.addRoutes(server.id, surface.routes);
          created.push({ server, routeCount: surface.routes.length });
        }
      } else {
        const server = await this.manager.createServer(`${workspaceName} Mock API`, nextFreePort());
        await this.manager.addRoutes(server.id, summary.routes);
        created.push({ server, routeCount: summary.routes.length });
      }

      if (data?.autoStart) {
        for (const { server } of created) {
          try {
            await this.manager.startServer(server.id);
          } catch (error) {
            this.sendError(
              `"${server.name}" created, but failed to start: ${error instanceof Error ? error.message : 'unknown error'}`
            );
          }
        }
      }

      await this.sendState();
      const first = created[0];
      const surfaceNote =
        created.length > 1
          ? `${created.length} API surfaces detected — one mock server per surface (${created
              .map(({ server }) => `"${server.name}" on port ${server.port}`)
              .join(', ')}). `
          : '';
      const strategyNote = summary.strategies?.length
        ? `Scan strategy: ${summary.strategies
            .map((entry) => `${entry.surface} → ${entry.strategy}`)
            .join(', ')}. `
        : '';
      const verificationNote = summary.verification
        ? ` Verified by a critic agent: ${summary.verification.confirmed} confirmed, ${summary.verification.repaired} repaired, ${summary.verification.dropped} dropped.`
        : '';
      this.panel?.webview.postMessage({
        type: 'aiStatus',
        status: 'done',
        serverId: first.server.id,
        serverName: first.server.name,
        port: first.server.port,
        routeCount: summary.routes.length,
        servers: created.map(({ server, routeCount }) => ({
          serverId: server.id,
          serverName: server.name,
          port: server.port,
          routeCount,
        })),
        message: `${surfaceNote}${strategyNote}${summary.positiveCount} success + ${summary.negativeCount} failure routes from ${summary.matchedFileCount} API files (failure routes are disabled — toggle one on to simulate that error).${verificationNote}`,
      });
    } catch (error) {
      if (
        error instanceof vscode.CancellationError ||
        isScanCancellation(error) ||
        token.isCancellationRequested
      ) {
        this.panel?.webview.postMessage({ type: 'aiStatus', status: 'idle' });
        // The LangGraph pipeline aborts with an AbortError and leaves a
        // resumable checkpoint behind — keep it and say so.
        void this.detectResumableScan(workspaceRoot).then((info) => {
          if (info) {
            vscode.window.showInformationMessage(
              'Mocklify: Scan paused — the next "From Codebase" run can resume where it left off.'
            );
          }
        });
        return;
      }
      // Even the census scan found nothing to mock — an informational
      // outcome (empty workspace), not an error card.
      if (error instanceof Error && error.message === CENSUS_NO_ROUTES_MESSAGE) {
        this.panel?.webview.postMessage({ type: 'aiStatus', status: 'done', message: error.message });
        return;
      }
      this.sendAiStatus('error', this.describeAiError(error));
    } finally {
      // Any question still awaiting an answer reads as "no answer" once the
      // scan is over — never leave a dangling resolver behind.
      for (const settle of [...this.pendingScanAnswers.values()]) {
        settle('');
      }
      this.pendingScanAnswers.clear();
      this.aiGenerationCts?.dispose();
      this.aiGenerationCts = undefined;
    }
  }

  /** Interrupted-scan detection that must never break starting a fresh scan. */
  private async detectResumableScan(workspaceRoot: vscode.Uri): Promise<ResumableScanInfo | null> {
    try {
      return await hasResumableScan(workspaceRoot);
    } catch {
      return null;
    }
  }

  /**
   * Bridge an agentic ask_user question into the dashboard: an additive
   * `question` payload rides the aiStatus channel, AiCreatePanel renders it
   * with answer buttons, and the webview's aiAnswerQuestion message resolves
   * it. Cancelling the scan (or the 120s in-graph timeout ending the wait)
   * resolves with '' — this promise never rejects.
   */
  private askDashboardQuestion(
    question: HumanQuestion,
    token: vscode.CancellationToken,
    provider?: string
  ): Promise<string> {
    return new Promise<string>((resolve) => {
      let settled = false;
      // `settle` and `subscription` reference each other; both only run after
      // this scope finishes initializing, so the forward reference is safe.
      const settle = (answer: string): void => {
        if (settled) {
          return;
        }
        settled = true;
        this.pendingScanAnswers.delete(question.id);
        subscription.dispose();
        resolve(answer);
      };
      this.pendingScanAnswers.set(question.id, settle);
      const subscription = token.onCancellationRequested(() => settle(''));
      this.panel?.webview.postMessage({
        type: 'aiStatus',
        status: 'generating',
        provider,
        message: `Waiting for your answer: ${question.question}`,
        question: {
          id: question.id,
          question: question.question,
          options: question.options,
          freeText: question.freeText !== false,
        },
      });
    });
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

  private async exportServer(serverId: string, data?: { format?: string }): Promise<void> {
    try {
      const server = await this.manager.getServer(serverId);

      if (!server) {
        this.sendError('Server not found');
        return;
      }

      const slug = server.name.replace(/\s+/g, '-');
      const format = data?.format ?? 'config';
      let content: string;
      let filename: string;

      switch (format) {
        case 'openapi-json':
          content = new OpenApiExportService().exportToJson(server);
          filename = `${slug}-openapi.json`;
          break;
        case 'openapi-yaml':
          content = buildOpenApiYaml(server, new OpenApiExportService().exportToOpenApi(server));
          filename = `${slug}-openapi.yaml`;
          break;
        case 'postman':
          content = JSON.stringify(buildPostmanCollection(server), null, 2);
          filename = `${slug}.postman_collection.json`;
          break;
        case 'http':
          content = buildHttpFile(server);
          filename = `${slug}.http`;
          break;
        case 'html':
          content = buildApiDocsHtml(server);
          filename = `${slug}-docs.html`;
          break;
        case 'confluence':
          content = buildConfluenceStorageXhtml(server);
          filename = `${slug}-docs.xml`;
          break;
        default:
          content = this.manager.getExportService().exportServerToJson(server, { pretty: true });
          filename = `${slug}-config.json`;
      }

      this.panel?.webview.postMessage({
        type: 'exportResult',
        format,
        content,
        filename,
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
