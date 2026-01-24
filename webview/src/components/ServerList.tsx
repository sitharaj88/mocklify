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
} from 'lucide-react';
import type { MockServerConfig } from '../types';

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
        <h1>Servers</h1>
        <button className="btn btn-primary" onClick={handleCreateServer}>
          <Plus size={16} />
          New Server
        </button>
      </header>

      <div className="content-body">
        {servers.length === 0 ? (
          <div className="empty-state">
            <Server size={64} />
            <h3>No servers yet</h3>
            <p>Create your first mock server to get started</p>
            <button className="btn btn-primary" onClick={handleCreateServer}>
              <Plus size={16} />
              Create Server
            </button>
          </div>
        ) : (
          <div className="grid-2">
            {servers.map((server) => {
              const state = serverStates[server.id];
              const isRunning = state?.status === 'running';
              const requestCount = state?.requestCount || 0;

              return (
                <div key={server.id} className="server-card">
                  <div className="server-card-header">
                    <div className="server-info">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span
                          className={`status-dot ${isRunning ? 'running' : state?.status === 'error' ? 'error' : 'stopped'}`}
                        />
                        <h3>{server.name}</h3>
                      </div>
                      <div className="port">
                        localhost:{server.port}
                        <button
                          className="btn btn-ghost btn-icon btn-sm"
                          onClick={() => copyUrl(server.port)}
                          title="Copy URL"
                          style={{ marginLeft: '4px', padding: '2px' }}
                        >
                          <Copy size={12} />
                        </button>
                      </div>
                    </div>

                    <div className="server-actions">
                      <button
                        className={`btn btn-icon ${isRunning ? 'btn-secondary' : 'btn-success'}`}
                        onClick={() => handleToggleServer(server)}
                        title={isRunning ? 'Stop Server' : 'Start Server'}
                      >
                        {isRunning ? <Square size={16} /> : <Play size={16} />}
                      </button>
                      <button
                        className="btn btn-icon btn-ghost"
                        onClick={() => handleEditServer(server)}
                        title="Edit Server"
                      >
                        <Edit size={16} />
                      </button>
                      <button
                        className="btn btn-icon btn-ghost"
                        onClick={() => handleDeleteServer(server.id)}
                        title="Delete Server"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  <div className="server-stats">
                    <span>
                      <Route size={14} />
                      {server.routes.length} routes
                    </span>
                    <span>
                      <Activity size={14} />
                      {requestCount} requests
                    </span>
                    <span
                      className={`badge ${isRunning ? 'badge-success' : 'badge-neutral'}`}
                    >
                      {state?.status || 'stopped'}
                    </span>
                  </div>

                  {state?.error && (
                    <div
                      style={{
                        marginTop: '12px',
                        padding: '8px',
                        background: 'rgba(244, 67, 54, 0.1)',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '12px',
                        color: 'var(--error)',
                      }}
                    >
                      {state.error}
                    </div>
                  )}

                  <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ flex: 1 }}
                      onClick={() => handleViewRoutes(server.id)}
                    >
                      <Route size={14} />
                      Manage Routes
                    </button>
                    {isRunning && (
                      <a
                        href={`http://localhost:${server.port}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-ghost btn-sm"
                      >
                        Open in Browser
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
