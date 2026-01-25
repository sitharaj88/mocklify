import PageHeader from '../components/PageHeader';
import CodeBlock from '../components/CodeBlock';
import InfoBox from '../components/InfoBox';
import { CheckCircle2 } from 'lucide-react';

const steps = [
  'Open VS Code',
  'Go to Extensions (Cmd+Shift+X / Ctrl+Shift+X)',
  'Search for "Specter"',
  'Click Install',
];

export default function GettingStarted() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Getting Started"
        description="Get up and running with Specter in minutes."
      />

      {/* Installation */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Installation</h2>
        <div className="bg-[#1a2332] rounded-xl border border-slate-800 p-6">
          <h3 className="font-medium mb-4">From VS Code Marketplace</h3>
          <ol className="space-y-3">
            {steps.map((step, index) => (
              <li key={index} className="flex items-center gap-3">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 text-sm">
                  {index + 1}
                </span>
                <span className="text-slate-300">{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <InfoBox type="tip" title="Install from VSIX">
          You can also install from a VSIX file: Extensions → "..." → "Install from VSIX..."
        </InfoBox>
      </section>

      {/* Create Server */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Create Your First Server</h2>
        <ol className="space-y-4">
          <li className="flex gap-4">
            <span className="flex items-center justify-center w-8 h-8 rounded-full bg-purple-600 text-white text-sm font-medium shrink-0">
              1
            </span>
            <div>
              <h4 className="font-medium mb-1">Open Command Palette</h4>
              <p className="text-slate-400 text-sm">
                Press <code className="px-2 py-0.5 bg-slate-800 rounded">Cmd+Shift+P</code> (Mac) or{' '}
                <code className="px-2 py-0.5 bg-slate-800 rounded">Ctrl+Shift+P</code> (Windows/Linux)
              </p>
            </div>
          </li>
          <li className="flex gap-4">
            <span className="flex items-center justify-center w-8 h-8 rounded-full bg-purple-600 text-white text-sm font-medium shrink-0">
              2
            </span>
            <div>
              <h4 className="font-medium mb-1">Create Server</h4>
              <p className="text-slate-400 text-sm">
                Type "Specter: Create Server" and press Enter
              </p>
            </div>
          </li>
          <li className="flex gap-4">
            <span className="flex items-center justify-center w-8 h-8 rounded-full bg-purple-600 text-white text-sm font-medium shrink-0">
              3
            </span>
            <div>
              <h4 className="font-medium mb-1">Configure Server</h4>
              <p className="text-slate-400 text-sm">
                Enter a name (e.g., "API Server") and port (e.g., 3000)
              </p>
            </div>
          </li>
        </ol>
      </section>

      {/* Add Route */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Add a Route</h2>
        <p className="text-slate-400 mb-4">
          Right-click on your server in the Specter sidebar and select "Add Route", or use the dashboard.
        </p>
        <CodeBlock
          title="Example Route Response"
          language="json"
          code={`{
  "users": [
    { "id": 1, "name": "John Doe" },
    { "id": 2, "name": "Jane Smith" }
  ]
}`}
        />
      </section>

      {/* Start Server */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Start the Server</h2>
        <div className="flex items-start gap-3 mb-4">
          <CheckCircle2 className="w-5 h-5 text-green-500 mt-1 shrink-0" />
          <p className="text-slate-300">
            Click the ▶️ play button next to your server, or use the keyboard shortcut{' '}
            <code className="px-2 py-0.5 bg-slate-800 rounded">Cmd/Ctrl+Shift+S</code>
          </p>
        </div>
        <p className="text-slate-400">
          Your mock API is now running! Test it with:
        </p>
        <CodeBlock
          language="bash"
          code={`curl http://localhost:3000/api/users`}
        />
      </section>

      {/* What's Next */}
      <section className="bg-gradient-to-r from-purple-500/10 to-cyan-500/10 rounded-xl border border-purple-500/20 p-6">
        <h2 className="text-xl font-semibold mb-4">What's Next?</h2>
        <ul className="space-y-2 text-slate-300">
          <li>• Learn about <a href="#/templates" className="text-purple-400 hover:underline">dynamic templates</a> with Faker.js</li>
          <li>• Set up <a href="#/matching" className="text-purple-400 hover:underline">request matching</a> for conditional responses</li>
          <li>• Configure <a href="#/proxy" className="text-purple-400 hover:underline">proxy pass-through</a> to forward requests</li>
          <li>• Import existing APIs from <a href="#/import" className="text-purple-400 hover:underline">OpenAPI or Postman</a></li>
        </ul>
      </section>
    </div>
  );
}
