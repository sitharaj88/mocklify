import PageHeader from '../components/PageHeader';
import CodeBlock from '../components/CodeBlock';
import InfoBox from '../components/InfoBox';

export default function Proxy() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Proxy & Recording"
        description="Forward requests to real APIs and record responses to generate mock routes."
      />

      {/* Overview */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Overview</h2>
        <p className="theme-text-secondary mb-4">
          The proxy feature allows you to:
        </p>
        <ul className="space-y-2 theme-text-secondary">
          <li>• Forward unmatched requests to a real API</li>
          <li>• Record API responses to create mock routes</li>
          <li>• Work with a mix of mocked and real endpoints</li>
          <li>• Capture real data for testing scenarios</li>
        </ul>
      </section>

      {/* Enable Proxy */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Enabling Proxy</h2>
        <p className="theme-text-secondary mb-4">
          Configure proxy at the server level:
        </p>
        
        <CodeBlock
          title="Server with Proxy"
          language="json"
          code={`{
  "name": "API with Proxy",
  "port": 3000,
  "proxy": {
    "enabled": true,
    "target": "https://api.example.com",
    "changeOrigin": true
  }
}`}
        />

        <h3 className="text-lg font-medium mb-3 mt-6">Proxy Options</h3>
        <div className="theme-bg-card rounded-xl border theme-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b theme-border">
                <th className="text-left px-4 py-3 theme-text">Option</th>
                <th className="text-left px-4 py-3 theme-text">Description</th>
              </tr>
            </thead>
            <tbody className="theme-text-secondary">
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400">target</td>
                <td className="px-4 py-3">Target URL to forward requests to</td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400">changeOrigin</td>
                <td className="px-4 py-3">Rewrite origin header to match target</td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400">secure</td>
                <td className="px-4 py-3">Verify SSL certificates (default: true)</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-purple-400">pathRewrite</td>
                <td className="px-4 py-3">Rewrite path before forwarding</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Path Rewriting */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Path Rewriting</h2>
        <CodeBlock
          language="json"
          code={`{
  "proxy": {
    "enabled": true,
    "target": "https://api.example.com",
    "pathRewrite": {
      "^/api/v1": "/v1",
      "^/legacy": ""
    }
  }
}`}
        />
        <p className="theme-text-secondary mt-4">
          Request to <code className="px-2 py-0.5 theme-bg-secondary rounded">/api/v1/users</code> forwards to <code className="px-2 py-0.5 theme-bg-secondary rounded">https://api.example.com/v1/users</code>
        </p>
      </section>

      {/* Recording */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Request Recording</h2>
        <p className="theme-text-secondary mb-4">
          Record proxied requests to automatically generate mock routes:
        </p>

        <h3 className="text-lg font-medium mb-3">Start Recording</h3>
        <ol className="space-y-3 mb-6">
          <li className="flex gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-600 text-white text-xs">1</span>
            <span className="theme-text">Open the Mocklify dashboard</span>
          </li>
          <li className="flex gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-600 text-white text-xs">2</span>
            <span className="theme-text">Click "Start Recording" on your server</span>
          </li>
          <li className="flex gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-600 text-white text-xs">3</span>
            <span className="theme-text">Enter the target API URL</span>
          </li>
          <li className="flex gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-600 text-white text-xs">4</span>
            <span className="theme-text">Make requests through your mock server</span>
          </li>
          <li className="flex gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-600 text-white text-xs">5</span>
            <span className="theme-text">Click "Stop Recording" when done</span>
          </li>
        </ol>

        <InfoBox type="tip">
          Recorded responses are saved to the <code>.mocklify/recordings/</code> folder and can be imported as routes.
        </InfoBox>
      </section>

      {/* Recording Configuration */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Recording Options</h2>
        <CodeBlock
          language="json"
          code={`{
  "recording": {
    "enabled": false,
    "target": "https://api.example.com",
    "options": {
      "includeHeaders": true,
      "includeQueryParams": true,
      "includeRequestBody": true,
      "deduplicateRequests": true,
      "maxRecordings": 100
    }
  }
}`}
        />
      </section>

      {/* Generate Routes */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Generate Routes from Recording</h2>
        <p className="theme-text-secondary mb-4">
          After recording, Mocklify can generate mock routes from the captured data:
        </p>
        
        <CodeBlock
          title="Generated Route Example"
          language="json"
          code={`{
  "name": "GET /api/users (recorded)",
  "method": "GET",
  "path": "/api/users",
  "response": {
    "statusCode": 200,
    "headers": {
      "Content-Type": "application/json"
    },
    "body": {
      "users": [
        { "id": 1, "name": "John Doe" },
        { "id": 2, "name": "Jane Smith" }
      ]
    }
  },
  "tags": ["recorded"]
}`}
        />
      </section>

      {/* Mixed Mode */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Mixed Mode</h2>
        <p className="theme-text-secondary mb-4">
          Use a combination of mocked and proxied endpoints:
        </p>
        
        <CodeBlock
          language="json"
          code={`{
  "name": "Development Server",
  "port": 3000,
  "proxy": {
    "enabled": true,
    "target": "https://api.production.com"
  },
  "routes": [
    {
      "name": "Mock Login",
      "method": "POST",
      "path": "/api/auth/login",
      "response": {
        "body": { "token": "dev-token-123" }
      }
    }
  ]
}`}
        />

        <InfoBox type="info">
          Defined mock routes take priority. Unmatched requests are forwarded to the proxy target.
        </InfoBox>
      </section>

      {/* Headers */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Custom Headers</h2>
        <p className="theme-text-secondary mb-4">
          Add custom headers to proxied requests:
        </p>
        <CodeBlock
          language="json"
          code={`{
  "proxy": {
    "enabled": true,
    "target": "https://api.example.com",
    "headers": {
      "X-Api-Key": "your-api-key",
      "X-Custom-Header": "custom-value"
    }
  }
}`}
        />
      </section>
    </div>
  );
}
