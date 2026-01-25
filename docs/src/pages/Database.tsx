import PageHeader from '../components/PageHeader';
import CodeBlock from '../components/CodeBlock';
import InfoBox from '../components/InfoBox';

export default function Database() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Database Integration"
        description="Query JSON files or in-memory databases for dynamic, stateful responses."
      />

      {/* Overview */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Overview</h2>
        <p className="text-slate-400 mb-4">
          Specter supports database-like functionality for more realistic mock scenarios:
        </p>
        <ul className="space-y-2 text-slate-400">
          <li>• <strong>JSON File Databases:</strong> Query JSON files as collections</li>
          <li>• <strong>In-Memory Store:</strong> Temporary data that persists during server runtime</li>
          <li>• <strong>CRUD Operations:</strong> Create, read, update, delete operations</li>
        </ul>
      </section>

      {/* JSON Database */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">JSON File Database</h2>
        <p className="text-slate-400 mb-4">
          Create a JSON file in your <code className="px-2 py-0.5 bg-slate-800 rounded">.specter/databases/</code> folder:
        </p>
        
        <CodeBlock
          title=".specter/databases/users.json"
          language="json"
          code={`{
  "users": [
    { "id": 1, "name": "John Doe", "email": "john@example.com", "role": "admin" },
    { "id": 2, "name": "Jane Smith", "email": "jane@example.com", "role": "user" },
    { "id": 3, "name": "Bob Wilson", "email": "bob@example.com", "role": "user" }
  ]
}`}
        />
      </section>

      {/* Querying */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Querying Data</h2>
        <p className="text-slate-400 mb-4">
          Use the <code className="px-2 py-0.5 bg-slate-800 rounded">db</code> helper in your responses:
        </p>

        <h3 className="text-lg font-medium mb-3">Get All Records</h3>
        <CodeBlock
          language="json"
          code={`{
  "name": "Get All Users",
  "method": "GET",
  "path": "/api/users",
  "response": {
    "body": {
      "users": "{{db 'users' 'users'}}"
    }
  }
}`}
        />

        <h3 className="text-lg font-medium mb-3 mt-6">Find by ID</h3>
        <CodeBlock
          language="json"
          code={`{
  "name": "Get User by ID",
  "method": "GET",
  "path": "/api/users/:id",
  "response": {
    "body": "{{db 'users' 'users' id=request.params.id}}"
  }
}`}
        />

        <h3 className="text-lg font-medium mb-3 mt-6">Filter by Field</h3>
        <CodeBlock
          language="json"
          code={`{
  "name": "Get Users by Role",
  "method": "GET",
  "path": "/api/users",
  "response": {
    "body": {
      "users": "{{db 'users' 'users' role=request.query.role}}"
    }
  }
}`}
        />
      </section>

      {/* CRUD Operations */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">CRUD Operations</h2>
        
        <h3 className="text-lg font-medium mb-3">Create</h3>
        <CodeBlock
          language="json"
          code={`{
  "name": "Create User",
  "method": "POST",
  "path": "/api/users",
  "response": {
    "statusCode": 201,
    "body": "{{dbInsert 'users' 'users' request.body}}"
  }
}`}
        />

        <h3 className="text-lg font-medium mb-3 mt-6">Update</h3>
        <CodeBlock
          language="json"
          code={`{
  "name": "Update User",
  "method": "PUT",
  "path": "/api/users/:id",
  "response": {
    "body": "{{dbUpdate 'users' 'users' request.params.id request.body}}"
  }
}`}
        />

        <h3 className="text-lg font-medium mb-3 mt-6">Delete</h3>
        <CodeBlock
          language="json"
          code={`{
  "name": "Delete User",
  "method": "DELETE",
  "path": "/api/users/:id",
  "response": {
    "statusCode": 204,
    "body": "{{dbDelete 'users' 'users' request.params.id}}"
  }
}`}
        />

        <InfoBox type="warning" title="Persistence">
          Changes made via CRUD operations are saved to the JSON file. The file is updated in real-time.
        </InfoBox>
      </section>

      {/* In-Memory Store */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">In-Memory Store</h2>
        <p className="text-slate-400 mb-4">
          Use the in-memory store for temporary data that doesn't need to persist:
        </p>
        
        <CodeBlock
          title="Store a Value"
          language="json"
          code={`{
  "name": "Store Session",
  "method": "POST",
  "path": "/api/session",
  "response": {
    "body": {
      "stored": "{{memorySet 'session' request.body.sessionId request.body}}"
    }
  }
}`}
        />

        <CodeBlock
          title="Retrieve a Value"
          language="json"
          code={`{
  "name": "Get Session",
  "method": "GET",
  "path": "/api/session/:id",
  "response": {
    "body": "{{memoryGet 'session' request.params.id}}"
  }
}`}
        />

        <InfoBox type="info">
          In-memory data is cleared when the mock server restarts.
        </InfoBox>
      </section>

      {/* Complex Queries */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Complex Queries</h2>
        
        <h3 className="text-lg font-medium mb-3">Pagination</h3>
        <CodeBlock
          language="json"
          code={`{
  "name": "Paginated Users",
  "method": "GET",
  "path": "/api/users",
  "response": {
    "body": {
      "users": "{{dbPaginate 'users' 'users' page=request.query.page limit=request.query.limit}}",
      "total": "{{dbCount 'users' 'users'}}",
      "page": "{{request.query.page}}",
      "limit": "{{request.query.limit}}"
    }
  }
}`}
        />

        <h3 className="text-lg font-medium mb-3 mt-6">Sorting</h3>
        <CodeBlock
          language="json"
          code={`{
  "response": {
    "body": {
      "users": "{{dbSort 'users' 'users' sortBy=request.query.sortBy order=request.query.order}}"
    }
  }
}`}
        />
      </section>

      {/* Managing Databases */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Managing Databases</h2>
        <p className="text-slate-400 mb-4">
          Use the Specter dashboard to manage your databases:
        </p>
        <ul className="space-y-2 text-slate-400">
          <li>• View and edit database records</li>
          <li>• Create new databases</li>
          <li>• Import data from CSV or JSON</li>
          <li>• Export database contents</li>
          <li>• Reset database to initial state</li>
        </ul>
      </section>
    </div>
  );
}
