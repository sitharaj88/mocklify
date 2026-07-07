import React, { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useStore, postMessage } from '../store';

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

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-surface-800 rounded-xl shadow-xl border border-surface-700 p-6 z-50">
          <Dialog.Title className="text-xl font-semibold text-surface-100 mb-4">
            Import Routes
          </Dialog.Title>

          <div className="space-y-4">
            {/* Import Type Selection */}
            <div className="flex gap-2">
              <button
                onClick={() => setImportType('openapi')}
                className={`flex-1 px-4 py-3 rounded-lg border transition-colors ${
                  importType === 'openapi'
                    ? 'bg-brand-600 text-white border-brand-500'
                    : 'bg-surface-700 text-surface-200 border-surface-700 hover:bg-surface-600'
                }`}
              >
                <div className="font-medium">OpenAPI / Swagger</div>
                <div className="text-sm opacity-80">Import from OpenAPI 3.0 or Swagger 2.0 spec</div>
              </button>
              <button
                onClick={() => setImportType('postman')}
                className={`flex-1 px-4 py-3 rounded-lg border transition-colors ${
                  importType === 'postman'
                    ? 'bg-brand-600 text-white border-brand-500'
                    : 'bg-surface-700 text-surface-200 border-surface-700 hover:bg-surface-600'
                }`}
              >
                <div className="font-medium">Postman Collection</div>
                <div className="text-sm opacity-80">Import from Postman Collection v2.1</div>
              </button>
            </div>

            {/* Target Server */}
            <div>
              <label className="block text-sm font-medium text-surface-100 mb-1">
                Target Server
              </label>
              <select
                value={targetServerId}
                onChange={(e) => setTargetServerId(e.target.value)}
                className="w-full px-3 py-2 bg-surface-900/60 border border-surface-700 rounded-lg text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
              >
                <option value="">Select a server...</option>
                {servers.map((server) => (
                  <option key={server.id} value={server.id}>
                    {server.name} (:{server.port})
                  </option>
                ))}
              </select>
            </div>

            {/* File Upload */}
            <div>
              <label className="block text-sm font-medium text-surface-100 mb-1">
                Upload File
              </label>
              <input
                type="file"
                accept={importType === 'openapi' ? '.json,.yaml,.yml' : '.json'}
                onChange={handleFileUpload}
                className="w-full px-3 py-2 bg-surface-900/60 border border-surface-700 rounded-lg text-surface-100 file:mr-4 file:py-1 file:px-3 file:rounded-md file:border-0 file:bg-brand-600 file:text-white file:cursor-pointer"
              />
            </div>

            {/* Or paste content */}
            <div className="relative">
              <div className="absolute inset-x-0 top-0 flex items-center">
                <div className="flex-1 border-t border-surface-700" />
                <span className="px-2 text-sm text-surface-400 bg-surface-800">or paste content</span>
                <div className="flex-1 border-t border-surface-700" />
              </div>
            </div>

            {/* Content Textarea */}
            <div className="pt-4">
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={
                  importType === 'openapi'
                    ? 'Paste your OpenAPI/Swagger JSON or YAML here...'
                    : 'Paste your Postman Collection JSON here...'
                }
                rows={10}
                className="w-full px-3 py-2 bg-surface-900/60 border border-surface-700 rounded-lg text-surface-100 font-mono text-sm placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500/50 resize-none"
              />
            </div>

            {/* Error */}
            {error && (
              <div className="px-3 py-2 bg-red-500/10 border border-destructive/20 rounded-lg text-red-400 text-sm">
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Dialog.Close asChild>
                <button className="px-4 py-2 bg-surface-700 text-surface-200 rounded-lg hover:bg-surface-600 transition-colors">
                  Cancel
                </button>
              </Dialog.Close>
              <button
                onClick={handleImport}
                disabled={isLoading || !content.trim() || !targetServerId}
                className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Importing...' : 'Import Routes'}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
