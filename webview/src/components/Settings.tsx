import { useState } from 'react';
import {
  Settings as SettingsIcon,
  Server,
  Database,
  ScrollText,
  Info,
  ExternalLink,
} from 'lucide-react';

export function Settings() {
  const [activeTab, setActiveTab] = useState('general');

  return (
    <>
      <header className="content-header">
        <h1>Settings</h1>
      </header>

      <div className="content-body">
        <div style={{ display: 'flex', gap: '24px' }}>
          {/* Settings Navigation */}
          <div style={{ width: '200px' }}>
            <div className="card" style={{ padding: 0 }}>
              {[
                { id: 'general', label: 'General', icon: SettingsIcon },
                { id: 'server', label: 'Server Defaults', icon: Server },
                { id: 'logging', label: 'Logging', icon: ScrollText },
                { id: 'database', label: 'Database', icon: Database },
                { id: 'about', label: 'About', icon: Info },
              ].map((item) => (
                <div
                  key={item.id}
                  className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
                  onClick={() => setActiveTab(item.id)}
                  style={{ borderRadius: 0 }}
                >
                  <item.icon size={16} />
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Settings Content */}
          <div style={{ flex: 1 }}>
            {activeTab === 'general' && (
              <div className="card">
                <div className="card-header">
                  <span className="card-title">General Settings</span>
                </div>
                <div className="card-body">
                  <div className="form-group">
                    <label className="form-label">Configuration Path</label>
                    <input
                      type="text"
                      className="form-input"
                      defaultValue=".mockserver"
                      placeholder=".mockserver"
                    />
                    <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      Directory where server configurations are stored
                    </p>
                  </div>

                  <div className="form-group">
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                      <input type="checkbox" />
                      <span>Auto-start servers when VS Code opens</span>
                    </label>
                  </div>

                  <div className="form-group">
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                      <input type="checkbox" defaultChecked />
                      <span>Show status bar indicator</span>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'server' && (
              <div className="card">
                <div className="card-header">
                  <span className="card-title">Server Defaults</span>
                </div>
                <div className="card-body">
                  <div className="form-group">
                    <label className="form-label">Default Port</label>
                    <input
                      type="number"
                      className="form-input"
                      defaultValue={3000}
                      min={1}
                      max={65535}
                      style={{ width: '150px' }}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Default Protocol</label>
                    <select className="form-select" style={{ width: '200px' }}>
                      <option value="http">HTTP</option>
                      <option value="graphql">GraphQL</option>
                      <option value="websocket">WebSocket</option>
                    </select>
                  </div>

                  <h4 style={{ marginTop: '24px', marginBottom: '16px', fontSize: '14px' }}>
                    CORS Settings
                  </h4>

                  <div className="form-group">
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                      <input type="checkbox" defaultChecked />
                      <span>Enable CORS by default</span>
                    </label>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Allowed Origins</label>
                    <input
                      type="text"
                      className="form-input"
                      defaultValue="*"
                      placeholder="* or comma-separated origins"
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'logging' && (
              <div className="card">
                <div className="card-header">
                  <span className="card-title">Logging Settings</span>
                </div>
                <div className="card-body">
                  <div className="form-group">
                    <label className="form-label">Maximum Log Entries</label>
                    <input
                      type="number"
                      className="form-input"
                      defaultValue={1000}
                      min={100}
                      max={10000}
                      style={{ width: '150px' }}
                    />
                    <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      Older entries will be automatically removed
                    </p>
                  </div>

                  <div className="form-group">
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                      <input type="checkbox" defaultChecked />
                      <span>Include request/response body in logs</span>
                    </label>
                  </div>

                  <div className="form-group">
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                      <input type="checkbox" />
                      <span>Log to VS Code output channel</span>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'database' && (
              <div className="card">
                <div className="card-header">
                  <span className="card-title">Database Settings</span>
                </div>
                <div className="card-body">
                  <div className="form-group">
                    <label className="form-label">JSON Database Directory</label>
                    <input
                      type="text"
                      className="form-input"
                      defaultValue=".mockserver/data"
                      placeholder=".mockserver/data"
                    />
                  </div>

                  <div className="form-group">
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                      <input type="checkbox" defaultChecked />
                      <span>Auto-create JSON collections if they don't exist</span>
                    </label>
                  </div>

                  <div className="form-group">
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                      <input type="checkbox" />
                      <span>Persist database changes between sessions</span>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'about' && (
              <div className="card">
                <div className="card-header">
                  <span className="card-title">About Mock Server</span>
                </div>
                <div className="card-body">
                  <div style={{ textAlign: 'center', padding: '24px' }}>
                    <div
                      style={{
                        width: '80px',
                        height: '80px',
                        background: 'var(--accent-primary)',
                        borderRadius: '16px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 16px',
                      }}
                    >
                      <Server size={40} color="white" />
                    </div>
                    <h2 style={{ marginBottom: '8px' }}>VS Code Mock Server</h2>
                    <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>
                      Version 0.1.0
                    </p>
                    <p style={{ maxWidth: '400px', margin: '0 auto 24px', color: 'var(--text-secondary)' }}>
                      A powerful mock server extension for VS Code that enables developers to
                      create, manage, and run mock servers directly from their IDE.
                    </p>

                    <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
                      <a
                        href="https://github.com/mockserver/vscode-mock-server"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-secondary"
                      >
                        <ExternalLink size={14} />
                        GitHub
                      </a>
                      <a
                        href="https://github.com/mockserver/vscode-mock-server/issues"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-secondary"
                      >
                        Report Issue
                      </a>
                    </div>
                  </div>

                  <div
                    style={{
                      borderTop: '1px solid var(--border-color)',
                      marginTop: '24px',
                      paddingTop: '24px',
                    }}
                  >
                    <h4 style={{ marginBottom: '12px', fontSize: '13px' }}>Features</h4>
                    <ul style={{ paddingLeft: '20px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                      <li>HTTP, GraphQL, and WebSocket mock servers</li>
                      <li>Path parameters and wildcards</li>
                      <li>Dynamic responses with Handlebars templates</li>
                      <li>Faker.js integration for realistic data</li>
                      <li>Database integration (JSON, SQLite, MongoDB, SQL)</li>
                      <li>Request logging and HAR export</li>
                      <li>OpenAPI/Swagger import</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
