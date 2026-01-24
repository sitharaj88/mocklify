import { create } from 'zustand';
import type {
  MockServerConfig,
  ServerRuntimeState,
  DatabaseConnection,
  RequestLogEntry,
  RouteConfig,
  MessageToExtension,
} from '../types';

type ActiveView = 'dashboard' | 'servers' | 'routes' | 'databases' | 'logs' | 'settings';

interface RecordingState {
  isRecording: boolean;
  recordingCount: number;
  targetUrl?: string;
}

interface SearchFilters {
  query: string;
  method: string | null;
  status: string | null;
  tags: string[];
}

interface AppStore {
  // State
  servers: MockServerConfig[];
  serverStates: Record<string, ServerRuntimeState>;
  databases: DatabaseConnection[];
  logs: RequestLogEntry[];
  selectedServerId: string | null;
  selectedRouteId: string | null;
  selectedDatabaseId: string | null;
  activeView: ActiveView;
  isLoading: boolean;
  editingServer: MockServerConfig | null;
  editingRoute: RouteConfig | null;
  editingDatabase: DatabaseConnection | null;
  showServerModal: boolean;
  showRouteModal: boolean;
  showDatabaseModal: boolean;

  // Search & Filter state
  searchFilters: SearchFilters;
  
  // Recording state
  recordingStates: Record<string, RecordingState>;

  // Theme
  theme: 'light' | 'dark' | 'system';

  // Actions
  setServers: (servers: MockServerConfig[]) => void;
  setServerStates: (states: Record<string, ServerRuntimeState>) => void;
  updateServerState: (state: ServerRuntimeState) => void;
  setDatabases: (databases: DatabaseConnection[]) => void;
  setLogs: (logs: RequestLogEntry[]) => void;
  addLog: (log: RequestLogEntry) => void;
  setSelectedServerId: (id: string | null) => void;
  setSelectedRouteId: (id: string | null) => void;
  setSelectedDatabaseId: (id: string | null) => void;
  setActiveView: (view: ActiveView) => void;
  setIsLoading: (loading: boolean) => void;
  setEditingServer: (server: MockServerConfig | null) => void;
  setEditingRoute: (route: RouteConfig | null) => void;
  setEditingDatabase: (database: DatabaseConnection | null) => void;
  setShowServerModal: (show: boolean) => void;
  setShowRouteModal: (show: boolean) => void;
  setShowDatabaseModal: (show: boolean) => void;

  // Search & Filter actions
  setSearchQuery: (query: string) => void;
  setMethodFilter: (method: string | null) => void;
  setStatusFilter: (status: string | null) => void;
  setTagsFilter: (tags: string[]) => void;
  clearFilters: () => void;

  // Recording actions
  setRecordingState: (serverId: string, state: RecordingState) => void;

  // Theme actions
  setTheme: (theme: 'light' | 'dark' | 'system') => void;

  // Helpers
  getSelectedServer: () => MockServerConfig | undefined;
  getSelectedRoute: () => RouteConfig | undefined;
  getServerState: (serverId: string) => ServerRuntimeState | undefined;
  getFilteredRoutes: () => RouteConfig[];
  getFilteredLogs: () => RequestLogEntry[];
  getAllTags: () => string[];
}

export const useStore = create<AppStore>((set, get) => ({
  // Initial state
  servers: [],
  serverStates: {},
  databases: [],
  logs: [],
  selectedServerId: null,
  selectedRouteId: null,
  selectedDatabaseId: null,
  activeView: 'dashboard',
  isLoading: true,
  editingServer: null,
  editingRoute: null,
  editingDatabase: null,
  showServerModal: false,
  showRouteModal: false,
  showDatabaseModal: false,

  // Search & Filter initial state
  searchFilters: {
    query: '',
    method: null,
    status: null,
    tags: [],
  },

  // Recording initial state
  recordingStates: {},

  // Theme
  theme: 'system',

  // Actions
  setServers: (servers) => set({ servers }),
  setServerStates: (serverStates) => set({ serverStates }),
  updateServerState: (state) =>
    set((s) => ({
      serverStates: { ...s.serverStates, [state.id]: state },
    })),
  setDatabases: (databases) => set({ databases }),
  setLogs: (logs) => set({ logs }),
  addLog: (log) =>
    set((s) => ({
      logs: [log, ...s.logs].slice(0, 1000),
    })),
  setSelectedServerId: (selectedServerId) => set({ selectedServerId }),
  setSelectedRouteId: (selectedRouteId) => set({ selectedRouteId }),
  setSelectedDatabaseId: (selectedDatabaseId) => set({ selectedDatabaseId }),
  setActiveView: (activeView) => set({ activeView }),
  setIsLoading: (isLoading) => set({ isLoading }),
  setEditingServer: (editingServer) => set({ editingServer }),
  setEditingRoute: (editingRoute) => set({ editingRoute }),
  setEditingDatabase: (editingDatabase) => set({ editingDatabase }),
  setShowServerModal: (showServerModal) => set({ showServerModal }),
  setShowRouteModal: (showRouteModal) => set({ showRouteModal }),
  setShowDatabaseModal: (showDatabaseModal) => set({ showDatabaseModal }),

  // Search & Filter actions
  setSearchQuery: (query) =>
    set((s) => ({ searchFilters: { ...s.searchFilters, query } })),
  setMethodFilter: (method) =>
    set((s) => ({ searchFilters: { ...s.searchFilters, method } })),
  setStatusFilter: (status) =>
    set((s) => ({ searchFilters: { ...s.searchFilters, status } })),
  setTagsFilter: (tags) =>
    set((s) => ({ searchFilters: { ...s.searchFilters, tags } })),
  clearFilters: () =>
    set({
      searchFilters: { query: '', method: null, status: null, tags: [] },
    }),

  // Recording actions
  setRecordingState: (serverId, state) =>
    set((s) => ({
      recordingStates: { ...s.recordingStates, [serverId]: state },
    })),

  // Theme actions
  setTheme: (theme) => set({ theme }),

  // Helpers
  getSelectedServer: () => {
    const { servers, selectedServerId } = get();
    return servers.find((s) => s.id === selectedServerId);
  },
  getSelectedRoute: () => {
    const server = get().getSelectedServer();
    const { selectedRouteId } = get();
    return server?.routes.find((r) => r.id === selectedRouteId);
  },
  getServerState: (serverId) => get().serverStates[serverId],

  getFilteredRoutes: () => {
    const { servers, selectedServerId, searchFilters } = get();
    const server = servers.find((s) => s.id === selectedServerId);
    if (!server) return [];

    let routes = [...server.routes];
    const { query, method, tags } = searchFilters;

    if (query) {
      const lowerQuery = query.toLowerCase();
      routes = routes.filter(
        (r) =>
          r.name.toLowerCase().includes(lowerQuery) ||
          r.path.toLowerCase().includes(lowerQuery)
      );
    }

    if (method) {
      routes = routes.filter((r) => r.method === method);
    }

    if (tags.length > 0) {
      routes = routes.filter(
        (r) => r.tags && tags.some((t) => r.tags?.includes(t))
      );
    }

    return routes;
  },

  getFilteredLogs: () => {
    const { logs, selectedServerId, searchFilters } = get();
    let filtered = selectedServerId
      ? logs.filter((l) => l.serverId === selectedServerId)
      : logs;

    const { query, method, status } = searchFilters;

    if (query) {
      const lowerQuery = query.toLowerCase();
      filtered = filtered.filter(
        (l) =>
          l.request.path.toLowerCase().includes(lowerQuery) ||
          l.request.method.toLowerCase().includes(lowerQuery)
      );
    }

    if (method) {
      filtered = filtered.filter((l) => l.request.method === method);
    }

    if (status) {
      const statusCode = parseInt(status, 10);
      const statusRange = Math.floor(statusCode / 100) * 100;
      filtered = filtered.filter((l) => {
        const code = l.response?.statusCode || 0;
        return code >= statusRange && code < statusRange + 100;
      });
    }

    return filtered;
  },

  getAllTags: () => {
    const { servers } = get();
    const tagSet = new Set<string>();
    servers.forEach((server) => {
      server.routes.forEach((route) => {
        route.tags?.forEach((tag) => tagSet.add(tag));
      });
    });
    return Array.from(tagSet).sort();
  },
}));

// VS Code API
declare const acquireVsCodeApi: () => {
  postMessage: (message: MessageToExtension) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
};

let vscodeApi: ReturnType<typeof acquireVsCodeApi> | null = null;

export function getVsCodeApi() {
  if (!vscodeApi) {
    try {
      vscodeApi = acquireVsCodeApi();
    } catch {
      // Running outside VS Code (development mode)
      vscodeApi = {
        postMessage: (message) => console.log('postMessage:', message),
        getState: () => null,
        setState: () => {},
      };
    }
  }
  return vscodeApi;
}

export function postMessage(message: MessageToExtension) {
  getVsCodeApi().postMessage(message);
}
