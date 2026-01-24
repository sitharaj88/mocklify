import { useState, useEffect } from 'react';
import { useStore, postMessage } from '../store';
import { Server, Globe, Zap, Radio } from 'lucide-react';
import type { MockServerConfig } from '../types';
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
  FormHint,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui';
import { cn } from '../lib/utils';

const protocols = [
  { value: 'http', label: 'HTTP / REST', icon: Globe, description: 'RESTful API endpoints' },
  { value: 'graphql', label: 'GraphQL', icon: Zap, description: 'GraphQL queries & mutations' },
  { value: 'websocket', label: 'WebSocket', icon: Radio, description: 'Real-time connections' },
];

export function ServerModal() {
  const { editingServer, showServerModal, setShowServerModal, setEditingServer } = useStore();

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
    <Dialog open={showServerModal} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent size="default">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-brand-500/15">
              <Server className="w-5 h-5 text-brand-400" />
            </div>
            <div>
              <DialogTitle>
                {isEditing ? 'Edit Server' : 'Create New Server'}
              </DialogTitle>
              <DialogDescription>
                {isEditing ? 'Update server configuration' : 'Configure your server settings'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-5 px-6 py-4 overflow-y-auto max-h-[60vh]">
            <FormGroup>
              <Label required>Server Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My API Server"
                autoFocus
              />
            </FormGroup>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormGroup>
                <Label required>Port</Label>
                <Input
                  type="number"
                  value={port}
                  onChange={(e) => setPort(parseInt(e.target.value) || 0)}
                  min={1}
                  max={65535}
                />
              </FormGroup>

              <FormGroup>
                <Label>Protocol</Label>
                <Select value={protocol} onValueChange={(v) => setProtocol(v as any)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {protocols.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        <div className="flex items-center gap-2">
                          <p.icon size={14} className="text-surface-400" />
                          {p.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormGroup>
            </div>

            <div className="rounded-xl bg-surface-800/50 border border-surface-700/50 p-4 space-y-4">
              <h4 className="text-sm font-medium text-surface-200">Server Settings</h4>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-surface-200">Enable CORS</p>
                  <p className="text-xs text-surface-500">Allow cross-origin requests</p>
                </div>
                <Switch
                  checked={corsEnabled}
                  onCheckedChange={setCorsEnabled}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-surface-200">Request Logging</p>
                  <p className="text-xs text-surface-500">Log all incoming requests</p>
                </div>
                <Switch
                  checked={loggingEnabled}
                  onCheckedChange={setLoggingEnabled}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit">
              {isEditing ? 'Save Changes' : 'Create Server'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
