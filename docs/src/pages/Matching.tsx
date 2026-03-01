import PageHeader from '../components/PageHeader';
import CodeBlock from '../components/CodeBlock';
import InfoBox from '../components/InfoBox';

export default function Matching() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Request Matching"
        description="Define conditions to match specific requests and return different responses."
      />

      {/* Overview */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Overview</h2>
        <p className="theme-text-secondary mb-4">
          Request matching allows you to create multiple routes with the same path/method but different responses based on request conditions.
        </p>
        <InfoBox type="info">
          Routes with matchers are evaluated in order. The first matching route wins. Put more specific matchers first.
        </InfoBox>
      </section>

      {/* Header Matching */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Header Matching</h2>
        <CodeBlock
          title="Match by Authorization Header"
          language="json"
          code={`{
  "name": "Authenticated User",
  "method": "GET",
  "path": "/api/profile",
  "matcher": {
    "headers": {
      "Authorization": "Bearer valid-token"
    }
  },
  "response": {
    "statusCode": 200,
    "body": { "name": "John Doe", "role": "admin" }
  }
}`}
        />

        <CodeBlock
          title="Unauthorized Response"
          language="json"
          code={`{
  "name": "Unauthorized",
  "method": "GET",
  "path": "/api/profile",
  "response": {
    "statusCode": 401,
    "body": { "error": "Unauthorized" }
  }
}`}
        />
      </section>

      {/* Query Parameter Matching */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Query Parameter Matching</h2>
        <CodeBlock
          language="json"
          code={`{
  "name": "Active Users Only",
  "method": "GET",
  "path": "/api/users",
  "matcher": {
    "queryParams": {
      "status": "active",
      "verified": "true"
    }
  },
  "response": {
    "body": {
      "users": [
        { "name": "Active User 1", "status": "active" },
        { "name": "Active User 2", "status": "active" }
      ]
    }
  }
}`}
        />
      </section>

      {/* Body Matching */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Body Matching</h2>
        
        <h3 className="text-lg font-medium mb-3">Exact Match</h3>
        <CodeBlock
          language="json"
          code={`{
  "matcher": {
    "body": {
      "type": "exact",
      "value": {
        "action": "create",
        "type": "user"
      }
    }
  }
}`}
        />

        <h3 className="text-lg font-medium mb-3 mt-6">Partial Match (Contains)</h3>
        <CodeBlock
          language="json"
          code={`{
  "matcher": {
    "body": {
      "type": "contains",
      "value": {
        "action": "create"
      }
    }
  }
}`}
        />
      </section>

      {/* JSONPath Matching */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">JSONPath Matching</h2>
        <p className="theme-text-secondary mb-4">
          Use JSONPath expressions for advanced body matching:
        </p>
        
        <CodeBlock
          title="Match by Nested Value"
          language="json"
          code={`{
  "name": "Admin Only Action",
  "method": "POST",
  "path": "/api/admin/action",
  "matcher": {
    "body": {
      "type": "jsonPath",
      "jsonPath": "$.user.role",
      "value": "admin"
    }
  },
  "response": {
    "statusCode": 200,
    "body": { "success": true }
  }
}`}
        />

        <CodeBlock
          title="Match Array Length"
          language="json"
          code={`{
  "matcher": {
    "body": {
      "type": "jsonPath",
      "jsonPath": "$.items.length",
      "value": 3
    }
  }
}`}
        />

        <InfoBox type="tip" title="JSONPath Examples">
          <ul className="space-y-1 mt-2">
            <li><code>$.user.name</code> - Root-level object property</li>
            <li><code>$.items[0].id</code> - First item in array</li>
            <li><code>$.items[*].price</code> - All prices in items array</li>
            <li><code>$..id</code> - All id fields at any depth</li>
          </ul>
        </InfoBox>
      </section>

      {/* Regex Matching */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Regex Matching</h2>
        <CodeBlock
          language="json"
          code={`{
  "matcher": {
    "headers": {
      "User-Agent": {
        "type": "regex",
        "pattern": "^Mozilla.*Firefox"
      }
    },
    "queryParams": {
      "email": {
        "type": "regex",
        "pattern": ".*@example\\.com$"
      }
    }
  }
}`}
        />
      </section>

      {/* Combined Matching */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Combined Matching</h2>
        <p className="theme-text-secondary mb-4">
          Combine multiple conditions - all must match (AND logic):
        </p>
        
        <CodeBlock
          language="json"
          code={`{
  "name": "Premium User Search",
  "method": "GET",
  "path": "/api/search",
  "matcher": {
    "headers": {
      "X-User-Tier": "premium"
    },
    "queryParams": {
      "limit": "100"
    }
  },
  "response": {
    "body": {
      "results": [],
      "limit": 100,
      "tier": "premium"
    }
  }
}`}
        />
      </section>

      {/* Priority */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Route Priority</h2>
        <p className="theme-text-secondary mb-4">
          When multiple routes match, use the <code className="px-2 py-0.5 theme-bg-secondary rounded">priority</code> field:
        </p>
        
        <CodeBlock
          language="json"
          code={`{
  "name": "High Priority Route",
  "path": "/api/users",
  "priority": 10,
  "matcher": { ... }
},
{
  "name": "Default Route",
  "path": "/api/users",
  "priority": 1
}`}
        />
        
        <InfoBox type="info">
          Higher priority values are matched first. Default priority is 0.
        </InfoBox>
      </section>
    </div>
  );
}
