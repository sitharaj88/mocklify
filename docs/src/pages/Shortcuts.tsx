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
          <kbd className="px-2 py-1 text-xs font-mono bg-slate-800 border border-slate-700 rounded text-slate-300">
            {key}
          </kbd>
          {index < keys.length - 1 && <span className="mx-1 text-slate-500">+</span>}
        </span>
      ))}
    </div>
  );
}

function ShortcutTable({ title, shortcuts }: { title: string; shortcuts: { keys: string[]; action: string }[] }) {
  return (
    <div className="mb-8">
      <h2 className="text-xl font-semibold mb-4">{title}</h2>
      <div className="bg-[#1a2332] rounded-xl border border-slate-800 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="text-left px-4 py-3 text-sm text-slate-400 w-1/2">Shortcut</th>
              <th className="text-left px-4 py-3 text-sm text-slate-400">Action</th>
            </tr>
          </thead>
          <tbody>
            {shortcuts.map((shortcut, index) => (
              <tr key={index} className="border-b border-slate-800 last:border-0">
                <td className="px-4 py-3">
                  <KeyCombo keys={shortcut.keys} />
                </td>
                <td className="px-4 py-3 text-slate-300">{shortcut.action}</td>
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
        <ul className="space-y-3 text-slate-300">
          <li className="flex gap-3">
            <span className="text-purple-400">•</span>
            Use <kbd className="px-2 py-0.5 text-xs font-mono bg-slate-800 border border-slate-700 rounded">Cmd/Ctrl + K</kbd> to quickly search for routes, servers, or logs
          </li>
          <li className="flex gap-3">
            <span className="text-purple-400">•</span>
            Number shortcuts (<kbd className="px-2 py-0.5 text-xs font-mono bg-slate-800 border border-slate-700 rounded">Alt + 1-9</kbd>) work in the server list
          </li>
          <li className="flex gap-3">
            <span className="text-purple-400">•</span>
            Press <kbd className="px-2 py-0.5 text-xs font-mono bg-slate-800 border border-slate-700 rounded">Escape</kbd> twice to close nested modals
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
        <p className="text-slate-400 mb-4">
          Access all Specter commands from the Command Palette (<kbd className="px-2 py-0.5 text-xs font-mono bg-slate-800 border border-slate-700 rounded">Cmd/Ctrl + Shift + P</kbd>):
        </p>
        <div className="bg-[#1a2332] rounded-xl border border-slate-800 p-4">
          <ul className="space-y-2 text-slate-300 font-mono text-sm">
            <li>Specter: Create Server</li>
            <li>Specter: Add Route</li>
            <li>Specter: Start Server</li>
            <li>Specter: Stop Server</li>
            <li>Specter: Start All Servers</li>
            <li>Specter: Stop All Servers</li>
            <li>Specter: Open Dashboard</li>
            <li>Specter: Import from OpenAPI</li>
            <li>Specter: Import from Postman</li>
            <li>Specter: Export Logs</li>
            <li>Specter: Clear Logs</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
