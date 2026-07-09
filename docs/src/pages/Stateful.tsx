import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import CodeBlock from '../components/CodeBlock';
import InfoBox from '../components/InfoBox';

export default function Stateful() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Stateful Data"
        description="Give a family of routes a shared in-memory collection so POST-then-GET flows actually work — full CRUD from a few lines of config, no database."
      />

      {/* Overview */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Why stateful routes</h2>
        <p className="theme-text-secondary mb-4">
          A plain mock returns the same canned body every time. That is fine for a read-only
          screen, but it breaks the moment your app creates something and expects to read it back.
          A stateful route family fixes this: routes that share a{' '}
          <code className="text-purple-400">collection</code> name are backed by one live,
          in-memory store, so a <code className="text-purple-400">POST</code> is remembered and a
          later <code className="text-purple-400">GET</code> returns it.
        </p>
        <p className="theme-text-secondary">
          Add a <code className="text-purple-400">stateful</code> block to a route and Mocklify
          derives the CRUD operation from the HTTP method and whether the matched path bound an id.
          You write no handler code. The AI generators emit stateful blocks for CRUD endpoint
          families automatically — see{' '}
          <Link to="/ai" className="text-purple-400 hover:underline">AI Features</Link>.
        </p>
      </section>

      {/* Config shape */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">The stateful block</h2>
        <div className="theme-bg-card rounded-xl border theme-border overflow-x-auto mb-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b theme-border">
                <th className="text-left px-4 py-3 theme-text">Field</th>
                <th className="text-left px-4 py-3 theme-text">Type</th>
                <th className="text-left px-4 py-3 theme-text">Meaning</th>
              </tr>
            </thead>
            <tbody className="theme-text-secondary">
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400">collection</td>
                <td className="px-4 py-3">string (required)</td>
                <td className="px-4 py-3">The store key. Routes sharing this name share one store per running server.</td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400">idParam</td>
                <td className="px-4 py-3">string (default <code>"id"</code>)</td>
                <td className="px-4 py-3">The path parameter that identifies a single item, e.g. <code>:id</code>.</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-purple-400">seed</td>
                <td className="px-4 py-3">array (optional)</td>
                <td className="px-4 py-3">Initial items. If omitted, the list route&apos;s example body seeds the store.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <InfoBox type="info" title="One store per running server">
          The collection is in-memory and scoped to a single running server instance. Every route
          in that server referencing the same <code>collection</code> reads and writes the same
          items.
        </InfoBox>
      </section>

      {/* Verb behavior */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">What each verb does</h2>
        <p className="theme-text-secondary mb-4">
          The operation is derived from the method and whether the path bound the id parameter:
        </p>
        <div className="theme-bg-card rounded-xl border theme-border overflow-x-auto mb-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b theme-border">
                <th className="text-left px-4 py-3 theme-text">Request</th>
                <th className="text-left px-4 py-3 theme-text">Operation</th>
                <th className="text-left px-4 py-3 theme-text">Response</th>
              </tr>
            </thead>
            <tbody className="theme-text-secondary">
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400">GET /items</td>
                <td className="px-4 py-3">List</td>
                <td className="px-4 py-3">200 with the array (supports <code>?limit=</code> and <code>?offset=</code>)</td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400">GET /items/:id</td>
                <td className="px-4 py-3">Get one</td>
                <td className="px-4 py-3">200 with the item, or 404 if the id is unknown</td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400">POST /items</td>
                <td className="px-4 py-3">Insert</td>
                <td className="px-4 py-3">201 with the stored item (an <code>id</code> is generated if you send none)</td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400">PUT /items/:id</td>
                <td className="px-4 py-3">Replace</td>
                <td className="px-4 py-3">200 with the replaced item (id preserved), or 404</td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400">PATCH /items/:id</td>
                <td className="px-4 py-3">Update (shallow merge)</td>
                <td className="px-4 py-3">200 with the merged item (id preserved), or 404</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-purple-400">DELETE /items/:id</td>
                <td className="px-4 py-3">Delete</td>
                <td className="px-4 py-3">204 with no body, or 404 if the id is unknown</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="theme-text-secondary">
          A missing id on a get, update, replace, or delete returns{' '}
          <code className="text-purple-400">404</code> with{' '}
          <code className="text-purple-400">{'{ "error": "Not Found", "message": "…" }'}</code>.
          When no CRUD operation can be derived (for example a <code>POST</code> to a
          <code>/:id</code> path) the route quietly falls back to its normal configured response, so
          a misconfigured stateful block never breaks the route.
        </p>
      </section>

      {/* Seeding */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Seeding</h2>
        <p className="theme-text-secondary mb-4">
          A collection is seeded the first time it is touched, in this order:
        </p>
        <ol className="space-y-2 theme-text-secondary list-decimal list-inside mb-4">
          <li>
            An explicit <code className="text-purple-400">stateful.seed</code> array, if any route
            in the family declares one.
          </li>
          <li>
            Otherwise the matched route&apos;s static example body — an array becomes the list, a
            single object becomes one item.
          </li>
        </ol>
        <InfoBox type="info" title="Items carry their own id">
          On insert, if you send no <code>id</code> (and none matches the configured{' '}
          <code>idParam</code>), Mocklify generates a UUID. Lookups compare loosely by string, so
          numeric seeded ids still match a string path parameter.
        </InfoBox>
      </section>

      {/* Full example */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">A working example</h2>
        <p className="theme-text-secondary mb-4">
          Three routes share the <code className="text-purple-400">products</code> collection. The
          list route&apos;s example body doubles as the seed.
        </p>
        <CodeBlock
          title="servers.json (abbreviated — see Routes for the full envelope)"
          language="json"
          code={`{
  "name": "Catalog API",
  "port": 3000,
  "protocol": "http",
  "routes": [
    {
      "name": "List products",
      "method": "GET",
      "path": "/products",
      "stateful": { "collection": "products" },
      "response": {
        "statusCode": 200,
        "body": [
          { "id": "1", "name": "Keyboard", "price": 49 },
          { "id": "2", "name": "Mouse", "price": 25 }
        ]
      }
    },
    {
      "name": "Get product",
      "method": "GET",
      "path": "/products/:id",
      "stateful": { "collection": "products" },
      "response": { "statusCode": 200, "body": {} }
    },
    {
      "name": "Create product",
      "method": "POST",
      "path": "/products",
      "stateful": { "collection": "products" },
      "response": { "statusCode": 201, "body": {} }
    },
    {
      "name": "Delete product",
      "method": "DELETE",
      "path": "/products/:id",
      "stateful": { "collection": "products" },
      "response": { "statusCode": 204, "body": {} }
    }
  ]
}`}
        />
        <h3 className="text-lg font-medium mb-3 mt-6">Create, fetch, delete with curl</h3>
        <CodeBlock
          title="terminal"
          language="bash"
          code={`# Create a product → 201, returns the stored item
curl -X POST http://localhost:3000/products \\
  -H 'Content-Type: application/json' \\
  -d '{"id": "3", "name": "Monitor", "price": 199}'

# List now includes it → 200
curl http://localhost:3000/products

# Page through the list → 200 with at most one item, skipping the first
curl 'http://localhost:3000/products?limit=1&offset=1'

# Fetch it back by id → 200
curl http://localhost:3000/products/3

# Delete it → 204, empty body
curl -X DELETE http://localhost:3000/products/3

# Fetch the deleted id → 404
curl http://localhost:3000/products/3`}
        />
      </section>

      {/* Reset & cap */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Resetting and the size cap</h2>
        <p className="theme-text-secondary mb-4">
          State lives only as long as the running server. It <strong>resets on server restart</strong>,
          and you can clear it without restarting by running{' '}
          <code className="text-purple-400">Mocklify: Reset Stateful Mock Data</code> — collections
          re-seed on the next request.
        </p>
        <InfoBox type="warning" title="Collections are capped at 100,000 items">
          The store is in-memory, so each collection is capped at{' '}
          <code>MAX_COLLECTION_SIZE = 100000</code> items. At the cap an insert evicts the oldest
          item first, keeping memory bounded — inserts never fail. This is far above any realistic
          mock dataset.
        </InfoBox>
        <p className="theme-text-secondary">
          Stateful data runs headless too: serve the same config from the{' '}
          <Link to="/cli" className="text-purple-400 hover:underline">CLI</Link> and CRUD works
          exactly as it does in the editor, resetting on restart. Pair it with{' '}
          <Link to="/chaos" className="text-purple-400 hover:underline">Chaos</Link> to test how
          your app copes when a stateful write fails, and see the{' '}
          <Link to="/routes" className="text-purple-400 hover:underline">route reference</Link> for
          the full route shape.
        </p>
      </section>
    </div>
  );
}
