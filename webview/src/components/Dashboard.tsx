import { motion } from 'framer-motion';
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
  Zap,
} from 'lucide-react';
import { cn } from '../lib/utils';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  getMethodVariant,
  getStatusVariant,
  StatusDot,
  EmptyState,
} from './ui';

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 },
};

interface StatCardProps {
  icon: typeof Server;
  value: number;
  label: string;
  gradient: string;
  iconBg: string;
}

function StatCard({ icon: Icon, value, label, gradient, iconBg }: StatCardProps) {
  return (
    <motion.div variants={itemVariants}>
      <Card className={cn('relative overflow-hidden group', gradient)}>
        <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        <CardContent className="p-5">
          <div className="flex items-center gap-4">
            <div className={cn('p-3 rounded-xl', iconBg)}>
              <Icon className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-3xl font-bold text-surface-50">{value}</p>
              <p className="text-sm text-surface-400">{label}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

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
      {/* Header */}
      <header className="content-header">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-brand-500/10">
            <Zap className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-surface-50">Dashboard</h1>
            <p className="text-sm text-surface-400">Overview of your mock servers</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleStartAll}>
            <Play size={16} />
            Start All
          </Button>
          <Button variant="secondary" onClick={handleStopAll}>
            <Square size={16} />
            Stop All
          </Button>
          <Button onClick={handleCreateServer}>
            <Plus size={16} />
            New Server
          </Button>
        </div>
      </header>

      <div className="content-body space-y-6">
        {/* Stats Grid */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="show"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
        >
          <StatCard
            icon={Server}
            value={servers.length}
            label="Total Servers"
            gradient="bg-gradient-to-br from-blue-500/10 to-blue-600/5 border-blue-500/20"
            iconBg="bg-gradient-to-br from-blue-500 to-blue-600"
          />
          <StatCard
            icon={Activity}
            value={runningServers}
            label="Running Servers"
            gradient="bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border-emerald-500/20"
            iconBg="bg-gradient-to-br from-emerald-500 to-emerald-600"
          />
          <StatCard
            icon={Route}
            value={totalRoutes}
            label="Total Routes"
            gradient="bg-gradient-to-br from-amber-500/10 to-amber-600/5 border-amber-500/20"
            iconBg="bg-gradient-to-br from-amber-500 to-amber-600"
          />
          <StatCard
            icon={Database}
            value={totalRequests}
            label="Total Requests"
            gradient="bg-gradient-to-br from-purple-500/10 to-purple-600/5 border-purple-500/20"
            iconBg="bg-gradient-to-br from-purple-500 to-purple-600"
          />
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Servers Overview */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-4">
                <CardTitle>Servers</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveView('servers')}
                >
                  View All <ArrowRight size={14} />
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {servers.length === 0 ? (
                  <EmptyState
                    icon={Server}
                    title="No servers configured"
                    description="Create your first mock server to get started"
                    action={{
                      label: 'Create Server',
                      onClick: handleCreateServer,
                    }}
                  />
                ) : (
                  servers.slice(0, 4).map((server) => {
                    const state = serverStates[server.id];
                    const isRunning = state?.status === 'running';
                    return (
                      <motion.div
                        key={server.id}
                        whileHover={{ scale: 1.01 }}
                        className="flex items-center justify-between p-4 rounded-lg bg-surface-800/50 border border-surface-700/50 hover:border-brand-500/30 transition-all"
                      >
                        <div className="flex items-center gap-3">
                          <StatusDot status={isRunning ? 'running' : 'stopped'} size="lg" />
                          <div>
                            <p className="font-medium text-surface-100">{server.name}</p>
                            <p className="text-xs text-surface-400">
                              :{server.port} · {server.routes.length} routes
                            </p>
                          </div>
                        </div>
                        <Button
                          variant={isRunning ? 'secondary' : 'success'}
                          size="icon-sm"
                          onClick={() =>
                            postMessage({
                              type: isRunning ? 'stopServer' : 'startServer',
                              serverId: server.id,
                            })
                          }
                        >
                          {isRunning ? <Square size={14} /> : <Play size={14} />}
                        </Button>
                      </motion.div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Recent Activity */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
          >
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-4">
                <CardTitle>Recent Requests</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveView('logs')}
                >
                  View All <ArrowRight size={14} />
                </Button>
              </CardHeader>
              <CardContent>
                {recentLogs.length === 0 ? (
                  <EmptyState
                    icon={Activity}
                    title="No requests logged yet"
                    description="Start a server and make some requests to see activity here"
                  />
                ) : (
                  <div className="space-y-2">
                    {recentLogs.map((log) => (
                      <div
                        key={log.id}
                        className="flex items-center gap-3 p-3 rounded-lg bg-surface-800/30 hover:bg-surface-800/50 transition-colors"
                      >
                        <span className="text-xs text-surface-500 w-16 flex-shrink-0">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </span>
                        <Badge variant={getMethodVariant(log.request.method)}>
                          {log.request.method}
                        </Badge>
                        <span className="flex-1 text-sm text-surface-200 truncate font-mono">
                          {log.request.path}
                        </span>
                        <Badge variant={getStatusVariant(log.response.statusCode)}>
                          {log.response.statusCode}
                        </Badge>
                        <span className="text-xs text-surface-400 w-12 text-right">
                          {log.response.duration}ms
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </>
  );
}
