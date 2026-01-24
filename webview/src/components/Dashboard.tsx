import { useStore, postMessage } from '../store';
import {
  Server,
  Route,
  Activity,
  Database,
  Play,
  Square,
  Plus,
  ArrowRight,
} from 'lucide-react';

export function Dashboard() {
  const {
    servers,
    serverStates,
    logs,
    setActiveView,
    setShowServerModal,
    setEditingServer,
  } = useStore();

  const runningServers = Object.values(serverStates).filter(
    (s) => s.status === 'running'
  ).length;
  const totalRoutes = servers.reduce((sum, s) => sum + s.routes.length, 0);
  const totalRequests = Object.values(serverStates).reduce(
    (sum, s) => sum + s.requestCount,
    0
  );

  const recentLogs = logs.slice(0, 5);

  const handleStartAll = () => {
    servers.forEach((server) => {
      const state = serverStates[server.id];
      if (!state || state.status === 'stopped') {
        postMessage({ type: 'startServer', serverId: server.id });
      }
    });
  };

  const handleStopAll = () => {
    servers.forEach((server) => {
      const state = serverStates[server.id];
      if (state?.status === 'running') {
        postMessage({ type: 'stopServer', serverId: server.id });
      }
    });
  };

  const handleCreateServer = () => {
    setEditingServer(null);
    setShowServerModal(true);
  };

  return (
    <>
      <header className="content-header">
        <h1>Dashboard</h1>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-secondary" onClick={handleStartAll}>
            <Play size={16} />
            Start All
          </button>
          <button className="btn btn-secondary" onClick={handleStopAll}>
            <Square size={16} />
            Stop All
          </button>
          <button className="btn btn-primary" onClick={handleCreateServer}>
            <Plus size={16} />
            New Server
          </button>
        </div>
      </header>

      <div className="content-body">
        {/* Stats Grid */}
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon blue">
              <Server size={24} />
            </div>
            <div className="stat-content">
              <h3>{servers.length}</h3>
              <p>Total Servers</p>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon green">
              <Activity size={24} />
            </div>
            <div className="stat-content">
              <h3>{runningServers}</h3>
              <p>Running Servers</p>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon orange">
              <Route size={24} />
            </div>
            <div className="stat-content">
              <h3>{totalRoutes}</h3>
              <p>Total Routes</p>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon purple">
              <Database size={24} />
            </div>
            <div className="stat-content">
              <h3>{totalRequests}</h3>
              <p>Total Requests</p>
            </div>
          </div>
        </div>

        <div className="grid-2">
          {/* Servers Overview */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Servers</span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setActiveView('servers')}
              >
                View All <ArrowRight size={14} />
              </button>
            </div>
            <div className="card-body">
              {servers.length === 0 ? (
                <div className="empty-state" style={{ padding: '24px' }}>
                  <Server size={32} />
                  <p>No servers configured</p>
                  <button className="btn btn-primary btn-sm" onClick={handleCreateServer}>
                    Create Server
                  </button>
                </div>
              ) : (
                servers.slice(0, 4).map((server) => {
                  const state = serverStates[server.id];
                  const isRunning = state?.status === 'running';
                  return (
                    <div
                      key={server.id}
                      className="server-card"
                      style={{ marginBottom: '8px', padding: '12px' }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span
                              className={`status-dot ${isRunning ? 'running' : 'stopped'}`}
                            />
                            <span style={{ fontWeight: 600 }}>{server.name}</span>
                          </div>
                          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                            :{server.port} · {server.routes.length} routes
                          </span>
                        </div>
                        <button
                          className={`btn btn-sm ${isRunning ? 'btn-secondary' : 'btn-success'}`}
                          onClick={() =>
                            postMessage({
                              type: isRunning ? 'stopServer' : 'startServer',
                              serverId: server.id,
                            })
                          }
                        >
                          {isRunning ? <Square size={14} /> : <Play size={14} />}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Recent Activity */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Recent Requests</span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setActiveView('logs')}
              >
                View All <ArrowRight size={14} />
              </button>
            </div>
            <div className="card-body" style={{ padding: 0 }}>
              {recentLogs.length === 0 ? (
                <div className="empty-state" style={{ padding: '24px' }}>
                  <Activity size={32} />
                  <p>No requests logged yet</p>
                </div>
              ) : (
                recentLogs.map((log) => (
                  <div key={log.id} className="log-entry">
                    <span className="log-time">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <span className={`method-badge method-${log.request.method.toLowerCase()}`}>
                      {log.request.method}
                    </span>
                    <span className="log-path">{log.request.path}</span>
                    <span
                      className={`badge ${
                        log.response.statusCode < 400 ? 'badge-success' : 'badge-error'
                      }`}
                    >
                      {log.response.statusCode}
                    </span>
                    <span className="log-duration">{log.response.duration}ms</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
