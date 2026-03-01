import PageHeader from '../components/PageHeader';
import CodeBlock from '../components/CodeBlock';
import InfoBox from '../components/InfoBox';

export default function GraphQL() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="GraphQL Support"
        description="Mock GraphQL queries and mutations with operation matching and variable substitution."
      />

      {/* Overview */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Overview</h2>
        <p className="text-slate-400 mb-4">
          Mocklify supports GraphQL mocking by matching operations based on operation name, query content, and variables.
        </p>
      </section>

      {/* Basic Query */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Basic Query Mock</h2>
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
        <p className="text-slate-400 mb-4">
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
        <p className="text-slate-400 mb-4">
          Access GraphQL variables in your response templates:
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
          GraphQL variables are in <code>request.body.variables</code>
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
        <p className="text-slate-400 mb-4">
          Match based on query content for operations without names:
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
      "value": {
        "query": "__schema"
      }
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
          GraphQL subscriptions require WebSocket transport. See the <a href="#/websocket" className="text-purple-400 hover:underline">WebSocket documentation</a> for setting up subscription mocks.
        </InfoBox>
      </section>

      {/* Complete Example */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Complete Example</h2>
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
