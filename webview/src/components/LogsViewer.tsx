import { useState } from 'react';
import { useStore, postMessage } from '../store';
import {
  Trash2,
  Download,
  ScrollText,
} from 'lucide-react';
import type { RequestLogEntry } from '../types';

export function LogsViewer() {
  const { logs, servers } = useStore();
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [selectedLog, setSelectedLog] = useState<RequestLogEntry | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filteredLogs = logs.filter((log) => {
    if (selectedServerId && log.serverId !== selectedServerId) return false;
    if (statusFilter === 'success' && log.response.statusCode >= 400) return false;
    if (statusFilter === 'error' && log.response.statusCode < 400) return false;
    return true;
  });

  const handleClearLogs = () => {
    if (confirm('Are you sure you want to clear all logs?')) {
      postMessage({ type: 'clearLogs', serverId: selectedServerId || undefined });
    }
  };

  const handleExportLogs = () => {
    const data = JSON.stringify(filteredLogs, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mock-server-logs.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const getStatusColor = (status: number) => {
    if (status < 300) return 'badge-success';
    if (status < 400) return 'badge-info';
    if (status < 500) return 'badge-warning';
    return 'badge-error';
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
        <h1>Request Logs</h1>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-secondary" onClick={handleExportLogs}>
            <Download size={16} />
            Export
          </button>
          <button className="btn btn-secondary" onClick={handleClearLogs}>
            <Trash2 size={16} />
            Clear
          </button>
        </div>
      </header>

      <div className="content-body" style={{ display: 'flex', gap: '16px', height: 'calc(100% - 100px)' }}>
        {/* Logs List */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {/* Filters */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <select
              className="form-select"
              style={{ width: '200px' }}
              value={selectedServerId || ''}
              onChange={(e) => setSelectedServerId(e.target.value || null)}
            >
              <option value="">All Servers</option>
              {servers.map((server) => (
                <option key={server.id} value={server.id}>
                  {server.name}
                </option>
              ))}
            </select>

            <select
              className="form-select"
              style={{ width: '150px' }}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All Status</option>
              <option value="success">Success (2xx, 3xx)</option>
              <option value="error">Errors (4xx, 5xx)</option>
            </select>

            <span style={{ marginLeft: 'auto', color: 'var(--text-secondary)', fontSize: '13px' }}>
              {filteredLogs.length} request{filteredLogs.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Logs Table */}
          <div className="card" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {filteredLogs.length === 0 ? (
              <div className="empty-state" style={{ flex: 1 }}>
                <ScrollText size={64} />
                <h3>No requests logged</h3>
                <p>Requests to your mock servers will appear here</p>
              </div>
            ) : (
              <div style={{ flex: 1, overflow: 'auto' }}>
                {filteredLogs.map((log) => (
                  <div
                    key={log.id}
                    className="log-entry"
                    style={{
                      cursor: 'pointer',
                      background: selectedLog?.id === log.id ? 'var(--bg-active)' : undefined,
                    }}
                    onClick={() => setSelectedLog(log)}
                  >
                    <span className="log-time">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <span className={`method-badge method-${log.request.method.toLowerCase()}`}>
                      {log.request.method}
                    </span>
                    <span className="log-path" title={log.request.url}>
                      {log.request.path}
                    </span>
                    <span className={`badge ${getStatusColor(log.response.statusCode)}`}>
                      {log.response.statusCode}
                    </span>
                    <span className="log-duration">{log.response.duration}ms</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Log Details Panel */}
        {selectedLog && (
          <div className="card" style={{ width: '400px', overflow: 'auto' }}>
            <div className="card-header">
              <span className="card-title">Request Details</span>
              <button
                className="btn btn-ghost btn-icon btn-sm"
                onClick={() => setSelectedLog(null)}
              >
                &times;
              </button>
            </div>
            <div className="card-body">
              {/* Request */}
              <div style={{ marginBottom: '16px' }}>
                <h4 style={{ fontSize: '12px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-muted)' }}>
                  REQUEST
                </h4>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                  <span className={`method-badge method-${selectedLog.request.method.toLowerCase()}`}>
                    {selectedLog.request.method}
                  </span>
                  <code style={{ fontSize: '12px' }}>{selectedLog.request.path}</code>
                </div>

                {/* Headers */}
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-muted)', marginBottom: '4px' }}>
                    Headers
                  </div>
                  <div
                    style={{
                      background: 'var(--bg-tertiary)',
                      padding: '8px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '11px',
                      fontFamily: 'var(--font-mono)',
                      maxHeight: '100px',
                      overflow: 'auto',
                    }}
                  >
                    {Object.entries(selectedLog.request.headers)
                      .filter(([_, v]) => v)
                      .slice(0, 10)
                      .map(([key, value]) => (
                        <div key={key}>
                          <span style={{ color: 'var(--info)' }}>{key}</span>: {String(value)}
                        </div>
                      ))}
                  </div>
                </div>

                {/* Body */}
                {selectedLog.request.body && (
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-muted)', marginBottom: '4px' }}>
                      Body
                    </div>
                    <pre
                      style={{
                        background: 'var(--bg-tertiary)',
                        padding: '8px',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '11px',
                        fontFamily: 'var(--font-mono)',
                        maxHeight: '150px',
                        overflow: 'auto',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}
                    >
                      {String(formatBody(selectedLog.request.body))}
                    </pre>
                  </div>
                )}
              </div>

              {/* Response */}
              <div>
                <h4 style={{ fontSize: '12px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-muted)' }}>
                  RESPONSE
                </h4>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                  <span className={`badge ${getStatusColor(selectedLog.response.statusCode)}`}>
                    {selectedLog.response.statusCode}
                  </span>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    {selectedLog.response.duration}ms
                  </span>
                  {selectedLog.matched ? (
                    <span className="badge badge-success">Matched</span>
                  ) : (
                    <span className="badge badge-warning">Not Matched</span>
                  )}
                </div>

                {/* Response Body */}
                {selectedLog.response.body && (
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-muted)', marginBottom: '4px' }}>
                      Body
                    </div>
                    <pre
                      style={{
                        background: 'var(--bg-tertiary)',
                        padding: '8px',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '11px',
                        fontFamily: 'var(--font-mono)',
                        maxHeight: '200px',
                        overflow: 'auto',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}
                    >
                      {String(formatBody(selectedLog.response.body))}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
