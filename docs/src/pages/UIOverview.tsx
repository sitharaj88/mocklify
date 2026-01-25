import PageHeader from '../components/PageHeader';
import InfoBox from '../components/InfoBox';
import Feature from '../components/Feature';
import {
  Smartphone,
  LayoutDashboard,
  Bell,
  Server,
  Route,
  Database,
  ScrollText,
  Settings,
  Play,
  Square,
  Plus,
  ClipboardList,
  FileText,
  Lock,
  Globe,
  Clock,
  Search,
  CheckCircle,
  Download,
  Trash2,
  X,
  RefreshCw,
  Save,
  FileJson,
  Mail,
  KeyRound,
  Terminal,
} from 'lucide-react';

export default function UIOverview() {
  return (
    <div>
      <PageHeader
        title="User Interface Overview"
        description="A comprehensive guide to Specter's intuitive dashboard and all its features"
      />

      <InfoBox type="tip">
        Open the Specter dashboard by clicking the ghost icon in the status bar, using the command palette (<code>Cmd+Shift+P</code> → "Specter: Open Dashboard"), or pressing <code>Cmd+Shift+M</code>.
      </InfoBox>

      {/* Main Layout */}
      <section className="mt-8">
        <h2 className="text-2xl font-bold theme-text mb-4">Main Layout</h2>
        <p className="theme-text-secondary mb-4">
          Specter's UI is built with a modern, responsive design that adapts seamlessly to different screen sizes. The interface consists of three main areas:
        </p>

        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <Feature
            icon={Smartphone}
            title="Sidebar Navigation"
            description="Quick access to all sections: Dashboard, Servers, Routes, Databases, Logs, and Settings. Collapsible on desktop, slide-out drawer on mobile."
          />
          <Feature
            icon={LayoutDashboard}
            title="Main Content Area"
            description="The primary workspace where you manage servers, configure routes, view logs, and more. Content adapts based on selected section."
          />
          <Feature
            icon={Bell}
            title="Status Indicators"
            description="Real-time status dots and badges showing server states, running counts, and activity levels throughout the interface."
          />
        </div>
      </section>

      {/* Sidebar */}
      <section className="mt-12">
        <h2 className="text-2xl font-bold theme-text mb-4">Sidebar Navigation</h2>
        <p className="theme-text-secondary mb-4">
          The sidebar provides quick navigation to all sections of Specter. It features animated transitions and intelligent visual feedback.
        </p>

        <div className="theme-card rounded-lg p-6 mb-6">
          <h3 className="font-semibold theme-text mb-4">Navigation Items</h3>
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 theme-secondary-bg rounded-lg">
              <LayoutDashboard className="w-5 h-5 text-purple-400" />
              <div>
                <p className="font-medium theme-text">Dashboard</p>
                <p className="text-sm theme-text-secondary">Overview of all servers, routes, and recent activity</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 theme-secondary-bg rounded-lg">
              <Server className="w-5 h-5 text-blue-400" />
              <div>
                <p className="font-medium theme-text">Servers</p>
                <p className="text-sm theme-text-secondary">Create, configure, start/stop mock servers</p>
              </div>
              <span className="ml-auto px-2 py-0.5 text-xs font-medium bg-green-500/20 text-green-400 rounded-full">2 running</span>
            </div>
            <div className="flex items-center gap-3 p-3 theme-secondary-bg rounded-lg">
              <Route className="w-5 h-5 text-amber-400" />
              <div>
                <p className="font-medium theme-text">Routes</p>
                <p className="text-sm theme-text-secondary">Define API endpoints with custom responses</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 theme-secondary-bg rounded-lg">
              <Database className="w-5 h-5 text-purple-400" />
              <div>
                <p className="font-medium theme-text">Databases</p>
                <p className="text-sm theme-text-secondary">Connect JSON, SQLite, or external databases</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 theme-secondary-bg rounded-lg">
              <ScrollText className="w-5 h-5 text-emerald-400" />
              <div>
                <p className="font-medium theme-text">Logs</p>
                <p className="text-sm theme-text-secondary">View real-time request/response logs</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 theme-secondary-bg rounded-lg">
              <Settings className="w-5 h-5 text-gray-400" />
              <div>
                <p className="font-medium theme-text">Settings</p>
                <p className="text-sm theme-text-secondary">Configure appearance, defaults, and preferences</p>
              </div>
            </div>
          </div>
        </div>

        <InfoBox type="info">
          On desktop, click the collapse button to minimize the sidebar to icons only. On mobile, the sidebar becomes a slide-out drawer accessible via the menu button.
        </InfoBox>
      </section>

      {/* Dashboard */}
      <section className="mt-12">
        <h2 className="text-2xl font-bold theme-text mb-4">Dashboard</h2>
        <p className="theme-text-secondary mb-4">
          The Dashboard provides a high-level overview of your mock server environment with real-time statistics and quick actions.
        </p>

        <h3 className="text-lg font-semibold theme-text mb-3">Statistics Cards</h3>
        <div className="grid md:grid-cols-4 gap-4 mb-6">
          <div className="theme-card rounded-lg p-4 border-l-4 border-blue-500">
            <p className="text-2xl font-bold theme-text">4</p>
            <p className="text-sm theme-text-secondary">Total Servers</p>
          </div>
          <div className="theme-card rounded-lg p-4 border-l-4 border-green-500">
            <p className="text-2xl font-bold theme-text">2</p>
            <p className="text-sm theme-text-secondary">Running</p>
          </div>
          <div className="theme-card rounded-lg p-4 border-l-4 border-amber-500">
            <p className="text-2xl font-bold theme-text">18</p>
            <p className="text-sm theme-text-secondary">Total Routes</p>
          </div>
          <div className="theme-card rounded-lg p-4 border-l-4 border-purple-500">
            <p className="text-2xl font-bold theme-text">127</p>
            <p className="text-sm theme-text-secondary">Requests</p>
          </div>
        </div>

        <h3 className="text-lg font-semibold theme-text mb-3">Quick Actions</h3>
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <Feature
            icon={Play}
            title="Start All Servers"
            description="One-click to start all configured servers simultaneously"
          />
          <Feature
            icon={Square}
            title="Stop All Servers"
            description="Quickly stop all running servers with a single action"
          />
          <Feature
            icon={Plus}
            title="New Server"
            description="Jump directly to server creation modal"
          />
          <Feature
            icon={ClipboardList}
            title="Recent Activity"
            description="View the last 5 requests with method, path, and status"
          />
        </div>
      </section>

      {/* Servers View */}
      <section className="mt-12">
        <h2 className="text-2xl font-bold theme-text mb-4">Servers View</h2>
        <p className="theme-text-secondary mb-4">
          The Servers view displays all configured mock servers in a responsive card grid layout.
        </p>

        <h3 className="text-lg font-semibold theme-text mb-3">Server Card Anatomy</h3>
        <div className="theme-card rounded-lg p-6 mb-6">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse"></div>
              <div>
                <p className="font-semibold theme-text">API Server</p>
                <p className="text-sm font-mono theme-text-secondary">localhost:3000</p>
              </div>
            </div>
            <span className="px-2 py-1 text-xs font-medium bg-green-500/20 text-green-400 rounded-full">Running</span>
          </div>
          
          <div className="grid grid-cols-2 gap-4 text-sm mb-4">
            <div className="theme-secondary-bg rounded-lg p-3">
              <p className="theme-text-secondary">Routes</p>
              <p className="text-lg font-semibold theme-text">8</p>
            </div>
            <div className="theme-secondary-bg rounded-lg p-3">
              <p className="theme-text-secondary">Requests</p>
              <p className="text-lg font-semibold theme-text">42</p>
            </div>
          </div>
          
          <div className="flex gap-2">
            <button className="flex-1 px-3 py-2 text-sm font-medium bg-red-500/20 text-red-400 rounded-lg">Stop</button>
            <button className="px-3 py-2 text-sm theme-secondary-bg theme-text-secondary rounded-lg">Edit</button>
            <button className="px-3 py-2 text-sm theme-secondary-bg theme-text-secondary rounded-lg">Routes</button>
          </div>
        </div>

        <h3 className="text-lg font-semibold theme-text mb-3">Server States</h3>
        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <div className="theme-card rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-3 h-3 rounded-full bg-green-500"></div>
              <span className="font-medium theme-text">Running</span>
            </div>
            <p className="text-sm theme-text-secondary">Server is active and accepting requests. Shows request count and uptime.</p>
          </div>
          <div className="theme-card rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-3 h-3 rounded-full bg-gray-500"></div>
              <span className="font-medium theme-text">Stopped</span>
            </div>
            <p className="text-sm theme-text-secondary">Server is configured but not currently running. Click Start to activate.</p>
          </div>
          <div className="theme-card rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-3 h-3 rounded-full bg-red-500"></div>
              <span className="font-medium theme-text">Error</span>
            </div>
            <p className="text-sm theme-text-secondary">Server encountered an error (e.g., port in use). Check logs for details.</p>
          </div>
        </div>
      </section>

      {/* Server Modal */}
      <section className="mt-12">
        <h2 className="text-2xl font-bold theme-text mb-4">Server Creation Modal</h2>
        <p className="theme-text-secondary mb-4">
          When creating or editing a server, a modal dialog opens with all configuration options organized in tabs.
        </p>

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <Feature
            icon={FileText}
            title="Basic Settings"
            description="Server name, port number, description, and enable/disable toggle"
          />
          <Feature
            icon={Lock}
            title="HTTPS Configuration"
            description="Enable SSL with auto-generated or custom certificates"
          />
          <Feature
            icon={Globe}
            title="CORS Settings"
            description="Configure allowed origins, methods, headers, and credentials"
          />
          <Feature
            icon={Clock}
            title="Advanced Options"
            description="Request timeout, body size limits, rate limiting, latency simulation"
          />
        </div>
      </section>

      {/* Routes View */}
      <section className="mt-12">
        <h2 className="text-2xl font-bold theme-text mb-4">Routes View</h2>
        <p className="theme-text-secondary mb-4">
          The Routes view allows you to manage API endpoints for each server. Select a server from the dropdown to view and manage its routes.
        </p>

        <h3 className="text-lg font-semibold theme-text mb-3">Route Table</h3>
        <div className="theme-card rounded-lg overflow-hidden mb-6">
          <table className="w-full text-sm">
            <thead className="theme-secondary-bg">
              <tr>
                <th className="text-left p-3 font-medium theme-text-secondary">Method</th>
                <th className="text-left p-3 font-medium theme-text-secondary">Path</th>
                <th className="text-left p-3 font-medium theme-text-secondary">Status</th>
                <th className="text-left p-3 font-medium theme-text-secondary">Enabled</th>
                <th className="text-left p-3 font-medium theme-text-secondary">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t theme-border">
                <td className="p-3"><span className="px-2 py-1 text-xs font-medium bg-green-500/20 text-green-400 rounded">GET</span></td>
                <td className="p-3 font-mono theme-text">/api/users</td>
                <td className="p-3"><span className="text-green-400">200</span></td>
                <td className="p-3"><span className="text-green-400">✓</span></td>
                <td className="p-3 theme-text-secondary">Edit | Delete</td>
              </tr>
              <tr className="border-t theme-border">
                <td className="p-3"><span className="px-2 py-1 text-xs font-medium bg-blue-500/20 text-blue-400 rounded">POST</span></td>
                <td className="p-3 font-mono theme-text">/api/users</td>
                <td className="p-3"><span className="text-green-400">201</span></td>
                <td className="p-3"><span className="text-green-400">✓</span></td>
                <td className="p-3 theme-text-secondary">Edit | Delete</td>
              </tr>
              <tr className="border-t theme-border">
                <td className="p-3"><span className="px-2 py-1 text-xs font-medium bg-red-500/20 text-red-400 rounded">DELETE</span></td>
                <td className="p-3 font-mono theme-text">/api/users/:id</td>
                <td className="p-3"><span className="text-green-400">204</span></td>
                <td className="p-3"><span className="text-gray-500">✗</span></td>
                <td className="p-3 theme-text-secondary">Edit | Delete</td>
              </tr>
            </tbody>
          </table>
        </div>

        <InfoBox type="tip">
          Click the toggle button to quickly enable or disable a route without editing. Disabled routes return 404 until re-enabled.
        </InfoBox>
      </section>

      {/* Route Modal */}
      <section className="mt-12">
        <h2 className="text-2xl font-bold theme-text mb-4">Route Configuration Modal</h2>
        <p className="theme-text-secondary mb-4">
          The route modal provides comprehensive options for configuring endpoint behavior.
        </p>

        <h3 className="text-lg font-semibold theme-text mb-3">Configuration Tabs</h3>
        <div className="space-y-4 mb-6">
          <div className="theme-card rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <ClipboardList className="w-5 h-5 text-blue-400" />
              <h4 className="font-medium theme-text">Basic Tab</h4>
            </div>
            <p className="text-sm theme-text-secondary">HTTP method selection (GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD, or multiple), path pattern with parameter support (/users/:id), and enable/disable toggle.</p>
          </div>
          
          <div className="theme-card rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Download className="w-5 h-5 text-emerald-400" />
              <h4 className="font-medium theme-text">Response Tab</h4>
            </div>
            <p className="text-sm theme-text-secondary">Status code dropdown (200, 201, 400, 404, 500, etc.), response body editor with JSON syntax highlighting, custom headers configuration, and latency simulation.</p>
          </div>
          
          <div className="theme-card rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Search className="w-5 h-5 text-amber-400" />
              <h4 className="font-medium theme-text">Matching Tab</h4>
            </div>
            <p className="text-sm theme-text-secondary">Add conditions for headers, query parameters, and request body matching. Routes only respond when all conditions are met.</p>
          </div>
          
          <div className="theme-card rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <RefreshCw className="w-5 h-5 text-purple-400" />
              <h4 className="font-medium theme-text">Sequences Tab</h4>
            </div>
            <p className="text-sm theme-text-secondary">Configure response sequences that cycle through different responses on each request. Perfect for testing pagination or state changes.</p>
          </div>
        </div>
      </section>

      {/* Logs Viewer */}
      <section className="mt-12">
        <h2 className="text-2xl font-bold theme-text mb-4">Logs Viewer</h2>
        <p className="theme-text-secondary mb-4">
          The Logs view provides real-time visibility into all requests hitting your mock servers.
        </p>

        <h3 className="text-lg font-semibold theme-text mb-3">Features</h3>
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <Feature
            icon={Search}
            title="Filter by Server"
            description="Select a specific server or view all requests across servers"
          />
          <Feature
            icon={CheckCircle}
            title="Status Filter"
            description="Filter by success (2xx, 3xx) or error (4xx, 5xx) responses"
          />
          <Feature
            icon={Download}
            title="Export Logs"
            description="Download filtered logs as JSON for analysis or debugging"
          />
          <Feature
            icon={Trash2}
            title="Clear Logs"
            description="Clear all logs or logs for a specific server"
          />
        </div>

        <h3 className="text-lg font-semibold theme-text mb-3">Log Entry Details</h3>
        <div className="theme-card rounded-lg p-4 mb-6">
          <p className="text-sm theme-text-secondary mb-3">Click any log entry to view full details:</p>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="theme-secondary-bg rounded-lg p-3">
              <h4 className="font-medium theme-text text-sm mb-2">Request Details</h4>
              <ul className="text-sm theme-text-secondary space-y-1">
                <li>• Method & URL</li>
                <li>• Headers</li>
                <li>• Query Parameters</li>
                <li>• Request Body</li>
                <li>• Timestamp</li>
              </ul>
            </div>
            <div className="theme-secondary-bg rounded-lg p-3">
              <h4 className="font-medium theme-text text-sm mb-2">Response Details</h4>
              <ul className="text-sm theme-text-secondary space-y-1">
                <li>• Status Code</li>
                <li>• Response Headers</li>
                <li>• Response Body</li>
                <li>• Duration (ms)</li>
                <li>• Matched Route</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Database View */}
      <section className="mt-12">
        <h2 className="text-2xl font-bold theme-text mb-4">Database Connections</h2>
        <p className="theme-text-secondary mb-4">
          The Database view lets you manage data sources for dynamic mock responses.
        </p>

        <h3 className="text-lg font-semibold theme-text mb-3">Supported Database Types</h3>
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div className="theme-card rounded-lg p-4 border-l-4 border-amber-500">
            <h4 className="font-medium theme-text mb-1">JSON File</h4>
            <p className="text-sm theme-text-secondary">Use local JSON files as data sources. Great for static fixture data.</p>
          </div>
          <div className="theme-card rounded-lg p-4 border-l-4 border-blue-500">
            <h4 className="font-medium theme-text mb-1">SQLite</h4>
            <p className="text-sm theme-text-secondary">Lightweight embedded database. Perfect for relational test data.</p>
          </div>
          <div className="theme-card rounded-lg p-4 border-l-4 border-green-500">
            <h4 className="font-medium theme-text mb-1">MongoDB</h4>
            <p className="text-sm theme-text-secondary">Connect to MongoDB instances for document-based data.</p>
          </div>
          <div className="theme-card rounded-lg p-4 border-l-4 border-orange-500">
            <h4 className="font-medium theme-text mb-1">MySQL / PostgreSQL</h4>
            <p className="text-sm theme-text-secondary">Connect to production-like relational databases.</p>
          </div>
        </div>

        <InfoBox type="info">
          Each database card shows the connection status, type, and provides quick actions for testing the connection, editing, or deleting.
        </InfoBox>
      </section>

      {/* Settings View */}
      <section className="mt-12">
        <h2 className="text-2xl font-bold theme-text mb-4">Settings</h2>
        <p className="theme-text-secondary mb-4">
          The Settings view is organized into tabs for easy navigation.
        </p>

        <div className="space-y-4 mb-6">
          <div className="theme-card rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Settings className="w-5 h-5 text-gray-400" />
              <h4 className="font-medium theme-text">General</h4>
            </div>
            <p className="text-sm theme-text-secondary">Theme selection (Light/Dark/System), UI animations, confirmation dialogs</p>
          </div>
          
          <div className="theme-card rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Server className="w-5 h-5 text-blue-400" />
              <h4 className="font-medium theme-text">Server Defaults</h4>
            </div>
            <p className="text-sm theme-text-secondary">Default port, timeout, body size limit, auto-start preferences</p>
          </div>
          
          <div className="theme-card rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <ScrollText className="w-5 h-5 text-emerald-400" />
              <h4 className="font-medium theme-text">Logging</h4>
            </div>
            <p className="text-sm theme-text-secondary">Log level, max entries, body truncation, retention settings</p>
          </div>
          
          <div className="theme-card rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Database className="w-5 h-5 text-purple-400" />
              <h4 className="font-medium theme-text">Database</h4>
            </div>
            <p className="text-sm theme-text-secondary">Default database type, connection timeout, query limits</p>
          </div>
        </div>
      </section>

      {/* Modals Overview */}
      <section className="mt-12">
        <h2 className="text-2xl font-bold theme-text mb-4">Modal Dialogs</h2>
        <p className="theme-text-secondary mb-4">
          Specter uses modal dialogs for focused data entry. All modals share consistent design patterns.
        </p>

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <Feature
            icon={X}
            title="Escape to Close"
            description="Press Escape key or click outside to close any modal"
          />
          <Feature
            icon={Smartphone}
            title="Responsive Design"
            description="Modals adapt to screen size, full-screen on mobile devices"
          />
          <Feature
            icon={RefreshCw}
            title="Form Validation"
            description="Real-time validation with helpful error messages"
          />
          <Feature
            icon={Save}
            title="Save & Cancel"
            description="Clear action buttons with keyboard shortcuts"
          />
        </div>
      </section>

      {/* Search & Shortcuts */}
      <section className="mt-12">
        <h2 className="text-2xl font-bold theme-text mb-4">Search & Keyboard Shortcuts</h2>
        
        <h3 className="text-lg font-semibold theme-text mb-3">Global Search</h3>
        <p className="theme-text-secondary mb-4">
          Press <code className="theme-card px-2 py-1 rounded text-sm">Cmd+K</code> (Mac) or <code className="theme-card px-2 py-1 rounded text-sm">Ctrl+K</code> (Windows/Linux) to open the search bar. Search across servers, routes, and commands.
        </p>

        <h3 className="text-lg font-semibold theme-text mb-3">Keyboard Navigation</h3>
        <div className="theme-card rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="theme-secondary-bg">
              <tr>
                <th className="text-left p-3 font-medium theme-text-secondary">Shortcut</th>
                <th className="text-left p-3 font-medium theme-text-secondary">Action</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t theme-border">
                <td className="p-3 font-mono theme-text">Cmd+1</td>
                <td className="p-3 theme-text-secondary">Go to Dashboard</td>
              </tr>
              <tr className="border-t theme-border">
                <td className="p-3 font-mono theme-text">Cmd+2</td>
                <td className="p-3 theme-text-secondary">Go to Servers</td>
              </tr>
              <tr className="border-t theme-border">
                <td className="p-3 font-mono theme-text">Cmd+3</td>
                <td className="p-3 theme-text-secondary">Go to Routes</td>
              </tr>
              <tr className="border-t theme-border">
                <td className="p-3 font-mono theme-text">Cmd+N</td>
                <td className="p-3 theme-text-secondary">New Server/Route (context-aware)</td>
              </tr>
              <tr className="border-t theme-border">
                <td className="p-3 font-mono theme-text">Cmd+K</td>
                <td className="p-3 theme-text-secondary">Open Search</td>
              </tr>
              <tr className="border-t theme-border">
                <td className="p-3 font-mono theme-text">?</td>
                <td className="p-3 theme-text-secondary">Show Keyboard Shortcuts Help</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Theme Support */}
      <section className="mt-12">
        <h2 className="text-2xl font-bold theme-text mb-4">Theme Support</h2>
        <p className="theme-text-secondary mb-4">
          Specter supports three theme modes that can be switched from Settings → General:
        </p>

        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <div className="theme-card rounded-lg p-4 text-center">
            <span className="text-3xl mb-2 block">☀️</span>
            <h4 className="font-medium theme-text">Light</h4>
            <p className="text-sm theme-text-secondary">Clean, bright interface</p>
          </div>
          <div className="theme-card rounded-lg p-4 text-center">
            <span className="text-3xl mb-2 block">🌙</span>
            <h4 className="font-medium theme-text">Dark</h4>
            <p className="text-sm theme-text-secondary">Easy on the eyes</p>
          </div>
          <div className="theme-card rounded-lg p-4 text-center">
            <span className="text-3xl mb-2 block">💻</span>
            <h4 className="font-medium theme-text">System</h4>
            <p className="text-sm theme-text-secondary">Follows OS preference</p>
          </div>
        </div>
      </section>

      {/* Animations */}
      <section className="mt-12">
        <h2 className="text-2xl font-bold theme-text mb-4">Animations & Transitions</h2>
        <p className="theme-text-secondary mb-4">
          Specter uses smooth animations powered by Framer Motion for a polished user experience:
        </p>

        <ul className="list-disc list-inside theme-text-secondary space-y-2">
          <li><strong className="theme-text">Page transitions:</strong> Fade and slide animations between views</li>
          <li><strong className="theme-text">Staggered lists:</strong> Items animate in sequence when loading</li>
          <li><strong className="theme-text">Hover effects:</strong> Subtle scale and color transitions on interactive elements</li>
          <li><strong className="theme-text">Modal animations:</strong> Scale and fade animations for dialogs</li>
          <li><strong className="theme-text">Status indicators:</strong> Pulsing animations for running servers</li>
        </ul>

        <InfoBox type="tip">
          Animations can be disabled in Settings → General if you prefer reduced motion.
        </InfoBox>
      </section>

      {/* Import Feature */}
      <section className="mt-12">
        <h2 className="text-2xl font-bold theme-text mb-4">Import Feature</h2>
        <p className="theme-text-secondary mb-4">
          Access the Import feature from the sidebar footer. Specter can import routes from:
        </p>

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <Feature
            icon={FileJson}
            title="OpenAPI / Swagger"
            description="Import from OpenAPI 3.x or Swagger 2.0 specifications"
          />
          <Feature
            icon={Mail}
            title="Postman Collections"
            description="Import from Postman Collection v2.0 or v2.1 format"
          />
          <Feature
            icon={KeyRound}
            title="HAR Files"
            description="Import from HTTP Archive files recorded in browsers"
          />
          <Feature
            icon={Terminal}
            title="cURL Commands"
            description="Convert cURL commands directly into mock routes"
          />
        </div>
      </section>

      {/* Best Practices */}
      <section className="mt-12">
        <h2 className="text-2xl font-bold theme-text mb-4">UI Best Practices</h2>
        
        <div className="space-y-4">
          <div className="theme-card rounded-lg p-4 border-l-4 border-green-500">
            <h4 className="font-medium theme-text mb-1">✓ Use meaningful names</h4>
            <p className="text-sm theme-text-secondary">Give servers and routes descriptive names for easy identification</p>
          </div>
          <div className="theme-card rounded-lg p-4 border-l-4 border-green-500">
            <h4 className="font-medium theme-text mb-1">✓ Organize with multiple servers</h4>
            <p className="text-sm theme-text-secondary">Group related routes on separate servers (auth, users, products)</p>
          </div>
          <div className="theme-card rounded-lg p-4 border-l-4 border-green-500">
            <h4 className="font-medium theme-text mb-1">✓ Monitor logs regularly</h4>
            <p className="text-sm theme-text-secondary">Check the Logs view to debug request matching issues</p>
          </div>
          <div className="theme-card rounded-lg p-4 border-l-4 border-green-500">
            <h4 className="font-medium theme-text mb-1">✓ Use keyboard shortcuts</h4>
            <p className="text-sm theme-text-secondary">Learn shortcuts for faster navigation and productivity</p>
          </div>
        </div>
      </section>
    </div>
  );
}
