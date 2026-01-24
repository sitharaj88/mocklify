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

  // Helpers
  getSelectedServer: () => MockServerConfig | undefined;
  getSelectedRoute: () => RouteConfig | undefined;
  getServerState: (serverId: string) => ServerRuntimeState | undefined;
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
