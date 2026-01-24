import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import {
  MockServerConfig,
  RouteConfig,
  ServerRuntimeState,
  EventHandler,
  ServerEvent,
  RequestLogEntry,
  IRequestLogger,
} from '../types/core.js';
import { ConfigurationStore } from '../storage/ConfigurationStore.js';
import { HttpMockServer } from '../servers/HttpMockServer.js';
import { RequestLogger } from '../logging/RequestLogger.js';

export class MockServerManager {
  private configStore: ConfigurationStore;
  private servers: Map<string, HttpMockServer> = new Map();
  private requestLogger: RequestLogger;
  private eventHandlers: Set<EventHandler> = new Set();
  private _onDidChangeServers = new vscode.EventEmitter<void>();
  readonly onDidChangeServers = this._onDidChangeServers.event;

  constructor(workspaceRoot: string | undefined) {
    this.configStore = new ConfigurationStore(workspaceRoot);

    const config = vscode.workspace.getConfiguration('specter');
    const maxLogEntries = config.get<number>('logging.maxEntries', 1000);
    this.requestLogger = new RequestLogger(maxLogEntries);
  }

  /**
   * Initialize the manager and load configurations
   */
  async initialize(): Promise<void> {
    await this.configStore.initialize();

    // Load all server configurations
    const configs = await this.configStore.getServers();
    for (const config of configs) {
      this.createServerInstance(config);
    }

    // Auto-start servers if enabled
    const autoStart = vscode.workspace.getConfiguration('specter').get<boolean>('autoStart', false);
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
    const config = vscode.workspace.getConfiguration('specter');
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
    const server = new HttpMockServer(config);

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
      }
    });

    this.servers.set(config.id, server);
  }

  /**
   * Dispose all resources
   */
  async dispose(): Promise<void> {
    await this.stopAll();
    this._onDidChangeServers.dispose();
  }
}
