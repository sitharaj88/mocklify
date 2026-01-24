import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore, postMessage } from '../store';
import { Database, FileJson, HardDrive, Leaf, CircleDashed } from 'lucide-react';
import type { DatabaseConnection } from '../types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
  Input,
  Switch,
  FormGroup,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui';
import { cn } from '../lib/utils';

type DbType = 'json' | 'sqlite' | 'mongodb' | 'mysql' | 'postgresql';

const dbTypes = [
  { value: 'json', label: 'JSON File', icon: FileJson, color: 'text-amber-400' },
  { value: 'sqlite', label: 'SQLite', icon: HardDrive, color: 'text-blue-400' },
  { value: 'mongodb', label: 'MongoDB', icon: Leaf, color: 'text-green-400' },
  { value: 'mysql', label: 'MySQL', icon: Database, color: 'text-orange-400' },
  { value: 'postgresql', label: 'PostgreSQL', icon: CircleDashed, color: 'text-sky-400' },
];

export function DatabaseModal() {
  const { editingDatabase, showDatabaseModal, setShowDatabaseModal, setEditingDatabase } = useStore();

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

  const selectedDb = dbTypes.find((d) => d.value === dbType);

  return (
    <Dialog open={showDatabaseModal} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent size="default">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-brand-500/15">
              <Database className="w-5 h-5 text-brand-400" />
            </div>
            <div>
              <DialogTitle>
                {isEditing ? 'Edit Database' : 'Add Database Connection'}
              </DialogTitle>
              <DialogDescription>
                {isEditing ? 'Update connection settings' : 'Configure a database for mock data'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-5 px-6 py-4 overflow-y-auto max-h-[60vh]">
            <FormGroup>
              <Label required>Connection Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Database"
                autoFocus
              />
            </FormGroup>

            <FormGroup>
              <Label required>Database Type</Label>
              <Select
                value={dbType}
                onValueChange={(v) => {
                  setDbType(v as DbType);
                  if (v === 'mysql') setSqlPort(3306);
                  if (v === 'postgresql') setSqlPort(5432);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {dbTypes.map((db) => (
                    <SelectItem key={db.value} value={db.value}>
                      <div className="flex items-center gap-2">
                        <db.icon size={14} className={db.color} />
                        {db.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormGroup>

            <AnimatePresence mode="wait">
              <motion.div
                key={dbType}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="rounded-xl bg-surface-800/50 border border-surface-700/50 p-4 space-y-4"
              >
                <div className="flex items-center gap-2">
                  {selectedDb && <selectedDb.icon size={16} className={selectedDb.color} />}
                  <h4 className="text-sm font-medium text-surface-200">
                    {selectedDb?.label} Configuration
                  </h4>
                </div>

                {/* JSON Configuration */}
                {dbType === 'json' && (
                  <>
                    <FormGroup>
                      <Label>File Path</Label>
                      <Input
                        value={jsonFilePath}
                        onChange={(e) => setJsonFilePath(e.target.value)}
                        placeholder="./data/db.json"
                        className="font-mono text-sm"
                      />
                    </FormGroup>
                    <FormGroup>
                      <Label>Collections (comma-separated)</Label>
                      <Input
                        value={jsonCollections}
                        onChange={(e) => setJsonCollections(e.target.value)}
                        placeholder="users, products, orders"
                      />
                    </FormGroup>
                  </>
                )}

                {/* SQLite Configuration */}
                {dbType === 'sqlite' && (
                  <FormGroup>
                    <Label>Database File Path</Label>
                    <Input
                      value={sqliteFilePath}
                      onChange={(e) => setSqliteFilePath(e.target.value)}
                      placeholder="./data/database.sqlite"
                      className="font-mono text-sm"
                    />
                  </FormGroup>
                )}

                {/* MongoDB Configuration */}
                {dbType === 'mongodb' && (
                  <>
                    <FormGroup>
                      <Label>Connection String</Label>
                      <Input
                        value={mongoConnectionString}
                        onChange={(e) => setMongoConnectionString(e.target.value)}
                        placeholder="mongodb://localhost:27017"
                        className="font-mono text-sm"
                      />
                    </FormGroup>
                    <FormGroup>
                      <Label>Database Name</Label>
                      <Input
                        value={mongoDatabase}
                        onChange={(e) => setMongoDatabase(e.target.value)}
                        placeholder="mockdb"
                      />
                    </FormGroup>
                  </>
                )}

                {/* MySQL/PostgreSQL Configuration */}
                {(dbType === 'mysql' || dbType === 'postgresql') && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <FormGroup>
                        <Label>Host</Label>
                        <Input
                          value={sqlHost}
                          onChange={(e) => setSqlHost(e.target.value)}
                          placeholder="localhost"
                        />
                      </FormGroup>
                      <FormGroup>
                        <Label>Port</Label>
                        <Input
                          type="number"
                          value={sqlPort}
                          onChange={(e) => setSqlPort(parseInt(e.target.value) || 0)}
                        />
                      </FormGroup>
                    </div>
                    <FormGroup>
                      <Label>Database Name</Label>
                      <Input
                        value={sqlDatabase}
                        onChange={(e) => setSqlDatabase(e.target.value)}
                        placeholder="mockdb"
                      />
                    </FormGroup>
                    <div className="grid grid-cols-2 gap-4">
                      <FormGroup>
                        <Label>Username</Label>
                        <Input
                          value={sqlUsername}
                          onChange={(e) => setSqlUsername(e.target.value)}
                          placeholder="root"
                        />
                      </FormGroup>
                      <FormGroup>
                        <Label>Password</Label>
                        <Input
                          type="password"
                          value={sqlPassword}
                          onChange={(e) => setSqlPassword(e.target.value)}
                          placeholder="••••••••"
                        />
                      </FormGroup>
                    </div>
                  </>
                )}
              </motion.div>
            </AnimatePresence>

            <div className="flex items-center justify-between pt-2">
              <div>
                <p className="text-sm font-medium text-surface-200">Enable Connection</p>
                <p className="text-xs text-surface-500">Activate this database connection</p>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit">
              {isEditing ? 'Save Changes' : 'Add Connection'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
