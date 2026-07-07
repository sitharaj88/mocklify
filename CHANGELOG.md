# Changelog

All notable changes to the "Mocklify" extension will be documented in this file.

## [0.3.1] - 2026-07-07 (pre-release)

### Added

- **Export Server As…** (`mocklify.exportServerAs`, also in the dashboard's export dialog): OpenAPI 3.0 JSON/YAML, **Postman Collection v2.1** (deterministic collection id, folders per tag, mock responses as saved examples, failure-scenario subfolders), **REST Client `.http`**, **API docs web page** (self-contained single HTML file with search, curl examples, light/dark), **Confluence Storage Format** (paste via Insert → Markup or push via REST API), and Markdown. Generating docs now offers "Also export as Web Page / Confluence"
- **Dashboard UI overhaul**: consistent method-badge and status color system, retuned light theme with WCAG-AA contrast, auto-collapsing sidebar rail, route tables collapse to cards on narrow panes, responsive stat grid and modals, unified focus rings and motion

- **Agentic codebase scanning** (`mocklify.ai.scanMode`: `fast` | `agentic`): in agentic mode the AI explores the workspace itself through read-only tools (`list_files` / `read_file` / `search_code`) — following imports to data models, auth, and error conventions — then submits routes validated against the route schema. Hardened confinement: path-traversal and symlink protection, secrets denylist (`.env`, keys, credentials), 512KB read budget, 30-tool-call cap, 8-minute wall clock. Falls back to the fast scan (with a notice) when the active provider lacks tool support
- **Dashboard codebase generation**: a "From Codebase" button in the Create with AI panel with live stage messages, a progress bar, and a Cancel button
- **Copilot model selection** (`mocklify.ai.copilotModel`): pick from the live model list your Copilot subscription exposes — in the dashboard or via `Mocklify: Select AI Model`; empty = auto-select best
- **Model dropdowns in the dashboard** for Claude/OpenAI/Gemini fed by a shared catalog, with a custom-ID escape hatch for gateway model names
- **AI endpoint fields in the dashboard**: configure Bedrock-compatible / Azure-compatible / LiteLLM gateway base URLs per provider without leaving the dashboard

### Fixed

- AI requests can no longer hang forever: a stall watchdog (120s first data / 90s mid-stream gap) aborts dead requests with an error naming the provider and the base-URL setting to check; the codebase scan shows live streaming progress
- Dashboard sidebar/About and HAR exports showed a hardcoded version 0.1.0 — the real extension version is now injected at runtime
- Search bar, filters, and three dialogs rendered as unstyled native (white) controls in both themes — undefined Tailwind token classes mapped onto the theme palette
- Generated curl commands (docs exports and the log cURL export) used invalid shell quoting for single quotes in bodies/headers — now properly escaped and round-trip through `sh`

## [0.3.0] - 2026-07-07 (pre-release)

### Added

- **OpenAPI / Swagger import** (`Mocklify: Import OpenAPI / Swagger Spec`): OpenAPI 3.0/3.1 and Swagger 2.0, JSON or YAML, with local `$ref` resolution (cycle-safe) and deterministic seeded example data — the same spec always imports identically, no AI required. Documented 4xx/5xx responses become disabled negative routes. Optional **AI enrichment** rewrites example data to be coherent across routes and adds failure routes for endpoints that don't document them (with the exact AI request count disclosed up front); falls back to the deterministic import if AI is unavailable
- **Record & replay** (`Mocklify: AI: Generate Mock Server from Recorded Traffic`): turns captured request logs into a mock server — endpoints grouped and parameterized deterministically (`/users/42` → `/users/:userId`), real payloads generalized by AI, captured errors preserved as disabled negative routes; never invents endpoints that weren't observed
- **Stateful mocks**: routes with a `stateful` block (`{ collection, idParam?, seed? }`) share a live in-memory collection per server — GET lists (`?limit=`/`?offset=`), GET `/:id`, POST (201), PUT/PATCH, DELETE (204), 404 on missing ids. Seeds from `stateful.seed` or the route's example body; resets on restart or via `Mocklify: Reset Stateful Mock Data`. All AI generators emit stateful CRUD families automatically
- **Chaos simulation** (`Mocklify: Configure Chaos (Latency & Failures)`): per-server random failures and latency jitter with presets (Flaky 10% / Unstable 30% + jitter) or custom rate, status, and delay range; hot-reloads onto running servers
- **Scenario simulation** (`Mocklify: Simulate Scenario (Happy Path / Failures)`): one-command switch between happy path and failure scenarios (401, 404, 429, 500, slow responses, GraphQL errors) — scenarios reset to baseline first so they never stack
- **Drift watch** (`mocklify.ai.driftWatch` setting): notifies when saved source files contain API calls no mock covers, with one-click route generation carrying the missing endpoints
- **Enterprise AI gateways**: `mocklify.ai.claudeBaseUrl` / `openaiBaseUrl` / `geminiBaseUrl` settings route AI traffic through Bedrock-backed, LiteLLM, Azure-compatible, or other corporate gateways; `Mocklify: Select AI Model` picker with current model catalogs plus custom IDs (e.g. Bedrock-style `anthropic.claude-opus-4-8`)
- **Structured AI outputs**: Claude, OpenAI, and Gemini requests use native JSON-schema enforcement with graceful fallback for gateways that don't support it
- **Codebase scanning upgrades**: GraphQL client detection (Apollo, urql, graphql-request), data-model import following so mocked responses match your app's types, and expanded negative flows (403, 429 with `Retry-After`, slow-response routes)
- **Generation self-verification**: every AI-generated route batch is programmatically checked and invalid routes get one AI repair round before anything is saved

### Changed

- Negative routes now carry a matching priority so *enabling* a failure route reliably wins over the success route on the same method + path
- Bulk route insertion (imports, generators) persists in a single write instead of one write per route
- License changed from MIT to Apache-2.0

## [0.2.0] - 2026-07-03

### Added

- **Multi-provider AI**: all AI features now work with GitHub Copilot, Anthropic Claude (official `@anthropic-ai/sdk`), OpenAI, or Google Gemini
  - `Mocklify: Select AI Provider` and `Mocklify: Set/Clear AI Provider API Key` commands; keys stored in VS Code encrypted secret storage
  - `mocklify.ai.provider` setting (`auto` picks the first available provider) plus per-provider model settings (`ai.claudeModel` default `claude-opus-4-8`, `ai.openaiModel`, `ai.geminiModel`)
  - Streaming responses from every provider; the dashboard AI panel shows which provider is working
- **Dashboard AI panel**: type a description like "ecommerce api server" in the dashboard and get a running mock server with realistic data, suggestion chips, and auto-start
- **Dashboard AI settings tab**: choose the provider visually (with live availability — Copilot auto-detected, keys detected), save/replace/remove API keys, set models, and test the active provider without leaving the dashboard
- **"AI: Generate Mock Server from Codebase"**: scans any client codebase (Retrofit, fetch/axios, URLSession/Alamofire, Dio, HttpClient, react-query, and more) locally, then AI reverse-engineers every endpoint into a mock server — success routes shaped like the app's models plus disabled negative-flow routes (400/401/404/500) that can be toggled on to simulate failures; works with all AI providers

- **GitHub Copilot integration**
  - `@mocklify` chat participant with `/create`, `/route`, `/docs`, `/test`, `/analyze`, and `/list` commands
  - Language Model Tools so Copilot agent mode can list, create, populate, start, and inspect mock servers (`mocklify_list_servers`, `mocklify_create_server`, `mocklify_add_route`, `mocklify_start_server`, `mocklify_stop_server`, `mocklify_get_request_logs`)
  - AI mock generation commands: "AI: Generate Mock Server from Description" and "AI: Generate Routes from Description" — all AI output is validated against Mocklify's schemas before it is stored
- **API documentation**
  - "Generate API Documentation" command: AI-written Markdown docs saved to `docs/`, with an accurate deterministic fallback when Copilot is unavailable
  - "Export OpenAPI Spec" command: OpenAPI 3.0 export with response schemas inferred from example bodies
- ESLint configuration so `npm run lint` works
- Tests for OpenAPI export, documentation generation, AI JSON extraction, and route validation

### Fixed

- Recording never captured requests (sessions were started without activating them) and "Stop Recording" could never find the active session
- Dashboard OpenAPI/Postman import and server/log export called non-existent service methods
- Route search crashed on routes with multiple HTTP methods
- `Open Request Logs` command was declared but never registered
- Template helper `faker.userName` used a non-existent Faker v8 API
- Project now typechecks cleanly (`tsc --noEmit`)

### Changed

- Minimum VS Code version is now 1.95

## [0.1.0] - 2025-01-24

### Added

- Create and manage multiple mock servers on different ports
- HTTP/REST, GraphQL, and WebSocket protocol support
- Dynamic responses with Handlebars templates and Faker.js helpers
- Request matching by headers, query params, and body content
- Response delays for simulating network latency
- Response sequences for different responses based on call count
- Import from OpenAPI/Swagger and Postman collections
- Export request logs in HAR and cURL formats
- Proxy pass-through with request recording
- Modern React dashboard with dark/light themes
- Real-time request logging
- Keyboard shortcuts for navigation and actions
- Activity bar view with server and log panels
