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
  Menu,
  X,
  Import,
  Keyboard,
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

interface SidebarProps {
  onImportClick?: () => void;
  onShortcutsClick?: () => void;
}

// Custom hook to detect if we're on mobile
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 1024);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return isMobile;
}

export function Sidebar({ onImportClick, onShortcutsClick }: SidebarProps) {
  const { activeView, setActiveView, servers, serverStates } = useStore();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const isMobile = useIsMobile();

  // Close mobile menu when view changes
  useEffect(() => {
    setMobileOpen(false);
  }, [activeView]);

  // Handle escape key to close mobile menu
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, []);

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
      {/* Mobile Header Bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 h-14 bg-surface-900 border-b border-surface-800 flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <div className="relative w-8 h-8">
            <div className="absolute inset-0 bg-brand-500/30 blur-lg rounded-full" />
            <div className="relative w-full h-full rounded-lg bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center shadow-lg shadow-brand-500/25">
              <Zap size={16} className="text-white" />
            </div>
          </div>
          <h1 className="font-bold text-surface-50">Specter</h1>
        </div>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-2 rounded-lg text-surface-400 hover:bg-surface-800 hover:text-surface-200 transition-colors"
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile Overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setMobileOpen(false)}
            className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <motion.aside
        initial={false}
        animate={{ 
          width: collapsed && !isMobile ? 72 : 240,
        }}
        transition={{ duration: 0.2, ease: 'easeInOut' }}
        className={cn(
          "h-screen flex flex-col bg-surface-900 border-r border-surface-800",
          // Mobile: fixed positioning with slide animation
          "max-lg:fixed max-lg:z-50 max-lg:top-14 max-lg:left-0 max-lg:h-[calc(100vh-3.5rem)]",
          "max-lg:transition-transform max-lg:duration-200",
          mobileOpen ? "max-lg:translate-x-0" : "max-lg:-translate-x-full",
          // Desktop: relative positioning, always visible
          "lg:relative lg:z-auto lg:translate-x-0 lg:top-0 lg:h-screen"
        )}
      >
        {/* Logo - Hidden on mobile since we have the mobile header */}
        <div className="h-16 hidden lg:flex items-center px-4 border-b border-surface-800">
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
              const showLabels = isMobile || !collapsed;

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
                      {showLabels && (
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
                  {item.badge && showLabels && (
                    <Badge variant="default" className="ml-auto">
                      {item.badge}
                    </Badge>
                  )}
                  {item.id === 'servers' && runningCount > 0 && (
                    <div className={cn('ml-auto', !showLabels && 'absolute -top-1 -right-1')}>
                      <StatusDot status="running" size="sm" />
                    </div>
                  )}
                </motion.button>
              );

              if (collapsed && !isMobile) {
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

        {/* Collapse Toggle - Desktop only */}
        <div className="hidden lg:block border-t border-surface-800">
          {/* Quick Actions */}
          <div className="p-3 space-y-1">
            {onImportClick && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onImportClick}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-surface-400 hover:bg-surface-800/50 hover:text-surface-200 transition-colors',
                      collapsed && 'justify-center'
                    )}
                  >
                    <Import size={18} />
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
                  <button
                    onClick={onShortcutsClick}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-surface-400 hover:bg-surface-800/50 hover:text-surface-200 transition-colors',
                      collapsed && 'justify-center'
                    )}
                  >
                    <Keyboard size={18} />
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

          {/* Collapse Button */}
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
        </div>
      </motion.aside>
    </TooltipProvider>
  );
}
