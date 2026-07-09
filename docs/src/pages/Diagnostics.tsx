import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import CodeBlock from '../components/CodeBlock';
import InfoBox from '../components/InfoBox';

export default function Diagnostics() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Diagnostics"
        description="Generate a redacted, paste-ready bug report — with your API keys, gateway URLs, absolute paths, route bodies, and request logs kept out of it."
      />

      {/* Report Issue */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Report Issue</h2>
        <p className="theme-text-secondary mb-4">
          Run <code className="text-purple-400">Mocklify: Report Issue</code> from the Command
          Palette. Mocklify assembles a GitHub-flavored markdown diagnostics report and offers two
          actions:
        </p>
        <ul className="space-y-2 theme-text-secondary mb-4">
          <li>
            • <strong>Copy report to clipboard</strong> — paste it wherever you like.
          </li>
          <li>
            • <strong>Open GitHub issue</strong> — opens a new issue on the Mocklify repo with the
            report pre-filled as the body.
          </li>
        </ul>
        <InfoBox type="tip" title="Redaction is the whole point">
          The report is built to be pasted into a <strong>public</strong> issue. Every free-text
          field is run through a redactor, and no secret-bearing field is ever collected in the
          first place.
        </InfoBox>
      </section>

      {/* What is collected */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">What the report contains</h2>
        <div className="theme-bg-card rounded-xl border theme-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b theme-border">
                <th className="text-left px-4 py-3 theme-text">Section</th>
                <th className="text-left px-4 py-3 theme-text">Fields</th>
              </tr>
            </thead>
            <tbody className="theme-text-secondary">
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-medium text-purple-400">Environment</td>
                <td className="px-4 py-3">
                  Mocklify version, VS Code version, OS / arch, Node version.
                </td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-medium text-purple-400">AI</td>
                <td className="px-4 py-3">
                  Configured provider, resolved provider, model (or{' '}
                  <code className="text-purple-400">default</code>),{' '}
                  <strong>custom gateway configured: yes / no</strong>, scan mode.
                </td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-medium text-purple-400">Workspace</td>
                <td className="px-4 py-3">
                  Server count, route count, running-server count — counts only.
                </td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-medium text-purple-400">Feature flags</td>
                <td className="px-4 py-3">Drift watch, ask clarifying questions.</td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-medium text-purple-400">Last codebase scan</td>
                <td className="px-4 py-3">
                  For the most recent scan this session: per surface → strategy → reason (redacted).
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-medium text-purple-400">Last error</td>
                <td className="px-4 py-3">
                  The most recent captured error message / stack, this session (redacted).
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="theme-text-secondary mt-4">
          The last-scan and last-error sections only appear when something was recorded during the
          current session; otherwise the report says so.
        </p>
      </section>

      {/* Redaction */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Exactly what is redacted</h2>
        <p className="theme-text-secondary mb-4">
          Any value that <em>is</em> collected passes through a redactor. Recognized secrets are
          replaced with <code className="text-purple-400">«redacted»</code>, every URL with{' '}
          <code className="text-purple-400">«url»</code>, and absolute paths are relativized:
        </p>
        <ul className="space-y-2 theme-text-secondary mb-4">
          <li>
            • <strong>API keys</strong> — OpenAI / Anthropic (<code className="text-purple-400">sk-…</code>,{' '}
            <code className="text-purple-400">sk-ant-…</code>), Google (<code className="text-purple-400">AIza…</code>),
            Slack, GitHub tokens (<code className="text-purple-400">ghp_…</code>,{' '}
            <code className="text-purple-400">github_pat_…</code>).
          </li>
          <li>
            • <strong>Bearer tokens</strong> and{' '}
            <code className="text-purple-400">authorization</code> /{' '}
            <code className="text-purple-400">api_key</code> /{' '}
            <code className="text-purple-400">token</code> /{' '}
            <code className="text-purple-400">secret</code> /{' '}
            <code className="text-purple-400">password</code> values — including JSON-quoted forms
            like <code className="text-purple-400">&quot;apiKey&quot;:&quot;sk-…&quot;</code> — plus
            any 40+ character hex string.
          </li>
          <li>
            • <strong>All URLs → <code className="text-purple-400">«url»</code></strong>. This is why
            a custom gateway is reported as a boolean only — the gateway URL is never collected, and
            any URL that did slip into an error message is redacted anyway.
          </li>
          <li>
            • <strong>Absolute paths</strong> — the workspace root is rewritten to{' '}
            <code className="text-purple-400">.</code> and your home directory to{' '}
            <code className="text-purple-400">~</code>, so your filesystem layout never leaks.
          </li>
        </ul>
        <InfoBox type="warning" title="Never collected at all">
          Route response bodies and request logs are <strong>never</strong> included in the report —
          not redacted, simply not gathered. Only counts of servers, routes, and running servers are
          collected.
        </InfoBox>
      </section>

      {/* Sample */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Sample report</h2>
        <CodeBlock
          title="Mocklify: Report Issue — generated markdown"
          language="markdown"
          code={`## Mocklify Diagnostics

_Generated: 2026-07-10T09:12:00.000Z_

### Environment

- **Mocklify version:** 0.4.0
- **VS Code version:** 1.99.0
- **OS / arch:** darwin / arm64
- **Node:** v20.11.1

### AI

- **Configured provider:** auto
- **Resolved provider:** claude
- **Model:** claude-opus-4-8
- **Custom gateway configured:** yes
- **Scan mode:** auto

### Workspace

- **Servers:** 3
- **Routes:** 42
- **Running servers:** 1

### Feature flags

- **Drift watch:** no
- **Ask clarifying questions:** yes

### Last codebase scan

- **./web/src** → \`agentic\` — explored client fetch calls and inferred routes
- **./api** → \`spec\` — imported an existing OpenAPI document

### Last error

\`\`\`
Error: provider request failed calling «url»
    at CodebaseMockGenerator.scan (./src/ai/...)
\`\`\``}
        />
        <p className="theme-text-secondary mt-4">
          Notice the gateway shows as <code className="text-purple-400">yes</code> with no URL, the
          error&apos;s endpoint is <code className="text-purple-400">«url»</code>, and the stack path
          is relative to <code className="text-purple-400">.</code>. When opened as a GitHub issue,
          the body is capped near 6000 characters so the URL stays within GitHub&apos;s length limit.
        </p>
      </section>

      {/* Cross-links */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Related</h2>
        <p className="theme-text-secondary">
          The last-scan and last-error sections are most useful when an{' '}
          <Link to="/ai" className="text-purple-400 hover:underline">AI codebase scan</Link> fails —
          the strategy report shows what each surface tried. For configuration errors, the{' '}
          <Link to="/cli" className="text-purple-400 hover:underline">CLI&apos;s{' '}
          <code className="text-purple-400">validate</code></Link> command reports which server and
          field is wrong.
        </p>
      </section>
    </div>
  );
}
