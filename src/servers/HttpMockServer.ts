import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  ChaosConfig,
  MockServerConfig,
  RouteConfig,
  ServerRuntimeState,
  IMockServer,
  RequestLogEntry,
  EventHandler,
  ServerEvent,
  RequestValidator,
  ContractViolation,
} from '../types/core.js';
import { RequestMatcher, RequestInfo } from '../matching/RequestMatcher.js';
import { ResponseGenerator, ResponseContext, GeneratedResponse } from '../response/ResponseGenerator.js';
import { StatefulStore, executeStateful } from '../core/StatefulStore.js';
import { responseStateManager } from '../state/ResponseStateManager.js';

export const CHAOS_DEFAULT_FAILURE_STATUS = 503;

// Upper bound on injected chaos latency. The delay is awaited inside the request
// handler before any reply is sent, so an unbounded value from an untrusted
// config would hold sockets/timers open indefinitely (setTimeout accepts up to
// ~2^31 ms ≈ 24 days). 60s is far beyond any realistic latency simulation.
export const CHAOS_MAX_DELAY_MS = 60_000;

export interface ChaosDecision {
  delayMs: number;
  failure: { statusCode: number; body: { error: string; chaos: true } } | null;
}

/**
 * Decide the chaos outcome for one request. Pure and seedable: `random` is
 * drawn at most twice — first for the delay (only when a delay bound is set),
 * then for the failure roll (only when failureRate > 0). Disabled or absent
 * config always yields { delayMs: 0, failure: null } without consuming random.
 */
export function decideChaos(
  chaos: ChaosConfig | undefined,
  random: () => number = Math.random
): ChaosDecision {
  if (!chaos?.enabled) {
    return { delayMs: 0, failure: null };
  }

  let delayMs = 0;
  if (chaos.minDelayMs !== undefined || chaos.maxDelayMs !== undefined) {
    const lo = Math.min(CHAOS_MAX_DELAY_MS, Math.max(0, chaos.minDelayMs ?? 0));
    const hi = Math.min(CHAOS_MAX_DELAY_MS, Math.max(lo, chaos.maxDelayMs ?? lo)); // inverted bounds clamp to lo
    delayMs = Math.round(lo + random() * (hi - lo));
  }

  const rate = Math.min(1, Math.max(0, chaos.failureRate ?? 0));
  // random() ∈ [0, 1), so rate 1 always fails and rate 0 never rolls
  const failed = rate > 0 && random() < rate;

  return {
    delayMs,
    failure: failed
      ? {
          statusCode: chaos.failureStatus ?? CHAOS_DEFAULT_FAILURE_STATUS,
          body: { error: 'Simulated failure (Mocklify chaos)', chaos: true },
        }
      : null,
  };
}

export class HttpMockServer implements IMockServer {
  private server: FastifyInstance | null = null;
  private _config: MockServerConfig;
  private _state: ServerRuntimeState;
  private requestMatcher: RequestMatcher;
  private responseGenerator: ResponseGenerator;
  private statefulStore: StatefulStore = new StatefulStore();
  private eventHandlers: Set<EventHandler> = new Set();
  // Contract validator is injected (undefined ⇒ validation skipped entirely).
  // Kept as a constructor arg so every existing `new HttpMockServer(config)`
  // call remains byte-identical in behavior.
  private validator?: RequestValidator;

  constructor(config: MockServerConfig, validator?: RequestValidator) {
    this._config = config;
    this.validator = validator;
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

    // Stateful collections live for one server run
    this.statefulStore.clear();

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
   * Clear stateful collections (re-seeds lazily on next access)
   */
  resetState(): void {
    this.statefulStore.clear();
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

    // Match FIRST so a matched route's own chaos override can win. This reorders
    // matching ahead of chaos vs. the original server-wide flow, but the
    // observable result is identical when no route defines `chaos`:
    //   effective chaos = matchedRoute?.chaos ?? server.chaos
    // A route override fully REPLACES server chaos for that route, so a route
    // carrying `{ enabled: false }` is EXEMPT from chaos even while server chaos
    // is on (decideChaos no-ops on !enabled). Unmatched (404) requests use
    // server.chaos. Matching is pure and side-effect free, so running it before
    // the chaos short-circuit is safe. decideChaos stays pure/seedable/unchanged.
    const matchResult = this.requestMatcher.match(requestInfo, this._config.routes);
    const effectiveChaos = matchResult.route?.chaos ?? this._config.chaos;

    // Chaos simulation: optional extra latency, then a possible short-circuit
    // failure before any response generation. No-op unless chaos.enabled.
    const chaos = decideChaos(effectiveChaos);
    if (chaos.delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, chaos.delayMs));
    }
    if (chaos.failure) {
      const chaosHeaders = { 'Content-Type': 'application/json' };
      reply.status(chaos.failure.statusCode);
      reply.header('Content-Type', 'application/json');
      reply.send(chaos.failure.body);

      const chaosEntry: Omit<RequestLogEntry, 'id'> = {
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
          statusCode: chaos.failure.statusCode,
          headers: chaosHeaders,
          body: chaos.failure.body,
          duration: Date.now() - startTime,
        },
        matched: false,
      };
      this.emit({ type: 'request:received', serverId: this.id, entry: chaosEntry as RequestLogEntry });
      return;
    }

    let logEntry: Omit<RequestLogEntry, 'id'>;

    if (matchResult.matched && matchResult.route) {
      // Contract validation runs on the matched route BEFORE response generation.
      // `this.validator` is injected only when contract mode !== 'off', so its
      // mere presence gates all overhead. `enforce` short-circuits with a 400;
      // `warn` serves normally and only records violations on the log entry.
      let validation: RequestLogEntry['validation'];
      if (this.validator) {
        const result = this.validator.validate(
          {
            method: requestInfo.method,
            path: requestInfo.path,
            params: matchResult.params,
            query: requestInfo.query,
            headers: requestInfo.headers,
            body: requestInfo.body,
          },
          matchResult.route
        );
        const mode: 'warn' | 'enforce' =
          this._config.contract?.mode === 'enforce' ? 'enforce' : 'warn';
        const violations: ContractViolation[] = result.ok ? [] : result.violations;
        validation = { mode, ok: result.ok, violations };

        if (!result.ok && mode === 'enforce') {
          const enforceBody = { error: 'Contract violation', mode, violations };
          reply.status(400);
          reply.header('Content-Type', 'application/json');
          reply.send(enforceBody);

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
              statusCode: 400,
              headers: { 'Content-Type': 'application/json' },
              body: enforceBody,
              duration: Date.now() - startTime,
            },
            matched: true,
            validation,
          };
          this.emit({ type: 'request:received', serverId: this.id, entry: logEntry as RequestLogEntry });
          return;
        }
      }

      // Generate response
      const context: ResponseContext = {
        params: matchResult.params,
        query: requestInfo.query,
        headers: requestInfo.headers,
        body: requestInfo.body,
        path: requestInfo.path,
        method: requestInfo.method,
        serverId: this.id,
      };

      try {
        const response =
          (await this.generateStatefulResponse(matchResult.route, context)) ??
          (await this.responseGenerator.generate(matchResult.route, context));

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
          validation,
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
          validation,
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
   * Handle a stateful CRUD route via the in-memory store.
   * Returns null when the route has no stateful config, an active response
   * sequence should win, or no operation can be derived — the caller then
   * falls back to normal response generation (pre-existing behavior).
   */
  private async generateStatefulResponse(
    route: RouteConfig,
    context: ResponseContext
  ): Promise<GeneratedResponse | null> {
    if (!route.stateful) {
      return null;
    }

    // Response sequences (scenario overrides) take precedence over stateful data
    if (responseStateManager.hasSequence(this.id, route.id)) {
      return null;
    }

    // Models sometimes emit an idParam that matches no :param in the path
    // (e.g. the default "id" on /users/:userId). When the path ends in a
    // parameter the config doesn't reference, key the request by that
    // parameter so detail routes don't silently degrade to list responses.
    let stateful = route.stateful;
    const idKey = stateful.idParam ?? 'id';
    const lastSegment = route.path.split('/').filter(Boolean).pop();
    if (
      lastSegment?.startsWith(':') &&
      lastSegment.slice(1) !== idKey &&
      context.params[idKey] === undefined
    ) {
      stateful = { ...stateful, idParam: lastSegment.slice(1) };
    }

    const result = executeStateful(
      this.statefulStore,
      stateful,
      {
        method: context.method,
        params: context.params,
        query: context.query,
        body: context.body,
      },
      this.resolveStatefulFallbackSeed(route)
    );

    if (!result) {
      return null;
    }

    responseStateManager.recordCall(this.id, route.id);

    if (route.delay) {
      await this.responseGenerator.applyDelay(route.delay);
    }

    const headers: Record<string, string> = { ...route.response.headers };
    if (result.body !== null) {
      headers['Content-Type'] = 'application/json';
    }

    return {
      statusCode: result.statusCode,
      headers,
      body: result.body,
    };
  }

  /**
   * Seed used when a stateful collection is first touched and the matched
   * route declares no seed of its own. The generation convention keeps the
   * seed ONLY on the GET-list route, so whichever family route happens to be
   * hit first must seed from the family's configured seed (or, failing that,
   * the list route's static example) — never from its own example body, which
   * would inject a phantom item and permanently shadow the real seed.
   */
  private resolveStatefulFallbackSeed(route: RouteConfig): unknown {
    const collection = route.stateful?.collection;
    const family = this._config.routes.filter((r) => r.stateful?.collection === collection);
    const explicit = family.find((r) => r.stateful?.seed !== undefined);
    if (explicit) {
      return explicit.stateful?.seed;
    }
    const listRoute = family.find((r) => {
      const last = r.path.split('/').filter(Boolean).pop();
      const methods = Array.isArray(r.method) ? r.method : [r.method];
      return !last?.startsWith(':') && methods.includes('GET') && r.response.body?.content !== undefined;
    });
    return listRoute?.response.body?.content;
  }

  /**
   * Check if body should be logged
   */
  private shouldLogBody(): boolean {
    return this._config.settings?.logging?.includeBody !== false;
  }
}
