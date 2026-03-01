import PageHeader from '../components/PageHeader';
import CodeBlock from '../components/CodeBlock';
import InfoBox from '../components/InfoBox';

export default function Import() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Import & Export"
        description="Import API definitions from OpenAPI, Swagger, and Postman. Export logs as HAR or cURL."
      />

      {/* OpenAPI Import */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">OpenAPI / Swagger Import</h2>
        <p className="text-slate-400 mb-4">
          Import mock routes from OpenAPI 3.0 or Swagger 2.0 specifications:
        </p>

        <h3 className="text-lg font-medium mb-3">How to Import</h3>
        <ol className="space-y-3 mb-6">
          <li className="flex gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-600 text-white text-xs">1</span>
            <span className="text-slate-300">Open Command Palette (Cmd/Ctrl+Shift+P)</span>
          </li>
          <li className="flex gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-600 text-white text-xs">2</span>
            <span className="text-slate-300">Type "Mocklify: Import from OpenAPI"</span>
          </li>
          <li className="flex gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-600 text-white text-xs">3</span>
            <span className="text-slate-300">Select your OpenAPI JSON or YAML file</span>
          </li>
          <li className="flex gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-600 text-white text-xs">4</span>
            <span className="text-slate-300">Routes are automatically created</span>
          </li>
        </ol>

        <h3 className="text-lg font-medium mb-3">Supported Features</h3>
        <ul className="space-y-2 text-slate-400 mb-4">
          <li>• Path parameters → Dynamic path segments</li>
          <li>• Response schemas → Mock response bodies</li>
          <li>• Example values → Used in responses</li>
          <li>• Operation tags → Route tags</li>
          <li>• Multiple response codes → Separate routes</li>
        </ul>

        <InfoBox type="tip">
          Mocklify uses example values from your OpenAPI spec when available. Otherwise, it generates fake data based on schema types.
        </InfoBox>
      </section>

      {/* Postman Import */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Postman Collection Import</h2>
        <p className="text-slate-400 mb-4">
          Import from Postman Collection v2.1 format:
        </p>

        <h3 className="text-lg font-medium mb-3">How to Export from Postman</h3>
        <ol className="space-y-2 text-slate-400 mb-6">
          <li>1. In Postman, select your collection</li>
          <li>2. Click "..." → Export</li>
          <li>3. Choose "Collection v2.1"</li>
          <li>4. Save the JSON file</li>
        </ol>

        <h3 className="text-lg font-medium mb-3">How to Import</h3>
        <ol className="space-y-3 mb-6">
          <li className="flex gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-600 text-white text-xs">1</span>
            <span className="text-slate-300">Open Command Palette (Cmd/Ctrl+Shift+P)</span>
          </li>
          <li className="flex gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-600 text-white text-xs">2</span>
            <span className="text-slate-300">Type "Mocklify: Import from Postman"</span>
          </li>
          <li className="flex gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-600 text-white text-xs">3</span>
            <span className="text-slate-300">Select your Postman collection JSON file</span>
          </li>
        </ol>

        <h3 className="text-lg font-medium mb-3">What's Imported</h3>
        <ul className="space-y-2 text-slate-400">
          <li>• Request names → Route names</li>
          <li>• Request method and path</li>
          <li>• Example responses (if available)</li>
          <li>• Folder structure → Tags</li>
        </ul>
      </section>

      {/* HAR Export */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">HAR Export</h2>
        <p className="text-slate-400 mb-4">
          Export request logs in HTTP Archive (HAR) format for analysis in browser dev tools:
        </p>

        <h3 className="text-lg font-medium mb-3">How to Export</h3>
        <ol className="space-y-3 mb-6">
          <li className="flex gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-600 text-white text-xs">1</span>
            <span className="text-slate-300">Open the Mocklify dashboard</span>
          </li>
          <li className="flex gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-600 text-white text-xs">2</span>
            <span className="text-slate-300">Go to the Logs tab</span>
          </li>
          <li className="flex gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-600 text-white text-xs">3</span>
            <span className="text-slate-300">Click "Export as HAR"</span>
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
      "version": "0.1.0"
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
        <p className="text-slate-400 mb-4">
          Generate cURL commands from logged requests:
        </p>

        <h3 className="text-lg font-medium mb-3">Single Request</h3>
        <p className="text-slate-400 mb-4">
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
        <p className="text-slate-400">
          Export all logs as a shell script with multiple cURL commands from the Logs tab menu.
        </p>
      </section>

      {/* JSON Export */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Configuration Export</h2>
        <p className="text-slate-400 mb-4">
          Export your mock server configuration:
        </p>

        <h3 className="text-lg font-medium mb-3">Export Server</h3>
        <p className="text-slate-400 mb-4">
          Right-click on a server and select "Export Configuration" to save as JSON.
        </p>

        <h3 className="text-lg font-medium mb-3">Share with Team</h3>
        <p className="text-slate-400 mb-4">
          The <code className="px-2 py-0.5 bg-slate-800 rounded">.mocklify</code> folder can be committed to version control to share mock configurations with your team.
        </p>

        <InfoBox type="tip">
          Add sensitive data (API keys, tokens) to your <code>.gitignore</code> or use environment variables.
        </InfoBox>
      </section>
    </div>
  );
}
