import { useState } from 'react';
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
  AlertCircle,
  Download,
  FileJson,
  FileCode,
  Package,
  Terminal,
  Globe,
  BookOpen,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { MockServerConfig } from '../types';
import {
  Button,
  Card,
  CardContent,
  Badge,
  StatusDot,
  EmptyState,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
} from './ui';
import { cn } from '../lib/utils';
import { AiCreatePanel } from './AiCreatePanel';

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

const EXPORT_FORMATS: { id: string; label: string; description: string; icon: LucideIcon }[] = [
  { id: 'config', label: 'Server Config (JSON)', description: 'Full Mocklify config — re-importable', icon: FileJson },
  { id: 'openapi-json', label: 'OpenAPI 3.0 (JSON)', description: 'Spec with inferred response schemas', icon: FileCode },
  { id: 'openapi-yaml', label: 'OpenAPI 3.0 (YAML)', description: 'The same spec serialized as YAML', icon: FileCode },
  { id: 'postman', label: 'Postman Collection v2.1', description: 'Folders per tag with saved example responses', icon: Package },
  { id: 'http', label: 'REST Client (.http)', description: 'Runnable requests for the REST Client extension', icon: Terminal },
  { id: 'html', label: 'API Docs — Web Page', description: 'Self-contained HTML with search and curl examples', icon: Globe },
  { id: 'confluence', label: 'API Docs — Confluence', description: 'Storage-format XML to paste into a page', icon: BookOpen },
];

export function ServerList() {
  const {
    servers,
    serverStates,
    setShowServerModal,
    setEditingServer,
    setSelectedServerId,
    setActiveView,
  } = useStore();

  const [deleteServerId, setDeleteServerId] = useState<string | null>(null);
  const [exportServer, setExportServer] = useState<MockServerConfig | null>(null);

  const handleExport = (format: string) => {
    if (!exportServer) return;
    postMessage({ type: 'exportServer', serverId: exportServer.id, data: { format } });
    setExportServer(null);
  };

  const handleCreateServer = () => {
    setEditingServer(null);
    setShowServerModal(true);
  };

  const handleEditServer = (server: MockServerConfig) => {
    setEditingServer(server);
    setShowServerModal(true);
  };

  const handleDeleteServer = () => {
    if (!deleteServerId) return;
    postMessage({ type: 'deleteServer', serverId: deleteServerId });
    setDeleteServerId(null);
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
          <div className="p-2 rounded-md bg-brand-500/10">
            <Server className="w-5 h-5 text-brand-600 dark:text-brand-400" />
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
        <AiCreatePanel />
        {servers.length === 0 ? (
          <EmptyState
            icon={Server}
            title="No servers yet"
            description="Describe your API above to generate one with AI, or create one manually"
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
                      'overflow-hidden',
                      isRunning && 'border-emerald-500/30',
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
                                className="focus-ring p-1 hover:bg-surface-700 rounded transition-colors duration-150"
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
                            variant={isRunning ? 'secondary' : 'default'}
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
                            onClick={() => setExportServer(server)}
                            title="Export Server"
                          >
                            <Download size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setDeleteServerId(server.id)}
                            title="Delete Server"
                            className="hover:text-red-600 dark:hover:text-red-400"
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
                        <div className="mb-4 flex items-start gap-2 p-3 rounded-md bg-red-500/10 border border-red-500/20 text-sm text-red-700 dark:text-red-400">
                          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                          <span className="min-w-0 break-words">{state.error}</span>
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

      <Dialog open={!!exportServer} onOpenChange={(open) => !open && setExportServer(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Export Server</DialogTitle>
            <DialogDescription>
              Download "{exportServer?.name}" in the format you need
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="p-2 sm:p-2">
            <div className="flex flex-col gap-0.5">
              {EXPORT_FORMATS.map((format) => (
                <button
                  key={format.id}
                  className="focus-ring flex items-start gap-3 w-full rounded-md px-3 py-2.5 text-left hover:bg-surface-700 transition-colors duration-150"
                  onClick={() => handleExport(format.id)}
                >
                  <format.icon
                    size={16}
                    className="mt-0.5 flex-shrink-0 text-brand-600 dark:text-brand-400"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-surface-100">
                      {format.label}
                    </span>
                    <span className="block text-xs text-surface-400">{format.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteServerId}
        onOpenChange={(open) => !open && setDeleteServerId(null)}
        title="Delete Server"
        description="Are you sure you want to delete this server and all its routes? This action cannot be undone."
        confirmLabel="Delete"
        onConfirm={handleDeleteServer}
      />
    </>
  );
}
