import { z } from 'zod';

// HTTP Methods
export const HttpMethodSchema = z.enum([
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'PATCH',
  'HEAD',
  'OPTIONS',
  'TRACE',
  'CONNECT',
]);
export type HttpMethod = z.infer<typeof HttpMethodSchema>;

// Delay Configuration
export const DelayConfigSchema = z.object({
  type: z.enum(['fixed', 'random']),
  min: z.number().min(0).optional(),
  max: z.number().min(0).optional(),
  value: z.number().min(0).optional(),
});
export type DelayConfig = z.infer<typeof DelayConfigSchema>;

// Request Matcher - how to match incoming requests
export const BodyMatcherSchema = z.object({
  type: z.enum(['exact', 'contains', 'jsonPath', 'regex']),
  value: z.string(),
  jsonPath: z.string().optional(),
});
export type BodyMatcher = z.infer<typeof BodyMatcherSchema>;

export const RequestMatcherSchema = z.object({
  headers: z.record(z.string()).optional(),
  queryParams: z.record(z.string()).optional(),
  body: BodyMatcherSchema.optional(),
});
export type RequestMatcher = z.infer<typeof RequestMatcherSchema>;

// Response Body Configuration
export const ResponseBodySchema = z.object({
  contentType: z.string(),
  content: z.unknown(),
});
export type ResponseBody = z.infer<typeof ResponseBodySchema>;

// Template Configuration
export const TemplateConfigSchema = z.object({
  engine: z.literal('handlebars'),
  template: z.string(),
});
export type TemplateConfig = z.infer<typeof TemplateConfigSchema>;

// Proxy Configuration
export const ProxyConfigSchema = z.object({
  targetUrl: z.string().url(),
  preserveHost: z.boolean().optional(),
  timeout: z.number().min(0).optional(),
});
export type ProxyConfig = z.infer<typeof ProxyConfigSchema>;

// Database Response Configuration
export const DatabaseResponseConfigSchema = z.object({
  connectionId: z.string(),
  operation: z.enum(['find', 'findOne', 'insert', 'update', 'delete', 'query']),
  collection: z.string().optional(),
  table: z.string().optional(),
  query: z.string().optional(),
  filter: z.record(z.unknown()).optional(),
});
export type DatabaseResponseConfig = z.infer<typeof DatabaseResponseConfigSchema>;

// Response Configuration (explicit interfaces because the sequence type is
// mutually recursive with ResponseConfig — see the z.lazy below)
export interface ResponseSequenceConfig {
  responses: ResponseConfig[];
  resetAfter?: number; // Reset after N calls
  resetOnTime?: number; // Reset after N milliseconds
}

export interface ResponseConfig {
  type: 'static' | 'dynamic' | 'proxy' | 'database' | 'sequence';
  statusCode: number;
  headers?: Record<string, string>;
  body?: ResponseBody;
  template?: TemplateConfig;
  proxy?: ProxyConfig;
  database?: DatabaseResponseConfig;
  sequence?: ResponseSequenceConfig;
}

export const ResponseSequenceConfigSchema: z.ZodType<ResponseSequenceConfig> = z.object({
  responses: z.array(z.lazy(() => ResponseConfigSchema)),
  resetAfter: z.number().optional(),
  resetOnTime: z.number().optional(),
});

export const ResponseConfigSchema: z.ZodType<ResponseConfig> = z.object({
  type: z.enum(['static', 'dynamic', 'proxy', 'database', 'sequence']),
  statusCode: z.number().min(100).max(599),
  headers: z.record(z.string()).optional(),
  body: ResponseBodySchema.optional(),
  template: TemplateConfigSchema.optional(),
  proxy: ProxyConfigSchema.optional(),
  database: DatabaseResponseConfigSchema.optional(),
  sequence: ResponseSequenceConfigSchema.optional(),
});

/**
 * Priority stamped on disabled negative-flow routes. RequestMatcher keeps the
 * FIRST route on a score tie, so a negative route sharing method+path with its
 * success route would never win once enabled unless it outscores it.
 */
export const NEGATIVE_ROUTE_PRIORITY = 10;

// Stateful Configuration - CRUD route families sharing a live in-memory collection
export const StatefulConfigSchema = z.object({
  collection: z.string().min(1),
  idParam: z.string().min(1).optional(), // default 'id'
  seed: z.array(z.unknown()).optional(),
});
export type StatefulConfig = z.infer<typeof StatefulConfigSchema>;

// Chaos Configuration - random latency and failure injection.
// Declared before RouteConfig so a route may carry its own override; the
// effective chaos for a request is `matchedRoute?.chaos ?? server.chaos`
// (see HttpMockServer). A route override fully REPLACES server chaos for that
// route — `{ enabled: false }` therefore exempts the route from server chaos.
export const ChaosConfigSchema = z.object({
  enabled: z.boolean(),
  failureRate: z.number().min(0).max(1).optional(), // probability per request
  failureStatus: z.number().min(100).max(599).optional(), // default 503
  minDelayMs: z.number().min(0).optional(),
  maxDelayMs: z.number().min(0).optional(),
});
export type ChaosConfig = z.infer<typeof ChaosConfigSchema>;

// GraphQL-native route - matches a POST body's operation instead of a REST path
export const GraphQlRouteSchema = z.object({
  operationName: z.string().min(1),
  operationType: z.enum(['query', 'mutation', 'subscription']),
});
export type GraphQlRoute = z.infer<typeof GraphQlRouteSchema>;

// Contract config (server-level request validation against an API spec)
export const ContractModeSchema = z.enum(['off', 'warn', 'enforce']);
export type ContractMode = z.infer<typeof ContractModeSchema>;
export const ContractConfigSchema = z.object({
  specPath: z.string().min(1),
  mode: ContractModeSchema,
});
export type ContractConfig = z.infer<typeof ContractConfigSchema>;

// Route Configuration
export const RouteConfigSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  enabled: z.boolean(),
  method: z.union([HttpMethodSchema, z.array(HttpMethodSchema)]),
  path: z.string().min(1),
  matcher: RequestMatcherSchema.optional(),
  response: ResponseConfigSchema,
  delay: DelayConfigSchema.optional(),
  priority: z.number().optional(),
  tags: z.array(z.string()).optional(),
  stateful: StatefulConfigSchema.optional(),
  chaos: ChaosConfigSchema.optional(), // route-level override; REPLACES server chaos for this route
  graphql: GraphQlRouteSchema.optional(),
});
export type RouteConfig = z.infer<typeof RouteConfigSchema>;

// --- Contract validation hook (E5 declares & calls; validator injected externally) ---
export interface ContractViolation {
  field: string;
  message: string;
}
export type ValidationResult =
  | { ok: true }
  | { ok: false; violations: ContractViolation[] };

/** vscode-free, pure request view handed to the validator. */
export interface ValidatedRequest {
  method: string;
  path: string; // path only, no query string
  params: Record<string, string>; // matched path params
  query: Record<string, string | string[] | undefined>;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

/** Synchronous and pure: no I/O, no vscode. Spec parsing happens in the factory. */
export interface RequestValidator {
  validate(req: ValidatedRequest, route: RouteConfig): ValidationResult;
}

// Environment Configuration
export const EnvironmentConfigSchema = z.object({
  name: z.string(),
  variables: z.record(z.string()),
});
export type EnvironmentConfig = z.infer<typeof EnvironmentConfigSchema>;

// Server Settings
export const ServerSettingsSchema = z.object({
  cors: z
    .object({
      enabled: z.boolean(),
      origins: z.array(z.string()).optional(),
      methods: z.array(HttpMethodSchema).optional(),
      headers: z.array(z.string()).optional(),
    })
    .optional(),
  defaultHeaders: z.record(z.string()).optional(),
  logging: z
    .object({
      enabled: z.boolean(),
      includeBody: z.boolean().optional(),
    })
    .optional(),
});
export type ServerSettings = z.infer<typeof ServerSettingsSchema>;

// Server Protocol
export const ServerProtocolSchema = z.enum(['http', 'graphql', 'websocket']);
export type ServerProtocol = z.infer<typeof ServerProtocolSchema>;

// Mock Server Configuration
export const MockServerConfigSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  port: z.number().min(1).max(65535),
  protocol: ServerProtocolSchema,
  enabled: z.boolean(),
  routes: z.array(RouteConfigSchema),
  settings: ServerSettingsSchema.optional(),
  chaos: ChaosConfigSchema.optional(),
  contract: ContractConfigSchema.optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type MockServerConfig = z.infer<typeof MockServerConfigSchema>;

// Server Runtime State
export interface ServerRuntimeState {
  id: string;
  status: 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
  port: number;
  startedAt?: Date;
  error?: string;
  requestCount: number;
}

// Request Log Entry
export interface RequestLogEntry {
  id: string;
  serverId: string;
  routeId?: string;
  timestamp: Date;
  request: {
    method: string;
    path: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    query: Record<string, string | string[] | undefined>;
    body?: unknown;
  };
  response: {
    statusCode: number;
    headers: Record<string, string>;
    body?: unknown;
    duration: number;
  };
  matched: boolean;
  // Set on the matched-route entry whenever a contract validator ran (mode !== 'off').
  validation?: { mode: 'warn' | 'enforce'; ok: boolean; violations: ContractViolation[] };
}

// Extension Configuration
export interface ExtensionConfig {
  autoStart: boolean;
  defaultPort: number;
  configPath: string;
  logging: {
    maxEntries: number;
    includeBody: boolean;
  };
}

// Events
export type ServerEvent =
  | { type: 'server:started'; serverId: string; port: number }
  | { type: 'server:stopped'; serverId: string }
  | { type: 'server:error'; serverId: string; error: string }
  | { type: 'request:received'; serverId: string; entry: RequestLogEntry }
  | { type: 'config:changed'; serverId: string };

export type EventHandler = (event: ServerEvent) => void;

// Server Interface
export interface IMockServer {
  readonly id: string;
  readonly config: MockServerConfig;
  readonly state: ServerRuntimeState;

  start(): Promise<void>;
  stop(): Promise<void>;
  updateConfig(config: MockServerConfig): Promise<void>;
  onEvent(handler: EventHandler): () => void;
  /** Clear runtime request state (e.g. stateful collections); optional per protocol */
  resetState?(): void;
}

// Configuration Store Interface
export interface IConfigurationStore {
  getServers(): Promise<MockServerConfig[]>;
  getServer(id: string): Promise<MockServerConfig | undefined>;
  saveServer(config: MockServerConfig): Promise<void>;
  deleteServer(id: string): Promise<void>;
  initialize(): Promise<void>;
}

// Request Logger Interface
export interface IRequestLogger {
  log(entry: RequestLogEntry): void;
  getEntries(serverId?: string, limit?: number): RequestLogEntry[];
  clear(serverId?: string): void;
}

// Database Connection Types
export interface JsonDbConfig {
  filePath: string;
  collections: string[];
}

export interface SqliteDbConfig {
  filePath: string;
}

export interface MongoDbConfig {
  connectionString: string;
  database: string;
}

export interface SqlDbConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

export type DatabaseType = 'json' | 'sqlite' | 'mongodb' | 'mysql' | 'postgresql';

export interface DatabaseConnection {
  id: string;
  name: string;
  type: DatabaseType;
  config: JsonDbConfig | SqliteDbConfig | MongoDbConfig | SqlDbConfig;
  enabled: boolean;
}
