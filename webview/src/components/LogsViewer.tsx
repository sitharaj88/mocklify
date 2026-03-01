import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore, postMessage } from '../store';
import {
  Trash2,
  Download,
  ScrollText,
  X,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import type { RequestLogEntry } from '../types';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  getMethodVariant,
  getStatusVariant,
  EmptyState,
  ConfirmDialog,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui';
import { cn } from '../lib/utils';

export function LogsViewer() {
  const { logs, servers } = useStore();
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [selectedLog, setSelectedLog] = useState<RequestLogEntry | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const filteredLogs = logs.filter((log) => {
    if (selectedServerId && log.serverId !== selectedServerId) return false;
    if (statusFilter === 'success' && log.response.statusCode >= 400) return false;
    if (statusFilter === 'error' && log.response.statusCode < 400) return false;
    return true;
  });

  const handleClearLogs = () => {
    postMessage({ type: 'clearLogs', serverId: selectedServerId || undefined });
  };

  const handleExportLogs = () => {
    const data = JSON.stringify(filteredLogs, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mocklify-logs.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatBody = (body: unknown): string => {
    if (body === undefined || body === null) return 'No body';
    if (typeof body === 'string') return body;
    try {
      return JSON.stringify(body, null, 2);
    } catch {
      return String(body);
    }
  };

  return (
    <>
      <header className="content-header">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/10">
            <ScrollText className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-semibold text-surface-50">Request Logs</h1>
            <p className="text-sm text-surface-400">{logs.length} total requests</p>
          </div>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <Button variant="secondary" onClick={handleExportLogs} className="flex-1 sm:flex-none">
            <Download size={16} />
            <span className="hidden sm:inline">Export</span>
          </Button>
          <Button variant="secondary" onClick={() => setShowClearConfirm(true)} className="flex-1 sm:flex-none">
            <Trash2 size={16} />
            <span className="hidden sm:inline">Clear</span>
          </Button>
        </div>
      </header>

      <div className="content-body flex flex-col lg:flex-row gap-4 h-full">
        {/* Logs List */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Filters */}
          <div className="flex flex-wrap gap-3 mb-4 items-center">
            <Select
              value={selectedServerId || 'all'}
              onValueChange={(value) => setSelectedServerId(value === 'all' ? null : value)}
            >
              <SelectTrigger className="w-full sm:w-[200px]">
                <SelectValue placeholder="All Servers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Servers</SelectItem>
                {servers.map((server) => (
                  <SelectItem key={server.id} value={server.id}>
                    {server.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="success">Success (2xx, 3xx)</SelectItem>
                <SelectItem value="error">Errors (4xx, 5xx)</SelectItem>
              </SelectContent>
            </Select>

            <span className="ml-auto text-sm text-surface-400">
              {filteredLogs.length} request{filteredLogs.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Logs */}
          <Card className="flex-1 overflow-hidden flex flex-col">
            {filteredLogs.length === 0 ? (
              <div className="flex-1">
                <EmptyState
                  icon={ScrollText}
                  title="No requests logged"
                  description="Requests to your servers will appear here"
                />
              </div>
            ) : (
              <div className="flex-1 overflow-auto">
                {filteredLogs.map((log) => (
                  <motion.div
                    key={log.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className={cn(
                      'flex items-center gap-3 px-4 py-3 border-b border-surface-700/50 cursor-pointer transition-colors',
                      selectedLog?.id === log.id
                        ? 'bg-brand-500/10'
                        : 'hover:bg-surface-700/30'
                    )}
                    onClick={() => setSelectedLog(log)}
                  >
                    <span className="text-xs text-surface-500 w-20 flex-shrink-0">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <Badge variant={getMethodVariant(log.request.method)}>
                      {log.request.method}
                    </Badge>
                    <span className="flex-1 text-sm text-surface-200 truncate font-mono" title={log.request.url}>
                      {log.request.path}
                    </span>
                    <Badge variant={getStatusVariant(log.response.statusCode)}>
                      {log.response.statusCode}
                    </Badge>
                    <span className="text-xs text-surface-400 w-14 text-right">
                      {log.response.duration}ms
                    </span>
                  </motion.div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Log Details Panel */}
        <AnimatePresence>
          {selectedLog && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="w-[400px] flex-shrink-0"
            >
              <Card className="h-full overflow-hidden flex flex-col">
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <CardTitle className="text-base">Request Details</CardTitle>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setSelectedLog(null)}
                  >
                    <X size={16} />
                  </Button>
                </CardHeader>
                <CardContent className="flex-1 overflow-auto space-y-6">
                  {/* Request */}
                  <div>
                    <h4 className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-3">
                      Request
                    </h4>
                    <div className="flex items-center gap-2 mb-3">
                      <Badge variant={getMethodVariant(selectedLog.request.method)}>
                        {selectedLog.request.method}
                      </Badge>
                      <code className="text-xs text-surface-300 truncate">{selectedLog.request.path}</code>
                    </div>

                    {/* Headers */}
                    <div className="mb-3">
                      <p className="text-xs font-medium text-surface-500 mb-2">Headers</p>
                      <div className="p-3 rounded-lg bg-surface-900/50 border border-surface-700/50 text-xs font-mono max-h-24 overflow-auto space-y-1">
                        {Object.entries(selectedLog.request.headers)
                          .filter(([_, v]) => v)
                          .slice(0, 10)
                          .map(([key, value]) => (
                            <div key={key}>
                              <span className="text-brand-400">{key}</span>
                              <span className="text-surface-500">: </span>
                              <span className="text-surface-300">{String(value)}</span>
                            </div>
                          ))}
                      </div>
                    </div>

                    {/* Body */}
                    {selectedLog.request.body && (
                      <div>
                        <p className="text-xs font-medium text-surface-500 mb-2">Body</p>
                        <pre className="p-3 rounded-lg bg-surface-900/50 border border-surface-700/50 text-xs font-mono max-h-32 overflow-auto whitespace-pre-wrap break-all text-surface-300">
                          {formatBody(selectedLog.request.body)}
                        </pre>
                      </div>
                    )}
                  </div>

                  {/* Response */}
                  <div>
                    <h4 className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-3">
                      Response
                    </h4>
                    <div className="flex items-center gap-2 mb-3">
                      <Badge variant={getStatusVariant(selectedLog.response.statusCode)}>
                        {selectedLog.response.statusCode}
                      </Badge>
                      <span className="text-xs text-surface-400">
                        {selectedLog.response.duration}ms
                      </span>
                      {selectedLog.matched ? (
                        <Badge variant="success" className="ml-auto">
                          <CheckCircle size={12} className="mr-1" />
                          Matched
                        </Badge>
                      ) : (
                        <Badge variant="warning" className="ml-auto">
                          <AlertCircle size={12} className="mr-1" />
                          Not Matched
                        </Badge>
                      )}
                    </div>

                    {/* Response Body */}
                    {selectedLog.response.body && (
                      <div>
                        <p className="text-xs font-medium text-surface-500 mb-2">Body</p>
                        <pre className="p-3 rounded-lg bg-surface-900/50 border border-surface-700/50 text-xs font-mono max-h-48 overflow-auto whitespace-pre-wrap break-all text-surface-300">
                          {formatBody(selectedLog.response.body)}
                        </pre>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <ConfirmDialog
        open={showClearConfirm}
        onOpenChange={setShowClearConfirm}
        title="Clear Logs"
        description="Are you sure you want to clear all request logs? This action cannot be undone."
        confirmLabel="Clear"
        onConfirm={handleClearLogs}
      />
    </>
  );
}
