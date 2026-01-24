import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  MockServerConfig,
  ServerRuntimeState,
  IMockServer,
  RequestLogEntry,
  EventHandler,
  ServerEvent,
} from '../types/core.js';
import { RequestMatcher, RequestInfo } from '../matching/RequestMatcher.js';
import { ResponseGenerator, ResponseContext } from '../response/ResponseGenerator.js';

export class HttpMockServer implements IMockServer {
  private server: FastifyInstance | null = null;
  private _config: MockServerConfig;
  private _state: ServerRuntimeState;
  private requestMatcher: RequestMatcher;
  private responseGenerator: ResponseGenerator;
  private eventHandlers: Set<EventHandler> = new Set();

  constructor(config: MockServerConfig) {
    this._config = config;
    this._state = {
      id: config.id,
      status: 'stopped',
      port: config.port,
      requestCount: 0,
    };
    this.requestMatcher = new RequestMatcher();
    this.responseGenerator = new ResponseGenerator();
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

  /**
   * Subscribe to server events
   */
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

  /**
   * Start the mock server
   */
  async start(): Promise<void> {
    if (this.server) {
      throw new Error('Server is already running');
    }

    this._state.status = 'starting';

    try {
      this.server = Fastify({
        logger: false,
      });

      // Configure CORS if enabled
      if (this._config.settings?.cors?.enabled) {
        await this.configureCors();
      }

      // Register catch-all route
      this.server.all('*', this.handleRequest.bind(this));

      // Start listening
      await this.server.listen({
        port: this._config.port,
        host: '0.0.0.0',
      });

      this._state.status = 'running';
      this._state.startedAt = new Date();
      this._state.error = undefined;

      this.emit({ type: 'server:started', serverId: this.id, port: this._config.port });
    } catch (error) {
      this._state.status = 'error';
      this._state.error = error instanceof Error ? error.message : 'Unknown error';
      this.server = null;

      this.emit({ type: 'server:error', serverId: this.id, error: this._state.error });
      throw error;
    }
  }

  /**
   * Stop the mock server
   */
  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    this._state.status = 'stopping';

    try {
      await this.server.close();
      this.server = null;
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

  /**
   * Update server configuration
   */
  async updateConfig(config: MockServerConfig): Promise<void> {
    const wasRunning = this._state.status === 'running';
    const portChanged = config.port !== this._config.port;

    this._config = config;
    this._state.port = config.port;

    // Restart if port changed and server was running
    if (wasRunning && portChanged) {
      await this.stop();
      await this.start();
    }

    this.emit({ type: 'config:changed', serverId: this.id });
  }

  /**
   * Configure CORS headers
   */
  private async configureCors(): Promise<void> {
    if (!this.server) return;

    const corsConfig = this._config.settings?.cors;
    if (!corsConfig?.enabled) return;

    this.server.addHook('onRequest', async (request, reply) => {
      const origin = request.headers.origin;

      // Check allowed origins
      if (corsConfig.origins && corsConfig.origins.length > 0) {
        if (origin && corsConfig.origins.includes(origin)) {
          reply.header('Access-Control-Allow-Origin', origin);
        }
      } else {
        reply.header('Access-Control-Allow-Origin', '*');
      }

      // Set other CORS headers
      const methods = corsConfig.methods?.join(', ') || 'GET, POST, PUT, DELETE, PATCH, OPTIONS';
      reply.header('Access-Control-Allow-Methods', methods);

      const headers = corsConfig.headers?.join(', ') || 'Content-Type, Authorization';
      reply.header('Access-Control-Allow-Headers', headers);

      // Handle preflight
      if (request.method === 'OPTIONS') {
        reply.status(204).send();
      }
    });
  }

  /**
   * Handle incoming requests
   */
  private async handleRequest(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const startTime = Date.now();
    this._state.requestCount++;

    // Build request info
    const requestInfo: RequestInfo = {
      method: request.method,
      path: request.url.split('?')[0],
      headers: request.headers as Record<string, string | string[] | undefined>,
      query: request.query as Record<string, string | string[] | undefined>,
      body: request.body,
    };

    // Match request against routes
    const matchResult = this.requestMatcher.match(requestInfo, this._config.routes);

    let logEntry: Omit<RequestLogEntry, 'id'>;

    if (matchResult.matched && matchResult.route) {
      // Generate response
      const context: ResponseContext = {
        params: matchResult.params,
        query: requestInfo.query,
        headers: requestInfo.headers,
        body: requestInfo.body,
        path: requestInfo.path,
        method: requestInfo.method,
      };

      try {
        const response = await this.responseGenerator.generate(matchResult.route, context);

        // Apply default headers
        const allHeaders = {
          ...this._config.settings?.defaultHeaders,
          ...response.headers,
        };

        // Send response
        reply.status(response.statusCode);
        for (const [key, value] of Object.entries(allHeaders)) {
          reply.header(key, value);
        }

        if (response.body !== null && response.body !== undefined) {
          reply.send(response.body);
        } else {
          reply.send();
        }

        // Log entry
        logEntry = {
          serverId: this.id,
          routeId: matchResult.route.id,
          timestamp: new Date(),
          request: {
            method: requestInfo.method,
            path: requestInfo.path,
            url: request.url,
            headers: requestInfo.headers,
            query: requestInfo.query,
            body: this.shouldLogBody() ? requestInfo.body : undefined,
          },
          response: {
            statusCode: response.statusCode,
            headers: allHeaders,
            body: this.shouldLogBody() ? response.body : undefined,
            duration: Date.now() - startTime,
          },
          matched: true,
        };
      } catch (error) {
        // Error generating response
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        reply.status(500).send({
          error: 'Response Generation Error',
          message: errorMessage,
        });

        logEntry = {
          serverId: this.id,
          routeId: matchResult.route.id,
          timestamp: new Date(),
          request: {
            method: requestInfo.method,
            path: requestInfo.path,
            url: request.url,
            headers: requestInfo.headers,
            query: requestInfo.query,
            body: this.shouldLogBody() ? requestInfo.body : undefined,
          },
          response: {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: { error: 'Response Generation Error', message: errorMessage },
            duration: Date.now() - startTime,
          },
          matched: true,
        };
      }
    } else {
      // No matching route found
      const notFoundResponse = this.responseGenerator.generateNotFound(
        requestInfo.path,
        requestInfo.method
      );

      reply.status(notFoundResponse.statusCode);
      for (const [key, value] of Object.entries(notFoundResponse.headers)) {
        reply.header(key, value);
      }
      reply.send(notFoundResponse.body);

      logEntry = {
        serverId: this.id,
        timestamp: new Date(),
        request: {
          method: requestInfo.method,
          path: requestInfo.path,
          url: request.url,
          headers: requestInfo.headers,
          query: requestInfo.query,
          body: this.shouldLogBody() ? requestInfo.body : undefined,
        },
        response: {
          statusCode: notFoundResponse.statusCode,
          headers: notFoundResponse.headers,
          body: notFoundResponse.body,
          duration: Date.now() - startTime,
        },
        matched: false,
      };
    }

    // Emit request event
    this.emit({ type: 'request:received', serverId: this.id, entry: logEntry as RequestLogEntry });
  }

  /**
   * Check if body should be logged
   */
  private shouldLogBody(): boolean {
    return this._config.settings?.logging?.includeBody !== false;
  }
}
