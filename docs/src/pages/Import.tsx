import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import CodeBlock from '../components/CodeBlock';
import InfoBox from '../components/InfoBox';

export default function Import() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Import & Export"
        description="Import API definitions from OpenAPI, Swagger, and Postman. Export servers as OpenAPI, Postman, .http, or shareable API docs — and logs as HAR or cURL."
      />

      {/* OpenAPI Import */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">OpenAPI / Swagger Import</h2>
        <p className="theme-text-secondary mb-4">
          Import a complete mock server from an OpenAPI 3.0/3.1 or Swagger 2.0 specification
          (JSON or YAML):
        </p>

        <h3 className="text-lg font-medium mb-3">How to Import</h3>
        <ol className="space-y-3 mb-6">
          <li className="flex gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-600 text-white text-xs">1</span>
            <span className="theme-text">Open Command Palette (Cmd/Ctrl+Shift+P)</span>
          </li>
          <li className="flex gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-600 text-white text-xs">2</span>
            <span className="theme-text">Run "Mocklify: Import OpenAPI / Swagger Spec"</span>
          </li>
          <li className="flex gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-600 text-white text-xs">3</span>
            <span className="theme-text">Pick a spec found in your workspace, or browse to one</span>
          </li>
          <li className="flex gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-600 text-white text-xs">4</span>
            <span className="theme-text">Choose "Import as-is" (deterministic, no AI) or "Import + AI enrich"</span>
          </li>
          <li className="flex gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-600 text-white text-xs">5</span>
            <span className="theme-text">Confirm the route summary, then Create (or Create &amp; Start) the server</span>
          </li>
        </ol>

        <h3 className="text-lg font-medium mb-3">Supported Features</h3>
        <ul className="space-y-2 theme-text-secondary mb-4">
          <li>• Local <code className="text-purple-400">$ref</code> pointers → Resolved inline (cycles handled safely)</li>
          <li>• Path parameters (<code className="text-purple-400">{'{id}'}</code>) → Dynamic <code className="text-purple-400">:id</code> segments</li>
          <li>• Response schemas → Deterministic, realistic mock bodies (formats, enums, nesting)</li>
          <li>• Example values → Preferred over generated data</li>
          <li>• Operation tags &amp; summaries → Route tags and names</li>
          <li>• Documented 4xx/5xx responses → Disabled negative routes for scenario simulation</li>
        </ul>

        <InfoBox type="tip">
          The deterministic import needs no AI at all. "Import + AI enrich" additionally rewrites
          example data to be coherent across routes and adds disabled failure routes
          (400/401/404/429/500) where the spec documents none — and quietly falls back to the
          deterministic result if no AI provider is available.
        </InfoBox>
        <p className="theme-text-secondary mt-4">
          The same OpenAPI specs power{' '}
          <Link to="/contracts" className="text-purple-400 hover:underline">Contract Validation</Link>{' '}
          (validate live requests against a spec), and when a codebase already ships a spec the AI
          scanner takes a <Link to="/ai" className="text-purple-400 hover:underline">spec-first</Link>{' '}
          shortcut through this same import pipeline.
        </p>
      </section>

      {/* Postman Import */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Postman Collection Import</h2>
        <p className="theme-text-secondary mb-4">
          Import from Postman Collection v2.1 format:
        </p>

        <h3 className="text-lg font-medium mb-3">How to Export from Postman</h3>
        <ol className="space-y-2 theme-text-secondary mb-6">
          <li>1. In Postman, select your collection</li>
          <li>2. Click "..." → Export</li>
          <li>3. Choose "Collection v2.1"</li>
          <li>4. Save the JSON file</li>
        </ol>

        <h3 className="text-lg font-medium mb-3">How to Import</h3>
        <ol className="space-y-3 mb-6">
          <li className="flex gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-600 text-white text-xs">1</span>
            <span className="theme-text">Open Command Palette (Cmd/Ctrl+Shift+P)</span>
          </li>
          <li className="flex gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-600 text-white text-xs">2</span>
            <span className="theme-text">Run "Mocklify: Import Postman Collection"</span>
          </li>
          <li className="flex gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-600 text-white text-xs">3</span>
            <span className="theme-text">Select your Postman collection JSON file</span>
          </li>
        </ol>

        <h3 className="text-lg font-medium mb-3">What's Imported</h3>
        <ul className="space-y-2 theme-text-secondary">
          <li>• Request names → Route names</li>
          <li>• Request method and path</li>
          <li>• Example responses (if available)</li>
          <li>• Folder structure → Tags</li>
        </ul>
      </section>

      {/* Export Server As… */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Export Server As…</h2>
        <p className="theme-text-secondary mb-4">
          Run <strong>"Mocklify: Export Server As…"</strong> from the Command Palette (or the
          server's context menu in the tree view, or the Export button on a server card in the
          dashboard) to turn any mock server into:
        </p>

        <ul className="space-y-2 theme-text-secondary mb-6">
          <li>• <strong>OpenAPI 3.0 — JSON or YAML</strong> → spec with inferred response schemas</li>
          <li>• <strong>Postman Collection v2.1</strong> → folders per tag, saved example responses, and a "Failure scenarios" subfolder for disabled negative routes</li>
          <li>• <strong>REST Client (.http)</strong> → runnable requests for the VS Code REST Client extension, path params pre-filled from mock data</li>
          <li>• <strong>API Docs — Web Page (.html)</strong> → a single self-contained file (no external requests) with endpoint search, curl examples, and light/dark themes — ready to share or host anywhere</li>
          <li>• <strong>API Docs — Confluence (.xml)</strong> → Confluence Storage Format with status-macro method badges and code macros — paste via "Insert markup" or push with the REST API</li>
          <li>• <strong>API Docs — Markdown (.md)</strong> → AI-written documentation with a deterministic fallback when no AI provider is configured</li>
        </ul>

        <InfoBox type="tip">
          The web page and Confluence exports include AI-written overview prose when an AI
          provider is available (the same engine as "Generate API Documentation") and fall back
          to a pure endpoint reference otherwise. After generating Markdown docs you are also
          offered one-click "Also export as… Web Page / Confluence" with the AI prose embedded.
        </InfoBox>
      </section>

      {/* HAR Export */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">HAR Export</h2>
        <p className="theme-text-secondary mb-4">
          Export request logs in HTTP Archive (HAR) format for analysis in browser dev tools:
        </p>

        <h3 className="text-lg font-medium mb-3">How to Export</h3>
        <ol className="space-y-3 mb-6">
          <li className="flex gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-600 text-white text-xs">1</span>
            <span className="theme-text">Open the Mocklify dashboard</span>
          </li>
          <li className="flex gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-600 text-white text-xs">2</span>
            <span className="theme-text">Go to the Logs tab</span>
          </li>
          <li className="flex gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-600 text-white text-xs">3</span>
            <span className="theme-text">Click "Export as HAR"</span>
          </li>
        </ol>

        <CodeBlock
          title="HAR Format Example"
          language="json"
          code={`{
  "log": {
    "version": "1.2",
    "creator": {
      "name": "Mocklify",
      "version": "0.4.0"
    },
    "entries": [
      {
        "startedDateTime": "2024-01-15T10:30:00.000Z",
        "time": 45,
        "request": {
          "method": "GET",
          "url": "http://localhost:3000/api/users",
          "headers": []
        },
        "response": {
          "status": 200,
          "statusText": "OK",
          "headers": [],
          "content": {
            "mimeType": "application/json",
            "text": "{...}"
          }
        }
      }
    ]
  }
}`}
        />
      </section>

      {/* cURL Export */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">cURL Export</h2>
        <p className="theme-text-secondary mb-4">
          Generate cURL commands from logged requests:
        </p>

        <h3 className="text-lg font-medium mb-3">Single Request</h3>
        <p className="theme-text-secondary mb-4">
          Right-click on any log entry and select "Copy as cURL":
        </p>
        
        <CodeBlock
          language="bash"
          code={`curl -X POST 'http://localhost:3000/api/users' \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer token' \\
  -d '{"name": "John Doe", "email": "john@example.com"}'`}
        />

        <h3 className="text-lg font-medium mb-3 mt-6">Bulk Export</h3>
        <p className="theme-text-secondary">
          Export all logs as a shell script with multiple cURL commands from the Logs tab menu.
        </p>
      </section>

      {/* JSON Export */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Configuration Export</h2>
        <p className="theme-text-secondary mb-4">
          Export your mock server configuration:
        </p>

        <h3 className="text-lg font-medium mb-3">Export Server</h3>
        <p className="theme-text-secondary mb-4">
          Right-click on a server and select "Export Configuration" to save as JSON.
        </p>

        <h3 className="text-lg font-medium mb-3">Share with Team</h3>
        <p className="theme-text-secondary mb-4">
          The <code className="px-2 py-0.5 theme-bg-secondary rounded">.mocklify</code> folder can be committed to version control to share mock configurations with your team.
        </p>

        <InfoBox type="tip">
          Add sensitive data (API keys, tokens) to your <code>.gitignore</code> or use environment variables.
        </InfoBox>
      </section>
    </div>
  );
}
