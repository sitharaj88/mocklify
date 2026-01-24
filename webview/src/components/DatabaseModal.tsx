import { useState, useEffect } from 'react';
import { useStore, postMessage } from '../store';
import { X } from 'lucide-react';
import type { DatabaseConnection } from '../types';

type DbType = 'json' | 'sqlite' | 'mongodb' | 'mysql' | 'postgresql';

export function DatabaseModal() {
  const { editingDatabase, setShowDatabaseModal, setEditingDatabase } = useStore();

  const [name, setName] = useState('');
  const [dbType, setDbType] = useState<DbType>('json');
  const [enabled, setEnabled] = useState(true);

  // JSON config
  const [jsonFilePath, setJsonFilePath] = useState('./data/db.json');
  const [jsonCollections, setJsonCollections] = useState('users,products');

  // SQLite config
  const [sqliteFilePath, setSqliteFilePath] = useState('./data/database.sqlite');

  // MongoDB config
  const [mongoConnectionString, setMongoConnectionString] = useState('mongodb://localhost:27017');
  const [mongoDatabase, setMongoDatabase] = useState('mockdb');

  // SQL config (MySQL/PostgreSQL)
  const [sqlHost, setSqlHost] = useState('localhost');
  const [sqlPort, setSqlPort] = useState(3306);
  const [sqlDatabase, setSqlDatabase] = useState('mockdb');
  const [sqlUsername, setSqlUsername] = useState('root');
  const [sqlPassword, setSqlPassword] = useState('');

  const isEditing = !!editingDatabase;

  useEffect(() => {
    if (editingDatabase) {
      setName(editingDatabase.name);
      setDbType(editingDatabase.type);
      setEnabled(editingDatabase.enabled);

      const config = editingDatabase.config as any;
      switch (editingDatabase.type) {
        case 'json':
          setJsonFilePath(config.filePath || '');
          setJsonCollections(config.collections?.join(',') || '');
          break;
        case 'sqlite':
          setSqliteFilePath(config.filePath || '');
          break;
        case 'mongodb':
          setMongoConnectionString(config.connectionString || '');
          setMongoDatabase(config.database || '');
          break;
        case 'mysql':
        case 'postgresql':
          setSqlHost(config.host || '');
          setSqlPort(config.port || (editingDatabase.type === 'mysql' ? 3306 : 5432));
          setSqlDatabase(config.database || '');
          setSqlUsername(config.username || '');
          setSqlPassword(config.password || '');
          break;
      }
    } else {
      // Reset form
      setName('');
      setDbType('json');
      setEnabled(true);
      setJsonFilePath('./data/db.json');
      setJsonCollections('users,products');
      setSqliteFilePath('./data/database.sqlite');
      setMongoConnectionString('mongodb://localhost:27017');
      setMongoDatabase('mockdb');
      setSqlHost('localhost');
      setSqlPort(3306);
      setSqlDatabase('mockdb');
      setSqlUsername('root');
      setSqlPassword('');
    }
  }, [editingDatabase]);

  const handleClose = () => {
    setShowDatabaseModal(false);
    setEditingDatabase(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      alert('Database name is required');
      return;
    }

    let config: any;
    switch (dbType) {
      case 'json':
        config = {
          filePath: jsonFilePath,
          collections: jsonCollections.split(',').map((c) => c.trim()).filter(Boolean),
        };
        break;
      case 'sqlite':
        config = { filePath: sqliteFilePath };
        break;
      case 'mongodb':
        config = {
          connectionString: mongoConnectionString,
          database: mongoDatabase,
        };
        break;
      case 'mysql':
      case 'postgresql':
        config = {
          host: sqlHost,
          port: sqlPort,
          database: sqlDatabase,
          username: sqlUsername,
          password: sqlPassword,
        };
        break;
    }

    const databaseData: Partial<DatabaseConnection> = {
      name: name.trim(),
      type: dbType,
      config,
      enabled,
    };

    if (isEditing && editingDatabase) {
      postMessage({
        type: 'updateDatabase',
        data: { ...editingDatabase, ...databaseData } as DatabaseConnection,
      });
    } else {
      postMessage({
        type: 'createDatabase',
        data: databaseData,
      });
    }

    handleClose();
  };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">
            {isEditing ? 'Edit Database Connection' : 'Add Database Connection'}
          </h2>
          <button className="btn btn-ghost btn-icon" onClick={handleClose}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label">Connection Name *</label>
              <input
                type="text"
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Database"
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label">Database Type *</label>
              <select
                className="form-select"
                value={dbType}
                onChange={(e) => {
                  setDbType(e.target.value as DbType);
                  if (e.target.value === 'mysql') setSqlPort(3306);
                  if (e.target.value === 'postgresql') setSqlPort(5432);
                }}
              >
                <option value="json">JSON File Database</option>
                <option value="sqlite">SQLite</option>
                <option value="mongodb">MongoDB</option>
                <option value="mysql">MySQL</option>
                <option value="postgresql">PostgreSQL</option>
              </select>
            </div>

            {/* JSON Configuration */}
            {dbType === 'json' && (
              <>
                <div className="form-group">
                  <label className="form-label">File Path</label>
                  <input
                    type="text"
                    className="form-input"
                    value={jsonFilePath}
                    onChange={(e) => setJsonFilePath(e.target.value)}
                    placeholder="./data/db.json"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Collections (comma-separated)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={jsonCollections}
                    onChange={(e) => setJsonCollections(e.target.value)}
                    placeholder="users, products, orders"
                  />
                </div>
              </>
            )}

            {/* SQLite Configuration */}
            {dbType === 'sqlite' && (
              <div className="form-group">
                <label className="form-label">Database File Path</label>
                <input
                  type="text"
                  className="form-input"
                  value={sqliteFilePath}
                  onChange={(e) => setSqliteFilePath(e.target.value)}
                  placeholder="./data/database.sqlite"
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
              </div>
            )}

            {/* MongoDB Configuration */}
            {dbType === 'mongodb' && (
              <>
                <div className="form-group">
                  <label className="form-label">Connection String</label>
                  <input
                    type="text"
                    className="form-input"
                    value={mongoConnectionString}
                    onChange={(e) => setMongoConnectionString(e.target.value)}
                    placeholder="mongodb://localhost:27017"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Database Name</label>
                  <input
                    type="text"
                    className="form-input"
                    value={mongoDatabase}
                    onChange={(e) => setMongoDatabase(e.target.value)}
                    placeholder="mockdb"
                  />
                </div>
              </>
            )}

            {/* MySQL/PostgreSQL Configuration */}
            {(dbType === 'mysql' || dbType === 'postgresql') && (
              <>
                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label">Host</label>
                    <input
                      type="text"
                      className="form-input"
                      value={sqlHost}
                      onChange={(e) => setSqlHost(e.target.value)}
                      placeholder="localhost"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Port</label>
                    <input
                      type="number"
                      className="form-input"
                      value={sqlPort}
                      onChange={(e) => setSqlPort(parseInt(e.target.value) || 0)}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Database Name</label>
                  <input
                    type="text"
                    className="form-input"
                    value={sqlDatabase}
                    onChange={(e) => setSqlDatabase(e.target.value)}
                    placeholder="mockdb"
                  />
                </div>
                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label">Username</label>
                    <input
                      type="text"
                      className="form-input"
                      value={sqlUsername}
                      onChange={(e) => setSqlUsername(e.target.value)}
                      placeholder="root"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Password</label>
                    <input
                      type="password"
                      className="form-input"
                      value={sqlPassword}
                      onChange={(e) => setSqlPassword(e.target.value)}
                      placeholder="••••••••"
                    />
                  </div>
                </div>
              </>
            )}

            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                />
                <span>Enable this connection</span>
              </label>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={handleClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              {isEditing ? 'Save Changes' : 'Add Connection'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
