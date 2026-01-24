import { v4 as uuidv4 } from 'uuid';
import { RouteConfig, HttpMethod, ResponseConfig } from '../types/core.js';

export interface RecordedRequest {
  id: string;
  timestamp: Date;
  method: string;
  path: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body?: unknown;
  response: {
    statusCode: number;
    headers: Record<string, string>;
    body?: unknown;
    duration: number;
  };
}

export interface RecordingSessionConfig {
  id: string;
  name: string;
  targetUrl: string;
  filterPaths?: string[];
  excludePaths?: string[];
  filterMethods?: HttpMethod[];
  captureHeaders?: boolean;
  captureBody?: boolean;
  createdAt: Date;
}

export interface RecordingSessionState {
  status: 'idle' | 'recording' | 'paused' | 'stopped';
  requestCount: number;
  startedAt?: Date;
  stoppedAt?: Date;
}

export class RecordingSession {
  private _config: RecordingSessionConfig;
  private _state: RecordingSessionState;
  private _requests: RecordedRequest[] = [];

  constructor(name: string, targetUrl: string, options?: Partial<RecordingSessionConfig>) {
    this._config = {
      id: uuidv4(),
      name,
      targetUrl,
      filterPaths: options?.filterPaths,
      excludePaths: options?.excludePaths,
      filterMethods: options?.filterMethods,
      captureHeaders: options?.captureHeaders ?? true,
      captureBody: options?.captureBody ?? true,
      createdAt: new Date(),
    };

    this._state = {
      status: 'idle',
      requestCount: 0,
    };
  }

  get id(): string {
    return this._config.id;
  }

  get config(): RecordingSessionConfig {
    return this._config;
  }

  get state(): RecordingSessionState {
    return this._state;
  }

  get requests(): RecordedRequest[] {
    return [...this._requests];
  }

  start(): void {
    if (this._state.status === 'recording') {
      throw new Error('Recording is already in progress');
    }
    this._state.status = 'recording';
    this._state.startedAt = new Date();
    this._state.stoppedAt = undefined;
  }

  pause(): void {
    if (this._state.status !== 'recording') {
      throw new Error('Recording is not in progress');
    }
    this._state.status = 'paused';
  }

  resume(): void {
    if (this._state.status !== 'paused') {
      throw new Error('Recording is not paused');
    }
    this._state.status = 'recording';
  }

  stop(): void {
    if (this._state.status === 'stopped' || this._state.status === 'idle') {
      return;
    }
    this._state.status = 'stopped';
    this._state.stoppedAt = new Date();
  }

  record(request: Omit<RecordedRequest, 'id' | 'timestamp'>): RecordedRequest | null {
    if (this._state.status !== 'recording') {
      return null;
    }

    if (!this.shouldRecord(request)) {
      return null;
    }

    const recorded: RecordedRequest = {
      id: uuidv4(),
      timestamp: new Date(),
      method: request.method,
      path: request.path,
      headers: this._config.captureHeaders ? request.headers : {},
      query: request.query,
      body: this._config.captureBody ? request.body : undefined,
      response: {
        statusCode: request.response.statusCode,
        headers: this._config.captureHeaders ? request.response.headers : {},
        body: this._config.captureBody ? request.response.body : undefined,
        duration: request.response.duration,
      },
    };

    this._requests.push(recorded);
    this._state.requestCount++;

    return recorded;
  }

  private shouldRecord(request: Omit<RecordedRequest, 'id' | 'timestamp'>): boolean {
    if (this._config.filterMethods && this._config.filterMethods.length > 0) {
      if (!this._config.filterMethods.includes(request.method.toUpperCase() as HttpMethod)) {
        return false;
      }
    }

    if (this._config.filterPaths && this._config.filterPaths.length > 0) {
      const matches = this._config.filterPaths.some((pattern) =>
        this.matchPath(request.path, pattern)
      );
      if (!matches) return false;
    }

    if (this._config.excludePaths && this._config.excludePaths.length > 0) {
      const excluded = this._config.excludePaths.some((pattern) =>
        this.matchPath(request.path, pattern)
      );
      if (excluded) return false;
    }

    return true;
  }

  private matchPath(path: string, pattern: string): boolean {
    const regexPattern = pattern
      .replace(/\*/g, '.*')
      .replace(/\//g, '\\/')
      .replace(/\?/g, '\\?');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(path);
  }

  clear(): void {
    this._requests = [];
    this._state.requestCount = 0;
  }

  generateRoutes(options?: {
    deduplicatePaths?: boolean;
    extractPathParams?: boolean;
  }): RouteConfig[] {
    const routes: RouteConfig[] = [];
    const seenPaths = new Map<string, Set<string>>();

    for (const request of this._requests) {
      const pathKey = request.path;
      const methodKey = request.method.toUpperCase();

      if (options?.deduplicatePaths) {
        if (!seenPaths.has(pathKey)) {
          seenPaths.set(pathKey, new Set());
        }
        const methods = seenPaths.get(pathKey)!;
        if (methods.has(methodKey)) continue;
        methods.add(methodKey);
      }

      const response: ResponseConfig = {
        type: 'static',
        statusCode: request.response.statusCode,
        headers: request.response.headers,
      };

      if (request.response.body !== undefined) {
        const contentType =
          request.response.headers['content-type'] ||
          request.response.headers['Content-Type'] ||
          'application/json';

        response.body = {
          contentType,
          content: request.response.body,
        };
      }

      let path = request.path;
      if (options?.extractPathParams) {
        path = this.extractPathParams(path);
      }

      const route: RouteConfig = {
        id: uuidv4(),
        name: `${methodKey} ${path}`,
        enabled: true,
        method: methodKey as HttpMethod,
        path,
        response,
      };

      routes.push(route);
    }

    return routes;
  }

  private extractPathParams(path: string): string {
    const segments = path.split('/');

    return segments
      .map((segment) => {
        if (/^\d+$/.test(segment)) return ':id';
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) {
          return ':uuid';
        }
        if (/^[0-9a-f]{24}$/i.test(segment)) return ':id';
        return segment;
      })
      .join('/');
  }

  toJSON(): object {
    return {
      config: this._config,
      state: this._state,
      requests: this._requests,
    };
  }

  static fromJSON(data: {
    config: RecordingSessionConfig;
    state: RecordingSessionState;
    requests: RecordedRequest[];
  }): RecordingSession {
    const session = new RecordingSession(data.config.name, data.config.targetUrl, data.config);
    session._config = data.config;
    session._state = { ...data.state, status: 'stopped' };
    session._requests = data.requests.map((r) => ({
      ...r,
      timestamp: new Date(r.timestamp),
    }));
    return session;
  }
}
