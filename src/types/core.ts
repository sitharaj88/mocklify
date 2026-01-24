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

// Response Configuration
export const ResponseConfigSchema = z.object({
  type: z.enum(['static', 'dynamic', 'proxy']),
  statusCode: z.number().min(100).max(599),
  headers: z.record(z.string()).optional(),
  body: ResponseBodySchema.optional(),
  template: TemplateConfigSchema.optional(),
  proxy: ProxyConfigSchema.optional(),
});
export type ResponseConfig = z.infer<typeof ResponseConfigSchema>;

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
});
export type RouteConfig = z.infer<typeof RouteConfigSchema>;

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
