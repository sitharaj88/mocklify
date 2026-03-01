import PageHeader from '../components/PageHeader';
import CodeBlock from '../components/CodeBlock';
import InfoBox from '../components/InfoBox';

export default function Routes() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Routes"
        description="Define API endpoints with custom responses, methods, and behavior."
      />

      {/* Creating Routes */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Creating Routes</h2>
        <p className="text-slate-400 mb-4">
          Routes define how your mock server responds to specific HTTP requests.
        </p>
        
        <CodeBlock
          title="Basic Route"
          language="json"
          code={`{
  "name": "Get Users",
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
  }
}`}
        />
      </section>

      {/* Route Properties */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Route Properties</h2>
        <div className="bg-[#1a2332] rounded-xl border border-slate-800 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="text-left px-4 py-3 text-slate-300">Property</th>
                <th className="text-left px-4 py-3 text-slate-300">Required</th>
                <th className="text-left px-4 py-3 text-slate-300">Description</th>
              </tr>
            </thead>
            <tbody className="text-slate-400">
              <tr className="border-b border-slate-800">
                <td className="px-4 py-3 font-mono text-purple-400">name</td>
                <td className="px-4 py-3">Yes</td>
                <td className="px-4 py-3">Display name</td>
              </tr>
              <tr className="border-b border-slate-800">
                <td className="px-4 py-3 font-mono text-purple-400">method</td>
                <td className="px-4 py-3">Yes</td>
                <td className="px-4 py-3">GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD</td>
              </tr>
              <tr className="border-b border-slate-800">
                <td className="px-4 py-3 font-mono text-purple-400">path</td>
                <td className="px-4 py-3">Yes</td>
                <td className="px-4 py-3">URL path (supports parameters)</td>
              </tr>
              <tr className="border-b border-slate-800">
                <td className="px-4 py-3 font-mono text-purple-400">response</td>
                <td className="px-4 py-3">Yes</td>
                <td className="px-4 py-3">Response configuration</td>
              </tr>
              <tr className="border-b border-slate-800">
                <td className="px-4 py-3 font-mono text-purple-400">delay</td>
                <td className="px-4 py-3">No</td>
                <td className="px-4 py-3">Response delay in ms</td>
              </tr>
              <tr className="border-b border-slate-800">
                <td className="px-4 py-3 font-mono text-purple-400">matcher</td>
                <td className="px-4 py-3">No</td>
                <td className="px-4 py-3">Request matching rules</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-purple-400">tags</td>
                <td className="px-4 py-3">No</td>
                <td className="px-4 py-3">Array of tags for filtering</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Path Parameters */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Path Parameters</h2>
        <p className="text-slate-400 mb-4">
          Use colons to define dynamic path segments:
        </p>
        <CodeBlock
          language="json"
          code={`{
  "path": "/api/users/:id",
  "response": {
    "body": {
      "id": "{{request.params.id}}",
      "name": "User {{request.params.id}}"
    }
  }
}`}
        />
        
        <InfoBox type="tip">
          Access path parameters in templates using <code>{"{{request.params.paramName}}"}</code>
        </InfoBox>
      </section>

      {/* Response Configuration */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Response Configuration</h2>
        
        <h3 className="text-lg font-medium mb-3">Status Codes</h3>
        <CodeBlock
          language="json"
          code={`{
  "response": {
    "statusCode": 201,
    "body": { "message": "Created successfully" }
  }
}`}
        />

        <h3 className="text-lg font-medium mb-3 mt-6">Custom Headers</h3>
        <CodeBlock
          language="json"
          code={`{
  "response": {
    "statusCode": 200,
    "headers": {
      "X-Request-Id": "{{uuid}}",
      "X-RateLimit-Remaining": "99",
      "Cache-Control": "no-cache"
    },
    "body": { "success": true }
  }
}`}
        />
      </section>

      {/* Response Delays */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Response Delays</h2>
        <p className="text-slate-400 mb-4">
          Simulate network latency with fixed or random delays:
        </p>
        
        <h3 className="text-lg font-medium mb-3">Fixed Delay</h3>
        <CodeBlock
          language="json"
          code={`{
  "delay": 500
}`}
        />

        <h3 className="text-lg font-medium mb-3 mt-6">Random Delay</h3>
        <CodeBlock
          language="json"
          code={`{
  "delay": {
    "min": 100,
    "max": 2000
  }
}`}
        />
      </section>

      {/* Error Responses */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Error Responses</h2>
        <CodeBlock
          language="json"
          code={`{
  "name": "Not Found",
  "method": "GET",
  "path": "/api/users/:id",
  "matcher": {
    "params": {
      "id": "999"
    }
  },
  "response": {
    "statusCode": 404,
    "body": {
      "error": "User not found",
      "code": "USER_NOT_FOUND"
    }
  }
}`}
        />
      </section>
    </div>
  );
}
