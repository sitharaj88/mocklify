# Changelog

All notable changes to the "Mocklify" extension will be documented in this file.

## [0.5.0] - 2026-07-15

The AI release. A provider-agnostic chat assistant that can inspect **and modify** your
mock servers conversationally, backed by a confirmation-gated agent, a workspace
knowledge tool, and opt-in proactive agents. Works with Copilot, Claude, Gemini, and
OpenAI — every model call goes through Mocklify's own AI layer.

### Added

- **AI Chat panel** — a new **Chat** tab in the dashboard (command `Mocklify: Open AI Chat`). Ask the agent to inspect or change your mock servers in plain language ("add a 404 route to the payments API and restart it"). Streams live tool-progress, renders assistant replies as safe GFM markdown (lists, tables, links, fenced code blocks with one-click Copy), and never navigates the webview — links open through the extension with an http/https allowlist
- **Server agent + tool belt** — the assistant drives a hardened tool belt over your servers: list servers/routes, read recent request logs, and create server / add / update / delete route / start / stop. **Every mutation is gated behind an explicit confirmation** rendered as a before/after route diff card, all model-supplied input is validated, and route behaviors that reach out (proxy targets, database operations) are disclosed in the confirmation before you approve
- **Undo** — each chat turn that changed servers offers a one-click undo of that turn's mutations
- **Multi-session chat history with continue** — multiple named chat sessions (auto-titled from your first message), switch / rename / delete, per-session drafts, and full persistence across reloads and panel reopen (per workspace). Reopening continues a session with its history intact; timestamps, day dividers, copy-message, and regenerate round out the transcript
- **`query_knowledge` tool** — the agent can answer from what Mocklify already knows: previous scan memory, recent request logs (including failures), imported API specs and their endpoints, diagnostics/contract issues, and the current route tables — each source degrading gracefully when empty
- **`@mocklify /agent`** — the same server agent is available as a command on the existing `@mocklify` Copilot chat participant, for users who prefer Copilot Chat
- **Proactive drift notifications** (opt-in, `mocklify.ai.driftNotifications`, default off) — when saved code calls endpoints no mock covers, a rate-limited notification offers **Fix in AI Chat**, which opens the chat pre-filled with a repair prompt (never auto-sent). Per-endpoint rate limiting keeps autosave churn from spamming you
- **Scheduled background re-scans** (opt-in, `mocklify.ai.scheduledScan.intervalMinutes`, default 0 = off) — an unattended interval scan refreshes scan memory and, when it finds endpoints your mocks don't cover, surfaces one **Review in AI Chat** notification. Never overlaps an interactive scan, backs off on failure, and never interrupts you with error popups

### Fixed

- **Routes page search** now filters the list as you type (the search box previously updated state that the routes table ignored). Added a distinct "No matching routes" empty state with a Clear-filters action, a filtered count in the header, and correct matching for multi-method routes
- Chat inline-code, code blocks, and tables now keep proper contrast in **light** theme (they previously washed out to near-white-on-white)

### Changed

- The chat composer's Send/Stop controls are now modern circular icon buttons

## [0.4.0] - 2026-07-10

First stable release. Everything from the 0.3.x pre-releases, plus a headless CLI,
an end-to-end test harness, contract validation, and diagnostics.

### Added

- **Headless CLI** — published separately as [`@mocklify/cli`](https://www.npmjs.com/package/@mocklify/cli) (Node 18+). `mocklify serve | validate | list` runs the same mock engine outside VS Code, so CI boots the exact mocks your team designs in the dashboard. Streams one log line per request, clean `SIGINT` shutdown, exit codes `0` OK / `1` config error / `2` port in use
- **Contract validation** — give a server an OpenAPI spec (`contract: { specPath, mode }`): `warn` logs violations on each request, `enforce` answers non-conforming requests with `400`. Works in the extension and the CLI. New command `Mocklify: Configure Contract Validation`
- **Report Issue** (`Mocklify: Report Issue`) — a diagnostics report with version, provider, scan strategy and last error, redacting API keys, bearer tokens, gateway URLs and absolute paths; copy it or open a pre-filled GitHub issue
- **Per-route chaos** — a route may override its server's chaos config; `enabled: false` on a route exempts it from server-wide chaos
- **GraphQL-native routes** — match on `operationName` and operation type instead of body matchers
- **Agentic scan graph** (LangGraph orchestration): parallel per-surface exploration, a fresh-context critic agent that verifies generated routes against your code, one bounded repair round, human-in-the-loop questions (`ask_user`), resumable scans, and workspace scan memory. Copilot, gateways, watchdogs and the hardened read-only tools are unchanged — graph nodes call Mocklify's own AI layer
- **End-to-end test suite** running in a real VS Code host with an offline fake AI provider

### Added — universal codebase scanning

- **Workspace profiling**: the codebase scan now profiles the workspace first (web, Android, iOS, Kotlin Multiplatform, React Native, Flutter, Ionic, and backends — Spring Boot, Express/NestJS, FastAPI/Django/Flask, Rails, Go, Laravel, ASP.NET Core, …). Backends are scanned in the *serves* direction: route declarations and handler code become the mocked contract for frontend teams
- **One mock server per API surface**: monorepos and multi-app workspaces get a per-surface confirmation (name, direction, success/failure route counts, auto-assigned ports) and one mock server per surface, in both the command and the dashboard "From Codebase" flow; single-app repos behave exactly as before
- **Spec-first shortcut**: when the scan finds API spec files (OpenAPI/Swagger, proto, GraphQL, Postman), Mocklify offers to import the spec directly for exact routes — instead of or alongside the AI scan results; OpenAPI/Swagger imports reuse the full import pipeline
- Agentic scans on multi-project workspaces scale their budgets (up to 60 tool calls, 16 minutes, 1 MB read budget) and narrate progress milestones live

- **Any project, any language**: the extension-whitelist gate is gone. Language-agnostic API signals (REST paths, URLs, HTTP verbs, JSON shapes, auth vocabulary) seed the scan even for stacks Mocklify has never seen, and a workspace with no matches falls back to census-guided exploration instead of a dead end
- **`mocklify.ai.scanMode: "auto"`** (new default) picks the best strategy per surface: an existing spec > agentic exploration > fast scan > census
- Ecosystem knowledge is now a declarative registry of 39 framework packs, so adding a stack is a data entry

### Changed

- Drift watch now also recognizes server-route declarations (Express, Spring, FastAPI, and other backend frameworks), so backend files are watched for uncovered endpoints too

### Fixed

- GraphQL matching read the *first* operation in a multi-operation document instead of the one selected by `operationName`; documents starting with a fragment yielded no operation name at all
- Chaos delay was unbounded and awaited inside the request handler — an untrusted `servers.json` could hang every request. Now clamped to 60s
- Stateful collections grew without bound; capped with oldest-entry eviction
- Diagnostics redaction missed JSON-quoted secret values (`"apiKey": "sk-…"`)
- The search bar, filters and three dialogs rendered as unstyled native controls in both themes
- Route path chips were unreadable in light mode

## [0.3.2] - 2026-07-07 (pre-release)

### Fixed

- A configured gateway base URL was saved but never used unless an API key was also stored: providers with a custom endpoint now count as available (auto mode picks them, "Gateway configured" shown in the dashboard) and send a placeholder key when the gateway authenticates upstream

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
