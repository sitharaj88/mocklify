import { useState, useEffect } from 'react';
import { useStore, postMessage } from '../store';
import { X } from 'lucide-react';
import type { MockServerConfig } from '../types';

export function ServerModal() {
  const { editingServer, setShowServerModal, setEditingServer } = useStore();

  const [name, setName] = useState('');
  const [port, setPort] = useState(3000);
  const [protocol, setProtocol] = useState<'http' | 'graphql' | 'websocket'>('http');
  const [corsEnabled, setCorsEnabled] = useState(true);
  const [loggingEnabled, setLoggingEnabled] = useState(true);

  const isEditing = !!editingServer;

  useEffect(() => {
    if (editingServer) {
      setName(editingServer.name);
      setPort(editingServer.port);
      setProtocol(editingServer.protocol);
      setCorsEnabled(editingServer.settings?.cors?.enabled ?? true);
      setLoggingEnabled(editingServer.settings?.logging?.enabled ?? true);
    } else {
      setName('');
      setPort(3000);
      setProtocol('http');
      setCorsEnabled(true);
      setLoggingEnabled(true);
    }
  }, [editingServer]);

  const handleClose = () => {
    setShowServerModal(false);
    setEditingServer(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      alert('Server name is required');
      return;
    }

    if (port < 1 || port > 65535) {
      alert('Port must be between 1 and 65535');
      return;
    }

    const serverData: Partial<MockServerConfig> = {
      name: name.trim(),
      port,
      protocol,
      enabled: true,
      settings: {
        cors: { enabled: corsEnabled },
        logging: { enabled: loggingEnabled, includeBody: true },
      },
    };

    if (isEditing && editingServer) {
      postMessage({
        type: 'updateServer',
        data: { ...editingServer, ...serverData } as MockServerConfig,
      });
    } else {
      postMessage({
        type: 'createServer',
        data: serverData,
      });
    }

    handleClose();
  };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">
            {isEditing ? 'Edit Server' : 'Create New Server'}
          </h2>
          <button className="btn btn-ghost btn-icon" onClick={handleClose}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label">Server Name *</label>
              <input
                type="text"
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Mock Server"
                autoFocus
              />
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Port *</label>
                <input
                  type="number"
                  className="form-input"
                  value={port}
                  onChange={(e) => setPort(parseInt(e.target.value) || 0)}
                  min={1}
                  max={65535}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Protocol</label>
                <select
                  className="form-select"
                  value={protocol}
                  onChange={(e) => setProtocol(e.target.value as any)}
                >
                  <option value="http">HTTP / REST</option>
                  <option value="graphql">GraphQL</option>
                  <option value="websocket">WebSocket</option>
                </select>
              </div>
            </div>

            <div
              style={{
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
                padding: '16px',
                marginTop: '8px',
              }}
            >
              <h4 style={{ marginBottom: '12px', fontSize: '13px' }}>Server Settings</h4>

              <div className="form-group" style={{ marginBottom: '8px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={corsEnabled}
                    onChange={(e) => setCorsEnabled(e.target.checked)}
                  />
                  <span>Enable CORS</span>
                </label>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '24px' }}>
                  Allow cross-origin requests from any domain
                </p>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={loggingEnabled}
                    onChange={(e) => setLoggingEnabled(e.target.checked)}
                  />
                  <span>Enable Request Logging</span>
                </label>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '24px' }}>
                  Log all incoming requests and responses
                </p>
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={handleClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              {isEditing ? 'Save Changes' : 'Create Server'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
