import { useState } from 'react';
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
} from 'lucide-react';
import { cn } from '../lib/utils';
import { Badge, StatusDot, Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './ui';

type NavItemId = 'dashboard' | 'servers' | 'routes' | 'databases' | 'logs' | 'settings';

interface NavItem {
  id: NavItemId;
  label: string;
  icon: typeof LayoutDashboard;
  badge?: number;
}

export function Sidebar() {
  const { activeView, setActiveView, servers, serverStates } = useStore();
  const [collapsed, setCollapsed] = useState(false);

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

  return (
    <TooltipProvider delayDuration={0}>
      <motion.aside
        initial={false}
        animate={{ width: collapsed ? 72 : 240 }}
        transition={{ duration: 0.2, ease: 'easeInOut' }}
        className="h-screen flex flex-col bg-surface-900 border-r border-surface-800"
      >
        {/* Logo */}
        <div className="h-16 flex items-center px-4 border-b border-surface-800">
          <div className="relative flex items-center gap-3">
            <div className="relative w-10 h-10 flex-shrink-0">
              <div className="absolute inset-0 bg-brand-500/30 blur-lg rounded-full" />
              <div className="relative w-full h-full rounded-xl bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center shadow-lg shadow-brand-500/25">
                <Zap size={20} className="text-white" />
              </div>
            </div>
            <AnimatePresence>
              {!collapsed && (
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.15 }}
                >
                  <h1 className="font-bold text-surface-50 whitespace-nowrap">Specter</h1>
                  <p className="text-xs text-surface-500">v0.1.0</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 px-3 overflow-y-auto">
          <ul className="space-y-1">
            {navItems.map((item) => {
              const isActive = activeView === item.id;
              const Icon = item.icon;

              const button = (
                <motion.button
                  key={item.id}
                  whileHover={{ x: 2 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setActiveView(item.id)}
                  className={cn(
                    'w-full relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                    isActive
                      ? 'text-brand-400'
                      : 'text-surface-400 hover:bg-surface-800/50 hover:text-surface-200'
                  )}
                >
                  {isActive && (
                    <motion.div
                      layoutId="activeNav"
                      className="absolute inset-0 bg-brand-500/10 rounded-lg border border-brand-500/20"
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    />
                  )}
                  <div className="relative flex items-center gap-3">
                    <Icon size={18} />
                    <AnimatePresence>
                      {!collapsed && (
                        <motion.span
                          initial={{ opacity: 0, width: 0 }}
                          animate={{ opacity: 1, width: 'auto' }}
                          exit={{ opacity: 0, width: 0 }}
                          className="whitespace-nowrap overflow-hidden"
                        >
                          {item.label}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                  {item.badge && !collapsed && (
                    <Badge variant="default" className="ml-auto">
                      {item.badge}
                    </Badge>
                  )}
                  {item.id === 'servers' && runningCount > 0 && (
                    <div className={cn('ml-auto', collapsed && 'absolute -top-1 -right-1')}>
                      <StatusDot status="running" size="sm" />
                    </div>
                  )}
                </motion.button>
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

        {/* Collapse Toggle */}
        <div className="p-3 border-t border-surface-800">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-surface-500 hover:bg-surface-800/50 hover:text-surface-300 transition-colors"
          >
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            <AnimatePresence>
              {!collapsed && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-sm"
                >
                  Collapse
                </motion.span>
              )}
            </AnimatePresence>
          </button>
        </div>
      </motion.aside>
    </TooltipProvider>
  );
}
