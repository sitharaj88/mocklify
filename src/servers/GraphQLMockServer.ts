import Fastify, { FastifyInstance } from 'fastify';
import {
  MockServerConfig,
  ServerRuntimeState,
  IMockServer,
  RequestLogEntry,
  EventHandler,
  ServerEvent,
} from '../types/core.js';

interface GraphQLRoute {
  id: string;
  name: string;
  enabled: boolean;
  operationType: 'query' | 'mutation' | 'subscription';
  operationName: string;
  response: {
    data?: unknown;
    errors?: Array<{ message: string; path?: string[] }>;
  };
  delay?: number;
}

interface GraphQLRequest {
  query: string;
  operationName?: string;
  variables?: Record<string, unknown>;
}

export class GraphQLMockServer implements IMockServer {
  private server: FastifyInstance | null = null;
  private _config: MockServerConfig;
  private _state: ServerRuntimeState;
  private eventHandlers: Set<EventHandler> = new Set();
  private graphqlRoutes: Map<string, GraphQLRoute> = new Map();

  constructor(config: MockServerConfig) {
    this._config = config;
    this._state = {
      id: config.id,
      status: 'stopped',
      port: config.port,
      requestCount: 0,
    };

    // Parse GraphQL routes from config
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
    if (this.server) {
      throw new Error('Server is already running');
    }

    this._state.status = 'starting';

    try {
      this.server = Fastify({ logger: false });

      // Configure CORS
      if (this._config.settings?.cors?.enabled) {
        this.server.addHook('onRequest', async (request, reply) => {
          reply.header('Access-Control-Allow-Origin', '*');
          reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

          if (request.method === 'OPTIONS') {
            reply.status(204).send();
          }
        });
      }

      // GraphQL endpoint
      this.server.post('/graphql', async (request, reply) => {
        return this.handleGraphQLRequest(request.body as GraphQLRequest, reply);
      });

      // GraphQL GET for introspection
      this.server.get('/graphql', async (request, reply) => {
        const query = (request.query as Record<string, string>).query;
        if (query) {
          return this.handleGraphQLRequest({ query }, reply);
        }
        return reply.status(400).send({ error: 'Missing query parameter' });
      });

      await this.server.listen({ port: this._config.port, host: '0.0.0.0' });

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

  async stop(): Promise<void> {
    if (!this.server) return;

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

  private async handleGraphQLRequest(
    body: GraphQLRequest,
    reply: unknown
  ): Promise<unknown> {
    const startTime = Date.now();
    this._state.requestCount++;

    const { query, operationName, variables } = body;

    // Parse operation from query
    const operation = this.parseOperation(query, operationName);

    if (!operation) {
      return {
        errors: [{ message: 'Could not parse GraphQL operation' }],
      };
    }

    // Find matching route
    const route = this.findMatchingRoute(operation.type, operation.name);

    if (!route) {
      return {
        errors: [{ message: `No mock found for ${operation.type} "${operation.name}"` }],
      };
    }

    // Apply delay
    if (route.delay && route.delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, route.delay));
    }

    // Generate response with variable substitution
    const response = this.applyVariables(route.response, variables || {});

    // Log request
    const logEntry: RequestLogEntry = {
      id: Math.random().toString(36).substring(2),
      serverId: this.id,
      routeId: route.id,
      timestamp: new Date(),
      request: {
        method: 'POST',
        path: '/graphql',
        url: '/graphql',
        headers: {},
        query: {},
        body: { query, operationName, variables },
      },
      response: {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: response,
        duration: Date.now() - startTime,
      },
      matched: true,
    };

    this.emit({ type: 'request:received', serverId: this.id, entry: logEntry });

    return response;
  }

  private parseOperation(
    query: string,
    operationName?: string
  ): { type: 'query' | 'mutation' | 'subscription'; name: string } | null {
    // Simple GraphQL parser
    const queryMatch = query.match(/\b(query|mutation|subscription)\s+(\w+)/i);

    if (queryMatch) {
      return {
        type: queryMatch[1].toLowerCase() as 'query' | 'mutation' | 'subscription',
        name: queryMatch[2],
      };
    }

    // Anonymous query
    if (query.trim().startsWith('{')) {
      return { type: 'query', name: operationName || 'anonymous' };
    }

    // Try to extract field name as operation name
    const fieldMatch = query.match(/\{\s*(\w+)/);
    if (fieldMatch) {
      return { type: 'query', name: fieldMatch[1] };
    }

    return null;
  }

  private findMatchingRoute(
    operationType: 'query' | 'mutation' | 'subscription',
    operationName: string
  ): GraphQLRoute | null {
    for (const route of this.graphqlRoutes.values()) {
      if (!route.enabled) continue;

      if (route.operationType === operationType && route.operationName === operationName) {
        return route;
      }
    }

    // Try wildcard match
    for (const route of this.graphqlRoutes.values()) {
      if (!route.enabled) continue;

      if (route.operationType === operationType && route.operationName === '*') {
        return route;
      }
    }

    return null;
  }

  private applyVariables(
    response: GraphQLRoute['response'],
    variables: Record<string, unknown>
  ): unknown {
    const json = JSON.stringify(response);
    const substituted = json.replace(/\$(\w+)/g, (match, varName) => {
      const value = variables[varName];
      if (value !== undefined) {
        return typeof value === 'string' ? value : JSON.stringify(value);
      }
      return match;
    });

    try {
      return JSON.parse(substituted);
    } catch {
      return response;
    }
  }

  private parseRoutes(): void {
    this.graphqlRoutes.clear();

    for (const route of this._config.routes) {
      // Parse GraphQL-specific route configuration
      // Convention: path = "query:operationName" or "mutation:operationName"
      const match = route.path.match(/^(query|mutation|subscription):(\w+|\*)$/i);

      if (match) {
        const graphqlRoute: GraphQLRoute = {
          id: route.id,
          name: route.name,
          enabled: route.enabled,
          operationType: match[1].toLowerCase() as 'query' | 'mutation' | 'subscription',
          operationName: match[2],
          response: {
            data: route.response.body?.content,
          },
          delay: route.delay?.type === 'fixed' ? route.delay.value : undefined,
        };

        this.graphqlRoutes.set(route.id, graphqlRoute);
      }
    }
  }
}
