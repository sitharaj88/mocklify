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
  | { type: 'exportServer'; serverId: string }
  | { type: 'exportLogs'; serverId?: string; data?: { format: string } }
  // Recording
  | { type: 'startRecording'; serverId: string; data: { targetUrl: string; pathFilter?: string } }
  | { type: 'stopRecording'; serverId: string; data: { action: string } }
  | { type: 'getRecordingStatus'; serverId: string }
  // Search
  | { type: 'searchRoutes'; data: { query: string; serverId?: string } };

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
  | { type: 'searchResults'; query: string; results: Array<{ serverId: string; serverName: string; routes: RouteConfig[] }> };
