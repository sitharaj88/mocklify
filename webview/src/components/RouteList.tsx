import { useStore, postMessage } from '../store';
import {
  Plus,
  Trash2,
  Edit,
  Route,
  ToggleLeft,
  ToggleRight,
  Server,
} from 'lucide-react';
import type { RouteConfig } from '../types';

export function RouteList() {
  const {
    servers,
    selectedServerId,
    setSelectedServerId,
    setShowRouteModal,
    setEditingRoute,
  } = useStore();

  const selectedServer = servers.find((s) => s.id === selectedServerId);
  const routes = selectedServer?.routes || [];

  const handleCreateRoute = () => {
    if (!selectedServerId) {
      alert('Please select a server first');
      return;
    }
    setEditingRoute(null);
    setShowRouteModal(true);
  };

  const handleEditRoute = (route: RouteConfig) => {
    setEditingRoute(route);
    setShowRouteModal(true);
  };

  const handleDeleteRoute = (routeId: string) => {
    if (!selectedServerId) return;
    if (confirm('Are you sure you want to delete this route?')) {
      postMessage({
        type: 'deleteRoute',
        serverId: selectedServerId,
        routeId,
      });
    }
  };

  const handleToggleRoute = (route: RouteConfig) => {
    if (!selectedServerId) return;
    postMessage({
      type: 'updateRoute',
      serverId: selectedServerId,
      routeId: route.id,
      data: { enabled: !route.enabled },
    });
  };

  const getMethodClass = (method: string | string[]): string => {
    const m = Array.isArray(method) ? method[0] : method;
    return `method-${m.toLowerCase()}`;
  };

  const formatMethod = (method: string | string[]): string => {
    if (Array.isArray(method)) {
      return method.join(', ');
    }
    return method;
  };

  return (
    <>
      <header className="content-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <h1>Routes</h1>

          {/* Server Selector */}
          <div className="form-group" style={{ margin: 0, minWidth: '200px' }}>
            <select
              className="form-select"
              value={selectedServerId || ''}
              onChange={(e) => setSelectedServerId(e.target.value || null)}
            >
              <option value="">Select a server...</option>
              {servers.map((server) => (
                <option key={server.id} value={server.id}>
                  {server.name} (:{server.port})
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          className="btn btn-primary"
          onClick={handleCreateRoute}
          disabled={!selectedServerId}
        >
          <Plus size={16} />
          New Route
        </button>
      </header>

      <div className="content-body">
        {!selectedServerId ? (
          <div className="empty-state">
            <Server size={64} />
            <h3>Select a server</h3>
            <p>Choose a server from the dropdown to manage its routes</p>
          </div>
        ) : routes.length === 0 ? (
          <div className="empty-state">
            <Route size={64} />
            <h3>No routes yet</h3>
            <p>Create your first route for {selectedServer?.name}</p>
            <button className="btn btn-primary" onClick={handleCreateRoute}>
              <Plus size={16} />
              Create Route
            </button>
          </div>
        ) : (
          <div className="card">
            <div className="card-header">
              <span className="card-title">
                {selectedServer?.name} Routes ({routes.length})
              </span>
            </div>
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: '50px' }}>Status</th>
                    <th style={{ width: '100px' }}>Method</th>
                    <th>Path</th>
                    <th style={{ width: '150px' }}>Name</th>
                    <th style={{ width: '100px' }}>Response</th>
                    <th style={{ width: '80px' }}>Code</th>
                    <th style={{ width: '120px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {routes.map((route) => (
                    <tr key={route.id} style={{ opacity: route.enabled ? 1 : 0.5 }}>
                      <td>
                        <button
                          className="btn btn-ghost btn-icon btn-sm"
                          onClick={() => handleToggleRoute(route)}
                          title={route.enabled ? 'Disable route' : 'Enable route'}
                        >
                          {route.enabled ? (
                            <ToggleRight size={20} color="var(--success)" />
                          ) : (
                            <ToggleLeft size={20} />
                          )}
                        </button>
                      </td>
                      <td>
                        <span className={`method-badge ${getMethodClass(route.method)}`}>
                          {formatMethod(route.method)}
                        </span>
                      </td>
                      <td>
                        <code style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                          {route.path}
                        </code>
                      </td>
                      <td style={{ color: 'var(--text-secondary)' }}>
                        {route.name}
                      </td>
                      <td>
                        <span className="badge badge-neutral">{route.response.type}</span>
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            route.response.statusCode < 400
                              ? 'badge-success'
                              : route.response.statusCode < 500
                              ? 'badge-warning'
                              : 'badge-error'
                          }`}
                        >
                          {route.response.statusCode}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button
                            className="btn btn-ghost btn-icon btn-sm"
                            onClick={() => handleEditRoute(route)}
                            title="Edit route"
                          >
                            <Edit size={14} />
                          </button>
                          <button
                            className="btn btn-ghost btn-icon btn-sm"
                            onClick={() => handleDeleteRoute(route.id)}
                            title="Delete route"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
