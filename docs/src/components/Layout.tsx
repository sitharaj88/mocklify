import { Outlet, Link, useLocation } from 'react-router-dom';
import {
  Ghost,
  Home,
  PlayCircle,
  Server,
  Route,
  FileCode,
  Target,
  ListOrdered,
  ArrowRightLeft,
  Hexagon,
  Radio,
  FileDown,
  Database,
  Keyboard,
  LayoutDashboard,
  Github,
  Menu,
  X,
  Sun,
  Moon,
  Linkedin,
  Coffee,
  Globe,
  Heart,
} from 'lucide-react';
import { useState } from 'react';
import { useTheme } from '../context/ThemeContext';

const navigation = [
  { name: 'Home', path: '/', icon: Home },
  { name: 'Getting Started', path: '/getting-started', icon: PlayCircle },
  { name: 'UI Overview', path: '/ui-overview', icon: LayoutDashboard },
  { name: 'Servers', path: '/servers', icon: Server },
  { name: 'Routes', path: '/routes', icon: Route },
  { name: 'Templates', path: '/templates', icon: FileCode },
  { name: 'Request Matching', path: '/matching', icon: Target },
  { name: 'Response Sequences', path: '/sequences', icon: ListOrdered },
  { name: 'Proxy & Recording', path: '/proxy', icon: ArrowRightLeft },
  { name: 'GraphQL', path: '/graphql', icon: Hexagon },
  { name: 'WebSocket', path: '/websocket', icon: Radio },
  { name: 'Import & Export', path: '/import', icon: FileDown },
  { name: 'Database', path: '/database', icon: Database },
  { name: 'Keyboard Shortcuts', path: '/shortcuts', icon: Keyboard },
];

export default function Layout() {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="min-h-screen theme-bg theme-text">
      {/* Mobile Header */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-50 theme-bg backdrop-blur border-b theme-border px-4 py-3" style={{ backgroundColor: 'var(--bg-primary)', opacity: 0.98 }}>
        <div className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <Ghost className="w-8 h-8 text-purple-500" />
            <span className="text-xl font-bold">Mocklify</span>
          </Link>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              className="p-2 theme-text-secondary hover:theme-text transition-colors"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 theme-text-secondary hover:theme-text"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-40 theme-bg pt-16">
          <nav className="p-4 space-y-1 overflow-y-auto h-full">
            {navigation.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    isActive
                      ? 'bg-purple-500/20 text-purple-400'
                      : 'theme-text-secondary hover:theme-text'
                  }`}
                  style={!isActive ? { backgroundColor: 'transparent' } : undefined}
                >
                  <item.icon className="w-5 h-5" />
                  {item.name}
                </Link>
              );
            })}
          </nav>
        </div>
      )}

      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex fixed left-0 top-0 bottom-0 w-64 flex-col theme-bg border-r theme-border">
        {/* Logo */}
        <div className="p-6 border-b theme-border">
          <Link to="/" className="flex items-center gap-3">
            <Ghost className="w-10 h-10 text-purple-500" />
            <div>
              <h1 className="text-xl font-bold">Mocklify</h1>
              <p className="text-xs theme-text-muted">Documentation</p>
            </div>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navigation.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all duration-200 ${
                  isActive
                    ? 'nav-active text-purple-400'
                    : 'theme-text-secondary hover:theme-text'
                }`}
              >
                <item.icon className="w-4 h-4" />
                <span className="text-sm">{item.name}</span>
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t theme-border flex items-center justify-between">
          <a
            href="https://github.com/sitharaj88/mocklify"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 theme-text-secondary hover:theme-text transition-colors"
          >
            <Github className="w-5 h-5" />
            <span className="text-sm">GitHub</span>
          </a>
          <button
            onClick={toggleTheme}
            className="p-2 theme-text-secondary hover:theme-text transition-colors rounded-lg hover:bg-purple-500/10"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="lg:ml-64 min-h-screen flex flex-col">
        <div className="max-w-4xl mx-auto px-6 py-8 lg:py-12 pt-20 lg:pt-12 flex-1">
          <div className="fade-in">
            <Outlet />
          </div>
        </div>

        {/* Footer */}
        <footer className="theme-border-color border-t mt-auto">
          <div className="max-w-4xl mx-auto px-6 py-8">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              {/* Brand */}
              <div className="flex items-center gap-3">
                <Ghost className="w-6 h-6 text-purple-500" />
                <span className="font-semibold theme-text">Mocklify</span>
                <span className="theme-text-secondary text-sm">Mock Server</span>
              </div>

              {/* Social Links */}
              <div className="flex items-center gap-4">
                <a
                  href="https://www.sitharaj.in/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="theme-text-secondary hover:text-purple-500 transition-colors"
                  title="Website"
                >
                  <Globe className="w-5 h-5" />
                </a>
                <a
                  href="https://github.com/sitharaj88"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="theme-text-secondary hover:text-purple-500 transition-colors"
                  title="GitHub"
                >
                  <Github className="w-5 h-5" />
                </a>
                <a
                  href="https://linkedin.com/in/sitharaj08"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="theme-text-secondary hover:text-purple-500 transition-colors"
                  title="LinkedIn"
                >
                  <Linkedin className="w-5 h-5" />
                </a>
                <a
                  href="https://buymeacoffee.com/sitharaj88"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="theme-text-secondary hover:text-yellow-500 transition-colors"
                  title="Buy Me a Coffee"
                >
                  <Coffee className="w-5 h-5" />
                </a>
              </div>

              {/* Copyright */}
              <div className="flex items-center gap-1 text-sm theme-text-secondary">
                <span>Made with</span>
                <Heart className="w-4 h-4 text-red-500 fill-red-500" />
                <span>by</span>
                <a
                  href="https://www.sitharaj.in/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-purple-500 hover:text-purple-400 transition-colors"
                >
                  Sitharaj Seenivasan
                </a>
              </div>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
