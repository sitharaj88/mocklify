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
import { AiCreatePanel } from './AiCreatePanel';
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
  chip?: JSX.Element;
}

function StatCard({ icon: Icon, value, label, chip }: StatCardProps) {
  return (
    <motion.div variants={itemVariants}>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wider text-surface-400 truncate">
              {label}
            </p>
            <Icon className="w-4 h-4 text-surface-500 flex-shrink-0" />
          </div>
          <div className="mt-2 flex items-end justify-between gap-2">
            <p className="text-3xl font-bold text-surface-50 tabular-nums">{value}</p>
            {chip}
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
          <div className="p-2 rounded-md bg-brand-500/10">
            <Zap className="w-5 h-5 text-brand-600 dark:text-brand-400" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-semibold text-surface-50">Dashboard</h1>
            <p className="text-sm text-surface-400">Overview of your servers</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          <Button variant="secondary" onClick={handleStartAll} className="flex-1 sm:flex-none">
            <Play size={16} />
            <span className="hidden sm:inline">Start All</span>
            <span className="sm:hidden">Start</span>
          </Button>
          <Button variant="secondary" onClick={handleStopAll} className="flex-1 sm:flex-none">
            <Square size={16} />
            <span className="hidden sm:inline">Stop All</span>
            <span className="sm:hidden">Stop</span>
          </Button>
          <Button onClick={handleCreateServer} className="flex-1 sm:flex-none">
            <Plus size={16} />
            <span className="hidden sm:inline">New Server</span>
            <span className="sm:hidden">New</span>
          </Button>
        </div>
      </header>

      <div className="content-body space-y-6">
        {/* AI server generation */}
        <AiCreatePanel />

        {/* Stats Grid */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="show"
          className="grid grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-4 gap-4"
        >
          <StatCard icon={Server} value={servers.length} label="Servers" />
          <StatCard
            icon={Activity}
            value={runningServers}
            label="Running"
            chip={
              runningServers > 0 ? (
                <Badge variant="running" size="sm" className="mb-1 gap-1">
                  <StatusDot status="running" size="sm" pulse={false} />
                  live
                </Badge>
              ) : undefined
            }
          />
          <StatCard icon={Route} value={totalRoutes} label="Routes" />
          <StatCard icon={Database} value={totalRequests} label="Requests" />
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
                    description="Create your first server to get started"
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
                      <div
                        key={server.id}
                        className="flex items-center justify-between gap-3 p-4 rounded-lg bg-surface-800/50 border border-surface-700/50 hover:border-brand-500/30 transition-colors duration-150"
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
                          variant={isRunning ? 'secondary' : 'default'}
                          size="icon-sm"
                          title={isRunning ? 'Stop server' : 'Start server'}
                          onClick={() =>
                            postMessage({
                              type: isRunning ? 'stopServer' : 'startServer',
                              serverId: server.id,
                            })
                          }
                        >
                          {isRunning ? <Square size={14} /> : <Play size={14} />}
                        </Button>
                      </div>
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
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 rounded-lg bg-surface-800/30 hover:bg-surface-800/50 transition-colors duration-150"
                      >
                        <span className="text-xs text-surface-500 w-16 flex-shrink-0">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </span>
                        <Badge variant={getMethodVariant(log.request.method)}>
                          {log.request.method}
                        </Badge>
                        <span className="order-last w-full min-[480px]:order-none min-[480px]:w-auto min-[480px]:flex-1 text-sm text-surface-200 truncate font-mono">
                          {log.request.path}
                        </span>
                        <Badge variant={getStatusVariant(log.response.statusCode)}>
                          {log.response.statusCode}
                        </Badge>
                        <span className="text-xs text-surface-400 w-12 text-right ml-auto min-[480px]:ml-0">
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
