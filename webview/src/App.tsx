import { useEffect } from 'react';
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
    switch (activeView) {
      case 'dashboard':
        return <Dashboard />;
      case 'servers':
        return <ServerList />;
      case 'routes':
        return <RouteList />;
      case 'databases':
        return <DatabaseList />;
      case 'logs':
        return <LogsViewer />;
      case 'settings':
        return <Settings />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className="app">
      <Sidebar />
      <main className="main-content">
        {renderContent()}
      </main>

      {showServerModal && <ServerModal />}
      {showRouteModal && <RouteModal />}
      {showDatabaseModal && <DatabaseModal />}
    </div>
  );
}

export default App;
