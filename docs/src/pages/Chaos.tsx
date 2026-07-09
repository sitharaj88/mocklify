import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import CodeBlock from '../components/CodeBlock';
import InfoBox from '../components/InfoBox';

export default function Chaos() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Chaos"
        description="Inject random failures and latency so you can test retries, timeouts, and error UI against your mocks — server-wide, per route, or on demand."
      />

      {/* Overview */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">What chaos does</h2>
        <p className="theme-text-secondary mb-4">
          Chaos makes an otherwise perfect mock misbehave on purpose. When it is on, each request
          may be delayed by a random amount and may be short-circuited with a failure status
          before any normal response is generated. It is the fastest way to exercise the parts of
          your app that only run when the network is slow or the server is down — retry loops,
          spinners, timeouts, and error screens.
        </p>
        <p className="theme-text-secondary mb-4">
          Turn it on from the dashboard or the{' '}
          <code className="text-purple-400">Mocklify: Configure Chaos (Latency &amp; Failures)</code>{' '}
          command. Chaos hot-reloads onto a running server — no restart needed — and the same
          config runs headless in the <Link to="/cli" className="text-purple-400 hover:underline">CLI</Link>.
        </p>
        <InfoBox type="info" title="HTTP only">
          Chaos is consulted only by the HTTP server. Configure Chaos warns and no-ops on GraphQL
          or WebSocket servers.
        </InfoBox>
      </section>

      {/* Server-level chaos */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Server-wide chaos and presets</h2>
        <p className="theme-text-secondary mb-4">
          Run <strong>Configure Chaos</strong> on a server and pick a preset from the QuickPick.
          The choice is saved to the server&apos;s <code className="text-purple-400">chaos</code>{' '}
          block in <code className="text-purple-400">servers.json</code> and applies to{' '}
          <strong>every</strong> route on that server.
        </p>
        <div className="theme-bg-card rounded-xl border theme-border overflow-x-auto mb-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b theme-border">
                <th className="text-left px-4 py-3 theme-text">Preset</th>
                <th className="text-left px-4 py-3 theme-text">Effect</th>
                <th className="text-left px-4 py-3 theme-text">Config written</th>
              </tr>
            </thead>
            <tbody className="theme-text-secondary">
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-medium text-purple-400">Off</td>
                <td className="px-4 py-3">Disable chaos (keeps prior numbers so re-enabling is one step)</td>
                <td className="px-4 py-3 font-mono text-xs">{'{ enabled: false }'}</td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-medium text-purple-400">Flaky</td>
                <td className="px-4 py-3">10% of requests fail with 503</td>
                <td className="px-4 py-3 font-mono text-xs">failureRate: 0.1, failureStatus: 503</td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-medium text-purple-400">Unstable</td>
                <td className="px-4 py-3">30% failures plus 500–2000ms jitter</td>
                <td className="px-4 py-3 font-mono text-xs">failureRate: 0.3, minDelayMs: 500, maxDelayMs: 2000</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-medium text-purple-400">Custom…</td>
                <td className="px-4 py-3">Prompts for failure rate %, status code, and min/max delay</td>
                <td className="px-4 py-3 font-mono text-xs">whatever you enter</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="theme-text-secondary mb-4">
          On a failure roll the request is answered with the configured{' '}
          <code className="text-purple-400">failureStatus</code> (default{' '}
          <code className="text-purple-400">503</code>) and this exact body, and the failure shows
          up in the request log:
        </p>
        <CodeBlock
          title="Chaos failure response body"
          language="json"
          code={`{
  "error": "Simulated failure (Mocklify chaos)",
  "chaos": true
}`}
        />
      </section>

      {/* Config shape */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">The chaos config</h2>
        <p className="theme-text-secondary mb-4">
          Every field except <code className="text-purple-400">enabled</code> is optional. The
          same shape is used at the server level and, as an override, at the route level.
        </p>
        <div className="theme-bg-card rounded-xl border theme-border overflow-x-auto mb-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b theme-border">
                <th className="text-left px-4 py-3 theme-text">Field</th>
                <th className="text-left px-4 py-3 theme-text">Type / range</th>
                <th className="text-left px-4 py-3 theme-text">Meaning</th>
              </tr>
            </thead>
            <tbody className="theme-text-secondary">
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400">enabled</td>
                <td className="px-4 py-3">boolean (required)</td>
                <td className="px-4 py-3">Master switch — nothing happens unless true</td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400">failureRate</td>
                <td className="px-4 py-3">0–1</td>
                <td className="px-4 py-3">Probability a given request fails</td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400">failureStatus</td>
                <td className="px-4 py-3">100–599 (default 503)</td>
                <td className="px-4 py-3">Status code returned on a failure roll</td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400">minDelayMs</td>
                <td className="px-4 py-3">≥ 0</td>
                <td className="px-4 py-3">Lower bound of the injected latency</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-purple-400">maxDelayMs</td>
                <td className="px-4 py-3">≥ 0</td>
                <td className="px-4 py-3">Upper bound of the injected latency</td>
              </tr>
            </tbody>
          </table>
        </div>
        <InfoBox type="warning" title="Latency is clamped to 60 seconds">
          The delay is awaited inside the request handler before any reply is sent, so an
          unbounded value would hold sockets open indefinitely. Injected latency is clamped to a
          maximum of <code>60000ms</code> (60s), and inverted bounds (max &lt; min) collapse to the
          minimum.
        </InfoBox>
      </section>

      {/* Per-route chaos */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Per-route override and precedence</h2>
        <p className="theme-text-secondary mb-4">
          Any route can carry its own <code className="text-purple-400">chaos</code> block. The
          effective chaos for a request is:
        </p>
        <CodeBlock
          language="text"
          code={`effective chaos = matchedRoute?.chaos ?? server.chaos`}
        />
        <p className="theme-text-secondary mt-4 mb-4">
          A route-level block <strong>fully replaces</strong> server chaos for that route — it
          does not merge. Two consequences follow directly:
        </p>
        <ul className="space-y-2 theme-text-secondary mb-4">
          <li>
            • A route can be <strong>more</strong> chaotic than its server (its own higher rate or
            longer delays win).
          </li>
          <li>
            • A route carrying <code className="text-purple-400">{'{ "enabled": false }'}</code> is{' '}
            <strong>exempt</strong> from server-wide chaos even while server chaos is on — its
            override replaces the server config, and disabled chaos is a no-op. Use this to keep a
            health check or auth endpoint reliable while the rest of the server misbehaves.
          </li>
          <li>
            • Unmatched requests (404s) have no route, so they fall back to{' '}
            <code className="text-purple-400">server.chaos</code>.
          </li>
        </ul>
        <CodeBlock
          title="servers.json (abbreviated) — server chaos on, one route exempt, one route worse"
          language="json"
          code={`{
  "name": "Orders API",
  "port": 3000,
  "protocol": "http",
  "chaos": { "enabled": true, "failureRate": 0.1, "failureStatus": 503 },
  "routes": [
    {
      "name": "Health check",
      "method": "GET",
      "path": "/health",
      "chaos": { "enabled": false },
      "response": { "statusCode": 200, "body": { "status": "ok" } }
    },
    {
      "name": "Create order",
      "method": "POST",
      "path": "/orders",
      "chaos": {
        "enabled": true,
        "failureRate": 0.5,
        "failureStatus": 500,
        "minDelayMs": 800,
        "maxDelayMs": 3000
      },
      "response": { "statusCode": 201, "body": { "id": "ord_1" } }
    }
  ]
}`}
        />
        <p className="theme-text-secondary mt-4">
          The <Link to="/routes" className="text-purple-400 hover:underline">route reference</Link>{' '}
          documents the full route shape, and{' '}
          <Link to="/stateful" className="text-purple-400 hover:underline">Stateful Data</Link> is
          the sibling advanced feature you will often combine with chaos.
        </p>
      </section>

      {/* Simulate Scenario */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Simulate Scenario — deterministic failures</h2>
        <p className="theme-text-secondary mb-4">
          Chaos is random. When you instead want a specific, repeatable failure — &quot;show me
          exactly what the app does on a 401&quot; — use{' '}
          <code className="text-purple-400">Mocklify: Simulate Scenario (Happy Path / Failures)</code>.
          It flips a whole server between the happy path and one chosen failure by toggling the{' '}
          <code className="text-purple-400">negative</code>-tagged routes the AI generators create.
        </p>
        <p className="theme-text-secondary mb-4">
          The QuickPick always offers <strong>Happy path</strong> plus one entry per distinct
          negative status present on the server — for example{' '}
          <code className="text-purple-400">401 unauthorized</code>,{' '}
          <code className="text-purple-400">404 not found</code>,{' '}
          <code className="text-purple-400">429 rate limiting</code>,{' '}
          <code className="text-purple-400">500 errors</code>,{' '}
          <code className="text-purple-400">slow responses</code>, or{' '}
          <code className="text-purple-400">GraphQL errors</code>. Both scenarios reset to the
          happy-path baseline first, so switching between failures never stacks them.
        </p>
        <InfoBox type="tip" title="Chaos vs. Simulate Scenario">
          Reach for <strong>chaos</strong> to test resilience under unpredictable failures and
          latency; reach for <strong>Simulate Scenario</strong> to reproduce one exact error state
          on demand. A server with no <code>negative</code>-tagged routes offers to generate them
          from your codebase first — see{' '}
          <Link to="/ai" className="text-purple-400 hover:underline">AI Features</Link>.
        </InfoBox>
      </section>

      {/* CLI note */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Chaos runs headless</h2>
        <p className="theme-text-secondary">
          Chaos is stored in <code className="text-purple-400">servers.json</code>, so it runs
          identically when you serve the config from the{' '}
          <Link to="/cli" className="text-purple-400 hover:underline">CLI</Link> in CI — a great
          way to prove your retry and timeout handling under load without the editor open.
        </p>
      </section>
    </div>
  );
}
