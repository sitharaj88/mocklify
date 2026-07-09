import { Link } from 'react-router-dom';
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
        <p className="theme-text-secondary mb-4">
          Routes define how your mock server responds to specific HTTP requests.
        </p>
        
        <CodeBlock
          title="Basic Route (as stored in .mocklify/servers.json)"
          language="json"
          code={`{
  "id": "3f1a7b2c-8d4e-4f9a-b1c2-5e6d7a8b9c0d",
  "name": "Get Users",
  "enabled": true,
  "method": "GET",
  "path": "/api/users",
  "response": {
    "type": "static",
    "statusCode": 200,
    "headers": {
      "Content-Type": "application/json"
    },
    "body": {
      "contentType": "application/json",
      "content": {
        "users": [
          { "id": 1, "name": "John Doe" },
          { "id": 2, "name": "Jane Smith" }
        ]
      }
    }
  }
}`}
        />
        <InfoBox type="info" title="These snippets are abbreviated">
          The route above is a complete route object exactly as it is persisted in{' '}
          <code>.mocklify/servers.json</code>: a generated <code>id</code>, an <code>enabled</code>{' '}
          flag, and a response whose <code>type</code> is <code>static</code> and whose payload is
          nested under <code>body.content</code> (with a <code>body.contentType</code>). The shorter
          JSON snippets in the sections below focus on one field at a time and drop this surrounding
          envelope — you normally never hand-edit any of it: the dashboard generates the{' '}
          <code>id</code> and the full shape for you when you add a route.
        </InfoBox>
      </section>

      {/* Route Properties */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Route Fields</h2>
        <p className="theme-text-secondary mb-4">
          A route is one entry in a server&apos;s <code className="text-purple-400">routes</code>{' '}
          array. These are every field it accepts, with the exact name and type from{' '}
          <code className="text-purple-400">RouteConfig</code>. Fields that have their own page
          link to it.
        </p>
        <div className="theme-bg-card rounded-xl border theme-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b theme-border">
                <th className="text-left px-4 py-3 theme-text">Field</th>
                <th className="text-left px-4 py-3 theme-text">Type</th>
                <th className="text-left px-4 py-3 theme-text">Required</th>
                <th className="text-left px-4 py-3 theme-text">Description</th>
              </tr>
            </thead>
            <tbody className="theme-text-secondary">
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400">id</td>
                <td className="px-4 py-3 font-mono">string (uuid)</td>
                <td className="px-4 py-3">Yes</td>
                <td className="px-4 py-3">Unique id — generated for you when you add a route</td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400">name</td>
                <td className="px-4 py-3 font-mono">string</td>
                <td className="px-4 py-3">Yes</td>
                <td className="px-4 py-3">Display name</td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400">enabled</td>
                <td className="px-4 py-3 font-mono">boolean</td>
                <td className="px-4 py-3">Yes</td>
                <td className="px-4 py-3">Disabled routes never match — used for negative-flow routes</td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400">method</td>
                <td className="px-4 py-3 font-mono">HttpMethod | HttpMethod[]</td>
                <td className="px-4 py-3">Yes</td>
                <td className="px-4 py-3">GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS, TRACE, CONNECT — or an array</td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400">path</td>
                <td className="px-4 py-3 font-mono">string</td>
                <td className="px-4 py-3">Yes</td>
                <td className="px-4 py-3">URL path, with <code>:param</code> segments</td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400">response</td>
                <td className="px-4 py-3 font-mono">ResponseConfig</td>
                <td className="px-4 py-3">Yes</td>
                <td className="px-4 py-3">Status, headers, body, template, proxy, database, or sequence</td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400">matcher</td>
                <td className="px-4 py-3 font-mono">RequestMatcher</td>
                <td className="px-4 py-3">No</td>
                <td className="px-4 py-3">
                  Match by headers, query params, and body —{' '}
                  <Link to="/matching" className="text-purple-400 hover:underline">Request Matching</Link>
                </td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400">delay</td>
                <td className="px-4 py-3 font-mono">DelayConfig</td>
                <td className="px-4 py-3">No</td>
                <td className="px-4 py-3"><code>{'{ type: "fixed", value }'}</code> or <code>{'{ type: "random", min, max }'}</code></td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400">priority</td>
                <td className="px-4 py-3 font-mono">number</td>
                <td className="px-4 py-3">No</td>
                <td className="px-4 py-3">Tie-breaker when several routes match — higher wins (adds <code>priority × 1000</code> to the match score)</td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400">tags</td>
                <td className="px-4 py-3 font-mono">string[]</td>
                <td className="px-4 py-3">No</td>
                <td className="px-4 py-3">Labels for filtering; <code>negative</code> marks failure-scenario routes</td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400">stateful</td>
                <td className="px-4 py-3 font-mono">StatefulConfig</td>
                <td className="px-4 py-3">No</td>
                <td className="px-4 py-3">
                  CRUD over a shared in-memory collection —{' '}
                  <Link to="/stateful" className="text-purple-400 hover:underline">Stateful Data</Link>
                </td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400">chaos</td>
                <td className="px-4 py-3 font-mono">ChaosConfig</td>
                <td className="px-4 py-3">No</td>
                <td className="px-4 py-3">
                  Per-route latency/failure override —{' '}
                  <Link to="/chaos" className="text-purple-400 hover:underline">Chaos</Link>
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-purple-400">graphql</td>
                <td className="px-4 py-3 font-mono">GraphQlRoute</td>
                <td className="px-4 py-3">No</td>
                <td className="px-4 py-3">
                  Match by GraphQL operation instead of body matchers —{' '}
                  <Link to="/graphql" className="text-purple-400 hover:underline">GraphQL</Link>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Path Parameters */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Path Parameters</h2>
        <p className="theme-text-secondary mb-4">
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
        <p className="theme-text-secondary mb-4">
          Simulate network latency with fixed or random delays:
        </p>
        
        <h3 className="text-lg font-medium mb-3">Fixed Delay</h3>
        <CodeBlock
          language="json"
          code={`{
  "delay": { "type": "fixed", "value": 500 }
}`}
        />

        <h3 className="text-lg font-medium mb-3 mt-6">Random Delay</h3>
        <CodeBlock
          language="json"
          code={`{
  "delay": { "type": "random", "min": 100, "max": 2000 }
}`}
        />
      </section>

      {/* Error Responses */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Error Responses</h2>
        <p className="theme-text-secondary mb-4">
          To return an error for a specific record, match on something the{' '}
          <Link to="/matching" className="text-purple-400 hover:underline">matcher</Link> supports —
          a header, a query param, or the body. The matcher cannot compare a{' '}
          <em>path</em>-parameter value (it has no <code>params</code> field), so key the negative
          route on a query param instead:
        </p>
        <CodeBlock
          language="json"
          code={`{
  "name": "Not Found",
  "method": "GET",
  "path": "/api/users",
  "matcher": {
    "queryParams": {
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

      {/* Per-route chaos */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Per-Route Chaos Override</h2>
        <p className="theme-text-secondary mb-4">
          A route can override the server&apos;s chaos setting via a <code>chaos</code> block — it fully
          replaces server chaos for that route. Use <code>{`{ "enabled": false }`}</code> to exempt a
          route from server-wide chaos. Configure it in the route&apos;s <strong>Advanced</strong> tab. See{' '}
          <Link to="/chaos" className="text-purple-400 hover:underline">Chaos</Link> for presets and
          precedence.
        </p>
        <CodeBlock
          language="json"
          code={`{
  "name": "Flaky Search",
  "method": "GET",
  "path": "/api/search",
  "chaos": { "enabled": true, "failureRate": 0.3, "failureStatus": 503 },
  "response": { "statusCode": 200, "body": { "results": [] } }
}`}
        />
        <InfoBox type="tip">
          The effective chaos for a request is <code>matchedRoute.chaos ?? server.chaos</code>.
        </InfoBox>
      </section>

      {/* Contract validation */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Contract Validation</h2>
        <p className="theme-text-secondary mb-4">
          Run <strong>Mocklify: Configure Contract Validation</strong> to validate incoming requests
          against an OpenAPI 3.x spec. In <strong>warn</strong> mode violations are attached to the
          request log; in <strong>enforce</strong> mode a violating request gets a <code>400</code>
          before the mock response is generated. The setting is stored per server:
        </p>
        <CodeBlock
          language="json"
          code={`{
  "name": "Payments API",
  "port": 3000,
  "contract": { "specPath": "openapi.yaml", "mode": "enforce" },
  "routes": []
}`}
        />
        <InfoBox type="info">
          Contract validation is HTTP-only and reloads automatically when the spec changes on disk.
          See <Link to="/contracts" className="text-purple-400 hover:underline">Contract Validation</Link>{' '}
          for what is checked and the enforce-mode response.
        </InfoBox>
      </section>

      {/* Related */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Go Deeper</h2>
        <ul className="space-y-2 theme-text-secondary">
          <li>• <Link to="/stateful" className="text-purple-400 hover:underline">Stateful Data</Link> — the <code className="text-purple-400">stateful</code> block for POST-then-GET CRUD</li>
          <li>• <Link to="/graphql" className="text-purple-400 hover:underline">GraphQL</Link> — the <code className="text-purple-400">graphql</code> block for operation-based matching</li>
          <li>• <Link to="/matching" className="text-purple-400 hover:underline">Request Matching</Link> — the <code className="text-purple-400">matcher</code> block</li>
          <li>• <Link to="/sequences" className="text-purple-400 hover:underline">Response Sequences</Link> — a route that returns different responses on successive calls</li>
        </ul>
      </section>
    </div>
  );
}
