import React, { useState } from 'react';
import { AlertCircle, Import } from 'lucide-react';
import { useStore, postMessage } from '../store';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  Button,
  Textarea,
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

interface ImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ImportType = 'openapi' | 'postman';

export const ImportModal: React.FC<ImportModalProps> = ({ open, onOpenChange }) => {
  const { selectedServerId, servers } = useStore();
  const [importType, setImportType] = useState<ImportType>('openapi');
  const [content, setContent] = useState('');
  const [targetServerId, setTargetServerId] = useState(selectedServerId || '');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleImport = async () => {
    if (!content.trim()) {
      setError('Please paste the file content');
      return;
    }

    if (!targetServerId) {
      setError('Please select a server');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      postMessage({
        type: importType === 'openapi' ? 'importOpenApi' : 'importPostman',
        serverId: targetServerId,
        data: { content },
      });

      onOpenChange(false);
      setContent('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setContent(event.target?.result as string);
    };
    reader.onerror = () => {
      setError('Failed to read file');
    };
    reader.readAsText(file);
  };

  const importTypes: { value: ImportType; title: string; detail: string }[] = [
    {
      value: 'openapi',
      title: 'OpenAPI / Swagger',
      detail: 'OpenAPI 3.0 or Swagger 2.0 spec',
    },
    {
      value: 'postman',
      title: 'Postman Collection',
      detail: 'Postman Collection v2.1',
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-brand-500/10">
              <Import className="w-5 h-5 text-brand-600 dark:text-brand-400" />
            </div>
            <div>
              <DialogTitle>Import Routes</DialogTitle>
              <DialogDescription>
                Bring existing API definitions into a server
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <DialogBody className="space-y-5">
          {/* Import Type Selection */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {importTypes.map((t) => {
              const isSelected = importType === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setImportType(t.value)}
                  className={cn(
                    'focus-ring flex flex-col items-start gap-0.5 px-4 py-3 rounded-lg border-2 text-left transition-colors duration-150',
                    isSelected
                      ? 'border-brand-500 bg-brand-500/10'
                      : 'border-surface-700 hover:border-surface-600 hover:bg-surface-800/50'
                  )}
                >
                  <span
                    className={cn(
                      'text-sm font-medium',
                      isSelected ? 'text-brand-700 dark:text-brand-400' : 'text-surface-200'
                    )}
                  >
                    {t.title}
                  </span>
                  <span className="text-xs text-surface-500">{t.detail}</span>
                </button>
              );
            })}
          </div>

          <FormGroup>
            <Label required>Target Server</Label>
            <Select value={targetServerId} onValueChange={setTargetServerId}>
              <SelectTrigger>
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
          </FormGroup>

          <FormGroup>
            <Label>Upload File</Label>
            <input
              type="file"
              accept={importType === 'openapi' ? '.json,.yaml,.yml' : '.json'}
              onChange={handleFileUpload}
              className="focus-ring w-full px-3 py-2 rounded-md border border-surface-600 bg-surface-800/80 text-sm text-surface-100 transition-colors duration-150 file:mr-4 file:py-1 file:px-3 file:rounded file:border-0 file:bg-brand-500 file:text-white file:cursor-pointer"
            />
            <FormHint>Or paste the content below</FormHint>
          </FormGroup>

          <FormGroup>
            <Label>Content</Label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={
                importType === 'openapi'
                  ? 'Paste your OpenAPI/Swagger JSON or YAML here...'
                  : 'Paste your Postman Collection JSON here...'
              }
              rows={10}
              className="font-mono text-sm resize-none"
            />
          </FormGroup>

          {error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/25 text-sm text-red-700 dark:text-red-400">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={isLoading || !content.trim() || !targetServerId}
          >
            {isLoading ? 'Importing...' : 'Import Routes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
