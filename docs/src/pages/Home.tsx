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
} from 'lucide-react';
const logoUrl = import.meta.env.BASE_URL + 'logo.svg';
import Feature from '../components/Feature';

const features = [
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
    description: 'Import from OpenAPI, Swagger, and Postman. Export to HAR or cURL.',
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
          Powerful API Mocking for VS Code. Create, manage, and run mock servers directly from your editor.
        </p>
        <div className="flex flex-wrap gap-4 justify-center">
          <Link
            to="/getting-started"
            className="inline-flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors"
          >
            <Zap className="w-5 h-5" />
            Get Started
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

      {/* Quick Overview */}
      <div className="theme-bg-card rounded-xl border theme-border p-4 sm:p-8">
        <h2 className="text-2xl font-bold mb-6">Why Mocklify?</h2>
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-6">
          <div>
            <h3 className="font-semibold text-purple-400 mb-2">⚡ Fast Setup</h3>
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
