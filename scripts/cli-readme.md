# @mocklify/cli

Run [Mocklify](https://marketplace.visualstudio.com/items?itemName=sitharaj.mocklify) mock servers outside VS Code.

The mocks your team designs in the Mocklify dashboard live in a committed `.mocklify/servers.json`. This CLI boots those exact servers — same engine, same matching, same stateful and chaos behaviour — so CI runs the mocks your team already trusts.

No VS Code, no AI provider, no configuration required.

## Install

```bash
npx @mocklify/cli serve        # no install
npm i -D @mocklify/cli         # or add it to the project
```

Requires Node 18+.

## Usage

From a directory containing `.mocklify/servers.json`:

```bash
mocklify serve                              # start every enabled server, stream one line per request
mocklify serve --all                        # include disabled servers too
mocklify serve --server "Payments API" --port 4010
mocklify serve --watch                      # restart when the config changes
mocklify list                               # name / protocol / port / route count
mocklify validate                           # validate the config; exit 1 on error
```

Pass a path to use a different config: `mocklify serve ./fixtures/servers.json`.

| Exit code | Meaning |
|---|---|
| `0` | OK |
| `1` | Config or validation error |
| `2` | Port already in use |

`serve` shuts down cleanly on `SIGINT` / `SIGTERM`.

> Servers bind `0.0.0.0`, so they are reachable from other devices on your network — that is deliberate, since Mocklify is commonly used to mock APIs for phones and simulators on the same Wi-Fi. The CLI prints a warning at startup.

## Contract validation

If a server declares an OpenAPI contract, the CLI enforces it exactly as the extension does:

```json
{
  "name": "Payments API",
  "port": 4010,
  "contract": { "specPath": "openapi.yaml", "mode": "enforce" },
  "routes": [ /* … */ ]
}
```

`warn` logs violations; `enforce` answers non-conforming requests with `400`.

## GitHub Actions

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
      - run: npx @mocklify/cli serve --quiet &
      - run: npx wait-on tcp:3000
      - run: npm test          # your app under test, pointed at http://localhost:3000
```

## Links

- [VS Code extension](https://marketplace.visualstudio.com/items?itemName=sitharaj.mocklify) — design mocks with AI, then commit the config
- [Documentation](https://sitharaj88.github.io/mocklify/)
- [Issues](https://github.com/sitharaj88/mocklify/issues)

## Author

**Sitharaj Seenivasan**

- Website: [sitharaj.in](https://sitharaj.in)
- LinkedIn: [sitharaj08](https://www.linkedin.com/in/sitharaj08)
- GitHub: [sitharaj88](https://github.com/sitharaj88)

If this project helps you, consider [buying me a coffee](https://buymeacoffee.com/sitharaj88).

## License

Licensed under the [Apache License 2.0](LICENSE). © 2026 Sitharaj Seenivasan.
