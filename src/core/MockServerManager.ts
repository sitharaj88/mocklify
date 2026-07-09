import * as vscode from 'vscode';
import { statSync } from 'node:fs';
import { isAbsolute, resolve as resolvePath, dirname, basename } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import {
  ChaosConfig,
  ContractConfig,
  MockServerConfig,
  RouteConfig,
  RequestValidator,
  ServerRuntimeState,
  EventHandler,
  ServerEvent,
  RequestLogEntry,
  IRequestLogger,
  IMockServer,
} from '../types/core.js';
import { createRequestValidator } from '../services/ContractValidator.js';
import { ConfigurationStore } from '../storage/ConfigurationStore.js';
import { HttpMockServer } from '../servers/HttpMockServer.js';
import { GraphQLMockServer } from '../servers/GraphQLMockServer.js';
import { WebSocketMockServer } from '../servers/WebSocketMockServer.js';
import { RequestLogger } from '../logging/RequestLogger.js';
import { RecordingManager } from '../recording/RecordingManager.js';
import { DatabaseService } from '../services/DatabaseService.js';
import { OpenApiService } from '../services/OpenApiService.js';
import { PostmanService } from '../services/PostmanService.js';
import { ExportService } from '../services/ExportService.js';

export class MockServerManager {
  private configStore: ConfigurationStore;
  private servers: Map<string, IMockServer> = new Map();
  private requestLogger: RequestLogger;
  private eventHandlers: Set<EventHandler> = new Set();
  private _onDidChangeServers = new vscode.EventEmitter<void>();
  readonly onDidChangeServers = this._onDidChangeServers.event;

  // New services
  private recordingManager: RecordingManager;
  private databaseService: DatabaseService;
  private openApiService: OpenApiService;
  private postmanService: PostmanService;
  private exportService: ExportService;
  private workspaceRoot: string | undefined;

  // Contract validation. Validators are cached per resolved spec path + mtime so
  // multiple servers sharing a spec parse it once, and an edited spec is picked
  // up on the next rebuild. A per-server FileSystemWatcher recreates the running
  // instance (re-injecting a fresh validator) when its spec file changes on disk.
  private validatorCache = new Map<string, { mtimeMs: number; validator: RequestValidator | undefined }>();
  private contractWatchers = new Map<string, vscode.FileSystemWatcher>();

  constructor(workspaceRoot: string | undefined) {
    this.workspaceRoot = workspaceRoot;
    this.configStore = new ConfigurationStore(workspaceRoot);

    const config = vscode.workspace.getConfiguration('mocklify');
    const maxLogEntries = config.get<number>('logging.maxEntries', 1000);
    this.requestLogger = new RequestLogger(maxLogEntries);

    // Initialize services
    this.recordingManager = new RecordingManager(workspaceRoot);
    this.databaseService = new DatabaseService(workspaceRoot || '');
    this.openApiService = new OpenApiService();
    this.postmanService = new PostmanService();
    this.exportService = new ExportService();
  }

  /**
   * Initialize the manager and load configurations
   */
  async initialize(): Promise<void> {
    await this.configStore.initialize();
    await this.recordingManager.initialize();

    // Load all server configurations
    const configs = await this.configStore.getServers();
    for (const config of configs) {
      this.createServerInstance(config);
    }

    // Auto-start servers if enabled
    const autoStart = vscode.workspace.getConfiguration('mocklify').get<boolean>('autoStart', false);
    if (autoStart) {
      await this.startAll();
    }
  }

  /**
   * Create a new mock server
   */
  async createServer(
    name: string,
    port?: number,
    protocol: 'http' | 'graphql' | 'websocket' = 'http'
  ): Promise<MockServerConfig> {
    const config = vscode.workspace.getConfiguration('mocklify');
    const defaultPort = config.get<number>('defaultPort', 3000);

    const serverConfig: MockServerConfig = {
      id: uuidv4(),
      name,
      port: port ?? defaultPort,
      protocol,
      enabled: true,
      routes: [],
      settings: {
        cors: { enabled: true },
        logging: { enabled: true, includeBody: true },
      },
    };

    // Save to configuration store
    await this.configStore.saveServer(serverConfig);

    // Create server instance
    this.createServerInstance(serverConfig);

    this._onDidChangeServers.fire();
    return serverConfig;
  }

  /**
   * Delete a server
   */
  async deleteServer(serverId: string): Promise<void> {
    const server = this.servers.get(serverId);
    if (server) {
      // Stop if running
      if (server.state.status === 'running') {
        await server.stop();
      }
      this.servers.delete(serverId);
    }

    this.disposeContractWatcher(serverId);
    await this.configStore.deleteServer(serverId);
    this.requestLogger.clear(serverId);
    this._onDidChangeServers.fire();
  }

  /**
   * Get all servers
   */
  async getServers(): Promise<MockServerConfig[]> {
    return this.configStore.getServers();
  }

  /**
   * Get a specific server
   */
  async getServer(serverId: string): Promise<MockServerConfig | undefined> {
    return this.configStore.getServer(serverId);
  }

  /**
   * Get server runtime state
   */
  getServerState(serverId: string): ServerRuntimeState | undefined {
    return this.servers.get(serverId)?.state;
  }

  /**
   * Get all server states
   */
  getAllServerStates(): Map<string, ServerRuntimeState> {
    const states = new Map<string, ServerRuntimeState>();
    for (const [id, server] of this.servers) {
      states.set(id, server.state);
    }
    return states;
  }

  /**
   * Start a server
   */
  async startServer(serverId: string): Promise<void> {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Server not found: ${serverId}`);
    }

    await server.start();
    this._onDidChangeServers.fire();
  }

  /**
   * Stop a server
   */
  async stopServer(serverId: string): Promise<void> {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Server not found: ${serverId}`);
    }

    await server.stop();
    this._onDidChangeServers.fire();
  }

  /**
   * Start all enabled servers
   */
  async startAll(): Promise<void> {
    const configs = await this.configStore.getServers();
    const enabledServers = configs.filter((c) => c.enabled);

    await Promise.all(
      enabledServers.map(async (config) => {
        const server = this.servers.get(config.id);
        if (server && server.state.status === 'stopped') {
          try {
            await server.start();
          } catch (error) {
            console.error(`Failed to start server ${config.name}:`, error);
          }
        }
      })
    );

    this._onDidChangeServers.fire();
  }

  /**
   * Stop all servers
   */
  async stopAll(): Promise<void> {
    await Promise.all(
      Array.from(this.servers.values()).map(async (server) => {
        if (server.state.status === 'running') {
          try {
            await server.stop();
          } catch (error) {
            console.error(`Failed to stop server ${server.config.name}:`, error);
          }
        }
      })
    );

    this._onDidChangeServers.fire();
  }

  /**
   * Add a route to a server
   */
  async addRoute(
    serverId: string,
    route: Omit<RouteConfig, 'id'>
  ): Promise<RouteConfig> {
    const config = await this.configStore.getServer(serverId);
    if (!config) {
      throw new Error(`Server not found: ${serverId}`);
    }

    const routeConfig: RouteConfig = {
      ...route,
      id: uuidv4(),
    };

    config.routes.push(routeConfig);
    await this.configStore.saveServer(config);

    // Update running server
    const server = this.servers.get(serverId);
    if (server) {
      await server.updateConfig(config);
    }

    this._onDidChangeServers.fire();
    return routeConfig;
  }

  /**
   * Add many routes in one configuration write: one saveServer, one
   * updateConfig, one change event. Large imports must use this instead of
   * per-route addRoute, which rewrites the whole config file per route.
   */
  async addRoutes(serverId: string, routes: Omit<RouteConfig, 'id'>[]): Promise<RouteConfig[]> {
    const config = await this.configStore.getServer(serverId);
    if (!config) {
      throw new Error(`Server not found: ${serverId}`);
    }

    const routeConfigs: RouteConfig[] = routes.map((route) => ({ ...route, id: uuidv4() }));
    config.routes.push(...routeConfigs);
    await this.configStore.saveServer(config);

    const server = this.servers.get(serverId);
    if (server) {
      await server.updateConfig(config);
    }

    this._onDidChangeServers.fire();
    return routeConfigs;
  }

  /**
   * Update a route
   */
  async updateRoute(serverId: string, routeId: string, updates: Partial<RouteConfig>): Promise<void> {
    const config = await this.configStore.getServer(serverId);
    if (!config) {
      throw new Error(`Server not found: ${serverId}`);
    }

    const routeIndex = config.routes.findIndex((r) => r.id === routeId);
    if (routeIndex === -1) {
      throw new Error(`Route not found: ${routeId}`);
    }

    config.routes[routeIndex] = { ...config.routes[routeIndex], ...updates };
    await this.configStore.saveServer(config);

    // Update running server
    const server = this.servers.get(serverId);
    if (server) {
      await server.updateConfig(config);
    }

    this._onDidChangeServers.fire();
  }

  /**
   * Delete a route
   */
  async deleteRoute(serverId: string, routeId: string): Promise<void> {
    const config = await this.configStore.getServer(serverId);
    if (!config) {
      throw new Error(`Server not found: ${serverId}`);
    }

    config.routes = config.routes.filter((r) => r.id !== routeId);
    await this.configStore.saveServer(config);

    // Update running server
    const server = this.servers.get(serverId);
    if (server) {
      await server.updateConfig(config);
    }

    this._onDidChangeServers.fire();
  }

  /**
   * Toggle a route's enabled state
   */
  async toggleRoute(serverId: string, routeId: string): Promise<void> {
    const config = await this.configStore.getServer(serverId);
    if (!config) {
      throw new Error(`Server not found: ${serverId}`);
    }

    const route = config.routes.find((r) => r.id === routeId);
    if (!route) {
      throw new Error(`Route not found: ${routeId}`);
    }

    route.enabled = !route.enabled;
    await this.configStore.saveServer(config);

    // Update running server
    const server = this.servers.get(serverId);
    if (server) {
      await server.updateConfig(config);
    }

    this._onDidChangeServers.fire();
  }

  /**
   * Set or clear a server's chaos simulation config. Persisted, and pushed to
   * a running server instance via updateConfig so it applies without restart.
   */
  async setServerChaos(serverId: string, chaos: ChaosConfig | undefined): Promise<void> {
    const config = await this.configStore.getServer(serverId);
    if (!config) {
      throw new Error(`Server not found: ${serverId}`);
    }

    if (chaos) {
      config.chaos = chaos;
    } else {
      delete config.chaos;
    }
    await this.configStore.saveServer(config);

    const server = this.servers.get(serverId);
    if (server) {
      await server.updateConfig(config);
    }

    this._onDidChangeServers.fire();
  }

  /**
   * Set or clear a server's contract (OpenAPI request validation) config.
   * Persisted, then the server instance is recreated so a fresh validator is
   * injected (the engine reads its validator at construction time).
   */
  async setServerContract(serverId: string, contract: ContractConfig | undefined): Promise<void> {
    const config = await this.configStore.getServer(serverId);
    if (!config) {
      throw new Error(`Server not found: ${serverId}`);
    }

    if (contract) {
      config.contract = contract;
    } else {
      delete config.contract;
    }
    await this.configStore.saveServer(config);
    await this.recreateServerInstance(serverId);
  }

  /** Resolve a (possibly workspace-relative) spec path to an absolute one. */
  private resolveSpecPath(specPath: string): string {
    return isAbsolute(specPath)
      ? specPath
      : resolvePath(this.workspaceRoot ?? process.cwd(), specPath);
  }

  /**
   * Build (or reuse a cached) contract validator for a config. Returns
   * `undefined` when contract is absent, mode is 'off', or the spec can't be
   * loaded/parsed — in every such case the engine degrades to no validation.
   * Also (re)arms a FileSystemWatcher on the spec so on-disk edits invalidate
   * the cache and recreate the running instance.
   */
  private buildContractValidator(config: MockServerConfig): RequestValidator | undefined {
    const contract = config.contract;
    if (!contract || contract.mode === 'off') {
      this.disposeContractWatcher(config.id);
      return undefined;
    }

    const abs = this.resolveSpecPath(contract.specPath);
    let mtimeMs = 0;
    try {
      mtimeMs = statSync(abs).mtimeMs;
    } catch {
      mtimeMs = 0;
    }

    const cached = this.validatorCache.get(abs);
    let validator: RequestValidator | undefined;
    if (cached && cached.mtimeMs === mtimeMs) {
      validator = cached.validator;
    } else {
      validator = createRequestValidator(contract, { workspaceRoot: this.workspaceRoot });
      this.validatorCache.set(abs, { mtimeMs, validator });
    }

    this.watchContractSpec(config.id, abs);
    return validator;
  }

  /** Watch a server's spec file; on change, drop the cache and recreate it. */
  private watchContractSpec(serverId: string, absSpecPath: string): void {
    this.disposeContractWatcher(serverId);
    let watcher: vscode.FileSystemWatcher;
    try {
      watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(dirname(absSpecPath), basename(absSpecPath))
      );
    } catch {
      return; // watching is best-effort; a bad path just means no live reload
    }
    const onChange = () => {
      this.validatorCache.delete(absSpecPath);
      void this.recreateServerInstance(serverId);
    };
    watcher.onDidChange(onChange);
    watcher.onDidCreate(onChange);
    watcher.onDidDelete(onChange);
    this.contractWatchers.set(serverId, watcher);
  }

  private disposeContractWatcher(serverId: string): void {
    const existing = this.contractWatchers.get(serverId);
    if (existing) {
      existing.dispose();
      this.contractWatchers.delete(serverId);
    }
  }

  /**
   * Tear down and rebuild a server instance from its persisted config
   * (preserving running state). Used when a change can't be applied via
   * updateConfig alone — e.g. a validator must be re-injected at construction.
   */
  private async recreateServerInstance(serverId: string): Promise<void> {
    const existing = this.servers.get(serverId);
    const wasRunning = existing?.state.status === 'running';
    if (existing) {
      try {
        if (existing.state.status === 'running') {
          await existing.stop();
        }
      } catch (error) {
        console.error(`Failed to stop server ${serverId} for rebuild:`, error);
      }
      this.servers.delete(serverId);
    }

    const config = await this.configStore.getServer(serverId);
    if (!config) {
      this.disposeContractWatcher(serverId);
      this._onDidChangeServers.fire();
      return;
    }

    this.createServerInstance(config);
    if (wasRunning) {
      try {
        await this.servers.get(serverId)?.start();
      } catch (error) {
        console.error(`Failed to restart server ${serverId} after rebuild:`, error);
      }
    }
    this._onDidChangeServers.fire();
  }

  /**
   * Reset a server's stateful in-memory data (collections re-seed on next request).
   * Only meaningful while the server is running; safe no-op otherwise.
   */
  resetStatefulData(serverId: string): void {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Server not found: ${serverId}`);
    }
    server.resetState?.();
  }

  /**
   * Get request logger
   */
  getRequestLogger(): IRequestLogger {
    return this.requestLogger;
  }

  /**
   * Get request log entries
   */
  getLogEntries(serverId?: string, limit?: number): RequestLogEntry[] {
    return this.requestLogger.getEntries(serverId, limit);
  }

  /**
   * Clear request logs
   */
  clearLogs(serverId?: string): void {
    this.requestLogger.clear(serverId);
  }

  /**
   * Subscribe to events
   */
  onEvent(handler: EventHandler): vscode.Disposable {
    this.eventHandlers.add(handler);
    return new vscode.Disposable(() => this.eventHandlers.delete(handler));
  }

  /**
   * Create a server instance from config
   */
  private createServerInstance(config: MockServerConfig): void {
    let server: IMockServer;

    switch (config.protocol) {
      case 'graphql':
        server = new GraphQLMockServer(config);
        break;
      case 'websocket':
        server = new WebSocketMockServer(config);
        break;
      case 'http':
      default:
        // Contract validation is HTTP-only. A validator is built (and the spec
        // watched) only when contract mode !== 'off'; otherwise the engine runs
        // byte-identical to before with zero validation overhead.
        server = new HttpMockServer(config, this.buildContractValidator(config));
        break;
    }

    // Subscribe to server events
    server.onEvent((event) => {
      // Forward to manager event handlers
      for (const handler of this.eventHandlers) {
        try {
          handler(event);
        } catch (error) {
          console.error('Error in event handler:', error);
        }
      }

      // Log requests
      if (event.type === 'request:received') {
        this.requestLogger.log(event.entry);

        // Also record if recording is active
        if (this.recordingManager.getActiveSession()) {
          this.recordingManager.recordRequest({
            method: event.entry.request.method,
            path: event.entry.request.path,
            headers: event.entry.request.headers as Record<string, string>,
            query: event.entry.request.query as Record<string, string>,
            body: event.entry.request.body,
            response: event.entry.response,
          });
        }
      }
    });

    this.servers.set(config.id, server);
  }

  // Service Getters
  getRecordingManager(): RecordingManager {
    return this.recordingManager;
  }

  getDatabaseService(): DatabaseService {
    return this.databaseService;
  }

  getOpenApiService(): OpenApiService {
    return this.openApiService;
  }

  getPostmanService(): PostmanService {
    return this.postmanService;
  }

  getExportService(): ExportService {
    return this.exportService;
  }

  /**
   * Import routes from OpenAPI spec
   */
  async importFromOpenApi(filePath: string, serverId?: string): Promise<RouteConfig[]> {
    const result = await this.openApiService.importFromFile(filePath, {
      generateFakeData: true,
      includeExamples: true,
    });

    if (!result.success) {
      throw new Error(result.errors.join(', '));
    }

    if (serverId) {
      for (const route of result.routes) {
        await this.addRoute(serverId, route);
      }
    }

    return result.routes;
  }

  /**
   * Import routes from Postman collection
   */
  async importFromPostman(filePath: string, serverId?: string): Promise<RouteConfig[]> {
    const result = await this.postmanService.importFromFile(filePath, {
      includeExamples: true,
      convertVariables: true,
    });

    if (!result.success) {
      throw new Error(result.errors.join(', '));
    }

    if (serverId) {
      for (const route of result.routes) {
        await this.addRoute(serverId, route);
      }
    }

    return result.routes;
  }

  /**
   * Export server configuration
   */
  async exportServer(serverId: string, filePath: string): Promise<void> {
    const server = await this.getServer(serverId);
    if (!server) {
      throw new Error(`Server not found: ${serverId}`);
    }

    const json = this.exportService.exportServerToJson(server, { pretty: true });
    await this.exportService.exportToFile(filePath, json);
  }

  /**
   * Export logs to HAR format
   */
  async exportLogsToHar(serverId: string, filePath: string): Promise<void> {
    const server = await this.getServer(serverId);
    const logs = this.getLogEntries(serverId);
    const har = this.exportService.exportLogsToHar(logs, server?.port);
    await this.exportService.exportToFile(filePath, har);
  }

  /**
   * Dispose all resources
   */
  async dispose(): Promise<void> {
    await this.stopAll();
    await this.databaseService.disconnectAll();
    for (const watcher of this.contractWatchers.values()) {
      watcher.dispose();
    }
    this.contractWatchers.clear();
    this._onDidChangeServers.dispose();
  }
}
