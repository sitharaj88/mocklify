import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import CodeBlock from '../components/CodeBlock';
import InfoBox from '../components/InfoBox';

export default function GraphQL() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="GraphQL Support"
        description="Mock GraphQL queries and mutations — match a route by operation name and type, or fall back to body matchers."
      />

      {/* Overview */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Two ways to match</h2>
        <p className="theme-text-secondary mb-4">
          A GraphQL endpoint is just a <code>POST</code> to one path (usually{' '}
          <code>/graphql</code>), so every request looks the same to a REST matcher. Mocklify
          gives you two ways to route them:
        </p>
        <ul className="space-y-2 theme-text-secondary mb-4">
          <li>
            • <strong>Native operation routing</strong> — add a <code className="text-purple-400">graphql</code>{' '}
            block to a route and Mocklify matches by the operation name and type parsed from the
            request body. This is the recommended approach.
          </li>
          <li>
            • <strong>Body matchers</strong> — the general-purpose{' '}
            <Link to="/matching" className="text-purple-400 hover:underline">request matching</Link>{' '}
            engine, keyed on <code>$.operationName</code> or query content. Use it for cases the{' '}
            <code>graphql</code> block does not cover (matching on variables, introspection, etc.).
          </li>
        </ul>
      </section>

      {/* Native operation routing */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Native Operation Routing</h2>
        <p className="theme-text-secondary mb-4">
          Give a route a <code>graphql</code> block to match a <code>POST</code> by its GraphQL
          operation directly. Both fields are required:
        </p>
        <div className="theme-bg-card rounded-xl border theme-border overflow-x-auto mb-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b theme-border">
                <th className="text-left px-4 py-3 theme-text">Field</th>
                <th className="text-left px-4 py-3 theme-text">Type</th>
                <th className="text-left px-4 py-3 theme-text">Notes</th>
              </tr>
            </thead>
            <tbody className="theme-text-secondary">
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400">operationName</td>
                <td className="px-4 py-3 font-mono">string</td>
                <td className="px-4 py-3">Required, non-empty. Matched exactly (case-sensitive).</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-purple-400">operationType</td>
                <td className="px-4 py-3 font-mono">"query" | "mutation" | "subscription"</td>
                <td className="px-4 py-3">Required. Checked against the selected operation's type.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="theme-text-secondary mb-4">
          In the dashboard, open the route's <strong>Advanced</strong> tab — shown when the method
          is <code>POST</code> and the path contains <code>graphql</code> — and enable{' '}
          <strong>Match by operation</strong>. The <code>graphql</code> block is a{' '}
          <Link to="/routes" className="text-purple-400 hover:underline">route</Link> field, so you
          can also add it directly in <code>servers.json</code>.
        </p>
        <CodeBlock
          title="GetUser via a graphql block"
          language="json"
          code={`{
  "name": "GetUser",
  "method": "POST",
  "path": "/graphql",
  "graphql": {
    "operationName": "GetUser",
    "operationType": "query"
  },
  "response": {
    "statusCode": 200,
    "body": { "data": { "user": { "id": "{{faker 'string.uuid'}}" } } }
  }
}`}
        />
      </section>

      {/* Resolution */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">How the operation is resolved</h2>
        <p className="theme-text-secondary mb-4">
          Mocklify parses the request body and works out the <em>effective operation name</em>:
        </p>
        <ol className="space-y-2 theme-text-secondary list-decimal list-inside mb-4">
          <li>
            The body's top-level <code className="text-purple-400">operationName</code> field wins
            when present — this is what a client sends to disambiguate a multi-operation document.
          </li>
          <li>
            Otherwise the name is parsed from the <code className="text-purple-400">query</code>{' '}
            string: the first top-level operation, <strong>skipping any leading{' '}
            <code>fragment</code> definitions</strong>.
          </li>
        </ol>
        <p className="theme-text-secondary mb-4">
          The route matches only when that effective name equals the block's{' '}
          <code className="text-purple-400">operationName</code> exactly. The type guard then
          checks <code className="text-purple-400">operationType</code> against the{' '}
          <em>selected</em> operation: when the body named an operation, its type is checked (not
          the first operation's); when the named operation cannot be found in the parsed document,
          the type check is skipped rather than treated as a mismatch.
        </p>
        <InfoBox type="info" title="Multi-operation documents">
          A single request can carry several operations in one <code>query</code> string plus an{' '}
          <code>operationName</code> picking which to run. Mocklify matches on the operation the
          client actually selected — a leading fragment or extra operations no longer throw the
          match off.
        </InfoBox>
        <p className="theme-text-secondary mt-4">
          There is no wildcard: <code className="text-purple-400">operationName</code> is always an
          exact string. Create one route per operation and add a body-matcher-free catch-all route
          (shown in the complete example below) for anything unmatched.
        </p>
      </section>

      {/* Precedence & safety */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Precedence &amp; safety</h2>
        <ul className="space-y-2 theme-text-secondary mb-4">
          <li>
            • A route with a <code className="text-purple-400">graphql</code> block that does{' '}
            <strong>not</strong> match the operation is not a match at all — it never silently
            degrades to a path-only match, so it won't steal requests meant for another operation.
          </li>
          <li>
            • You can still add a <code>matcher</code> alongside a <code>graphql</code> block; both
            must pass. A higher <code>priority</code> wins when several routes are eligible (see{' '}
            <Link to="/routes" className="text-purple-400 hover:underline">Routes</Link>).
          </li>
          <li>
            • A malformed or non-GraphQL body (not <code>{'{ query: string, ... }'}</code>) simply
            fails to match and falls through to the next route — it never returns a 500.
          </li>
        </ul>
      </section>

      {/* Basic Query — body matcher */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Body-matcher approach</h2>
        <p className="theme-text-secondary mb-4">
          Without a <code>graphql</code> block, route GraphQL the same way you route any request —
          with a <Link to="/matching" className="text-purple-400 hover:underline">body matcher</Link>{' '}
          on <code>$.operationName</code>:
        </p>
        <CodeBlock
          title="GetUser Query"
          language="json"
          code={`{
  "name": "GetUser Query",
  "method": "POST",
  "path": "/graphql",
  "matcher": {
    "body": {
      "type": "jsonPath",
      "jsonPath": "$.operationName",
      "value": "GetUser"
    }
  },
  "response": {
    "statusCode": 200,
    "body": {
      "data": {
        "user": {
          "id": "{{faker 'string.uuid'}}",
          "name": "{{faker 'person.fullName'}}",
          "email": "{{faker 'internet.email'}}"
        }
      }
    }
  }
}`}
        />
      </section>

      {/* Multiple Operations */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Multiple Operations</h2>
        <p className="theme-text-secondary mb-4">
          Create separate routes for different GraphQL operations:
        </p>

        <CodeBlock
          title="GetUsers Query"
          language="json"
          code={`{
  "name": "GetUsers",
  "method": "POST",
  "path": "/graphql",
  "matcher": {
    "body": {
      "type": "jsonPath",
      "jsonPath": "$.operationName",
      "value": "GetUsers"
    }
  },
  "response": {
    "body": {
      "data": {
        "users": [
          { "id": "1", "name": "John Doe" },
          { "id": "2", "name": "Jane Smith" }
        ]
      }
    }
  }
}`}
        />

        <CodeBlock
          title="CreateUser Mutation"
          language="json"
          code={`{
  "name": "CreateUser",
  "method": "POST",
  "path": "/graphql",
  "matcher": {
    "body": {
      "type": "jsonPath",
      "jsonPath": "$.operationName",
      "value": "CreateUser"
    }
  },
  "response": {
    "body": {
      "data": {
        "createUser": {
          "id": "{{faker 'string.uuid'}}",
          "name": "{{request.body.variables.input.name}}",
          "email": "{{request.body.variables.input.email}}"
        }
      }
    }
  }
}`}
        />
      </section>

      {/* Variable Access */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Accessing Variables</h2>
        <p className="theme-text-secondary mb-4">
          Access GraphQL variables in your response templates — this works with either matching
          approach:
        </p>

        <CodeBlock
          language="json"
          code={`{
  "name": "GetUserById",
  "method": "POST",
  "path": "/graphql",
  "matcher": {
    "body": {
      "type": "jsonPath",
      "jsonPath": "$.operationName",
      "value": "GetUserById"
    }
  },
  "response": {
    "body": {
      "data": {
        "user": {
          "id": "{{request.body.variables.id}}",
          "name": "User {{request.body.variables.id}}"
        }
      }
    }
  }
}`}
        />

        <InfoBox type="tip">
          GraphQL variables live in <code>request.body.variables</code>.
        </InfoBox>
      </section>

      {/* Error Responses */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">GraphQL Errors</h2>
        <CodeBlock
          language="json"
          code={`{
  "name": "User Not Found",
  "method": "POST",
  "path": "/graphql",
  "matcher": {
    "body": {
      "type": "jsonPath",
      "jsonPath": "$.variables.id",
      "value": "invalid-id"
    }
  },
  "response": {
    "body": {
      "data": null,
      "errors": [
        {
          "message": "User not found",
          "locations": [{ "line": 2, "column": 3 }],
          "path": ["user"],
          "extensions": {
            "code": "NOT_FOUND"
          }
        }
      ]
    }
  }
}`}
        />
      </section>

      {/* Query Matching */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Query Content Matching</h2>
        <p className="theme-text-secondary mb-4">
          Match on query content for operations without names (e.g. introspection):
        </p>

        <CodeBlock
          language="json"
          code={`{
  "name": "Introspection Query",
  "method": "POST",
  "path": "/graphql",
  "matcher": {
    "body": {
      "type": "contains",
      "value": "__schema"
    }
  },
  "response": {
    "body": {
      "data": {
        "__schema": {
          "types": []
        }
      }
    }
  }
}`}
        />
      </section>

      {/* Subscriptions Note */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">GraphQL Subscriptions</h2>
        <InfoBox type="info" title="WebSocket Required">
          The <code>subscription</code> operation type is accepted in the <code>graphql</code>{' '}
          block, but live subscription streams need WebSocket transport. See the{' '}
          <Link to="/websocket" className="text-purple-400 hover:underline">WebSocket documentation</Link>{' '}
          for setting up subscription mocks.
        </InfoBox>
      </section>

      {/* Complete Example */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Complete Example</h2>
        <p className="theme-text-secondary mb-4">
          Native operation routes plus a body-matcher-free catch-all for anything unmatched:
        </p>
        <CodeBlock
          title="Full GraphQL Mock Server"
          language="json"
          code={`{
  "name": "GraphQL API",
  "port": 4000,
  "routes": [
    {
      "name": "GetUsers",
      "method": "POST",
      "path": "/graphql",
      "graphql": { "operationName": "GetUsers", "operationType": "query" },
      "response": {
        "body": {
          "data": {
            "users": [
              {
                "id": "{{faker 'string.uuid'}}",
                "name": "{{faker 'person.fullName'}}",
                "email": "{{faker 'internet.email'}}"
              }
            ]
          }
        }
      }
    },
    {
      "name": "CreateUser",
      "method": "POST",
      "path": "/graphql",
      "graphql": { "operationName": "CreateUser", "operationType": "mutation" },
      "response": {
        "body": {
          "data": { "createUser": { "id": "{{faker 'string.uuid'}}" } }
        }
      }
    },
    {
      "name": "Default GraphQL",
      "method": "POST",
      "path": "/graphql",
      "response": {
        "statusCode": 400,
        "body": {
          "errors": [
            { "message": "Unknown operation" }
          ]
        }
      }
    }
  ]
}`}
        />
      </section>
    </div>
  );
}
