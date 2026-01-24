import { useEffect } from 'react';
import { useStore, postMessage } from '../store';

interface ShortcutConfig {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: () => void;
  description: string;
}

export function useKeyboardShortcuts() {
  const {
    activeView,
    setActiveView,
    setShowServerModal,
    setShowRouteModal,
    setShowDatabaseModal,
    selectedServerId,
    servers,
    setSelectedServerId,
  } = useStore();

  useEffect(() => {
    const shortcuts: ShortcutConfig[] = [
      // Navigation
      {
        key: '1',
        meta: true,
        action: () => setActiveView('dashboard'),
        description: 'Go to Dashboard',
      },
      {
        key: '2',
        meta: true,
        action: () => setActiveView('servers'),
        description: 'Go to Servers',
      },
      {
        key: '3',
        meta: true,
        action: () => setActiveView('routes'),
        description: 'Go to Routes',
      },
      {
        key: '4',
        meta: true,
        action: () => setActiveView('databases'),
        description: 'Go to Databases',
      },
      {
        key: '5',
        meta: true,
        action: () => setActiveView('logs'),
        description: 'Go to Logs',
      },
      {
        key: '6',
        meta: true,
        action: () => setActiveView('settings'),
        description: 'Go to Settings',
      },

      // Create actions
      {
        key: 'n',
        meta: true,
        action: () => {
          if (activeView === 'servers') {
            setShowServerModal(true);
          } else if (activeView === 'routes' && selectedServerId) {
            setShowRouteModal(true);
          } else if (activeView === 'databases') {
            setShowDatabaseModal(true);
          }
        },
        description: 'Create new item',
      },

      // Quick server select (1-9)
      ...Array.from({ length: 9 }, (_, i) => ({
        key: String(i + 1),
        alt: true,
        action: () => {
          if (servers[i]) {
            setSelectedServerId(servers[i].id);
          }
        },
        description: `Select server ${i + 1}`,
      })),

      // Server controls
      {
        key: 's',
        meta: true,
        shift: true,
        action: () => {
          if (selectedServerId) {
            postMessage({ type: 'startServer', serverId: selectedServerId });
          }
        },
        description: 'Start selected server',
      },
      {
        key: 'x',
        meta: true,
        shift: true,
        action: () => {
          if (selectedServerId) {
            postMessage({ type: 'stopServer', serverId: selectedServerId });
          }
        },
        description: 'Stop selected server',
      },

      // Clear logs
      {
        key: 'l',
        meta: true,
        shift: true,
        action: () => {
          postMessage({ type: 'clearLogs', serverId: selectedServerId || undefined });
        },
        description: 'Clear logs',
      },
    ];

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        // Allow Escape to blur inputs
        if (e.key === 'Escape') {
          (e.target as HTMLElement).blur();
        }
        return;
      }

      for (const shortcut of shortcuts) {
        const ctrlMatch = shortcut.ctrl ? e.ctrlKey : true;
        const metaMatch = shortcut.meta ? e.metaKey || e.ctrlKey : true;
        const shiftMatch = shortcut.shift ? e.shiftKey : !e.shiftKey;
        const altMatch = shortcut.alt ? e.altKey : !e.altKey;
        const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase();

        // For meta shortcuts, require meta (cmd) or ctrl
        const metaOrCtrl = shortcut.meta ? e.metaKey || e.ctrlKey : true;

        if (
          keyMatch &&
          (shortcut.ctrl ? e.ctrlKey : true) &&
          metaOrCtrl &&
          shiftMatch &&
          altMatch
        ) {
          e.preventDefault();
          shortcut.action();
          break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeView,
    setActiveView,
    setShowServerModal,
    setShowRouteModal,
    setShowDatabaseModal,
    selectedServerId,
    servers,
    setSelectedServerId,
  ]);
}

export const KEYBOARD_SHORTCUTS = [
  { keys: ['⌘', '1-6'], description: 'Navigate to views' },
  { keys: ['⌘', 'K'], description: 'Focus search' },
  { keys: ['⌘', 'N'], description: 'Create new item' },
  { keys: ['⌥', '1-9'], description: 'Select server' },
  { keys: ['⌘', '⇧', 'S'], description: 'Start server' },
  { keys: ['⌘', '⇧', 'X'], description: 'Stop server' },
  { keys: ['⌘', '⇧', 'L'], description: 'Clear logs' },
  { keys: ['Esc'], description: 'Close modal / Clear search' },
];
