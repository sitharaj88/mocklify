import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import CodeBlock from '../components/CodeBlock';
import InfoBox from '../components/InfoBox';

export default function Contracts() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Contract Validation"
        description="Validate incoming requests against an OpenAPI 3.x spec — warn on drift while you develop, or enforce the contract with a 400 in CI."
      />

      {/* What it does */}
      <section>
        <p className="theme-text-secondary mb-4">
          Attach an OpenAPI 3.x spec to any HTTP mock server and Mocklify checks every matched
          request against it before generating a response. In <strong>warn</strong> mode the
          normal response is served unchanged and violations are recorded on the request log; in{' '}
          <strong>enforce</strong> mode a violating request is rejected with a{' '}
          <code className="text-purple-400">400</code> and the list of violations. The same
          validator runs in the extension and in the{' '}
          <Link to="/cli" className="text-purple-400 hover:underline">headless CLI</Link>, so a
          contract you set up locally also guards your pipeline.
        </p>
      </section>

      {/* Configure */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Turn it on</h2>
        <p className="theme-text-secondary mb-4">
          Run <code className="text-purple-400">Mocklify: Configure Contract Validation</code>{' '}
          (or use a server&apos;s context menu). Pick the HTTP server, choose a spec, then choose a
          mode:
        </p>
        <ol className="space-y-3 mb-4">
          <li className="flex gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-600 text-white text-xs shrink-0">1</span>
            <span className="theme-text">
              Select the server. The command applies to HTTP servers only — it warns and no-ops on
              WebSocket servers.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-600 text-white text-xs shrink-0">2</span>
            <span className="theme-text">
              Pick a spec. Mocklify lists <code className="text-purple-400">*openapi*</code> /{' '}
              <code className="text-purple-400">*swagger*</code> files found in your workspace, or
              choose <strong>Browse…</strong> to point at one anywhere on disk.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-600 text-white text-xs shrink-0">3</span>
            <span className="theme-text">
              Choose <strong>Warn</strong> or <strong>Enforce</strong>. Choosing{' '}
              <strong>Disable contract validation</strong> clears the contract from the server.
            </span>
          </li>
        </ol>
        <p className="theme-text-secondary">
          The choice is persisted as a server-level <code className="text-purple-400">contract</code>{' '}
          block in <code className="text-purple-400">.mocklify/servers.json</code>. The{' '}
          <code className="text-purple-400">specPath</code> is stored relative to the workspace root
          (extension) and resolved relative to the config file&apos;s directory (CLI), so a committed
          config works on any machine.
        </p>

        <CodeBlock
          title=".mocklify/servers.json — server-level contract block"
          language="json"
          code={`{
  "version": "1.0",
  "servers": [
    {
      "id": "b7d22ecd-868b-4519-b606-6229deb1dec8",
      "name": "Orders API",
      "protocol": "http",
      "port": 3000,
      "contract": {
        "specPath": "openapi/orders.yaml",
        "mode": "enforce"
      },
      "routes": []
    }
  ]
}`}
        />
        <InfoBox type="info" title="No chaos-style settings">
          There is no <code>mocklify.contract.*</code> setting. Contract validation is per-server
          config written by the <strong>Configure Contract Validation</strong> command, not a global
          setting.
        </InfoBox>
      </section>

      {/* Modes */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">off · warn · enforce</h2>
        <div className="theme-bg-card rounded-xl border theme-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b theme-border">
                <th className="text-left px-4 py-3 theme-text">Mode</th>
                <th className="text-left px-4 py-3 theme-text">Response</th>
                <th className="text-left px-4 py-3 theme-text">Violations</th>
              </tr>
            </thead>
            <tbody className="theme-text-secondary">
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-medium text-purple-400">off</td>
                <td className="px-4 py-3">Normal response — validation is skipped entirely.</td>
                <td className="px-4 py-3">Not computed.</td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-medium text-purple-400">warn</td>
                <td className="px-4 py-3">Normal response, served unchanged.</td>
                <td className="px-4 py-3">
                  Attached to the request log entry as{' '}
                  <code className="text-purple-400">validation: {'{ mode, ok, violations }'}</code>.
                  The dashboard shows an amber shield on the log row.
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-medium text-purple-400">enforce</td>
                <td className="px-4 py-3">
                  A violating request is rejected with{' '}
                  <code className="text-purple-400">400</code>{' '}
                  <strong>before</strong> the response is generated. Valid requests pass through
                  unchanged.
                </td>
                <td className="px-4 py-3">Returned in the 400 body and logged.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="theme-text-secondary mt-4">
          Validation runs only on requests that <strong>match a route</strong>; unmatched (404)
          requests are not validated.
        </p>

        <CodeBlock
          title="enforce mode — a rejected request"
          language="json"
          code={`HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "error": "Contract violation",
  "mode": "enforce",
  "violations": [
    { "field": "body.email", "message": "Missing required property \\"email\\"." },
    { "field": "query.status", "message": "Parameter \\"query.status\\" must be one of: \\"open\\", \\"shipped\\", \\"closed\\"." }
  ]
}`}
        />
      </section>

      {/* What is validated */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">What gets validated</h2>
        <p className="theme-text-secondary mb-4">
          Mocklify matches the request path to the <strong>most specific</strong> spec path template
          (more literal segments win), then validates against that operation. Two things are checked:
        </p>
        <ul className="space-y-2 theme-text-secondary mb-4">
          <li>
            • <strong>Parameters</strong> — path, query, and header parameters, for{' '}
            <code className="text-purple-400">required</code>,{' '}
            <code className="text-purple-400">type</code> (string / integer / number / boolean),
            and <code className="text-purple-400">enum</code>. Path parameters are always treated as
            required.
          </li>
          <li>
            • <strong>JSON request body</strong> — the{' '}
            <code className="text-purple-400">application/json</code> schema, checking types,{' '}
            <code className="text-purple-400">required</code> properties,{' '}
            <code className="text-purple-400">enum</code>,{' '}
            <code className="text-purple-400">nullable</code> (3.0) /{' '}
            <code className="text-purple-400">type: "null"</code> (3.1), and{' '}
            <code className="text-purple-400">additionalProperties: false</code>. Local{' '}
            <code className="text-purple-400">$ref</code> pointers, plus{' '}
            <code className="text-purple-400">allOf</code> /{' '}
            <code className="text-purple-400">anyOf</code> /{' '}
            <code className="text-purple-400">oneOf</code>, are resolved cycle-safely.
          </li>
        </ul>
        <InfoBox type="warning" title="Requests only — not responses">
          Contract validation checks the <strong>incoming request</strong> against the spec. Your
          mock&apos;s response bodies are not validated against the spec&apos;s response schemas.
        </InfoBox>

        <h3 className="text-lg font-medium mb-3 mt-6">Path / operation coverage</h3>
        <p className="theme-text-secondary mb-4">
          When the request cannot be placed in the spec, that itself is a violation:
        </p>
        <div className="theme-bg-card rounded-xl border theme-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b theme-border">
                <th className="text-left px-4 py-3 theme-text">Case</th>
                <th className="text-left px-4 py-3 theme-text">Violation field &amp; message</th>
              </tr>
            </thead>
            <tbody className="theme-text-secondary">
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-medium text-purple-400">unknown-path</td>
                <td className="px-4 py-3 font-mono text-xs">
                  path — no matching path template in the contract for &quot;/api/…&quot;.
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-medium text-purple-400">unknown-operation</td>
                <td className="px-4 py-3 font-mono text-xs">
                  method — the contract has no POST operation for path &quot;/api/orders&quot;.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Guardrails */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Guardrails</h2>
        <p className="theme-text-secondary mb-4">
          The validator is bounded so a large or adversarial (deeply nested, cyclic) spec can never
          hang a request:
        </p>
        <div className="theme-bg-card rounded-xl border theme-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b theme-border">
                <th className="text-left px-4 py-3 theme-text">Limit</th>
                <th className="text-left px-4 py-3 theme-text">Value</th>
              </tr>
            </thead>
            <tbody className="theme-text-secondary">
              <tr className="border-b theme-border">
                <td className="px-4 py-3">Violations reported per request</td>
                <td className="px-4 py-3 font-mono text-purple-400">50</td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3">Schema recursion depth</td>
                <td className="px-4 py-3 font-mono text-purple-400">64</td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3">Node-visit budget per request</td>
                <td className="px-4 py-3 font-mono text-purple-400">20000</td>
              </tr>
              <tr>
                <td className="px-4 py-3">Union branches explored (anyOf / oneOf / allOf)</td>
                <td className="px-4 py-3 font-mono text-purple-400">24</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="theme-text-secondary mt-4">
          The spec is loaded once per server and reloaded automatically when the file changes on
          disk. If a spec cannot be read or parsed, the server degrades to{' '}
          <code className="text-purple-400">off</code> rather than failing requests.
        </p>
      </section>

      {/* CI */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Enforce in CI</h2>
        <p className="theme-text-secondary mb-4">
          Because the CLI runs the identical validator, an <code className="text-purple-400">enforce</code>{' '}
          contract turns a mock server into a request-shape gate for contract tests. Spec paths in
          the config resolve against the config file&apos;s directory, so the same{' '}
          <code className="text-purple-400">.mocklify/</code> folder works headless.
        </p>
        <CodeBlock
          title="Run the enforcing mock in CI"
          language="bash"
          code={`# start the mock (contract mode "enforce" from servers.json) and run your tests against it
mocklify serve .mocklify --quiet &
npm test`}
        />
        <p className="theme-text-secondary mt-4">
          See <Link to="/cli" className="text-purple-400 hover:underline">CLI</Link> for flags and
          exit codes, and{' '}
          <Link to="/import" className="text-purple-400 hover:underline">Import &amp; Export</Link>{' '}
          for turning the same OpenAPI spec into a mock server or exporting one back out.{' '}
          <Link to="/ai" className="text-purple-400 hover:underline">AI Features</Link> can generate
          a spec-first mock from an existing contract.
        </p>
      </section>
    </div>
  );
}
