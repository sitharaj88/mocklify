import type { ChatMessageToExtension, ChatMessageFromExtension } from './chat';

// AI chat protocol (mirror of src/ai/chat/chatProtocol.ts)
export * from './chat';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

export interface DelayConfig {
  type: 'fixed' | 'random';
  min?: number;
  max?: number;
  value?: number;
}

export interface BodyMatcher {
  type: 'exact' | 'contains' | 'jsonPath' | 'regex';
  value: string;
  jsonPath?: string;
}

export interface RequestMatcher {
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  body?: BodyMatcher;
}

export interface ResponseBody {
  contentType: string;
  content: unknown;
}

export interface TemplateConfig {
  engine: 'handlebars';
  template: string;
}

export interface ProxyConfig {
  targetUrl: string;
  preserveHost?: boolean;
  timeout?: number;
}

export interface ResponseConfig {
  type: 'static' | 'dynamic' | 'proxy' | 'database';
  statusCode: number;
  headers?: Record<string, string>;
  body?: ResponseBody;
  template?: TemplateConfig;
  proxy?: ProxyConfig;
  database?: DatabaseResponseConfig;
}

export interface DatabaseResponseConfig {
  connectionId: string;
  operation: 'find' | 'findOne' | 'insert' | 'update' | 'delete' | 'query';
  collection?: string;
  table?: string;
  query?: string;
  filter?: Record<string, unknown>;
}

export interface ChaosConfig {
  enabled: boolean;
  failureRate?: number;
  failureStatus?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
}

export interface GraphQlRoute {
  operationName: string;
  operationType: 'query' | 'mutation' | 'subscription';
}

export interface RouteConfig {
  id: string;
  name: string;
  enabled: boolean;
  method: HttpMethod | HttpMethod[];
  path: string;
  matcher?: RequestMatcher;
  response: ResponseConfig;
  delay?: DelayConfig;
  priority?: number;
  tags?: string[];
  chaos?: ChaosConfig;
  graphql?: GraphQlRoute;
}

export interface CorsSettings {
  enabled: boolean;
  origins?: string[];
  methods?: HttpMethod[];
  headers?: string[];
}

export interface ServerSettings {
  cors?: CorsSettings;
  defaultHeaders?: Record<string, string>;
  logging?: {
    enabled: boolean;
    includeBody?: boolean;
  };
}

export interface MockServerConfig {
  id: string;
  name: string;
  port: number;
  protocol: 'http' | 'graphql' | 'websocket';
  enabled: boolean;
  routes: RouteConfig[];
  settings?: ServerSettings;
  createdAt?: string;
  updatedAt?: string;
}

export interface ServerRuntimeState {
  id: string;
  status: 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
  port: number;
  startedAt?: string;
  error?: string;
  requestCount: number;
}

export interface DatabaseConnection {
  id: string;
  name: string;
  type: 'json' | 'sqlite' | 'mongodb' | 'mysql' | 'postgresql';
  config: JsonDbConfig | SqliteDbConfig | MongoDbConfig | SqlDbConfig;
  enabled: boolean;
}

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

export interface RequestLogEntry {
  id: string;
  serverId: string;
  routeId?: string;
  timestamp: string;
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
  validation?: {
    mode: 'warn' | 'enforce';
    ok: boolean;
    violations: { field: string; message: string }[];
  };
}

export interface AppState {
  servers: MockServerConfig[];
  serverStates: Record<string, ServerRuntimeState>;
  databases: DatabaseConnection[];
  logs: RequestLogEntry[];
  selectedServerId: string | null;
  selectedRouteId: string | null;
  selectedDatabaseId: string | null;
  activeView: 'dashboard' | 'servers' | 'routes' | 'databases' | 'logs' | 'settings';
}

// VS Code API message types
export type MessageToExtension =
  | { type: 'ready' }
  | { type: 'getState' }
  | { type: 'createServer'; data: Partial<MockServerConfig> }
  | { type: 'updateServer'; data: MockServerConfig }
  | { type: 'deleteServer'; serverId: string }
  | { type: 'startServer'; serverId: string }
  | { type: 'stopServer'; serverId: string }
  | { type: 'createRoute'; serverId: string; data: Partial<RouteConfig> }
  | { type: 'updateRoute'; serverId: string; routeId: string; data: Partial<RouteConfig> }
  | { type: 'deleteRoute'; serverId: string; routeId: string }
  | { type: 'createDatabase'; data: Partial<DatabaseConnection> }
  | { type: 'updateDatabase'; data: DatabaseConnection }
  | { type: 'deleteDatabase'; databaseId: string }
  | { type: 'testDatabase'; databaseId: string }
  | { type: 'clearLogs'; serverId?: string }
  // Import/Export
  | { type: 'importOpenApi'; serverId: string; data: { content: string } }
  | { type: 'importPostman'; serverId: string; data: { content: string } }
  | { type: 'exportServer'; serverId: string; data?: { format?: string } }
  | { type: 'exportLogs'; serverId?: string; data?: { format: string } }
  // Recording
  | { type: 'startRecording'; serverId: string; data: { targetUrl: string; pathFilter?: string } }
  | { type: 'stopRecording'; serverId: string; data: { action: string } }
  | { type: 'getRecordingStatus'; serverId: string }
  // Search
  | { type: 'searchRoutes'; data: { query: string; serverId?: string } }
  // AI generation
  | { type: 'aiGenerateServer'; data: { description: string; autoStart?: boolean } }
  | { type: 'aiGenerateFromCodebase'; data: { autoStart?: boolean; resume?: 'resume' | 'fresh' } }
  | { type: 'aiAnswerQuestion'; data: { id: string; answer: string } }
  | { type: 'aiCancelGeneration' }
  | { type: 'aiGenerateRoutes'; serverId: string; data: { description: string } }
  // AI configuration
  | { type: 'getAiConfig' }
  | { type: 'setAiProvider'; data: { provider: string } }
  | { type: 'setAiModel'; data: { provider: string; model: string } }
  | { type: 'setAiBaseUrl'; data: { provider: string; baseUrl: string } }
  | { type: 'setAiApiKey'; data: { provider: string; key: string } }
  | { type: 'clearAiApiKey'; data: { provider: string } }
  | { type: 'testAiProvider' }
  // AI chat (dashboard chat tab)
  | ChatMessageToExtension;

export type MessageFromExtension =
  | { type: 'state'; data: AppState }
  | { type: 'serverUpdated'; server: MockServerConfig }
  | { type: 'serverStateChanged'; state: ServerRuntimeState }
  | { type: 'logEntry'; entry: RequestLogEntry }
  | { type: 'error'; message: string }
  | { type: 'success'; message: string }
  // Recording
  | { type: 'recordingStatus'; serverId: string; isRecording: boolean; recordingCount?: number; targetUrl?: string }
  // Export
  | { type: 'exportResult'; format: string; content: string; filename: string }
  // Search
  | { type: 'searchResults'; query: string; results: Array<{ serverId: string; serverName: string; routes: RouteConfig[] }> }
  // AI generation
  | {
      type: 'aiStatus';
      status: 'idle' | 'generating' | 'done' | 'error';
      message?: string;
      fraction?: number;
      provider?: string;
      serverId?: string;
      serverName?: string;
      port?: number;
      routeCount?: number;
      /** All servers a multi-surface codebase scan created (one per API surface). */
      servers?: AiCreatedServer[];
      /** A question the scanning agent needs answered to continue (HITL). */
      question?: AiScanQuestion;
      /** An interrupted scan that can be resumed (shown as an inline choice). */
      resumable?: AiResumableScan;
    }
  // AI configuration
  | { type: 'aiConfig'; provider: string; activeLabel?: string; providers: AiProviderInfo[] }
  | { type: 'aiTestResult'; ok: boolean; message: string }
  // AI chat (dashboard chat tab)
  | ChatMessageFromExtension;

export interface AiCreatedServer {
  serverId: string;
  serverName: string;
  port: number;
  routeCount: number;
}

/** A clarifying question the codebase-scanning agent asked (ask_user tool). */
export interface AiScanQuestion {
  id: string;
  question: string;
  /** 2–4 suggested answers; absent for free-text questions. */
  options?: string[];
  /** Whether a typed free-text answer is accepted (always true today). */
  freeText?: boolean;
}

/** An interrupted, checkpointed codebase scan that can be resumed. */
export interface AiResumableScan {
  completedSurfaces: number;
  totalSurfaces: number;
  /** Epoch ms when the interrupted scan started. */
  startedAt: number;
}

export interface AiGenerationState {
  status: 'idle' | 'generating' | 'done' | 'error';
  message?: string;
  /** 0..1 pipeline progress while generating. */
  fraction?: number;
  provider?: string;
  serverId?: string;
  serverName?: string;
  port?: number;
  routeCount?: number;
  /** All servers a multi-surface codebase scan created (one per API surface). */
  servers?: AiCreatedServer[];
  /** A question the scanning agent is waiting on (renders an answer card). */
  question?: AiScanQuestion;
  /** An interrupted scan offering Resume / Start fresh. */
  resumable?: AiResumableScan;
}

export interface AiProviderInfo {
  id: string;
  label: string;
  available: boolean;
  requiresKey: boolean;
  hasKey: boolean;
  model?: string;
  baseUrl?: string;
  models?: { id: string; detail: string }[];
}

export interface AiConfig {
  provider: string;
  activeLabel?: string;
  providers: AiProviderInfo[];
}

export interface AiTestResult {
  ok: boolean;
  message: string;
}
