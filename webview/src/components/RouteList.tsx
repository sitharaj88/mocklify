import { useState } from 'react';
import { motion } from 'framer-motion';
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
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  Badge,
  getMethodVariant,
  getStatusVariant,
  EmptyState,
  ConfirmDialog,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui';
import { cn } from '../lib/utils';

export function RouteList() {
  const {
    servers,
    selectedServerId,
    setSelectedServerId,
    setShowRouteModal,
    setEditingRoute,
  } = useStore();

  const [deleteRouteId, setDeleteRouteId] = useState<string | null>(null);

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

  const handleDeleteRoute = () => {
    if (!selectedServerId || !deleteRouteId) return;
    postMessage({
      type: 'deleteRoute',
      serverId: selectedServerId,
      routeId: deleteRouteId,
    });
    setDeleteRouteId(null);
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

  const formatMethod = (method: string | string[]): string => {
    if (Array.isArray(method)) {
      return method.join(', ');
    }
    return method;
  };

  const getFirstMethod = (method: string | string[]): string => {
    return Array.isArray(method) ? method[0] : method;
  };

  return (
    <>
      <header className="content-header">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 w-full sm:w-auto">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/10">
              <Route className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-semibold text-surface-50">Routes</h1>
              <p className="text-sm text-surface-400">Manage API endpoints</p>
            </div>
          </div>

          {/* Server Selector */}
          <Select
            value={selectedServerId || ''}
            onValueChange={(value) => setSelectedServerId(value || null)}
          >
            <SelectTrigger className="w-full sm:w-[220px]">
              <SelectValue placeholder="Select a server..." />
            </SelectTrigger>
            <SelectContent>
              {servers.map((server) => (
                <SelectItem key={server.id} value={server.id}>
                  {server.name} (:{server.port})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button onClick={handleCreateRoute} disabled={!selectedServerId} className="w-full sm:w-auto">
          <Plus size={16} />
          New Route
        </Button>
      </header>

      <div className="content-body">
        {!selectedServerId ? (
          <EmptyState
            icon={Server}
            title="Select a server"
            description="Choose a server from the dropdown to manage its routes"
          />
        ) : routes.length === 0 ? (
          <EmptyState
            icon={Route}
            title="No routes yet"
            description={`Create your first route for ${selectedServer?.name}`}
            action={{
              label: 'Create Route',
              onClick: handleCreateRoute,
            }}
          />
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>
                  {selectedServer?.name} Routes ({routes.length})
                </CardTitle>
              </CardHeader>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]">Status</TableHead>
                    <TableHead className="w-[100px]">Method</TableHead>
                    <TableHead>Path</TableHead>
                    <TableHead className="w-[150px]">Name</TableHead>
                    <TableHead className="w-[100px]">Type</TableHead>
                    <TableHead className="w-[80px]">Code</TableHead>
                    <TableHead className="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {routes.map((route) => (
                    <TableRow
                      key={route.id}
                      className={cn(!route.enabled && 'opacity-50')}
                    >
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handleToggleRoute(route)}
                          title={route.enabled ? 'Disable route' : 'Enable route'}
                        >
                          {route.enabled ? (
                            <ToggleRight size={20} className="text-emerald-400" />
                          ) : (
                            <ToggleLeft size={20} />
                          )}
                        </Button>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getMethodVariant(getFirstMethod(route.method))}>
                          {formatMethod(route.method)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <code className="text-xs font-mono text-surface-300">
                          {route.path}
                        </code>
                      </TableCell>
                      <TableCell className="text-surface-400">
                        {route.name}
                      </TableCell>
                      <TableCell>
                        <Badge variant="default">{route.response.type}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getStatusVariant(route.response.statusCode)}>
                          {route.response.statusCode}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleEditRoute(route)}
                            title="Edit route"
                          >
                            <Edit size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setDeleteRouteId(route.id)}
                            title="Delete route"
                            className="hover:text-red-400"
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </motion.div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteRouteId}
        onOpenChange={(open) => !open && setDeleteRouteId(null)}
        title="Delete Route"
        description="Are you sure you want to delete this route? This action cannot be undone."
        confirmLabel="Delete"
        onConfirm={handleDeleteRoute}
      />
    </>
  );
}
