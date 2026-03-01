import PageHeader from '../components/PageHeader';

const shortcuts = {
  navigation: [
    { keys: ['Cmd/Ctrl', '1'], action: 'Go to Dashboard' },
    { keys: ['Cmd/Ctrl', '2'], action: 'Go to Servers' },
    { keys: ['Cmd/Ctrl', '3'], action: 'Go to Routes' },
    { keys: ['Cmd/Ctrl', '4'], action: 'Go to Databases' },
    { keys: ['Cmd/Ctrl', '5'], action: 'Go to Logs' },
    { keys: ['Cmd/Ctrl', '6'], action: 'Go to Settings' },
  ],
  actions: [
    { keys: ['Cmd/Ctrl', 'K'], action: 'Focus search' },
    { keys: ['Cmd/Ctrl', 'N'], action: 'Create new item' },
    { keys: ['Cmd/Ctrl', 'S'], action: 'Save current item' },
    { keys: ['Cmd/Ctrl', 'Shift', 'S'], action: 'Start selected server' },
    { keys: ['Cmd/Ctrl', 'Shift', 'X'], action: 'Stop selected server' },
    { keys: ['Cmd/Ctrl', 'Shift', 'R'], action: 'Restart selected server' },
    { keys: ['Cmd/Ctrl', 'Shift', 'L'], action: 'Clear logs' },
    { keys: ['Cmd/Ctrl', 'Shift', 'E'], action: 'Export logs' },
  ],
  selection: [
    { keys: ['Alt', '1-9'], action: 'Select server by number' },
    { keys: ['↑', '↓'], action: 'Navigate list items' },
    { keys: ['Enter'], action: 'Select / Open item' },
    { keys: ['Delete'], action: 'Delete selected item' },
  ],
  modal: [
    { keys: ['Escape'], action: 'Close modal / Clear search' },
    { keys: ['Tab'], action: 'Next field' },
    { keys: ['Shift', 'Tab'], action: 'Previous field' },
    { keys: ['Cmd/Ctrl', 'Enter'], action: 'Submit form' },
  ],
};

function KeyCombo({ keys }: { keys: string[] }) {
  return (
    <div className="flex gap-1">
      {keys.map((key, index) => (
        <span key={index} className="flex items-center">
          <kbd className="px-2 py-1 text-xs font-mono theme-bg-secondary border theme-border rounded theme-text">
            {key}
          </kbd>
          {index < keys.length - 1 && <span className="mx-1 theme-text-muted">+</span>}
        </span>
      ))}
    </div>
  );
}

function ShortcutTable({ title, shortcuts }: { title: string; shortcuts: { keys: string[]; action: string }[] }) {
  return (
    <div className="mb-8">
      <h2 className="text-xl font-semibold mb-4">{title}</h2>
      <div className="theme-bg-card rounded-xl border theme-border overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b theme-border">
              <th className="text-left px-4 py-3 text-sm theme-text-secondary w-1/2">Shortcut</th>
              <th className="text-left px-4 py-3 text-sm theme-text-secondary">Action</th>
            </tr>
          </thead>
          <tbody>
            {shortcuts.map((shortcut, index) => (
              <tr key={index} className="border-b theme-border last:border-0">
                <td className="px-4 py-3">
                  <KeyCombo keys={shortcut.keys} />
                </td>
                <td className="px-4 py-3 theme-text">{shortcut.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Shortcuts() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Keyboard Shortcuts"
        description="Speed up your workflow with these keyboard shortcuts."
      />

      <ShortcutTable title="Navigation" shortcuts={shortcuts.navigation} />
      <ShortcutTable title="Actions" shortcuts={shortcuts.actions} />
      <ShortcutTable title="Selection" shortcuts={shortcuts.selection} />
      <ShortcutTable title="Modals & Forms" shortcuts={shortcuts.modal} />

      {/* Tips */}
      <div className="bg-gradient-to-r from-purple-500/10 to-cyan-500/10 rounded-xl border border-purple-500/20 p-6">
        <h2 className="text-xl font-semibold mb-4">Tips</h2>
        <ul className="space-y-3 theme-text">
          <li className="flex gap-3">
            <span className="text-purple-400">•</span>
            Use <kbd className="px-2 py-0.5 text-xs font-mono theme-bg-secondary border theme-border rounded">Cmd/Ctrl + K</kbd> to quickly search for routes, servers, or logs
          </li>
          <li className="flex gap-3">
            <span className="text-purple-400">•</span>
            Number shortcuts (<kbd className="px-2 py-0.5 text-xs font-mono theme-bg-secondary border theme-border rounded">Alt + 1-9</kbd>) work in the server list
          </li>
          <li className="flex gap-3">
            <span className="text-purple-400">•</span>
            Press <kbd className="px-2 py-0.5 text-xs font-mono theme-bg-secondary border theme-border rounded">Escape</kbd> twice to close nested modals
          </li>
          <li className="flex gap-3">
            <span className="text-purple-400">•</span>
            All shortcuts work in both light and dark themes
          </li>
        </ul>
      </div>

      {/* VS Code Commands */}
      <div>
        <h2 className="text-xl font-semibold mb-4">VS Code Commands</h2>
        <p className="theme-text-secondary mb-4">
          Access all Mocklify commands from the Command Palette (<kbd className="px-2 py-0.5 text-xs font-mono theme-bg-secondary border theme-border rounded">Cmd/Ctrl + Shift + P</kbd>):
        </p>
        <div className="theme-bg-card rounded-xl border theme-border p-4">
          <ul className="space-y-2 theme-text font-mono text-sm">
            <li>Mocklify: Create Server</li>
            <li>Mocklify: Add Route</li>
            <li>Mocklify: Start Server</li>
            <li>Mocklify: Stop Server</li>
            <li>Mocklify: Start All Servers</li>
            <li>Mocklify: Stop All Servers</li>
            <li>Mocklify: Open Dashboard</li>
            <li>Mocklify: Import from OpenAPI</li>
            <li>Mocklify: Import from Postman</li>
            <li>Mocklify: Export Logs</li>
            <li>Mocklify: Clear Logs</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
