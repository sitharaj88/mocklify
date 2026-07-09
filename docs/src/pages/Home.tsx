import { Link } from 'react-router-dom';
import {
  Server,
  FileCode,
  Target,
  ArrowRightLeft,
  Hexagon,
  Radio,
  FileDown,
  Database,
  Zap,
  ChevronRight,
  Sparkles,
  Telescope,
  MessageSquare,
  BookOpen,
  Terminal,
  ShieldCheck,
  Boxes,
} from 'lucide-react';
const logoUrl = import.meta.env.BASE_URL + 'logo.svg';
import Feature from '../components/Feature';

const features = [
  {
    icon: Sparkles,
    title: 'AI Mock Generation',
    description:
      'Describe your API in plain English and get a running mock server — with Copilot, Claude, OpenAI, or Gemini.',
  },
  {
    icon: Telescope,
    title: 'Mock Your App from Code',
    description:
      'Scan any codebase in any language and reverse-engineer a full mock server — one per detected API surface — with positive and negative flows.',
  },
  {
    icon: Terminal,
    title: 'Headless CLI for CI',
    description:
      'Run your mocks without VS Code. @mocklify/cli serves, validates, and lists servers with CI-friendly exit codes.',
  },
  {
    icon: ShieldCheck,
    title: 'Contract Validation',
    description:
      'Validate incoming requests against an OpenAPI 3.x spec — warn on the log row, or enforce with a 400.',
  },
  {
    icon: Boxes,
    title: 'Stateful CRUD',
    description:
      'Routes share an in-memory collection so POST-then-GET flows work: list, create (201), update, delete (204).',
  },
  {
    icon: Zap,
    title: 'Chaos Simulation',
    description:
      'Inject latency and random failures server-wide or per route, with Flaky/Unstable presets — hot-reloaded while running.',
  },
  {
    icon: MessageSquare,
    title: 'Copilot Chat & Agent Mode',
    description:
      '@mocklify chat commands plus language-model tools so Copilot agents can build and run your mocks.',
  },
  {
    icon: BookOpen,
    title: 'AI API Documentation',
    description:
      'Generate polished Markdown docs and OpenAPI 3.0 specs from any mock server.',
  },
  {
    icon: Server,
    title: 'Multiple Servers',
    description: 'Run multiple mock servers on different ports simultaneously.',
  },
  {
    icon: FileCode,
    title: 'Dynamic Templates',
    description: 'Use Handlebars templates with 80+ Faker.js helpers for realistic data.',
  },
  {
    icon: Target,
    title: 'Request Matching',
    description: 'Match requests by headers, query params, body content, and JSON paths.',
  },
  {
    icon: ArrowRightLeft,
    title: 'Proxy & Recording',
    description: 'Forward requests to real APIs and record responses to generate mocks.',
  },
  {
    icon: Hexagon,
    title: 'GraphQL Support',
    description: 'Mock GraphQL queries and mutations with variable substitution.',
  },
  {
    icon: Radio,
    title: 'WebSocket Support',
    description: 'Create real-time event mocks with rooms and broadcast capabilities.',
  },
  {
    icon: FileDown,
    title: 'Import & Export',
    description:
      'Import OpenAPI, Swagger, and Postman. Export as OpenAPI, Postman, .http, or shareable API docs — plus HAR and cURL logs.',
  },
  {
    icon: Database,
    title: 'Database Integration',
    description: 'Query JSON files or in-memory databases for dynamic responses.',
  },
];

export default function Home() {
  return (
    <div className="space-y-16">
      {/* Hero */}
      <div className="text-center py-12">
        <div className="inline-flex items-center justify-center w-24 h-24 rounded-2xl bg-gradient-to-br from-purple-500/20 to-cyan-500/20 mb-8 glow">
          <img src={logoUrl} alt="Mocklify" className="w-12 h-12" />
        </div>
        <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-4">
          <span className="gradient-text">Mocklify</span>
        </h1>
        <p className="text-xl theme-text-secondary mb-8 max-w-2xl mx-auto">
          AI-powered API mocking for VS Code. Describe your API — or point at your app&apos;s
          codebase — and get a running mock server with realistic data. Add stateful CRUD, chaos,
          and contract validation, then run it all headless in CI.
        </p>
        <div className="flex flex-wrap gap-4 justify-center">
          <Link
            to="/getting-started"
            className="inline-flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors"
          >
            <Zap className="w-5 h-5" />
            Get Started
          </Link>
          <Link
            to="/ai"
            className="inline-flex items-center gap-2 px-6 py-3 theme-bg-card border theme-border hover:border-purple-500/50 rounded-lg font-medium transition-colors"
          >
            <Sparkles className="w-5 h-5 text-purple-400" />
            AI Features
          </Link>
          <a
            href="https://marketplace.visualstudio.com/items?itemName=sitharaj.mocklify"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 theme-bg-card border theme-border hover:border-purple-500/50 rounded-lg font-medium transition-colors"
          >
            Install Extension
            <ChevronRight className="w-5 h-5" />
          </a>
        </div>
      </div>

      {/* Features */}
      <div>
        <h2 className="text-2xl font-bold mb-6 text-center">Features</h2>
        <div className="grid md:grid-cols-2 gap-4">
          {features.map((feature) => (
            <Feature key={feature.title} {...feature} />
          ))}
        </div>
      </div>

      {/* Explore */}
      <div>
        <h2 className="text-2xl font-bold mb-6 text-center">Start Here</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { to: '/getting-started', icon: Zap, title: 'Getting Started', desc: 'Install and create your first mock server in minutes.' },
            { to: '/ai', icon: Sparkles, title: 'AI Features', desc: 'Generate mocks from a description, a codebase, or recorded traffic.' },
            { to: '/cli', icon: Terminal, title: 'CLI', desc: 'Serve, validate, and list your mocks headless — built for CI.' },
            { to: '/chaos', icon: Zap, title: 'Chaos', desc: 'Latency and failure injection with presets and per-route overrides.' },
            { to: '/stateful', icon: Boxes, title: 'Stateful Data', desc: 'In-memory CRUD collections that survive across requests.' },
            { to: '/contracts', icon: ShieldCheck, title: 'Contract Validation', desc: 'Check requests against an OpenAPI spec in warn or enforce mode.' },
          ].map(({ to, icon: Icon, title, desc }) => (
            <Link
              key={to}
              to={to}
              className="p-5 rounded-xl theme-bg-card border theme-border hover:border-purple-500/50 transition-colors block"
            >
              <div className="flex items-center gap-3 mb-2">
                <Icon className="w-5 h-5 text-purple-400" />
                <h3 className="font-semibold">{title}</h3>
              </div>
              <p className="theme-text-secondary text-sm">{desc}</p>
            </Link>
          ))}
        </div>
      </div>

      {/* Quick Overview */}
      <div className="theme-bg-card rounded-xl border theme-border p-4 sm:p-8">
        <h2 className="text-2xl font-bold mb-6">Why Mocklify?</h2>
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-6">
          <div>
            <h3 className="font-semibold text-purple-400 mb-2">🤖 AI-First</h3>
            <p className="theme-text-secondary text-sm">
              Bring your own AI — Copilot, Claude, OpenAI, or Gemini — and mock APIs by
              describing them.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-green-400 mb-2">⚡ Fast Setup</h3>
            <p className="theme-text-secondary text-sm">
              Create a mock server in seconds. No configuration files needed.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-cyan-400 mb-2">🎨 Modern UI</h3>
            <p className="theme-text-secondary text-sm">
              Beautiful dashboard with real-time logs and intuitive controls.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-amber-400 mb-2">🔌 Protocol Support</h3>
            <p className="theme-text-secondary text-sm">
              HTTP, GraphQL, and WebSocket support out of the box.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
