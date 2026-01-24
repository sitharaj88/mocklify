import { motion } from 'framer-motion';
import { useStore, postMessage } from '../store';
import {
  Plus,
  Play,
  Square,
  Trash2,
  Edit,
  Server,
  Route,
  Activity,
  Copy,
  ExternalLink,
} from 'lucide-react';
import type { MockServerConfig } from '../types';
import {
  Button,
  Card,
  CardContent,
  Badge,
  StatusDot,
  EmptyState,
} from './ui';
import { cn } from '../lib/utils';

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 },
};

export function ServerList() {
  const {
    servers,
    serverStates,
    setShowServerModal,
    setEditingServer,
    setSelectedServerId,
    setActiveView,
  } = useStore();

  const handleCreateServer = () => {
    setEditingServer(null);
    setShowServerModal(true);
  };

  const handleEditServer = (server: MockServerConfig) => {
    setEditingServer(server);
    setShowServerModal(true);
  };

  const handleDeleteServer = (serverId: string) => {
    if (confirm('Are you sure you want to delete this server?')) {
      postMessage({ type: 'deleteServer', serverId });
    }
  };

  const handleToggleServer = (server: MockServerConfig) => {
    const state = serverStates[server.id];
    if (state?.status === 'running') {
      postMessage({ type: 'stopServer', serverId: server.id });
    } else {
      postMessage({ type: 'startServer', serverId: server.id });
    }
  };

  const handleViewRoutes = (serverId: string) => {
    setSelectedServerId(serverId);
    setActiveView('routes');
  };

  const copyUrl = (port: number) => {
    navigator.clipboard.writeText(`http://localhost:${port}`);
  };

  return (
    <>
      <header className="content-header">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-500/10">
            <Server className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-semibold text-surface-50">Servers</h1>
            <p className="text-sm text-surface-400">{servers.length} servers configured</p>
          </div>
        </div>
        <Button onClick={handleCreateServer} className="w-full sm:w-auto">
          <Plus size={16} />
          New Server
        </Button>
      </header>

      <div className="content-body">
        {servers.length === 0 ? (
          <EmptyState
            icon={Server}
            title="No servers yet"
            description="Create your first server to start intercepting requests"
            action={{
              label: 'Create Server',
              onClick: handleCreateServer,
            }}
          />
        ) : (
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 lg:grid-cols-2 gap-4"
          >
            {servers.map((server) => {
              const state = serverStates[server.id];
              const isRunning = state?.status === 'running';
              const isError = state?.status === 'error';
              const requestCount = state?.requestCount || 0;

              return (
                <motion.div key={server.id} variants={itemVariants}>
                  <Card 
                    className={cn(
                      'overflow-hidden transition-all duration-300',
                      isRunning && 'border-emerald-500/30 shadow-emerald-500/5',
                      isError && 'border-red-500/30'
                    )}
                  >
                    <CardContent className="p-5">
                      {/* Header */}
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <StatusDot 
                            status={isRunning ? 'running' : isError ? 'error' : 'stopped'} 
                            size="lg" 
                          />
                          <div>
                            <h3 className="font-semibold text-surface-50">{server.name}</h3>
                            <div className="flex items-center gap-1 text-sm text-surface-400 font-mono">
                              localhost:{server.port}
                              <button
                                className="p-1 hover:bg-surface-700 rounded transition-colors"
                                onClick={() => copyUrl(server.port)}
                                title="Copy URL"
                              >
                                <Copy size={12} />
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1">
                          <Button
                            variant={isRunning ? 'secondary' : 'success'}
                            size="icon-sm"
                            onClick={() => handleToggleServer(server)}
                            title={isRunning ? 'Stop Server' : 'Start Server'}
                          >
                            {isRunning ? <Square size={14} /> : <Play size={14} />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleEditServer(server)}
                            title="Edit Server"
                          >
                            <Edit size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleDeleteServer(server.id)}
                            title="Delete Server"
                            className="hover:text-red-400"
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </div>

                      {/* Stats */}
                      <div className="flex items-center gap-4 mb-4">
                        <div className="flex items-center gap-2 text-sm text-surface-400">
                          <Route size={14} />
                          <span>{server.routes.length} routes</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-surface-400">
                          <Activity size={14} />
                          <span>{requestCount} requests</span>
                        </div>
                        <Badge variant={isRunning ? 'success' : isError ? 'danger' : 'default'}>
                          {state?.status || 'stopped'}
                        </Badge>
                      </div>

                      {/* Error message */}
                      {state?.error && (
                        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
                          {state.error}
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          className="flex-1"
                          onClick={() => handleViewRoutes(server.id)}
                        >
                          <Route size={14} />
                          Manage Routes
                        </Button>
                        {isRunning && (
                          <Button
                            variant="ghost"
                            size="sm"
                            asChild
                          >
                            <a
                              href={`http://localhost:${server.port}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <ExternalLink size={14} />
                              Open
                            </a>
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </div>
    </>
  );
}
