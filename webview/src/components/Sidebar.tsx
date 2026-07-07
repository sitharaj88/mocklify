import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../store';
import {
  LayoutDashboard,
  Server,
  Route,
  Database,
  ScrollText,
  Settings,
  Zap,
  ChevronLeft,
  ChevronRight,
  Import,
  Keyboard,
} from 'lucide-react';
import { cn, extensionVersion } from '../lib/utils';
import { Badge, StatusDot, Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './ui';

type NavItemId = 'dashboard' | 'servers' | 'routes' | 'databases' | 'logs' | 'settings';

interface NavItem {
  id: NavItemId;
  label: string;
  icon: typeof LayoutDashboard;
  badge?: number;
}

interface SidebarProps {
  onImportClick?: () => void;
  onShortcutsClick?: () => void;
}

const NARROW_BREAKPOINT = 768;

// The webview can live in a narrow split-editor pane: below the breakpoint
// the sidebar automatically becomes an icon rail (manual toggle still works).
function useIsNarrow() {
  const [isNarrow, setIsNarrow] = useState(
    () => window.innerWidth < NARROW_BREAKPOINT
  );

  useEffect(() => {
    const check = () => setIsNarrow(window.innerWidth < NARROW_BREAKPOINT);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  return isNarrow;
}

export function Sidebar({ onImportClick, onShortcutsClick }: SidebarProps) {
  const { activeView, setActiveView, servers, serverStates } = useStore();
  const isNarrow = useIsNarrow();
  // null = follow the automatic width-based behavior
  const [userCollapsed, setUserCollapsed] = useState<boolean | null>(null);

  // Crossing the breakpoint resets any manual override so auto-collapse resumes
  useEffect(() => {
    setUserCollapsed(null);
  }, [isNarrow]);

  const collapsed = userCollapsed ?? isNarrow;

  const runningCount = Object.values(serverStates).filter(
    (s) => s.status === 'running'
  ).length;

  const navItems: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'servers', label: 'Servers', icon: Server, badge: runningCount || undefined },
    { id: 'routes', label: 'Routes', icon: Route },
    { id: 'databases', label: 'Databases', icon: Database },
    { id: 'logs', label: 'Logs', icon: ScrollText },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const actionButtonClass = cn(
    'focus-ring w-full flex items-center gap-2 px-3 py-2 rounded-md text-surface-400 hover:bg-surface-800/50 hover:text-surface-200 transition-colors duration-150',
    collapsed && 'justify-center px-0'
  );

  return (
    <TooltipProvider delayDuration={0}>
      <motion.aside
        initial={false}
        animate={{ width: collapsed ? 64 : 240 }}
        transition={{ duration: 0.2, ease: 'easeInOut' }}
        className="h-screen flex flex-col flex-shrink-0 bg-surface-900 border-r border-surface-700 overflow-hidden"
      >
        {/* Logo */}
        <div
          className={cn(
            'h-16 flex items-center border-b border-surface-700 flex-shrink-0',
            collapsed ? 'justify-center px-2' : 'px-4'
          )}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative w-9 h-9 flex-shrink-0">
              <div className="absolute inset-0 bg-brand-500/30 blur-lg rounded-full" />
              <div className="relative w-full h-full rounded-lg bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center shadow-lg shadow-brand-500/25">
                <Zap size={18} className="text-white" />
              </div>
            </div>
            <AnimatePresence>
              {!collapsed && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="min-w-0"
                >
                  <h1 className="font-bold text-surface-50 whitespace-nowrap">Mocklify</h1>
                  <p className="text-xs text-surface-500 whitespace-nowrap">
                    {extensionVersion() ? `v${extensionVersion()}` : ''}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 px-3 overflow-y-auto overflow-x-hidden">
          <ul className="space-y-1">
            {navItems.map((item) => {
              const isActive = activeView === item.id;
              const Icon = item.icon;

              const button = (
                <button
                  onClick={() => setActiveView(item.id)}
                  aria-label={item.label}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'focus-ring w-full relative flex items-center gap-3 py-2.5 rounded-md text-sm font-medium transition-colors duration-150',
                    collapsed ? 'justify-center px-0' : 'px-3',
                    isActive
                      ? 'text-brand-700 dark:text-brand-400'
                      : 'text-surface-400 hover:bg-surface-800/50 hover:text-surface-200'
                  )}
                >
                  {isActive && (
                    <motion.div
                      layoutId="activeNav"
                      className="absolute inset-0 bg-brand-500/10 rounded-md border border-brand-500/20"
                      transition={{ duration: 0.15, ease: 'easeOut' }}
                    />
                  )}
                  <span className="relative flex items-center gap-3 min-w-0">
                    <Icon size={18} className="flex-shrink-0" />
                    {!collapsed && (
                      <span className="whitespace-nowrap overflow-hidden">{item.label}</span>
                    )}
                  </span>
                  {item.badge != null && !collapsed && (
                    <Badge variant="default" className="relative ml-auto">
                      {item.badge}
                    </Badge>
                  )}
                  {item.id === 'servers' && runningCount > 0 && (
                    <span
                      className={cn(
                        'relative',
                        collapsed ? 'absolute top-1 right-1.5' : 'ml-1'
                      )}
                    >
                      <StatusDot status="running" size="sm" />
                    </span>
                  )}
                </button>
              );

              if (collapsed) {
                return (
                  <li key={item.id}>
                    <Tooltip>
                      <TooltipTrigger asChild>{button}</TooltipTrigger>
                      <TooltipContent side="right">
                        <p>{item.label}</p>
                      </TooltipContent>
                    </Tooltip>
                  </li>
                );
              }

              return <li key={item.id}>{button}</li>;
            })}
          </ul>
        </nav>

        {/* Quick actions + collapse toggle */}
        <div className="border-t border-surface-700 flex-shrink-0">
          <div className="p-3 space-y-1">
            {onImportClick && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={onImportClick} aria-label="Import OpenAPI/Postman" className={actionButtonClass}>
                    <Import size={18} className="flex-shrink-0" />
                    {!collapsed && <span className="text-sm">Import</span>}
                  </button>
                </TooltipTrigger>
                {collapsed && (
                  <TooltipContent side="right">
                    <p>Import OpenAPI/Postman</p>
                  </TooltipContent>
                )}
              </Tooltip>
            )}
            {onShortcutsClick && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={onShortcutsClick} aria-label="Keyboard shortcuts" className={actionButtonClass}>
                    <Keyboard size={18} className="flex-shrink-0" />
                    {!collapsed && <span className="text-sm">Shortcuts</span>}
                  </button>
                </TooltipTrigger>
                {collapsed && (
                  <TooltipContent side="right">
                    <p>Keyboard Shortcuts</p>
                  </TooltipContent>
                )}
              </Tooltip>
            )}
          </div>

          <div className="p-3 border-t border-surface-700">
            <button
              onClick={() => setUserCollapsed(!collapsed)}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="focus-ring w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-surface-500 hover:bg-surface-800/50 hover:text-surface-300 transition-colors duration-150"
            >
              {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
              {!collapsed && <span className="text-sm">Collapse</span>}
            </button>
          </div>
        </div>
      </motion.aside>
    </TooltipProvider>
  );
}
