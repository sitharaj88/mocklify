import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import CodeBlock from '../components/CodeBlock';
import InfoBox from '../components/InfoBox';

export default function AiFeatures() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="AI Features"
        description="Design, generate, and document mock APIs with AI — powered by GitHub Copilot, Anthropic Claude, OpenAI, or Google Gemini."
      />

      {/* Providers */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">AI Providers</h2>
        <p className="theme-text-secondary mb-4">
          Every AI feature works with any of four providers. GitHub Copilot is detected
          automatically; the others use your own API key, stored in VS Code&apos;s encrypted
          secret storage — never in settings files.
        </p>
        <div className="theme-bg-card rounded-xl border theme-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b theme-border">
                <th className="text-left px-4 py-3 theme-text">Provider</th>
                <th className="text-left px-4 py-3 theme-text">Requirement</th>
                <th className="text-left px-4 py-3 theme-text">Setup</th>
              </tr>
            </thead>
            <tbody className="theme-text-secondary">
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-medium text-purple-400">GitHub Copilot</td>
                <td className="px-4 py-3">Copilot extension, signed in</td>
                <td className="px-4 py-3">Nothing — auto-detected</td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-medium text-purple-400">Anthropic Claude</td>
                <td className="px-4 py-3">API key from console.anthropic.com</td>
                <td className="px-4 py-3">Dashboard → Settings → AI Provider</td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-medium text-purple-400">OpenAI</td>
                <td className="px-4 py-3">API key from platform.openai.com</td>
                <td className="px-4 py-3">Dashboard → Settings → AI Provider</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-medium text-purple-400">Google Gemini</td>
                <td className="px-4 py-3">API key from aistudio.google.com</td>
                <td className="px-4 py-3">Dashboard → Settings → AI Provider</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="theme-text-secondary mt-4">
          Leave the provider on <code className="text-purple-400">auto</code> and Mocklify uses
          the first available (Copilot → Claude → OpenAI → Gemini). Switch anytime from the
          dashboard&apos;s <strong>Settings → AI Provider</strong> tab or the{' '}
          <code className="text-purple-400">Mocklify: Select AI Provider</code> command, and
          verify your setup with <code className="text-purple-400">Mocklify: Test AI Provider</code>.
        </p>

        <CodeBlock
          title="Settings (optional — the dashboard manages these for you)"
          language="json"
          code={`{
  "mocklify.ai.provider": "auto",          // auto | copilot | claude | openai | gemini
  "mocklify.ai.claudeModel": "claude-opus-4-8",
  "mocklify.ai.openaiModel": "gpt-4o",
  "mocklify.ai.geminiModel": "gemini-2.5-flash",

  // Enterprise gateways: route requests through your company's endpoint
  // (e.g. a Bedrock-backed Anthropic gateway or a LiteLLM proxy).
  // Leave empty to use the provider's official API.
  "mocklify.ai.claudeBaseUrl": "https://ai-gateway.mycompany.com",
  "mocklify.ai.openaiBaseUrl": "",
  "mocklify.ai.geminiBaseUrl": ""
}`}
        />
        <p className="theme-text-secondary mt-4">
          Pick a model from the current list with{' '}
          <code className="text-purple-400">Mocklify: Select AI Model</code> — or enter a custom
          model ID for gateway-specific names (Bedrock-style Claude IDs use an{' '}
          <code className="text-purple-400">anthropic.</code> prefix, e.g.{' '}
          <code className="text-purple-400">anthropic.claude-opus-4-8</code>).
        </p>
      </section>

      {/* Create with AI */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Create Mock Servers from Plain English</h2>
        <p className="theme-text-secondary mb-4">
          Open the dashboard and type a description into the <strong>Create with AI</strong>{' '}
          panel — for example <em>&quot;e-commerce API with products, carts, and orders&quot;</em>.
          Mocklify designs the full API: CRUD routes, realistic example data, sensible error
          responses — then creates and (optionally) starts the server.
        </p>
        <ul className="space-y-2 theme-text-secondary">
          <li>• Works from the dashboard, the command palette, or Copilot Chat</li>
          <li>• Every generated route is schema-validated before it is saved</li>
          <li>• A free port is picked automatically</li>
        </ul>
        <InfoBox type="tip" title="Command palette">
          <code>Mocklify: AI: Generate Mock Server from Description</code> and{' '}
          <code>Mocklify: AI: Generate Routes from Description</code> do the same from the
          keyboard — the second one adds routes to an existing server.
        </InfoBox>
      </section>

      {/* Codebase scan */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Generate Mocks from Your App&apos;s Codebase</h2>
        <p className="theme-text-secondary mb-4">
          Point Mocklify at any client codebase — Android, iOS, web, Flutter — and it
          reverse-engineers the API the app calls into a complete mock server. Run{' '}
          <code className="text-purple-400">Mocklify: AI: Generate Mock Server from Codebase</code>{' '}
          in your app&apos;s workspace. It works with any project in any language — there is no
          extension whitelist; language-agnostic API signals (REST paths, URLs, HTTP verbs) seed
          the scan even for stacks Mocklify has never heard of, and a workspace with no matches
          falls back to a census-guided exploration instead of a dead end. Backends (Spring,
          Express, FastAPI, Rails, Go, …) are mocked from their declared routes and handlers,
          monorepos get one mock server per detected API surface, and when an OpenAPI spec
          already exists Mocklify offers to import it directly for exact routes (the same
          deterministic pipeline as{' '}
          <Link to="/import" className="text-purple-400 hover:underline">Import &amp; Export</Link>).
          Under the hood a registry of 40+ framework and stack packs (Retrofit, Express, Spring,
          FastAPI, Rails, Go, Dio, …) drives detection, but there is no hard-coded allow-list — the
          universal signals cover stacks not in the registry too.
        </p>
        <h3 className="text-lg font-medium mb-3">How it works</h3>
        <ol className="space-y-2 theme-text-secondary list-decimal list-inside mb-4">
          <li>
            <strong>Local scan (free, no AI)</strong> — finds API calls: Retrofit annotations,
            OkHttp, Volley, URLSession, Alamofire, fetch, axios, react-query, RTK Query, Angular
            HttpClient, Dio, and more.
          </li>
          <li>
            <strong>AI analysis</strong> — your provider infers every endpoint, its request
            shape, and the exact response fields your models parse.
          </li>
          <li>
            <strong>Mock server</strong> — success routes are enabled with realistic data;
            failure routes are created <em>disabled</em>.
          </li>
        </ol>
        <p className="theme-text-secondary mb-4">
          By default (<code className="text-purple-400">mocklify.ai.scanMode: &quot;auto&quot;</code>)
          Mocklify picks the best strategy <em>per project</em>: an existing spec leads, then
          agentic exploration when the provider supports tools, then the fast one-shot scan, and
          finally a census scan of the most promising file heads when a workspace matches no API
          patterns anywhere and the provider has no tools. Set it to{' '}
          <code className="text-purple-400">agentic</code> to always let the AI explore the
          codebase itself with read-only tools — reading files, following imports to data
          models, and finding auth/error conventions — for higher-quality routes at more time
          and AI cost, or <code className="text-purple-400">fast</code> to force the cheap
          one-shot scan (it still auto-escalates to agentic exploration when a tool-capable
          provider is set and nothing in the workspace matches a known API pattern).
        </p>
        <p className="theme-text-secondary mb-4">
          Agentic scans run as a multi-agent pipeline: on multi-project workspaces up to three
          API surfaces are explored <strong>in parallel</strong>, then a{' '}
          <strong>critic agent</strong> with fresh context verifies every proposed route against
          the actual code — wrong routes get one repair round and are dropped if still wrong,
          with confirmed / repaired / dropped counts in the result. When the code is genuinely
          ambiguous the agent can ask you up to two short clarifying questions per surface
          (<code className="text-purple-400">mocklify.ai.askQuestions</code>, on by default —
          answered inline on the dashboard or via a QuickPick; after a two-minute wait with no
          answer the agent decides for itself and notes the assumption). An interrupted scan is
          checkpointed under <code className="text-purple-400">.mocklify/checkpoints/</code>{' '}
          (gitignore it) and offers to <strong>resume</strong> next time, skipping surfaces
          already explored; each completed scan also saves what it learned to{' '}
          <code className="text-purple-400">.mocklify/scan-memory.json</code> — safe to commit — so
          the next scan starts smarter.
        </p>
        <InfoBox type="info" title="Your provider still runs every AI call">
          LangGraph only <em>orchestrates</em> the agentic pipeline — parallel branches, the
          critic loop, checkpoints. Every model call still goes through the provider you selected,
          so GitHub Copilot and enterprise gateways work exactly as they do everywhere else.
          Exploration is strictly read-only: no writes, no command execution, with
          path-traversal/symlink protection and a secrets denylist, bounded by tool-call, time,
          and byte budgets.
        </InfoBox>
        <p className="theme-text-secondary mb-4">
          If a scan ever fails or produces something surprising, run{' '}
          <code className="text-purple-400">Mocklify: Report Issue</code> — it builds a redacted
          bug report that includes the last scan&apos;s per-surface strategy and the last error.
          See <Link to="/diagnostics" className="text-purple-400 hover:underline">Diagnostics</Link>.
        </p>
        <h3 className="text-lg font-medium mb-3">Positive and negative flows</h3>
        <p className="theme-text-secondary mb-4">
          For each endpoint the scan also generates negative-flow routes shaped like your
          app&apos;s error handling: <code className="text-purple-400">400</code> validation
          errors, <code className="text-purple-400">401</code> auth failures,{' '}
          <code className="text-purple-400">404</code> missing resources, and{' '}
          <code className="text-purple-400">500</code> server errors — tagged{' '}
          <code className="text-purple-400">negative</code> and disabled by default. These are
          ordinary <Link to="/routes" className="text-purple-400 hover:underline">routes</Link> —
          toggle one on to simulate that failure in your app; toggle it off to return to the
          happy path.
        </p>
        <InfoBox type="success" title="Develop offline">
          Point your app&apos;s base URL (env var or config constant) at{' '}
          <code>http://localhost:&lt;port&gt;</code> and the whole app runs against the mocks.
        </InfoBox>
        <h3 className="text-lg font-medium mb-3 mt-6">Record &amp; replay, scenarios, and drift watch</h3>
        <p className="theme-text-secondary mb-4">
          <code className="text-purple-400">Mocklify: AI: Generate Mock Server from Recorded Traffic</code>{' '}
          turns real requests captured in the Request Log into a clean mock server — paths are
          parameterized deterministically and the AI only generalizes payloads it actually saw,
          never inventing endpoints.{' '}
          <code className="text-purple-400">Mocklify: Simulate Scenario (Happy Path / Failures)</code>{' '}
          flips a whole server between the happy path and a chosen failure (401, 500, …) in one
          step, using the <code className="text-purple-400">negative</code>-tagged routes the
          generators create. And with the{' '}
          <code className="text-purple-400">mocklify.ai.driftWatch</code> setting enabled,
          Mocklify watches saved source files for new API calls no mock covers and offers to
          generate the missing routes.
        </p>
      </section>

      {/* Copilot Chat */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">@mocklify in Copilot Chat</h2>
        <p className="theme-text-secondary mb-4">
          With GitHub Copilot Chat installed, talk to Mocklify conversationally. Responses are
          generated by whichever AI provider you selected.
        </p>
        <CodeBlock
          title="Chat commands"
          language="text"
          code={`@mocklify /create a bookstore API with books, authors, and reviews
@mocklify /route add pagination to GET /products
@mocklify /docs                 — generate API documentation
@mocklify /test                 — generate curl and .http test requests
@mocklify /analyze              — analyze request logs for errors and gaps
@mocklify /list                 — list servers and their status`}
        />
        <h3 className="text-lg font-medium mb-3 mt-6">Copilot agent mode</h3>
        <p className="theme-text-secondary mb-4">
          Mocklify also registers language-model tools, so Copilot&apos;s agent mode can drive it
          end-to-end — try <em>&quot;create a mock payments API with realistic data and start
          it&quot;</em>. Tools: <code className="text-purple-400">mocklify_list_servers</code>,{' '}
          <code className="text-purple-400">mocklify_create_server</code>,{' '}
          <code className="text-purple-400">mocklify_add_route</code>,{' '}
          <code className="text-purple-400">mocklify_start_server</code>,{' '}
          <code className="text-purple-400">mocklify_stop_server</code>, and{' '}
          <code className="text-purple-400">mocklify_get_request_logs</code> (reference{' '}
          <code className="text-purple-400">#mockServers</code> and{' '}
          <code className="text-purple-400">#mockLogs</code> in prompts).
        </p>
      </section>

      {/* Documentation */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">API Documentation &amp; OpenAPI Export</h2>
        <p className="theme-text-secondary mb-4">
          Right-click any server in the Mocklify sidebar:
        </p>
        <ul className="space-y-2 theme-text-secondary mb-4">
          <li>
            • <strong>Generate API Documentation</strong> — AI writes polished Markdown docs
            (overview, per-endpoint descriptions, parameters, examples, curl commands) grounded
            in your actual routes, saved to <code className="text-purple-400">docs/</code> and
            opened in preview.
          </li>
          <li>
            • <strong>Export OpenAPI Spec</strong> — deterministic OpenAPI 3.0 export with
            response schemas inferred from your example bodies.
          </li>
        </ul>
        <InfoBox type="info" title="No AI? No problem">
          Documentation falls back to an accurate deterministic reference generator, and OpenAPI
          export never needs AI — both work without any provider configured.
        </InfoBox>
      </section>

      {/* Spec import, stateful mocks, chaos */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Spec Import, Stateful Mocks &amp; Chaos</h2>
        <ul className="space-y-3 theme-text-secondary mb-4">
          <li>
            • <strong>Import OpenAPI / Swagger Spec</strong> — turn an OpenAPI 3.0/3.1 or Swagger
            2.0 file (JSON or YAML) into a mock server. The import is deterministic and works
            fully offline: <code className="text-purple-400">$ref</code> pointers are resolved,
            spec examples are preferred, and realistic bodies are generated from schemas.
            Optionally pick <strong>Import + AI enrich</strong> to have the AI rewrite example
            data coherently across routes and add disabled failure routes
            (400/401/404/429/500) — falling back to the deterministic import if AI is
            unavailable.
          </li>
          <li>
            • <strong><Link to="/stateful" className="text-purple-400 hover:underline">Stateful mocks</Link></strong>{' '}
            — routes with a <code className="text-purple-400">stateful</code> block share an
            in-memory collection, so POST-then-GET flows actually work: list, fetch by id, insert
            (201), update, delete (204), 404 for missing ids. Collections seed from{' '}
            <code className="text-purple-400">stateful.seed</code> and reset on restart or with{' '}
            <strong>Reset Stateful Mock Data</strong>. The AI generators emit stateful blocks
            for CRUD endpoint families automatically.
          </li>
          <li>
            • <strong><Link to="/chaos" className="text-purple-400 hover:underline">Chaos simulation</Link></strong>{' '}
            — <strong>Configure Chaos</strong> adds random failures (e.g. 10% 503s) and latency
            jitter across every route on a server, with presets or custom rate/status/delay.
            Hot-reloads while the server runs; great for testing retries, timeouts, and error UI.
          </li>
          <li>
            • <strong><Link to="/contracts" className="text-purple-400 hover:underline">Contract validation</Link></strong>{' '}
            — an imported spec can double as a live contract: run{' '}
            <strong>Configure Contract Validation</strong> to warn on (or enforce) requests that
            violate the OpenAPI spec, which pairs well with the spec-first scan shortcut.
          </li>
        </ul>
      </section>

      {/* Commands reference */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Command Reference</h2>
        <div className="theme-bg-card rounded-xl border theme-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b theme-border">
                <th className="text-left px-4 py-3 theme-text">Command</th>
                <th className="text-left px-4 py-3 theme-text">Description</th>
              </tr>
            </thead>
            <tbody className="theme-text-secondary">
              {[
                ['AI: Generate Mock Server from Codebase', 'Scan app code → full mock server with positive + negative flows'],
                ['AI: Generate Mock Server from Recorded Traffic', 'Record & replay — captured request logs → clean mock server'],
                ['Import OpenAPI / Swagger Spec', 'OpenAPI/Swagger spec → mock server, with optional AI enrichment'],
                ['Simulate Scenario (Happy Path / Failures)', 'One-click switch between happy path and failure scenarios'],
                ['Configure Chaos (Latency & Failures)', 'Random failures and latency jitter across a whole server'],
                ['Reset Stateful Mock Data', 'Clear in-memory stateful collections (re-seed on next request)'],
                ['AI: Generate Mock Server from Description', 'Plain English → complete mock server'],
                ['AI: Generate Routes from Description', 'Plain English → routes for an existing server'],
                ['Generate API Documentation', 'AI-written Markdown docs (deterministic fallback)'],
                ['Export OpenAPI Spec', 'OpenAPI 3.0 JSON with inferred schemas'],
                ['Select AI Provider', 'Switch between Auto / Copilot / Claude / OpenAI / Gemini'],
                ['Set AI Provider API Key', 'Store a key in encrypted secret storage'],
                ['Test AI Provider', 'Live round-trip test of the active provider'],
                ['Ask Mocklify in Copilot Chat', 'Open Copilot Chat with @mocklify'],
              ].map(([command, description], i, arr) => (
                <tr key={command} className={i < arr.length - 1 ? 'border-b theme-border' : ''}>
                  <td className="px-4 py-3 font-mono text-purple-400 whitespace-nowrap">{command}</td>
                  <td className="px-4 py-3">{description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
