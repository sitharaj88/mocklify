import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore, postMessage } from './store';
import { useChatStore } from './store/chat';
import { useThemeStore } from './hooks/useTheme';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { ServerList } from './components/ServerList';
import { RouteList } from './components/RouteList';
import { DatabaseList } from './components/DatabaseList';
import { LogsViewer } from './components/LogsViewer';
import { Settings } from './components/Settings';
import { ChatPanel } from './components/chat';
import { ServerModal } from './components/ServerModal';
import { RouteModal } from './components/RouteModal';
import { DatabaseModal } from './components/DatabaseModal';
import { SearchBar } from './components/SearchBar';
import { ImportModal } from './components/ImportModal';
import { KeyboardShortcutsHelp } from './components/KeyboardShortcutsHelp';
import type { MessageFromExtension } from './types';

const pageVariants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
};

const pageTransition = {
  type: 'tween',
  ease: 'easeInOut',
  duration: 0.2,
};

function App() {
  const {
    activeView,
    showServerModal,
    showRouteModal,
    showDatabaseModal,
    setServers,
    setServerStates,
    setDatabases,
    setLogs,
    addLog,
    updateServerState,
    setIsLoading,
    setRecordingState,
    setAiGeneration,
    setAiConfig,
    setAiTestResult,
    setActiveView,
  } = useStore();

  const { theme } = useThemeStore();
  const [showImportModal, setShowImportModal] = useState(false);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

  // Enable keyboard shortcuts
  useKeyboardShortcuts();

  // Apply theme on mount and when theme changes
  useEffect(() => {
    const root = document.documentElement;
    const isDark =
      theme === 'dark' ||
      (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

    root.classList.remove('light', 'dark');
    root.classList.add(isDark ? 'dark' : 'light');

    // Listen for system theme changes
    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = (e: MediaQueryListEvent) => {
        root.classList.remove('light', 'dark');
        root.classList.add(e.matches ? 'dark' : 'light');
      };
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [theme]);

  useEffect(() => {
    // Request initial state
    postMessage({ type: 'ready' });
    postMessage({ type: 'getState' });

    // Listen for messages from extension
    const handleMessage = (event: MessageEvent<MessageFromExtension>) => {
      const message = event.data;

      switch (message.type) {
        case 'state':
          setServers(message.data.servers);
          setServerStates(message.data.serverStates);
          setDatabases(message.data.databases);
          setLogs(message.data.logs);
          setIsLoading(false);
          break;

        case 'serverStateChanged':
          updateServerState(message.state);
          break;

        case 'logEntry':
          addLog(message.entry);
          break;

        case 'error':
          console.error('Extension error:', message.message);
          break;

        case 'success':
          console.log('Success:', message.message);
          break;

        case 'aiStatus': {
          // Progress ticks carry no question/resumable payload. A pending card
          // must survive them while the scan runs, or the next progress update
          // wipes the prompt the agent is blocked on. Both clear locally when
          // answered, and on any terminal status.
          const prev = useStore.getState().aiGeneration;
          const running = message.status === 'generating';
          setAiGeneration({
            status: message.status,
            message: message.message,
            fraction: message.fraction,
            provider: message.provider,
            serverId: message.serverId,
            serverName: message.serverName,
            port: message.port,
            routeCount: message.routeCount,
            servers: message.servers,
            question: message.question ?? (running ? prev.question : undefined),
            resumable: message.resumable ?? (running ? prev.resumable : undefined),
          });
          break;
        }

        case 'aiConfig':
          setAiConfig({
            provider: message.provider,
            activeLabel: message.activeLabel,
            providers: message.providers,
          });
          break;

        case 'aiTestResult':
          setAiTestResult({ ok: message.ok, message: message.message });
          break;

        case 'recordingStatus':
          if (message.serverId) {
            setRecordingState(message.serverId, {
              isRecording: message.isRecording,
              recordingCount: message.recordingCount || 0,
              targetUrl: message.targetUrl,
            });
          }
          break;

        case 'exportResult':
          // Handle file download
          if (message.content && message.filename) {
            const blob = new Blob([message.content], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = message.filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }
          break;

        // AI chat: the extension owns the transcript — these dispatch into
        // the chat store; ChatPanel's chatSync on mount reconciles races.
        case 'chatState':
          useChatStore.getState().setChatState(message.state);
          break;

        case 'chatUserMessage':
          useChatStore.getState().addChatUserMessage(message.message);
          break;

        case 'chatAssistantUpdate':
          useChatStore.getState().upsertChatAssistant(message.message);
          break;

        case 'chatConfirmRequest':
          useChatStore.getState().setChatConfirm(message.request);
          break;

        case 'chatConfirmResolved':
          useChatStore.getState().resolveChatConfirm(message.id);
          break;

        case 'chatFocus':
          setActiveView('chat');
          break;

        case 'chatPrefill':
          useChatStore.getState().setChatPrefill(message.text);
          break;

        case 'chatSessionsUpdate':
          // Metadata-only refresh (auto-title, updatedAt, messageCount) —
          // messages/running/pendingConfirm stay untouched.
          useChatStore.getState().setChatSessions(message.sessions, message.activeSessionId);
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const renderContent = () => {
    const components: Record<string, JSX.Element> = {
      dashboard: <Dashboard />,
      chat: <ChatPanel />,
      servers: <ServerList />,
      routes: <RouteList />,
      databases: <DatabaseList />,
      logs: <LogsViewer />,
      settings: <Settings />,
    };

    return components[activeView] || <Dashboard />;
  };

  return (
    <div className="app-container">
      <Sidebar 
        onImportClick={() => setShowImportModal(true)}
        onShortcutsClick={() => setShowShortcutsHelp(true)}
      />
      <main className="main-content mesh-bg">
        {/* Search Bar for routes and logs views */}
        <SearchBar />
        
        <AnimatePresence mode="wait">
          <motion.div
            key={activeView}
            initial="initial"
            animate="animate"
            exit="exit"
            variants={pageVariants}
            transition={pageTransition}
            className="flex-1 flex flex-col overflow-hidden"
          >
            {renderContent()}
          </motion.div>
        </AnimatePresence>
      </main>

      {showServerModal && <ServerModal />}
      {showRouteModal && <RouteModal />}
      {showDatabaseModal && <DatabaseModal />}
      <ImportModal open={showImportModal} onOpenChange={setShowImportModal} />
      <KeyboardShortcutsHelp open={showShortcutsHelp} onOpenChange={setShowShortcutsHelp} />
    </div>
  );
}

export default App;
