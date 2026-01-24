import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore, postMessage } from './store';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { ServerList } from './components/ServerList';
import { RouteList } from './components/RouteList';
import { DatabaseList } from './components/DatabaseList';
import { LogsViewer } from './components/LogsViewer';
import { Settings } from './components/Settings';
import { ServerModal } from './components/ServerModal';
import { RouteModal } from './components/RouteModal';
import { DatabaseModal } from './components/DatabaseModal';
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
  } = useStore();

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
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const renderContent = () => {
    const components: Record<string, JSX.Element> = {
      dashboard: <Dashboard />,
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
      <Sidebar />
      <main className="main-content mesh-bg">
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
    </div>
  );
}

export default App;
