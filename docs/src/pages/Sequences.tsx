import PageHeader from '../components/PageHeader';
import CodeBlock from '../components/CodeBlock';
import InfoBox from '../components/InfoBox';

export default function Sequences() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Response Sequences"
        description="Return different responses based on the number of times a route is called."
      />

      {/* Overview */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Overview</h2>
        <p className="theme-text-secondary mb-4">
          Response sequences allow you to simulate stateful API behavior by returning different responses on each call. This is useful for testing:
        </p>
        <ul className="space-y-2 theme-text-secondary mb-4">
          <li>• Retry logic and exponential backoff</li>
          <li>• Polling for status changes</li>
          <li>• Rate limiting scenarios</li>
          <li>• Progressive data loading</li>
        </ul>
      </section>

      {/* Basic Sequence */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Basic Sequence</h2>
        <CodeBlock
          title="Sequential Responses"
          language="json"
          code={`{
  "name": "Job Status",
  "method": "GET",
  "path": "/api/job/:id/status",
  "response": {
    "type": "sequence",
    "sequence": [
      {
        "statusCode": 200,
        "body": { "status": "pending", "progress": 0 }
      },
      {
        "statusCode": 200,
        "body": { "status": "processing", "progress": 50 }
      },
      {
        "statusCode": 200,
        "body": { "status": "complete", "progress": 100 }
      }
    ]
  }
}`}
        />
        
        <InfoBox type="info">
          Each call returns the next response in the sequence. After the last response, it loops back to the first.
        </InfoBox>
      </section>

      {/* Error Sequences */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Error & Retry Sequences</h2>
        <p className="theme-text-secondary mb-4">
          Test retry logic by returning errors initially, then success:
        </p>
        
        <CodeBlock
          title="Transient Error Simulation"
          language="json"
          code={`{
  "name": "Flaky Endpoint",
  "method": "POST",
  "path": "/api/submit",
  "response": {
    "type": "sequence",
    "sequence": [
      {
        "statusCode": 503,
        "body": { "error": "Service temporarily unavailable" }
      },
      {
        "statusCode": 503,
        "body": { "error": "Service temporarily unavailable" }
      },
      {
        "statusCode": 200,
        "body": { "success": true, "id": "{{uuid}}" }
      }
    ]
  }
}`}
        />
      </section>

      {/* Rate Limiting */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Rate Limiting Simulation</h2>
        <CodeBlock
          language="json"
          code={`{
  "name": "Rate Limited API",
  "method": "GET",
  "path": "/api/data",
  "response": {
    "type": "sequence",
    "sequence": [
      {
        "statusCode": 200,
        "headers": { "X-RateLimit-Remaining": "2" },
        "body": { "data": "First call" }
      },
      {
        "statusCode": 200,
        "headers": { "X-RateLimit-Remaining": "1" },
        "body": { "data": "Second call" }
      },
      {
        "statusCode": 200,
        "headers": { "X-RateLimit-Remaining": "0" },
        "body": { "data": "Third call" }
      },
      {
        "statusCode": 429,
        "headers": { "Retry-After": "60" },
        "body": { "error": "Too many requests" }
      }
    ]
  }
}`}
        />
      </section>

      {/* Pagination Sequence */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Pagination Sequence</h2>
        <CodeBlock
          language="json"
          code={`{
  "name": "Paginated Results",
  "method": "GET",
  "path": "/api/items",
  "response": {
    "type": "sequence",
    "sequence": [
      {
        "statusCode": 200,
        "body": {
          "items": [{ "id": 1 }, { "id": 2 }],
          "hasMore": true,
          "nextCursor": "cursor-2"
        }
      },
      {
        "statusCode": 200,
        "body": {
          "items": [{ "id": 3 }, { "id": 4 }],
          "hasMore": true,
          "nextCursor": "cursor-3"
        }
      },
      {
        "statusCode": 200,
        "body": {
          "items": [{ "id": 5 }],
          "hasMore": false,
          "nextCursor": null
        }
      }
    ]
  }
}`}
        />
      </section>

      {/* Sequence Options */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Sequence Options</h2>
        
        <h3 className="text-lg font-medium mb-3">Loop Behavior</h3>
        <CodeBlock
          language="json"
          code={`{
  "response": {
    "type": "sequence",
    "loop": true,
    "sequence": [...]
  }
}`}
        />
        <p className="theme-text-secondary mt-2 mb-6">
          When <code className="px-2 py-0.5 theme-bg-secondary rounded">loop: true</code> (default), the sequence repeats from the beginning after the last response.
        </p>

        <h3 className="text-lg font-medium mb-3">Stick to Last</h3>
        <CodeBlock
          language="json"
          code={`{
  "response": {
    "type": "sequence",
    "loop": false,
    "sequence": [
      { "statusCode": 202, "body": { "status": "pending" } },
      { "statusCode": 200, "body": { "status": "complete" } }
    ]
  }
}`}
        />
        <p className="theme-text-secondary mt-2">
          When <code className="px-2 py-0.5 theme-bg-secondary rounded">loop: false</code>, the last response is returned for all subsequent calls.
        </p>
      </section>

      {/* Reset */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Resetting Sequences</h2>
        <p className="theme-text-secondary mb-4">
          Sequence counters can be reset in several ways:
        </p>
        <ul className="space-y-2 theme-text-secondary">
          <li>• <strong>Restart Server:</strong> All sequences reset when the server restarts</li>
          <li>• <strong>Clear Logs:</strong> Use "Clear Logs" to reset all sequence counters</li>
          <li>• <strong>API:</strong> POST to <code className="px-2 py-0.5 theme-bg-secondary rounded">/__mocklify/reset</code> on your mock server</li>
        </ul>
      </section>

      {/* With Delay */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Sequences with Delays</h2>
        <p className="theme-text-secondary mb-4">
          Each response in a sequence can have its own delay:
        </p>
        <CodeBlock
          language="json"
          code={`{
  "response": {
    "type": "sequence",
    "sequence": [
      {
        "delay": 100,
        "statusCode": 200,
        "body": { "fast": true }
      },
      {
        "delay": 2000,
        "statusCode": 200,
        "body": { "slow": true }
      }
    ]
  }
}`}
        />
      </section>
    </div>
  );
}
