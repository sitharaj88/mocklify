import { useStore } from '../store';
import {
  LayoutDashboard,
  Server,
  Route,
  Database,
  ScrollText,
  Settings,
  Zap,
} from 'lucide-react';

export function Sidebar() {
  const { activeView, setActiveView, servers, serverStates } = useStore();

  const runningCount = Object.values(serverStates).filter(
    (s) => s.status === 'running'
  ).length;

  const navItems: Array<{
    id: 'dashboard' | 'servers' | 'routes' | 'databases' | 'logs' | 'settings';
    label: string;
    icon: typeof LayoutDashboard;
    badge?: number;
  }> = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'servers', label: 'Servers', icon: Server, badge: servers.length },
    { id: 'routes', label: 'Routes', icon: Route },
    { id: 'databases', label: 'Databases', icon: Database },
    { id: 'logs', label: 'Request Logs', icon: ScrollText },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <Zap size={24} />
          <span>Mock Server</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-section-title">Navigation</div>
        {navItems.map((item) => (
          <div
            key={item.id}
            className={`nav-item ${activeView === item.id ? 'active' : ''}`}
            onClick={() => setActiveView(item.id)}
          >
            <item.icon size={18} />
            <span>{item.label}</span>
            {item.badge !== undefined && item.badge > 0 && (
              <span className="badge badge-neutral" style={{ marginLeft: 'auto' }}>
                {item.badge}
              </span>
            )}
          </div>
        ))}
      </nav>

      <div style={{ padding: '16px', borderTop: '1px solid var(--border-color)' }}>
        <div className="status-indicator">
          <span
            className={`status-dot ${runningCount > 0 ? 'running' : 'stopped'}`}
          />
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            {runningCount} server{runningCount !== 1 ? 's' : ''} running
          </span>
        </div>
      </div>
    </aside>
  );
}
