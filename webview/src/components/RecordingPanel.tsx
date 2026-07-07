import React, { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useStore, postMessage } from '../store';

interface RecordingPanelProps {
  serverId: string;
}

export const RecordingPanel: React.FC<RecordingPanelProps> = ({ serverId }) => {
  const { recordingStates, serverStates } = useStore();
  const recordingState = recordingStates[serverId];
  const serverState = serverStates[serverId];
  const isRunning = serverState?.status === 'running';

  const [showStartDialog, setShowStartDialog] = useState(false);
  const [showStopDialog, setShowStopDialog] = useState(false);
  const [targetUrl, setTargetUrl] = useState('');
  const [pathFilter, setPathFilter] = useState('');

  const handleStartRecording = () => {
    if (!targetUrl) return;

    postMessage({
      type: 'startRecording',
      serverId,
      data: { targetUrl, pathFilter: pathFilter || undefined },
    });

    setShowStartDialog(false);
    setTargetUrl('');
    setPathFilter('');
  };

  const handleStopRecording = (action: 'generate' | 'save' | 'discard') => {
    postMessage({
      type: 'stopRecording',
      serverId,
      data: { action },
    });

    setShowStopDialog(false);
  };

  if (!isRunning) {
    return (
      <div className="p-4 bg-surface-800/50 rounded-lg text-center text-surface-400 text-sm">
        Start the server to enable recording
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {recordingState?.isRecording ? (
        // Recording in progress
        <div className="p-4 bg-red-500/10 border border-destructive/20 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-3 h-3 bg-red-600 rounded-full animate-pulse" />
                <div className="absolute inset-0 w-3 h-3 bg-red-600 rounded-full animate-ping" />
              </div>
              <div>
                <div className="font-medium text-surface-100">Recording...</div>
                <div className="text-sm text-surface-400">
                  {recordingState.recordingCount} requests captured
                </div>
                {recordingState.targetUrl && (
                  <div className="text-xs text-surface-400 mt-1">
                    Proxying to: {recordingState.targetUrl}
                  </div>
                )}
              </div>
            </div>
            <button
              onClick={() => setShowStopDialog(true)}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-500 transition-colors"
            >
              Stop Recording
            </button>
          </div>
        </div>
      ) : (
        // Not recording
        <button
          onClick={() => setShowStartDialog(true)}
          className="w-full px-4 py-3 bg-brand-500/10 border border-brand-500/20 rounded-lg hover:bg-brand-500/20 transition-colors text-left"
        >
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-brand-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" strokeWidth={2} />
              <circle cx="12" cy="12" r="4" fill="currentColor" />
            </svg>
            <div>
              <div className="font-medium text-surface-100">Start Recording</div>
              <div className="text-sm text-surface-400">
                Proxy requests to a real API and record responses
              </div>
            </div>
          </div>
        </button>
      )}

      {/* Start Recording Dialog */}
      <Dialog.Root open={showStartDialog} onOpenChange={setShowStartDialog}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-surface-800 rounded-xl shadow-xl border border-surface-700 p-6 z-50">
            <Dialog.Title className="text-lg font-semibold text-surface-100 mb-4">
              Start Recording
            </Dialog.Title>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-surface-100 mb-1">
                  Target URL *
                </label>
                <input
                  type="url"
                  value={targetUrl}
                  onChange={(e) => setTargetUrl(e.target.value)}
                  placeholder="https://api.example.com"
                  className="w-full px-3 py-2 bg-surface-900/60 border border-surface-700 rounded-lg text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                />
                <p className="text-xs text-surface-400 mt-1">
                  Requests will be proxied to this URL and responses will be recorded
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-surface-100 mb-1">
                  Path Filter (optional)
                </label>
                <input
                  type="text"
                  value={pathFilter}
                  onChange={(e) => setPathFilter(e.target.value)}
                  placeholder="/api/.*"
                  className="w-full px-3 py-2 bg-surface-900/60 border border-surface-700 rounded-lg text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                />
                <p className="text-xs text-surface-400 mt-1">
                  Regex pattern to filter which paths to record
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Dialog.Close asChild>
                  <button className="px-4 py-2 bg-surface-700 text-surface-200 rounded-lg hover:bg-surface-600 transition-colors">
                    Cancel
                  </button>
                </Dialog.Close>
                <button
                  onClick={handleStartRecording}
                  disabled={!targetUrl}
                  className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Start Recording
                </button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Stop Recording Dialog */}
      <Dialog.Root open={showStopDialog} onOpenChange={setShowStopDialog}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-surface-800 rounded-xl shadow-xl border border-surface-700 p-6 z-50">
            <Dialog.Title className="text-lg font-semibold text-surface-100 mb-4">
              Stop Recording
            </Dialog.Title>

            <p className="text-surface-400 mb-4">
              {recordingState?.recordingCount || 0} requests were captured. What would you like to do?
            </p>

            <div className="space-y-2">
              <button
                onClick={() => handleStopRecording('generate')}
                className="w-full px-4 py-3 bg-brand-500/10 border border-brand-500/20 rounded-lg hover:bg-brand-500/20 transition-colors text-left"
              >
                <div className="font-medium text-surface-100">Generate Mock Routes</div>
                <div className="text-sm text-surface-400">
                  Create mock routes from the recorded responses
                </div>
              </button>

              <button
                onClick={() => handleStopRecording('save')}
                className="w-full px-4 py-3 bg-surface-700 border border-surface-700 rounded-lg hover:bg-surface-600 transition-colors text-left"
              >
                <div className="font-medium text-surface-100">Save Recordings</div>
                <div className="text-sm text-surface-400">
                  Save raw recordings to review later
                </div>
              </button>

              <button
                onClick={() => handleStopRecording('discard')}
                className="w-full px-4 py-3 bg-red-500/10 border border-destructive/20 rounded-lg hover:bg-red-500/20 transition-colors text-left"
              >
                <div className="font-medium text-red-400">Discard</div>
                <div className="text-sm text-surface-400">
                  Discard all recorded requests
                </div>
              </button>
            </div>

            <div className="flex justify-end pt-4">
              <Dialog.Close asChild>
                <button className="px-4 py-2 text-surface-400 hover:text-surface-100 transition-colors">
                  Cancel
                </button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
};
