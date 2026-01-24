import { useStore, postMessage } from '../store';
import {
  Plus,
  Trash2,
  Edit,
  Database,
  FileJson,
  HardDrive,
  Cloud,
  TestTube,
} from 'lucide-react';
import type { DatabaseConnection } from '../types';

export function DatabaseList() {
  const {
    databases,
    setShowDatabaseModal,
    setEditingDatabase,
  } = useStore();

  const handleCreateDatabase = () => {
    setEditingDatabase(null);
    setShowDatabaseModal(true);
  };

  const handleEditDatabase = (database: DatabaseConnection) => {
    setEditingDatabase(database);
    setShowDatabaseModal(true);
  };

  const handleDeleteDatabase = (databaseId: string) => {
    if (confirm('Are you sure you want to delete this database connection?')) {
      postMessage({ type: 'deleteDatabase', databaseId });
    }
  };

  const handleTestConnection = (databaseId: string) => {
    postMessage({ type: 'testDatabase', databaseId });
  };

  const getDbIcon = (type: string) => {
    switch (type) {
      case 'json':
        return <FileJson size={24} />;
      case 'sqlite':
        return <HardDrive size={24} />;
      case 'mongodb':
      case 'mysql':
      case 'postgresql':
        return <Cloud size={24} />;
      default:
        return <Database size={24} />;
    }
  };

  const getDbLabel = (type: string) => {
    switch (type) {
      case 'json':
        return 'JSON File Database';
      case 'sqlite':
        return 'SQLite Database';
      case 'mongodb':
        return 'MongoDB';
      case 'mysql':
        return 'MySQL';
      case 'postgresql':
        return 'PostgreSQL';
      default:
        return type;
    }
  };

  return (
    <>
      <header className="content-header">
        <h1>Database Connections</h1>
        <button className="btn btn-primary" onClick={handleCreateDatabase}>
          <Plus size={16} />
          New Connection
        </button>
      </header>

      <div className="content-body">
        {databases.length === 0 ? (
          <div className="empty-state">
            <Database size={64} />
            <h3>No database connections</h3>
            <p>Connect a database to use dynamic data in your mock responses</p>
            <button className="btn btn-primary" onClick={handleCreateDatabase}>
              <Plus size={16} />
              Add Connection
            </button>
          </div>
        ) : (
          <>
            {/* Info Banner */}
            <div
              className="card"
              style={{ marginBottom: '24px', background: 'rgba(33, 150, 243, 0.1)' }}
            >
              <div className="card-body" style={{ display: 'flex', gap: '12px' }}>
                <Database size={24} color="var(--info)" />
                <div>
                  <strong style={{ color: 'var(--text-primary)' }}>
                    Database Integration
                  </strong>
                  <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    Connect your mock server to databases for dynamic responses. Use JSON files for
                    simple scenarios or connect to real databases for complex testing.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid-2">
              {databases.map((database) => (
                <div key={database.id} className="database-card">
                  <div className="database-type">
                    <div className="database-type-icon">
                      {getDbIcon(database.type)}
                    </div>
                    <div>
                      <h3 style={{ fontSize: '14px', fontWeight: 600 }}>{database.name}</h3>
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        {getDbLabel(database.type)}
                      </span>
                    </div>
                    <span
                      className={`badge ${database.enabled ? 'badge-success' : 'badge-neutral'}`}
                      style={{ marginLeft: 'auto' }}
                    >
                      {database.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>

                  {/* Connection Details */}
                  <div
                    style={{
                      padding: '12px',
                      background: 'var(--bg-tertiary)',
                      borderRadius: 'var(--radius-md)',
                      marginTop: '12px',
                      fontSize: '12px',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {database.type === 'json' && (
                      <div>
                        <span style={{ color: 'var(--text-muted)' }}>File: </span>
                        {(database.config as any).filePath}
                      </div>
                    )}
                    {database.type === 'sqlite' && (
                      <div>
                        <span style={{ color: 'var(--text-muted)' }}>File: </span>
                        {(database.config as any).filePath}
                      </div>
                    )}
                    {database.type === 'mongodb' && (
                      <div>
                        <span style={{ color: 'var(--text-muted)' }}>Database: </span>
                        {(database.config as any).database}
                      </div>
                    )}
                    {(database.type === 'mysql' || database.type === 'postgresql') && (
                      <div>
                        <span style={{ color: 'var(--text-muted)' }}>Host: </span>
                        {(database.config as any).host}:{(database.config as any).port}
                      </div>
                    )}
                  </div>

                  <div
                    style={{ display: 'flex', gap: '8px', marginTop: '12px' }}
                  >
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleTestConnection(database.id)}
                    >
                      <TestTube size={14} />
                      Test Connection
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleEditDatabase(database)}
                    >
                      <Edit size={14} />
                      Edit
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleDeleteDatabase(database.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Supported Databases */}
        <div className="card" style={{ marginTop: '24px' }}>
          <div className="card-header">
            <span className="card-title">Supported Databases</span>
          </div>
          <div className="card-body">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '16px' }}>
              {[
                { type: 'json', name: 'JSON File', desc: 'Local JSON storage' },
                { type: 'sqlite', name: 'SQLite', desc: 'Embedded SQL database' },
                { type: 'mongodb', name: 'MongoDB', desc: 'NoSQL database' },
                { type: 'mysql', name: 'MySQL', desc: 'SQL database' },
                { type: 'postgresql', name: 'PostgreSQL', desc: 'Advanced SQL' },
              ].map((db) => (
                <div
                  key={db.type}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '12px',
                    background: 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  {getDbIcon(db.type)}
                  <div>
                    <div style={{ fontWeight: 500, fontSize: '13px' }}>{db.name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{db.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
