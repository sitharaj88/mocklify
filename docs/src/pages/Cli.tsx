import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import CodeBlock from '../components/CodeBlock';
import InfoBox from '../components/InfoBox';

export default function Cli() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="CLI"
        description="Run the exact mock servers your team designed in the dashboard — outside VS Code, in CI, on a build box. No editor, no AI provider, no configuration required."
      />

      {/* What & why */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">What it is</h2>
        <p className="theme-text-secondary mb-4">
          The mocks your team designs in Mocklify are saved to a committed{' '}
          <code className="text-purple-400">.mocklify/servers.json</code>. The CLI is a separate
          npm package that boots those same servers from a terminal — the same engine, the same{' '}
          <Link to="/matching" className="text-purple-400 hover:underline">request matching</Link>,
          the same <Link to="/stateful" className="text-purple-400 hover:underline">stateful data</Link>,{' '}
          <Link to="/chaos" className="text-purple-400 hover:underline">chaos</Link>, and{' '}
          <Link to="/contracts" className="text-purple-400 hover:underline">contract validation</Link>.
          That means CI runs the mocks your team already trusts, with nothing to re-declare.
        </p>
        <InfoBox type="warning" title="It is @mocklify/cli — not mocklify">
          Always install and run <code className="text-purple-400">@mocklify/cli</code>. The
          unscoped <code>mocklify</code> package on npm is an unrelated project — never run{' '}
          <code>npx mocklify</code>.
        </InfoBox>
      </section>

      {/* Install */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Install</h2>
        <p className="theme-text-secondary mb-4">
          Requires Node 18 or newer. Run it on demand with <code className="text-purple-400">npx</code>,
          or add it as a dev dependency so CI uses a pinned version.
        </p>
        <CodeBlock
          language="bash"
          code={`npx @mocklify/cli serve        # no install — run it once
npm i -D @mocklify/cli         # or pin it as a dev dependency`}
        />
        <p className="theme-text-secondary mt-4">
          Once installed the binary is <code className="text-purple-400">mocklify</code>. Run every
          command from a directory that contains <code className="text-purple-400">.mocklify/servers.json</code>{' '}
          (the same folder you commit from VS Code).
        </p>
      </section>

      {/* Commands */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Commands</h2>
        <p className="theme-text-secondary mb-4">
          Three commands, plus <code className="text-purple-400">help</code> and{' '}
          <code className="text-purple-400">version</code>. Each takes an optional{' '}
          <code className="text-purple-400">configPath</code> positional: a directory holding{' '}
          <code className="text-purple-400">servers.json</code> (default{' '}
          <code className="text-purple-400">.mocklify</code>) or a path to a{' '}
          <code className="text-purple-400">*.json</code> config file, resolved from the current
          working directory.
        </p>
        <div className="theme-bg-card rounded-xl border theme-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b theme-border">
                <th className="text-left px-4 py-3 theme-text">Command</th>
                <th className="text-left px-4 py-3 theme-text">What it does</th>
              </tr>
            </thead>
            <tbody className="theme-text-secondary">
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400 whitespace-nowrap">serve [configPath]</td>
                <td className="px-4 py-3">Start one or all mock servers and stream request logs until you stop it.</td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400 whitespace-nowrap">validate [configPath]</td>
                <td className="px-4 py-3">Validate the config; exit 1 if any server is invalid.</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-purple-400 whitespace-nowrap">list [configPath]</td>
                <td className="px-4 py-3">List servers with their protocol, port and route count.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <CodeBlock
          title="Everyday usage"
          language="bash"
          code={`mocklify serve                                  # start the single server (errors if the config has several)
mocklify serve --all                            # start every enabled server
mocklify serve --server "Payments API" --port 4010   # a named server — may be a disabled one
mocklify serve --watch                          # restart when the config changes
mocklify list                                   # name / protocol / port / route count
mocklify validate                               # validate the config; exit 1 on error
mocklify serve ./fixtures/servers.json          # use a config at another path`}
        />
      </section>

      {/* Flags */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Flags</h2>
        <div className="theme-bg-card rounded-xl border theme-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b theme-border">
                <th className="text-left px-4 py-3 theme-text">Flag</th>
                <th className="text-left px-4 py-3 theme-text">Short</th>
                <th className="text-left px-4 py-3 theme-text">Meaning</th>
              </tr>
            </thead>
            <tbody className="theme-text-secondary">
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400 whitespace-nowrap">--server &lt;name|id&gt;</td>
                <td className="px-4 py-3 font-mono">-s</td>
                <td className="px-4 py-3">Select a single server by exact name or id. May start a disabled server.</td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400 whitespace-nowrap">--all</td>
                <td className="px-4 py-3 font-mono">—</td>
                <td className="px-4 py-3">Select every enabled server in the config.</td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400 whitespace-nowrap">--port &lt;number&gt;</td>
                <td className="px-4 py-3 font-mono">-p</td>
                <td className="px-4 py-3">Override the port (1–65535). Only with a single selected server.</td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400 whitespace-nowrap">--watch</td>
                <td className="px-4 py-3 font-mono">-w</td>
                <td className="px-4 py-3">Restart servers when the config file changes.</td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400 whitespace-nowrap">--quiet</td>
                <td className="px-4 py-3 font-mono">-q</td>
                <td className="px-4 py-3">Do not stream per-request log lines.</td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400 whitespace-nowrap">--help</td>
                <td className="px-4 py-3 font-mono">-h</td>
                <td className="px-4 py-3">Show usage.</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-purple-400 whitespace-nowrap">--version</td>
                <td className="px-4 py-3 font-mono">—</td>
                <td className="px-4 py-3">Print the CLI version.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <InfoBox type="info" title="Selecting the right server">
          With no <code>--server</code> and no <code>--all</code>, a config with exactly one
          server starts it automatically — but a config with several servers is a hard error
          (exit 1), so CI never silently boots the wrong one. Pass{' '}
          <code>--server &lt;name|id&gt;</code> or <code>--all</code> to be explicit.
        </InfoBox>
      </section>

      {/* Output */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">What serve prints</h2>
        <p className="theme-text-secondary mb-4">
          On startup, <code className="text-purple-400">serve</code> prints a table of what is
          listening, warns about the bind address, then streams one line per request as{' '}
          <code className="text-purple-400">METHOD path status durationms</code>. When more than
          one server runs, each line is prefixed with <code className="text-purple-400">[name]</code>.
        </p>
        <CodeBlock
          title="serve output"
          language="text"
          code={`NAME          PROTOCOL  PORT  ROUTES  URL
Payments API  http      4010  12      http://localhost:4010

Warning: servers bind 0.0.0.0 and are reachable from other devices on your network, not just this machine.

Listening. Press Ctrl+C to stop.
GET    /invoices 200 3ms
POST   /invoices 201 5ms
GET    /invoices/999 404 2ms`}
        />
        <p className="theme-text-secondary mt-4">
          <code className="text-purple-400">list</code> prints one line per server as{' '}
          <code className="text-purple-400">name  [protocol]  port N  M route(s)</code>, with a{' '}
          <code className="text-purple-400">(disabled)</code> suffix on disabled servers.{' '}
          <code className="text-purple-400">validate</code> prints{' '}
          <code className="text-purple-400">OK — N valid server(s)…</code> or, on failure, the
          per-server issues before exiting 1.
        </p>
      </section>

      {/* Exit codes */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Exit codes</h2>
        <p className="theme-text-secondary mb-4">
          Exit codes are part of the CLI contract, so a CI step fails for the right reason.
        </p>
        <div className="theme-bg-card rounded-xl border theme-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b theme-border">
                <th className="text-left px-4 py-3 theme-text">Code</th>
                <th className="text-left px-4 py-3 theme-text">Meaning</th>
              </tr>
            </thead>
            <tbody className="theme-text-secondary">
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400">0</td>
                <td className="px-4 py-3">Success.</td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400">1</td>
                <td className="px-4 py-3">Config or validation error (missing file, bad JSON, invalid server, ambiguous selection).</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-purple-400">2</td>
                <td className="px-4 py-3">Port already in use.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="theme-text-secondary mt-4">
          <code className="text-purple-400">serve</code> shuts every server down cleanly on{' '}
          <code className="text-purple-400">SIGINT</code> (Ctrl+C) or{' '}
          <code className="text-purple-400">SIGTERM</code>.
        </p>
      </section>

      {/* Bind warning */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Network bind address</h2>
        <InfoBox type="warning" title="Servers bind 0.0.0.0, not just localhost">
          Mock servers bind to all interfaces (<code>0.0.0.0</code>), so they are reachable from
          other devices on the same network — not only from the machine running the CLI. That is
          deliberate: Mocklify is commonly used to mock APIs for phones and simulators on the same
          Wi-Fi, which need to reach your machine by its LAN address. The CLI prints this warning
          to <code>stderr</code> at startup so it is never a surprise. On an untrusted network,
          keep this in mind.
        </InfoBox>
      </section>

      {/* Contract enforcement */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Contract enforcement, headless</h2>
        <p className="theme-text-secondary mb-4">
          If a server declares an OpenAPI contract, the CLI validates against it exactly as the
          extension does — spec paths resolve against the config file&apos;s directory.{' '}
          <code className="text-purple-400">warn</code> logs violations;{' '}
          <code className="text-purple-400">enforce</code> answers a non-conforming request with{' '}
          <code className="text-purple-400">400</code> before generating a response. This is how
          you fail a build when a client sends a request the contract forbids.
        </p>
        <CodeBlock
          title=".mocklify/servers.json (excerpt)"
          language="json"
          code={`{
  "name": "Payments API",
  "port": 4010,
  "contract": { "specPath": "openapi.yaml", "mode": "enforce" },
  "routes": []
}`}
        />
        <InfoBox type="info" title="WebSocket is extension-only">
          WebSocket servers are only supported inside VS Code — the CLI skips them with a warning
          on <code>stderr</code> and starts the rest. HTTP contract validation, stateful data, and
          chaos all run identically to the extension.{' '}
          <Link to="/contracts" className="text-purple-400 hover:underline">Contract validation</Link>{' '}
          has the full detail.
        </InfoBox>
      </section>

      {/* CI */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">GitHub Actions</h2>
        <p className="theme-text-secondary mb-4">
          Start the mocks in the background with <code className="text-purple-400">--quiet</code>,
          wait for the port, then run your test suite pointed at the mock:
        </p>
        <CodeBlock
          title=".github/workflows/contract-tests.yml"
          language="yaml"
          code={`jobs:
  contract-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npx @mocklify/cli serve --quiet &
      - run: npx wait-on tcp:3000
      - run: npm test          # your app under test, pointed at http://localhost:3000`}
        />
        <InfoBox type="tip">
          Run <code>mocklify validate</code> as its own step first — it exits 1 with the exact
          per-server issues if the committed config drifted, catching a broken{' '}
          <code>servers.json</code> before you waste a full test run. See{' '}
          <Link to="/getting-started" className="text-purple-400 hover:underline">Getting Started</Link>{' '}
          to design the servers this CLI runs.
        </InfoBox>
      </section>
    </div>
  );
}
