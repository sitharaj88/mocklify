import React, { useState } from 'react';
import { Circle } from 'lucide-react';
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
  Input,
  FormGroup,
  Label,
  FormHint,
} from './ui';

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
      <div className="p-4 bg-surface-800/50 border border-surface-700/50 rounded-lg text-center text-surface-400 text-sm">
        Start the server to enable recording
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {recordingState?.isRecording ? (
        // Recording in progress — red is a live status here, paired with
        // the pulsing dot and the "Recording" label.
        <div className="p-4 bg-red-500/10 border border-red-500/25 rounded-lg">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="relative flex-shrink-0">
                <div className="w-3 h-3 bg-red-600 rounded-full animate-pulse" />
                <div className="absolute inset-0 w-3 h-3 bg-red-600 rounded-full animate-ping" />
              </div>
              <div className="min-w-0">
                <div className="font-medium text-surface-100">Recording...</div>
                <div className="text-sm text-surface-400">
                  {recordingState.recordingCount} requests captured
                </div>
                {recordingState.targetUrl && (
                  <div className="text-xs text-surface-400 mt-1 truncate">
                    Proxying to: {recordingState.targetUrl}
                  </div>
                )}
              </div>
            </div>
            <Button variant="danger" onClick={() => setShowStopDialog(true)}>
              Stop Recording
            </Button>
          </div>
        </div>
      ) : (
        // Not recording
        <button
          onClick={() => setShowStartDialog(true)}
          className="focus-ring w-full px-4 py-3 bg-brand-500/10 border border-brand-500/20 rounded-lg hover:bg-brand-500/20 transition-colors duration-150 text-left"
        >
          <div className="flex items-center gap-3">
            <Circle className="w-5 h-5 text-brand-600 dark:text-brand-400 fill-current flex-shrink-0" />
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
      <Dialog open={showStartDialog} onOpenChange={setShowStartDialog}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Start Recording</DialogTitle>
            <DialogDescription>
              Proxy this server to a real API and capture the traffic
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <FormGroup>
              <Label required>Target URL</Label>
              <Input
                type="url"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                placeholder="https://api.example.com"
              />
              <FormHint>
                Requests will be proxied to this URL and responses will be recorded
              </FormHint>
            </FormGroup>

            <FormGroup>
              <Label>Path Filter (optional)</Label>
              <Input
                type="text"
                value={pathFilter}
                onChange={(e) => setPathFilter(e.target.value)}
                placeholder="/api/.*"
                className="font-mono"
              />
              <FormHint>Regex pattern to filter which paths to record</FormHint>
            </FormGroup>
          </DialogBody>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setShowStartDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleStartRecording} disabled={!targetUrl}>
              Start Recording
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stop Recording Dialog */}
      <Dialog open={showStopDialog} onOpenChange={setShowStopDialog}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Stop Recording</DialogTitle>
            <DialogDescription>
              {recordingState?.recordingCount || 0} requests were captured. What would
              you like to do?
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-2">
            <button
              onClick={() => handleStopRecording('generate')}
              className="focus-ring w-full px-4 py-3 bg-brand-500/10 border border-brand-500/20 rounded-lg hover:bg-brand-500/20 transition-colors duration-150 text-left"
            >
              <div className="font-medium text-surface-100">Generate Mock Routes</div>
              <div className="text-sm text-surface-400">
                Create mock routes from the recorded responses
              </div>
            </button>

            <button
              onClick={() => handleStopRecording('save')}
              className="focus-ring w-full px-4 py-3 bg-surface-800/50 border border-surface-700 rounded-lg hover:bg-surface-700/50 transition-colors duration-150 text-left"
            >
              <div className="font-medium text-surface-100">Save Recordings</div>
              <div className="text-sm text-surface-400">
                Save raw recordings to review later
              </div>
            </button>

            <button
              onClick={() => handleStopRecording('discard')}
              className="focus-ring w-full px-4 py-3 bg-red-500/10 border border-red-500/25 rounded-lg hover:bg-red-500/20 transition-colors duration-150 text-left"
            >
              <div className="font-medium text-red-700 dark:text-red-400">Discard</div>
              <div className="text-sm text-surface-400">
                Discard all recorded requests
              </div>
            </button>
          </DialogBody>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setShowStopDialog(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
