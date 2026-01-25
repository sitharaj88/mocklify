import PageHeader from '../components/PageHeader';
import CodeBlock from '../components/CodeBlock';
import InfoBox from '../components/InfoBox';

export default function Servers() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Servers"
        description="Create and manage multiple mock servers running on different ports."
      />

      {/* Creating Servers */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Creating a Server</h2>
        <p className="text-slate-400 mb-4">
          You can create servers using the Command Palette, sidebar context menu, or the dashboard.
        </p>
        
        <h3 className="text-lg font-medium mb-3">Server Properties</h3>
        <div className="bg-[#1a2332] rounded-xl border border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="text-left px-4 py-3 text-slate-300">Property</th>
                <th className="text-left px-4 py-3 text-slate-300">Description</th>
              </tr>
            </thead>
            <tbody className="text-slate-400">
              <tr className="border-b border-slate-800">
                <td className="px-4 py-3 font-mono text-purple-400">name</td>
                <td className="px-4 py-3">Display name for the server</td>
              </tr>
              <tr className="border-b border-slate-800">
                <td className="px-4 py-3 font-mono text-purple-400">port</td>
                <td className="px-4 py-3">Port number (1024-65535)</td>
              </tr>
              <tr className="border-b border-slate-800">
                <td className="px-4 py-3 font-mono text-purple-400">protocol</td>
                <td className="px-4 py-3">HTTP or WebSocket</td>
              </tr>
              <tr className="border-b border-slate-800">
                <td className="px-4 py-3 font-mono text-purple-400">delay</td>
                <td className="px-4 py-3">Default response delay in ms</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-purple-400">cors</td>
                <td className="px-4 py-3">Enable CORS headers</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Server Configuration */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Server Configuration</h2>
        <CodeBlock
          title="Server JSON Structure"
          language="json"
          code={`{
  "id": "srv-abc123",
  "name": "API Server",
  "port": 3000,
  "protocol": "http",
  "delay": 0,
  "cors": true,
  "routes": []
}`}
        />
      </section>

      {/* Managing Servers */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Managing Servers</h2>
        
        <h3 className="text-lg font-medium mb-3">Starting & Stopping</h3>
        <ul className="space-y-2 text-slate-400 mb-6">
          <li>• Click the ▶️/⏹️ button next to the server in the sidebar</li>
          <li>• Use keyboard shortcuts: <code className="px-2 py-0.5 bg-slate-800 rounded">Cmd/Ctrl+Shift+S</code> to start, <code className="px-2 py-0.5 bg-slate-800 rounded">Cmd/Ctrl+Shift+X</code> to stop</li>
          <li>• Right-click context menu options</li>
        </ul>

        <InfoBox type="info">
          Servers persist across VS Code sessions. Configuration is stored in the <code>.specter</code> folder.
        </InfoBox>
      </section>

      {/* Multiple Servers */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Running Multiple Servers</h2>
        <p className="text-slate-400 mb-4">
          You can run multiple mock servers simultaneously on different ports. This is useful for:
        </p>
        <ul className="space-y-2 text-slate-400">
          <li>• Mocking multiple microservices</li>
          <li>• Testing different API versions</li>
          <li>• Simulating complex architectures</li>
          <li>• Separating HTTP and WebSocket servers</li>
        </ul>

        <InfoBox type="warning" title="Port Conflicts">
          Ensure each server uses a unique port. Specter will show an error if a port is already in use.
        </InfoBox>
      </section>

      {/* Environment Variables */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Environment Variables</h2>
        <p className="text-slate-400 mb-4">
          Define environment variables at the server level to use across all routes:
        </p>
        <CodeBlock
          language="json"
          code={`{
  "name": "API Server",
  "port": 3000,
  "environment": {
    "API_VERSION": "v2",
    "DEFAULT_LIMIT": "20"
  }
}`}
        />
        <p className="text-slate-400 mt-4">
          Access in templates: <code className="px-2 py-0.5 bg-slate-800 rounded">{"{{env.API_VERSION}}"}</code>
        </p>
      </section>
    </div>
  );
}
