import { motion } from 'framer-motion';
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
  Info,
} from 'lucide-react';
import type { DatabaseConnection } from '../types';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  EmptyState,
} from './ui';
import { cn } from '../lib/utils';

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 },
};

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

  const getDbGradient = (type: string) => {
    switch (type) {
      case 'json':
        return 'from-amber-500 to-amber-600';
      case 'sqlite':
        return 'from-blue-500 to-blue-600';
      case 'mongodb':
        return 'from-emerald-500 to-emerald-600';
      case 'mysql':
        return 'from-orange-500 to-orange-600';
      case 'postgresql':
        return 'from-indigo-500 to-indigo-600';
      default:
        return 'from-surface-500 to-surface-600';
    }
  };

  return (
    <>
      <header className="content-header">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-purple-500/10">
            <Database className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-surface-50">Database Connections</h1>
            <p className="text-sm text-surface-400">{databases.length} connections</p>
          </div>
        </div>
        <Button onClick={handleCreateDatabase}>
          <Plus size={16} />
          New Connection
        </Button>
      </header>

      <div className="content-body space-y-6">
        {databases.length === 0 ? (
          <EmptyState
            icon={Database}
            title="No database connections"
            description="Connect a database to use dynamic data in your mock responses"
            action={{
              label: 'Add Connection',
              onClick: handleCreateDatabase,
            }}
          />
        ) : (
          <>
            {/* Info Banner */}
            <Card className="bg-blue-500/5 border-blue-500/20">
              <CardContent className="p-4 flex gap-3">
                <Info className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-surface-100">Database Integration</p>
                  <p className="text-sm text-surface-400 mt-1">
                    Connect your mock server to databases for dynamic responses. Use JSON files for
                    simple scenarios or connect to real databases for complex testing.
                  </p>
                </div>
              </CardContent>
            </Card>

            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="show"
              className="grid grid-cols-1 lg:grid-cols-2 gap-4"
            >
              {databases.map((database) => (
                <motion.div key={database.id} variants={itemVariants}>
                  <Card hover className="overflow-hidden">
                    <CardContent className="p-5">
                      {/* Header */}
                      <div className="flex items-start gap-4 mb-4">
                        <div className={cn(
                          'p-3 rounded-xl bg-gradient-to-br text-white',
                          getDbGradient(database.type)
                        )}>
                          {getDbIcon(database.type)}
                        </div>
                        <div className="flex-1">
                          <h3 className="font-semibold text-surface-50">{database.name}</h3>
                          <p className="text-sm text-surface-400">{getDbLabel(database.type)}</p>
                        </div>
                        <Badge variant={database.enabled ? 'success' : 'default'}>
                          {database.enabled ? 'Enabled' : 'Disabled'}
                        </Badge>
                      </div>

                      {/* Connection Details */}
                      <div className="p-3 rounded-lg bg-surface-900/50 border border-surface-700/50 mb-4 font-mono text-xs text-surface-300">
                        {database.type === 'json' && (
                          <div>
                            <span className="text-surface-500">File: </span>
                            {(database.config as any).filePath}
                          </div>
                        )}
                        {database.type === 'sqlite' && (
                          <div>
                            <span className="text-surface-500">File: </span>
                            {(database.config as any).filePath}
                          </div>
                        )}
                        {database.type === 'mongodb' && (
                          <div>
                            <span className="text-surface-500">Database: </span>
                            {(database.config as any).database}
                          </div>
                        )}
                        {(database.type === 'mysql' || database.type === 'postgresql') && (
                          <div>
                            <span className="text-surface-500">Host: </span>
                            {(database.config as any).host}:{(database.config as any).port}
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleTestConnection(database.id)}
                        >
                          <TestTube size={14} />
                          Test Connection
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEditDatabase(database)}
                        >
                          <Edit size={14} />
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteDatabase(database.id)}
                          className="hover:text-red-400"
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </motion.div>
          </>
        )}

        {/* Supported Databases */}
        <Card>
          <CardHeader>
            <CardTitle>Supported Databases</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              {[
                { type: 'json', name: 'JSON File', desc: 'Local JSON storage' },
                { type: 'sqlite', name: 'SQLite', desc: 'Embedded SQL database' },
                { type: 'mongodb', name: 'MongoDB', desc: 'NoSQL database' },
                { type: 'mysql', name: 'MySQL', desc: 'SQL database' },
                { type: 'postgresql', name: 'PostgreSQL', desc: 'Advanced SQL' },
              ].map((db) => (
                <div
                  key={db.type}
                  className="flex items-center gap-3 p-3 rounded-lg bg-surface-800/50 border border-surface-700/50"
                >
                  <div className={cn(
                    'p-2 rounded-lg bg-gradient-to-br text-white',
                    getDbGradient(db.type)
                  )}>
                    {getDbIcon(db.type)}
                  </div>
                  <div>
                    <p className="font-medium text-sm text-surface-100">{db.name}</p>
                    <p className="text-xs text-surface-500">{db.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
