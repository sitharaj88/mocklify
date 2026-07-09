# Mocklify

<p align="center">
  <img src="resources/icon.png" alt="Mocklify Logo" width="128" height="128">
</p>

<p align="center">
  <strong>Powerful API Mocking for VS Code</strong>
</p>

<p align="center">
  Create, manage, and run mock servers directly from your editor. Perfect for frontend development, API prototyping, and testing.
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=sitharaj.mocklify"><img src="https://img.shields.io/visual-studio-marketplace/v/sitharaj.mocklify?label=VS%20Code%20Marketplace&logo=visual-studio-code&color=blue" alt="VS Code Marketplace"></a>
  <a href="https://github.com/sitharaj88/mocklify/blob/main/LICENSE"><img src="https://img.shields.io/github/license/sitharaj88/mocklify?color=green" alt="License"></a>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="https://sitharaj88.github.io/mocklify/">Documentation</a> •
  <a href="#keyboard-shortcuts">Shortcuts</a>
</p>

---

## ✨ Features

### 🤖 AI Integration — Copilot, Claude, OpenAI, Gemini

- **Multiple AI Providers** - Use GitHub Copilot (no key needed), or bring your own API key for **Anthropic Claude**, **OpenAI**, or **Google Gemini**; `auto` mode picks the first available
- **Enterprise Gateways & Bedrock** - Point any provider at your company's endpoint (Bedrock-backed Anthropic gateways, LiteLLM, Azure-compatible proxies) with per-provider base-URL settings and custom model IDs
- **Mock Your App from Code** - Scan any client codebase (Android/Retrofit, iOS/URLSession, web fetch/axios, Flutter/Dio, GraphQL clients, and more) and generate a complete mock server covering **positive and negative flows** — success responses shaped like your models, plus disabled 400/401/403/404/429/500 and slow-response routes you toggle on to simulate failures
- **Record & Replay** - Turn captured request logs into a clean mock server: real payloads, parameterized paths (`/users/42` → `/users/:userId`), observed errors as toggleable failure routes
- **OpenAPI Import + AI Enrichment** - Import OpenAPI 3.x / Swagger 2.0 specs deterministically (no AI required), optionally letting the AI make example data coherent across routes and fill in undocumented failure cases
- **AI Mock Generation** - Describe your API in plain English (in the dashboard or Copilot Chat); get a complete mock server with realistic data
- **Scenario Simulation** - One command flips a server between happy path and failure scenarios (401, 404, 500, slow responses) — and back
- **Drift Watch** - Get notified when your app gains API calls that no mock covers, with one-click route generation
- **`@mocklify` Chat Participant** - Design, document, and debug mock APIs conversationally in Copilot Chat — answers come from your selected provider
- **AI API Documentation** - Generate polished, developer-ready API docs for any mock server
- **Copilot Agent Tools** - Copilot agent mode can list, create, populate, start, and inspect your mock servers autonomously
- **Traffic Analysis** - Analyze request logs, spot errors, and get suggested routes for unmatched requests
- **Secure Key Storage** - API keys live in VS Code's encrypted secret storage, never in settings files
- **Graceful Fallback** - Documentation, OpenAPI import/export, and stateful mocking work fully without any AI configured

### 📚 API Documentation

- **One-click Docs** - Right-click any server → "Generate API Documentation" → Markdown docs with examples and curl commands
- **OpenAPI 3.0 Export** - Turn any mock server into an OpenAPI spec with inferred response schemas

### 🚀 Core Features

- **Multiple Mock Servers** - Run multiple servers on different ports simultaneously
- **Stateful Mocks** - CRUD route families share a live in-memory collection: POST creates, GET reflects it, DELETE removes it — create-then-fetch flows just work
- **Chaos Simulation** - Inject random failures and latency jitter per server to test how your app handles a flaky backend
- **Dynamic Responses** - Use Handlebars templates with 80+ Faker.js helpers
- **Request Matching** - Match by headers, query params, and body content
- **Response Delays** - Simulate network latency with fixed or random delays
- **Hot Reload** - Changes apply instantly without server restart

### 🔌 Protocol Support

- **HTTP/REST** - Full support for all HTTP methods
- **GraphQL** - Mock queries and mutations with variable substitution
- **WebSocket** - Real-time event mocking with rooms and broadcast

### 📥 Import & Export

| Direction | Format | Notes |
|-----------|--------|-------|
| Import | OpenAPI 3.0/3.1 / Swagger 2.0 (JSON or YAML) | Deterministic, with optional AI enrichment |
| Import | Postman Collection v2.1 | Requests, folders, and example responses |
| Export | Server config (JSON) | Re-importable Mocklify configuration |
| Export | OpenAPI 3.0 (JSON or YAML) | Inferred response schemas |
| Export | Postman Collection v2.1 | Folders per tag, saved example responses, failure-scenario subfolders |
| Export | REST Client (`.http`) | Runnable requests for the VS Code REST Client extension |
| Export | API docs — web page (`.html`) | Self-contained single file with search, curl examples, and light/dark themes |
| Export | API docs — Confluence (`.xml`) | Confluence Storage Format — paste into a page or push via the REST API |
| Export | API docs — Markdown (`.md`) | AI-written docs with a deterministic fallback |
| Export | Request logs — HAR | HTTP Archive for browser dev tools |
| Export | Request logs — cURL | Shell script of curl commands |

Every server export format is available from **`Mocklify: Export Server As…`**, the server's context menu in the tree view, and the dashboard's per-server Export dialog.

### 🎯 Advanced Features

- **Proxy Pass-through** - Forward requests to real APIs with recording
- **Request Recording** - Capture real API responses to generate mocks
- **Response Sequences** - Return different responses based on call count
- **Database Integration** - Query JSON files or in-memory databases
- **Environment Variables** - Use variables across routes and servers

### 🎨 Modern Dashboard

- **Beautiful UI** - Modern React dashboard with dark/light themes
- **Real-time Logs** - View request/response logs as they happen
- **Search & Filter** - Find routes by name, path, method, or tags
- **Keyboard Shortcuts** - Navigate and control with keyboard

---

## 📦 Installation

### From VS Code Marketplace

1. Open VS Code
2. Go to Extensions (`Cmd+Shift+X` / `Ctrl+Shift+X`)
3. Search for "Mocklify"
4. Click Install

### From VSIX File

1. Download the `.vsix` file
2. Open VS Code
3. Go to Extensions
4. Click `...` → "Install from VSIX..."
5. Select the downloaded file

---

## 🚀 Quick Start

### 1. Create Your First Server

1. Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
2. Type "Mocklify: Create Server"
3. Enter a name and port (e.g., "API Server" on port 3000)

### 2. Add a Route

1. Right-click on your server in the Mocklify sidebar
2. Select "Add Route"
3. Configure your route:
   - **Name**: `Get Users`
   - **Method**: `GET`
   - **Path**: `/api/users`
   - **Response**: 
     ```json
     {
       "users": [
         { "id": 1, "name": "John Doe" },
         { "id": 2, "name": "Jane Smith" }
       ]
     }
     ```

### 3. Start the Server

1. Click the ▶️ play button next to your server
2. Your mock API is now running at `http://localhost:3000`

### 4. Test It

```bash
curl http://localhost:3000/api/users
```

### ⚡ Or Let Copilot Do It

Open Copilot Chat and type:

```
@mocklify /create a bookstore API with books, authors, and reviews
```

Review the generated routes, click **Create this server**, and you have a running mock API with realistic data in seconds.

---

## 🤖 AI Features

### Choosing a Provider

Mocklify's AI features work with any of four providers:

| Provider | Requirement | Setup |
|----------|-------------|-------|
| **GitHub Copilot** (default) | [GitHub Copilot](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot) extension, signed in | Nothing — works out of the box |
| **Anthropic Claude** | API key from [console.anthropic.com](https://console.anthropic.com) | `Mocklify: Set AI Provider API Key` |
| **OpenAI** | API key from [platform.openai.com](https://platform.openai.com) | `Mocklify: Set AI Provider API Key` |
| **Google Gemini** | API key from [aistudio.google.com](https://aistudio.google.com) | `Mocklify: Set AI Provider API Key` |

Run **`Mocklify: Select AI Provider`** to switch, or leave the `mocklify.ai.provider` setting on `auto` (Copilot → Claude → OpenAI → Gemini, first available wins). Pick a model with **`Mocklify: Select AI Model`**, or set `mocklify.ai.claudeModel` (default `claude-opus-4-8`), `mocklify.ai.openaiModel`, or `mocklify.ai.geminiModel` directly — any model ID your endpoint accepts works, not just the ones in the picker. Keys are stored in VS Code's encrypted secret storage.

**Enterprise gateways & Bedrock:** if your company routes AI traffic through a gateway or proxy (an Anthropic-compatible Bedrock gateway, LiteLLM, an Azure OpenAI-compatible endpoint, …), point Mocklify at it with `mocklify.ai.claudeBaseUrl`, `mocklify.ai.openaiBaseUrl`, or `mocklify.ai.geminiBaseUrl`, and set the model ID the gateway expects (Bedrock-style Claude IDs use an `anthropic.` prefix, e.g. `anthropic.claude-opus-4-8`). Leave the base URL empty to use the provider's official API.

> The `@mocklify` chat participant and agent-mode tools appear inside Copilot Chat, so they need the Copilot Chat UI — but their responses are generated by whichever provider you selected. The dashboard "Create with AI" panel and all AI commands work with any provider, no Copilot required.

### Chat Participant: `@mocklify`

| Command | What it does |
|---------|--------------|
| `@mocklify /create <description>` | Design a complete mock API server from a description |
| `@mocklify /route <description>` | Generate and add routes to an existing server |
| `@mocklify /docs` | Generate polished API documentation |
| `@mocklify /test` | Generate curl and REST Client (`.http`) test requests |
| `@mocklify /analyze` | Analyze request logs: errors, unmatched requests, anomalies |
| `@mocklify /list` | List all mock servers and their status |

You can also just ask questions: `@mocklify how do I add a delay to a route?`

### Copilot Agent Mode Tools

In agent mode, Copilot can drive Mocklify end-to-end with these tools — try *"Create a mock payments API with realistic data and start it"*:

- `mocklify_list_servers` (also `#mockServers` in prompts)
- `mocklify_create_server`, `mocklify_add_route`
- `mocklify_start_server`, `mocklify_stop_server`
- `mocklify_get_request_logs` (also `#mockLogs` in prompts)

### Mock Your App from Its Codebase

Run **`Mocklify: AI: Generate Mock Server from Codebase`** in any app workspace. Mocklify scans your source for API calls (Retrofit annotations, `fetch`/`axios`, `URLSession`/Alamofire, Dio, `HttpClient`, react-query/RTK Query, and more — scanning is local and free), then the AI reverse-engineers every endpoint into a mock server:

- **Success routes** (enabled) with response bodies shaped exactly like your app's models
- **Failure routes** (disabled) for negative-flow testing: 400 validation, 401 auth, 404 missing, 500 errors — toggle one on to simulate that failure in your app
- Point your app's base URL at `http://localhost:<port>` and develop offline

**Works with any project — any language.** The scan has no language gate: instead of an extension whitelist, a local pass reads every text file (binaries and build output are skipped) and looks for *universal API signals* — rooted REST paths, absolute URLs, HTTP verbs near them, JSON shapes, auth vocabulary — so a Lua script, a C file full of libcurl calls, a Haskell service, or even a `.txt` file of API notes can seed the scan just as well as a recognized framework. Recognized stacks still get first-class treatment from a declarative **ecosystem registry** (39 packs — Retrofit to Rails; adding a new stack is a ~10-line pack). Backends (Spring Boot, Express/NestJS, FastAPI/Django/Flask, Rails, Go, Laravel, ASP.NET Core, and more) are scanned in the *serves* direction — their route declarations become the mocked contract for frontend teams to develop against. Monorepos get **one mock server per detected API surface** (e.g. an Android app and its Spring backend each get their own server and port), while Kotlin Multiplatform, React Native, and Ionic projects are recognized as one app rather than separate native shells. When an OpenAPI/Swagger spec already exists in the workspace, Mocklify offers a **spec-first shortcut**: import it directly for exact routes instead of (or alongside) the AI scan.

**No dead ends.** A workspace where nothing matches any known pattern no longer errors out. With a tool-capable provider the scan switches to a recon-first agentic mission: the AI gets a *workspace census* (directory tree, file-type histogram, README and manifest heads) and explores from there. Without tools, the census plus the most promising file heads go to the AI in one shot. And when there genuinely is no API to mock, the scan completes with the agent's own explanation as an informational message — never an error.

**Auto strategy.** By default (`mocklify.ai.scanMode: "auto"`) Mocklify picks the best strategy per detected project: an existing spec leads, agentic exploration when the provider supports tools, fast one-shot scanning otherwise — mixed workspaces can use different strategies per surface, and the result dialog shows which surface got which. Set `"fast"` to force the cheap one-shot scan (it still auto-escalates to agentic exploration when no known patterns match), or `"agentic"` to always let the AI explore the codebase itself through read-only tools — listing, reading, and searching files, following imports to your data models, and picking up auth and error-body conventions — before submitting the routes. Agentic scans produce higher-quality mocks but are slower (up to 8 minutes, scaling to 16 on multi-project workspaces) and use substantially more AI tokens. The exploration is strictly read-only and confined to your workspace: at most 30 tool calls (60 for multi-project workspaces), a 512 KB–1 MB read budget, and never a write or command execution.

**Agent pipeline: parallel exploration, critic verification, questions, resume, memory.** Agentic scans run as a LangGraph-orchestrated pipeline (the graph only does orchestration — every model call still goes through your selected provider). Multi-project workspaces are explored up to three API surfaces in parallel, then a **critic agent** with fresh context re-checks every proposed route against the actual code: wrong routes get one bounded repair round and are dropped if still wrong, and the result dialog reports the confirmed / repaired / dropped counts. When the code is genuinely ambiguous the agent may ask you up to **two short questions per surface** — a QuickPick from the command flow, an inline answer card on the dashboard — controlled by `mocklify.ai.askQuestions` (on by default; unanswered questions time out after 2 minutes and the agent notes its assumption). Progress is **checkpointed** under `.mocklify/checkpoints/`, so a cancelled or interrupted scan offers *Resume* next time and skips the surfaces it already explored. Each completed scan also persists what it learned (surfaces, model/API directories, auth and error conventions) to `.mocklify/scan-memory.json`, so later scans start smarter. Add `.mocklify/checkpoints/` to your `.gitignore` (transient state); `.mocklify/scan-memory.json` is safe to commit if you want teammates' scans to benefit from it. If the graph pipeline cannot start for any reason, the scan transparently falls back to the classic single-agent exploration.

With the `mocklify.ai.driftWatch` setting enabled, Mocklify also watches saved source files for new API calls that no mock covers and offers to generate the missing routes — scanning stays local; the AI only runs when you accept.

### Record & Replay Real Traffic

Run **`Mocklify: AI: Generate Mock Server from Recorded Traffic`** to turn requests captured in the Request Log (via proxy routes or hits against a running mock) into a clean mock server. Mocklify groups the traffic by endpoint, parameterizes ids (`/users/42` → `/users/:userId`), and has the AI generalize the real payloads — success routes enabled, captured error variants as disabled negative routes. The AI never invents endpoints: only observed method + path pairs make it into the server.

### Scenario Simulation

Run **`Mocklify: Simulate Scenario (Happy Path / Failures)`** on any server with negative-tagged routes (the codebase and traffic generators create them automatically). Pick "Happy path" or a failure like "Simulate 401" — Mocklify flips the right routes on and off so the failure wins the match while unrelated endpoints keep succeeding, and hot-reloads running servers. Scenarios never stack; each one resets to the happy-path baseline first.

### Import OpenAPI / Swagger Specs

Run **`Mocklify: Import OpenAPI / Swagger Spec`** to turn an OpenAPI 3.0/3.1 or Swagger 2.0 spec (JSON or YAML) into a mock server. Mocklify finds spec files in your workspace (or lets you browse), resolves `$ref` pointers, prefers the spec's own examples, and deterministically generates realistic bodies from schemas — no AI required. Optionally choose **Import + AI enrich** to have the AI rewrite example data so it is coherent across routes and add disabled failure routes (400/401/404/429/500) for endpoints that don't document them; if AI is unavailable the deterministic import is used as-is. Documented 4xx/5xx responses become disabled negative routes ready for scenario simulation.

### Stateful Mocks

Give a route a `stateful` block (`{ "collection": "users", "seed": [...] }`) and its CRUD family shares an in-memory collection: GET lists (with `?limit=`/`?offset=`), GET `/:id` fetches, POST inserts (201), PUT/PATCH update, DELETE removes (204), and missing ids return 404 — so create-then-fetch flows actually work. Collections seed lazily from `stateful.seed` (or the route's static example body) and reset on server restart or via **`Mocklify: Reset Stateful Mock Data`**. The AI generators emit `stateful` blocks automatically for CRUD endpoint families.

### Chaos Simulation

Run **`Mocklify: Configure Chaos (Latency & Failures)`** on a server to test how your app handles a flaky backend: pick a preset (Flaky — 10% 503s; Unstable — 30% failures + 500-2000ms jitter) or configure a custom failure rate, status code, and latency range. Chaos applies to **all** routes on the server, hot-reloads without a restart, and is persisted in `servers.json` under the server's `chaos` block.

**Per-route chaos override.** Open a route's **Advanced** tab in the dashboard and set **Chaos Override** to *Override* (inject chaos on just this route, with its own failure rate/status/latency) or *Exempt* (never inject chaos here even when server chaos is on). A route override fully **replaces** the server's chaos for that route; unmatched requests still use the server setting. The effective chaos for a request is `matchedRoute.chaos ?? server.chaos`.

### Contract Validation

Run **`Mocklify: Configure Contract Validation`** on an HTTP server to validate incoming requests against an OpenAPI 3.x spec. Pick a spec file (Mocklify finds `*openapi*` / `*swagger*` files in your workspace, or browse), then a mode:

- **Warn** — the route's normal response is served unchanged, and any contract violations are attached to the request log entry (a subtle amber shield appears on the log row in the dashboard).
- **Enforce** — a violating request is rejected with `400 { "error": "Contract violation", "mode": "enforce", "violations": [...] }` before the mock response is generated.

The validator checks path/query/header parameters (type, enum, required) and the JSON request body schema against the spec. It is loaded once per spec file and reloaded automatically when the spec changes on disk. Choose **Disable** in the picker to turn validation off. The setting is persisted per server in `servers.json` under a `contract` block (`{ "specPath": "...", "mode": "warn" | "enforce" }`).

### GraphQL Operation Routing

A route on a GraphQL server can match by **operation** instead of by path. In the dashboard route **Advanced** tab (shown when the method is `POST` and the path contains `graphql`), enable **Match by operation** and set the operation name and type (`query` / `mutation` / `subscription`). Mocklify then matches a POST to that path whose GraphQL body carries the matching `operationName`/type, falling back to the legacy `query:opName` path convention when no `graphql` block is set.

### Report an Issue

Run **`Mocklify: Report Issue`** to generate a **redacted** diagnostics report (extension/VS Code/OS versions, AI provider, server/route counts, feature flags, the last scan strategy and last error) — API keys, gateway URLs, absolute paths, and response bodies are stripped. Choose **Copy report to clipboard** or **Open GitHub issue** (pre-fills a new issue with the report).

### AI Commands

| Command | Description |
|---------|-------------|
| `Mocklify: AI: Generate Mock Server from Codebase` | Scan your app's code → full mock server with positive + negative flows |
| `Mocklify: AI: Generate Mock Server from Recorded Traffic` | Record & replay — captured request logs → clean mock server |
| `Mocklify: Import OpenAPI / Swagger Spec` | OpenAPI/Swagger spec → mock server, with optional AI enrichment |
| `Mocklify: Simulate Scenario (Happy Path / Failures)` | One-click switch between happy path and failure scenarios (401, 500, …) |
| `Mocklify: Configure Chaos (Latency & Failures)` | Random failures and latency jitter across a whole server |
| `Mocklify: Reset Stateful Mock Data` | Clear a server's in-memory stateful collections (re-seed on next request) |
| `Mocklify: AI: Generate Mock Server from Description` | Natural language → full mock server |
| `Mocklify: AI: Generate Routes from Description` | Natural language → routes for an existing server |
| `Mocklify: Generate API Documentation` | AI-written Markdown docs (deterministic fallback without Copilot) |
| `Mocklify: Export OpenAPI Spec` | OpenAPI 3.0 JSON with inferred schemas |
| `Mocklify: Export Server As…` | OpenAPI JSON/YAML, Postman v2.1, `.http`, or API docs as web page / Confluence / Markdown |
| `Mocklify: Ask Mocklify in Copilot Chat` | Open Copilot Chat with `@mocklify` |

Generated documentation is saved to `docs/<server-name>-docs.md` in your workspace and opened with a live Markdown preview.

---

## 📖 Documentation

> For full documentation, visit the **[Mocklify Documentation Site](https://sitharaj88.github.io/mocklify/)**.

### Dynamic Responses with Templates

Use Handlebars templates with Faker.js for dynamic data:

```json
{
  "id": "{{faker 'string.uuid'}}",
  "name": "{{faker 'person.fullName'}}",
  "email": "{{faker 'internet.email'}}",
  "createdAt": "{{now}}"
}
```

#### Available Template Helpers

| Helper | Description | Example |
|--------|-------------|---------|
| `{{faker 'category.method'}}` | Generate fake data | `{{faker 'person.firstName'}}` |
| `{{now}}` | Current ISO timestamp | `2024-01-15T10:30:00.000Z` |
| `{{timestamp}}` | Unix timestamp | `1705315800000` |
| `{{uuid}}` | Random UUID | `a1b2c3d4-...` |
| `{{randomInt min max}}` | Random integer | `{{randomInt 1 100}}` |
| `{{request.params.id}}` | URL parameter | Path: `/users/:id` |
| `{{request.query.page}}` | Query parameter | `?page=2` |
| `{{request.body.name}}` | Request body field | POST body |

### Request Matching

Match specific requests with conditions:

```json
{
  "matcher": {
    "headers": {
      "Authorization": "Bearer valid-token"
    },
    "queryParams": {
      "status": "active"
    },
    "body": {
      "type": "jsonPath",
      "jsonPath": "$.user.role",
      "value": "admin"
    }
  }
}
```

### Response Sequences

Return different responses based on call count:

```json
{
  "response": {
    "type": "sequence",
    "sequence": [
      { "statusCode": 200, "body": { "attempt": 1 } },
      { "statusCode": 200, "body": { "attempt": 2 } },
      { "statusCode": 429, "body": { "error": "Rate limited" } }
    ]
  }
}
```

### Proxy & Recording

Forward requests to a real API and record responses:

1. Start your mock server
2. Click "Start Recording" 
3. Enter the target URL (e.g., `https://api.example.com`)
4. Make requests to your mock server
5. Stop recording and generate mock routes from captured responses

### GraphQL Support

Create GraphQL mocks with operation matching:

```json
{
  "path": "/graphql",
  "method": "POST",
  "matcher": {
    "body": {
      "type": "jsonPath",
      "jsonPath": "$.operationName",
      "value": "GetUser"
    }
  },
  "response": {
    "body": {
      "data": {
        "user": {
          "id": "{{faker 'string.uuid'}}",
          "name": "{{faker 'person.fullName'}}"
        }
      }
    }
  }
}
```

### WebSocket Support

Create WebSocket event handlers:

```json
{
  "protocol": "websocket",
  "path": "/ws",
  "routes": [
    {
      "name": "chat:message",
      "path": "ws:chat:message",
      "response": {
        "body": {
          "event": "chat:message",
          "data": {
            "id": "{{uuid}}",
            "message": "{{request.body.message}}",
            "timestamp": "{{now}}"
          }
        }
      }
    }
  ]
}
```

---

## ⌨️ Keyboard Shortcuts

### Navigation

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + 1` | Go to Dashboard |
| `Cmd/Ctrl + 2` | Go to Servers |
| `Cmd/Ctrl + 3` | Go to Routes |
| `Cmd/Ctrl + 4` | Go to Databases |
| `Cmd/Ctrl + 5` | Go to Logs |
| `Cmd/Ctrl + 6` | Go to Settings |

### Actions

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + K` | Focus search |
| `Cmd/Ctrl + N` | Create new item |
| `Alt + 1-9` | Select server |
| `Cmd/Ctrl + Shift + S` | Start server |
| `Cmd/Ctrl + Shift + X` | Stop server |
| `Cmd/Ctrl + Shift + L` | Clear logs |
| `Escape` | Close modal / Clear search |

---

## 🗂️ Project Structure

Mocklify stores configuration in a `.mocklify` folder in your workspace:

```
.mocklify/
├── servers.json      # Server configurations
├── recordings/       # Recorded sessions
└── databases/        # JSON database files
```

---

## 🖥️ Headless CLI (CI / no VS Code)

The same mock engine runs from the command line, so your CI can boot the exact mocks your team designs in the dashboard. The `.mocklify/servers.json` you commit is the CLI's config.

The CLI ships as a separate npm package, [`@mocklify/cli`](https://www.npmjs.com/package/@mocklify/cli) (Node 18+). Installing it globally or as a dev dependency gives you a plain `mocklify` command.

```bash
# From a workspace that has a .mocklify/servers.json:
npx @mocklify/cli serve            # start every enabled server, stream one line per request
npx @mocklify/cli serve --all      # include disabled servers too
npx @mocklify/cli serve --server "Payments API" --port 4010
npx @mocklify/cli list             # name / protocol / port / route count
npx @mocklify/cli validate         # zod-validate the config; exit 1 on error
```

Exit codes: `0` OK · `1` config/validation error · `2` port already in use. `serve` shuts down cleanly on `SIGINT`/`SIGTERM`.

### GitHub Actions

```yaml
jobs:
  contract-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      # Start the mocks in the background, wait for the port, run your tests.
      - run: npx @mocklify/cli serve --quiet &
      - run: npx wait-on tcp:3000
      - run: npm test          # your app under test, pointed at http://localhost:3000
```

> The CLI binds `0.0.0.0` and uses the same stateful, chaos, and (HTTP) contract-validation behavior as the extension. WebSocket servers are extension-only and are skipped with a warning.

---

## 🔧 Configuration

### Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `mocklify.autoStart` | `false` | Auto-start servers on VS Code launch |
| `mocklify.defaultPort` | `3000` | Default port for new servers |
| `mocklify.configPath` | `.mocklify` | Configuration directory path |
| `mocklify.logging.maxEntries` | `1000` | Maximum log entries to keep |
| `mocklify.logging.includeBody` | `true` | Include request/response bodies in logs |
| `mocklify.ai.provider` | `auto` | AI provider: `auto`, `copilot`, `claude`, `openai`, or `gemini` |
| `mocklify.ai.copilotModel` | *(empty)* | Copilot model family (e.g. `gpt-4o`); empty = auto-select best available |
| `mocklify.ai.claudeModel` | `claude-opus-4-8` | Claude model ID (Bedrock-style IDs like `anthropic.claude-opus-4-8` work with gateways) |
| `mocklify.ai.openaiModel` | `gpt-4o` | OpenAI model ID (or an Azure-compatible deployment name) |
| `mocklify.ai.geminiModel` | `gemini-2.5-flash` | Google Gemini model ID |
| `mocklify.ai.claudeBaseUrl` | *(empty)* | Anthropic-compatible gateway/proxy endpoint; empty = official API |
| `mocklify.ai.openaiBaseUrl` | *(empty)* | OpenAI-compatible gateway/proxy endpoint; empty = official API |
| `mocklify.ai.geminiBaseUrl` | *(empty)* | Gemini-compatible gateway/proxy endpoint; empty = official API |
| `mocklify.ai.driftWatch` | `false` | Watch saved files for uncovered API calls and offer to generate routes |

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 🙏 Acknowledgments

- [Fastify](https://fastify.dev/) - Fast and low overhead web framework
- [Faker.js](https://fakerjs.dev/) - Generate realistic fake data
- [Handlebars](https://handlebarsjs.com/) - Semantic templating
- [VS Code Extension API](https://code.visualstudio.com/api) - Extension development

---

## 👤 Author

**Sitharaj Seenivasan**

- 🌐 Website: [sitharaj.in](https://sitharaj.in)
- 💼 LinkedIn: [sitharaj08](https://www.linkedin.com/in/sitharaj08)
- 💻 GitHub: [sitharaj88](https://github.com/sitharaj88)

## ☕ Support

If this project helps you, consider buying me a coffee — it keeps the work going.

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-support-FFDD00?logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/sitharaj88)

## 📄 License

Licensed under the [Apache License 2.0](LICENSE). © 2026 Sitharaj Seenivasan.
