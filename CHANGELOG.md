# Changelog

All notable changes to the "Mocklify" extension will be documented in this file.

## [0.2.0] - 2026-07-03

### Added

- **Multi-provider AI**: all AI features now work with GitHub Copilot, Anthropic Claude (official `@anthropic-ai/sdk`), OpenAI, or Google Gemini
  - `Mocklify: Select AI Provider` and `Mocklify: Set/Clear AI Provider API Key` commands; keys stored in VS Code encrypted secret storage
  - `mocklify.ai.provider` setting (`auto` picks the first available provider) plus per-provider model settings (`ai.claudeModel` default `claude-opus-4-8`, `ai.openaiModel`, `ai.geminiModel`)
  - Streaming responses from every provider; the dashboard AI panel shows which provider is working
- **Dashboard AI panel**: type a description like "ecommerce api server" in the dashboard and get a running mock server with realistic data, suggestion chips, and auto-start
- **Dashboard AI settings tab**: choose the provider visually (with live availability — Copilot auto-detected, keys detected), save/replace/remove API keys, set models, and test the active provider without leaving the dashboard

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
