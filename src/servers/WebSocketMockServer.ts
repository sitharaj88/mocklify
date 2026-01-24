import { WebSocketServer, WebSocket } from 'ws';
import { createServer, Server as HttpServer } from 'http';
import {
  MockServerConfig,
  ServerRuntimeState,
  IMockServer,
  RequestLogEntry,
  EventHandler,
  ServerEvent,
} from '../types/core.js';

interface WebSocketRoute {
  id: string;
  name: string;
  enabled: boolean;
  event: string; // Event name to match
  response: {
    event?: string;
    data?: unknown;
    broadcast?: boolean;
  };
  delay?: number;
}

interface WebSocketMessage {
  event: string;
  data?: unknown;
  room?: string;
}

export class WebSocketMockServer implements IMockServer {
  private httpServer: HttpServer | null = null;
  private wss: WebSocketServer | null = null;
  private _config: MockServerConfig;
  private _state: ServerRuntimeState;
  private eventHandlers: Set<EventHandler> = new Set();
  private wsRoutes: Map<string, WebSocketRoute> = new Map();
  private clients: Set<WebSocket> = new Set();
  private rooms: Map<string, Set<WebSocket>> = new Map();

  constructor(config: MockServerConfig) {
    this._config = config;
    this._state = {
      id: config.id,
      status: 'stopped',
      port: config.port,
      requestCount: 0,
    };

    this.parseRoutes();
  }

  get id(): string {
    return this._config.id;
  }

  get config(): MockServerConfig {
    return this._config;
  }

  get state(): ServerRuntimeState {
    return this._state;
  }

  onEvent(handler: EventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  private emit(event: ServerEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('Error in event handler:', error);
      }
    }
  }

  async start(): Promise<void> {
    if (this.wss) {
      throw new Error('Server is already running');
    }

    this._state.status = 'starting';

    try {
      this.httpServer = createServer();
      this.wss = new WebSocketServer({ server: this.httpServer });

      this.wss.on('connection', (ws) => this.handleConnection(ws));

      await new Promise<void>((resolve, reject) => {
        this.httpServer!.listen(this._config.port, '0.0.0.0', () => resolve());
        this.httpServer!.on('error', reject);
      });

      this._state.status = 'running';
      this._state.startedAt = new Date();
      this._state.error = undefined;

      this.emit({ type: 'server:started', serverId: this.id, port: this._config.port });
    } catch (error) {
      this._state.status = 'error';
      this._state.error = error instanceof Error ? error.message : 'Unknown error';
      this.wss = null;
      this.httpServer = null;

      this.emit({ type: 'server:error', serverId: this.id, error: this._state.error });
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.wss) return;

    this._state.status = 'stopping';

    try {
      // Close all client connections
      for (const client of this.clients) {
        client.close();
      }
      this.clients.clear();
      this.rooms.clear();

      // Close WebSocket server
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve());
      });

      // Close HTTP server
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });

      this.wss = null;
      this.httpServer = null;
      this._state.status = 'stopped';
      this._state.startedAt = undefined;

      this.emit({ type: 'server:stopped', serverId: this.id });
    } catch (error) {
      this._state.status = 'error';
      this._state.error = error instanceof Error ? error.message : 'Unknown error';

      this.emit({ type: 'server:error', serverId: this.id, error: this._state.error });
      throw error;
    }
  }

  async updateConfig(config: MockServerConfig): Promise<void> {
    const wasRunning = this._state.status === 'running';
    const portChanged = config.port !== this._config.port;

    this._config = config;
    this._state.port = config.port;
    this.parseRoutes();

    if (wasRunning && portChanged) {
      await this.stop();
      await this.start();
    }

    this.emit({ type: 'config:changed', serverId: this.id });
  }

  private handleConnection(ws: WebSocket): void {
    this.clients.add(ws);
    this._state.requestCount++;

    // Log connection
    const connectLog: RequestLogEntry = {
      id: Math.random().toString(36).substring(2),
      serverId: this.id,
      timestamp: new Date(),
      request: {
        method: 'WEBSOCKET',
        path: '/ws',
        url: '/ws',
        headers: {},
        query: {},
        body: { event: 'connection' },
      },
      response: {
        statusCode: 101,
        headers: {},
        body: { event: 'connected' },
        duration: 0,
      },
      matched: true,
    };

    this.emit({ type: 'request:received', serverId: this.id, entry: connectLog });

    // Send welcome message if configured
    const welcomeRoute = this.findRoute('connection');
    if (welcomeRoute) {
      this.sendToClient(ws, welcomeRoute.response.event || 'welcome', welcomeRoute.response.data);
    }

    ws.on('message', (data) => this.handleMessage(ws, data.toString()));

    ws.on('close', () => {
      this.clients.delete(ws);
      // Remove from all rooms
      for (const room of this.rooms.values()) {
        room.delete(ws);
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  }

  private async handleMessage(ws: WebSocket, rawMessage: string): Promise<void> {
    const startTime = Date.now();
    this._state.requestCount++;

    let message: WebSocketMessage;
    try {
      message = JSON.parse(rawMessage);
    } catch {
      message = { event: 'message', data: rawMessage };
    }

    const { event, data, room } = message;

    // Handle built-in events
    if (event === 'join' && room) {
      this.joinRoom(ws, room);
      return;
    }

    if (event === 'leave' && room) {
      this.leaveRoom(ws, room);
      return;
    }

    // Find matching route
    const route = this.findRoute(event);

    if (!route) {
      this.sendToClient(ws, 'error', { message: `No handler for event: ${event}` });
      return;
    }

    // Apply delay
    if (route.delay && route.delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, route.delay));
    }

    // Generate response
    const responseData = this.applyVariables(route.response.data, data);

    // Send response
    if (route.response.broadcast) {
      this.broadcast(route.response.event || event, responseData);
    } else {
      this.sendToClient(ws, route.response.event || event, responseData);
    }

    // Log message
    const logEntry: RequestLogEntry = {
      id: Math.random().toString(36).substring(2),
      serverId: this.id,
      routeId: route.id,
      timestamp: new Date(),
      request: {
        method: 'WEBSOCKET',
        path: `/ws/${event}`,
        url: `/ws/${event}`,
        headers: {},
        query: {},
        body: message,
      },
      response: {
        statusCode: 200,
        headers: {},
        body: { event: route.response.event || event, data: responseData },
        duration: Date.now() - startTime,
      },
      matched: true,
    };

    this.emit({ type: 'request:received', serverId: this.id, entry: logEntry });
  }

  private sendToClient(ws: WebSocket, event: string, data?: unknown): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event, data }));
    }
  }

  private broadcast(event: string, data?: unknown, room?: string): void {
    const message = JSON.stringify({ event, data });
    const targets = room ? this.rooms.get(room) : this.clients;

    if (targets) {
      for (const client of targets) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      }
    }
  }

  private joinRoom(ws: WebSocket, room: string): void {
    if (!this.rooms.has(room)) {
      this.rooms.set(room, new Set());
    }
    this.rooms.get(room)!.add(ws);
    this.sendToClient(ws, 'joined', { room });
  }

  private leaveRoom(ws: WebSocket, room: string): void {
    const roomClients = this.rooms.get(room);
    if (roomClients) {
      roomClients.delete(ws);
      if (roomClients.size === 0) {
        this.rooms.delete(room);
      }
    }
    this.sendToClient(ws, 'left', { room });
  }

  private findRoute(event: string): WebSocketRoute | null {
    for (const route of this.wsRoutes.values()) {
      if (!route.enabled) continue;
      if (route.event === event || route.event === '*') {
        return route;
      }
    }
    return null;
  }

  private applyVariables(template: unknown, data: unknown): unknown {
    if (!template || !data) return template;

    const json = JSON.stringify(template);
    const dataObj = typeof data === 'object' ? (data as Record<string, unknown>) : { value: data };

    const substituted = json.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
      const value = dataObj[varName];
      if (value !== undefined) {
        return typeof value === 'string' ? value : JSON.stringify(value);
      }
      return match;
    });

    try {
      return JSON.parse(substituted);
    } catch {
      return template;
    }
  }

  private parseRoutes(): void {
    this.wsRoutes.clear();

    for (const route of this._config.routes) {
      // Convention: path = "ws:eventName"
      const match = route.path.match(/^ws:(\w+|\*)$/i);

      if (match) {
        const wsRoute: WebSocketRoute = {
          id: route.id,
          name: route.name,
          enabled: route.enabled,
          event: match[1],
          response: {
            event: route.response.headers?.['X-WS-Event'],
            data: route.response.body?.content,
            broadcast: route.response.headers?.['X-WS-Broadcast'] === 'true',
          },
          delay: route.delay?.type === 'fixed' ? route.delay.value : undefined,
        };

        this.wsRoutes.set(route.id, wsRoute);
      }
    }
  }

  /**
   * Get connected client count
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Get room information
   */
  getRooms(): Map<string, number> {
    const roomInfo = new Map<string, number>();
    for (const [name, clients] of this.rooms.entries()) {
      roomInfo.set(name, clients.size);
    }
    return roomInfo;
  }
}
