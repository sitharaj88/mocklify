# Mocklify

<p align="center">
  <img src="resources/icon.png" alt="Mocklify Logo" width="128" height="128">
</p>

<p align="center">
  <strong>Powerful API Mocking for VS Code</strong>
</p>

<p align="center">
  Create, manage, and run mock servers directly from your editor. Perfect for frontend development, API prototyping, and testing.
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#documentation">Documentation</a> •
  <a href="#keyboard-shortcuts">Shortcuts</a>
</p>

---

## ✨ Features

### 🚀 Core Features

- **Multiple Mock Servers** - Run multiple servers on different ports simultaneously
- **Dynamic Responses** - Use Handlebars templates with 80+ Faker.js helpers
- **Request Matching** - Match by headers, query params, and body content
- **Response Delays** - Simulate network latency with fixed or random delays
- **Hot Reload** - Changes apply instantly without server restart

### 🔌 Protocol Support

- **HTTP/REST** - Full support for all HTTP methods
- **GraphQL** - Mock queries and mutations with variable substitution
- **WebSocket** - Real-time event mocking with rooms and broadcast

### 📥 Import & Export

- **OpenAPI/Swagger** - Import from OpenAPI 3.0 or Swagger 2.0 specs
- **Postman Collections** - Import from Postman Collection v2.1
- **HAR Export** - Export request logs in HTTP Archive format
- **cURL Export** - Generate cURL commands from logged requests

### 🎯 Advanced Features

- **Proxy Pass-through** - Forward requests to real APIs with recording
- **Request Recording** - Capture real API responses to generate mocks
- **Response Sequences** - Return different responses based on call count
- **Database Integration** - Query JSON files or in-memory databases
- **Environment Variables** - Use variables across routes and servers

### 🎨 Modern Dashboard

- **Beautiful UI** - Modern React dashboard with dark/light themes
- **Real-time Logs** - View request/response logs as they happen
- **Search & Filter** - Find routes by name, path, method, or tags
- **Keyboard Shortcuts** - Navigate and control with keyboard

---

## 📦 Installation

### From VS Code Marketplace

1. Open VS Code
2. Go to Extensions (`Cmd+Shift+X` / `Ctrl+Shift+X`)
3. Search for "Mocklify"
4. Click Install

### From VSIX File

1. Download the `.vsix` file
2. Open VS Code
3. Go to Extensions
4. Click `...` → "Install from VSIX..."
5. Select the downloaded file

---

## 🚀 Quick Start

### 1. Create Your First Server

1. Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
2. Type "Mocklify: Create Server"
3. Enter a name and port (e.g., "API Server" on port 3000)

### 2. Add a Route

1. Right-click on your server in the Mocklify sidebar
2. Select "Add Route"
3. Configure your route:
   - **Name**: `Get Users`
   - **Method**: `GET`
   - **Path**: `/api/users`
   - **Response**: 
     ```json
     {
       "users": [
         { "id": 1, "name": "John Doe" },
         { "id": 2, "name": "Jane Smith" }
       ]
     }
     ```

### 3. Start the Server

1. Click the ▶️ play button next to your server
2. Your mock API is now running at `http://localhost:3000`

### 4. Test It

```bash
curl http://localhost:3000/api/users
```

---

## 📖 Documentation

### Dynamic Responses with Templates

Use Handlebars templates with Faker.js for dynamic data:

```json
{
  "id": "{{faker 'string.uuid'}}",
  "name": "{{faker 'person.fullName'}}",
  "email": "{{faker 'internet.email'}}",
  "createdAt": "{{now}}"
}
```

#### Available Template Helpers

| Helper | Description | Example |
|--------|-------------|---------|
| `{{faker 'category.method'}}` | Generate fake data | `{{faker 'person.firstName'}}` |
| `{{now}}` | Current ISO timestamp | `2024-01-15T10:30:00.000Z` |
| `{{timestamp}}` | Unix timestamp | `1705315800000` |
| `{{uuid}}` | Random UUID | `a1b2c3d4-...` |
| `{{randomInt min max}}` | Random integer | `{{randomInt 1 100}}` |
| `{{request.params.id}}` | URL parameter | Path: `/users/:id` |
| `{{request.query.page}}` | Query parameter | `?page=2` |
| `{{request.body.name}}` | Request body field | POST body |

### Request Matching

Match specific requests with conditions:

```json
{
  "matcher": {
    "headers": {
      "Authorization": "Bearer valid-token"
    },
    "queryParams": {
      "status": "active"
    },
    "body": {
      "type": "jsonPath",
      "jsonPath": "$.user.role",
      "value": "admin"
    }
  }
}
```

### Response Sequences

Return different responses based on call count:

```json
{
  "response": {
    "type": "sequence",
    "sequence": [
      { "statusCode": 200, "body": { "attempt": 1 } },
      { "statusCode": 200, "body": { "attempt": 2 } },
      { "statusCode": 429, "body": { "error": "Rate limited" } }
    ]
  }
}
```

### Proxy & Recording

Forward requests to a real API and record responses:

1. Start your mock server
2. Click "Start Recording" 
3. Enter the target URL (e.g., `https://api.example.com`)
4. Make requests to your mock server
5. Stop recording and generate mock routes from captured responses

### GraphQL Support

Create GraphQL mocks with operation matching:

```json
{
  "path": "/graphql",
  "method": "POST",
  "matcher": {
    "body": {
      "type": "jsonPath",
      "jsonPath": "$.operationName",
      "value": "GetUser"
    }
  },
  "response": {
    "body": {
      "data": {
        "user": {
          "id": "{{faker 'string.uuid'}}",
          "name": "{{faker 'person.fullName'}}"
        }
      }
    }
  }
}
```

### WebSocket Support

Create WebSocket event handlers:

```json
{
  "protocol": "websocket",
  "path": "/ws",
  "routes": [
    {
      "name": "chat:message",
      "path": "ws:chat:message",
      "response": {
        "body": {
          "event": "chat:message",
          "data": {
            "id": "{{uuid}}",
            "message": "{{request.body.message}}",
            "timestamp": "{{now}}"
          }
        }
      }
    }
  ]
}
```

---

## ⌨️ Keyboard Shortcuts

### Navigation

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + 1` | Go to Dashboard |
| `Cmd/Ctrl + 2` | Go to Servers |
| `Cmd/Ctrl + 3` | Go to Routes |
| `Cmd/Ctrl + 4` | Go to Databases |
| `Cmd/Ctrl + 5` | Go to Logs |
| `Cmd/Ctrl + 6` | Go to Settings |

### Actions

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + K` | Focus search |
| `Cmd/Ctrl + N` | Create new item |
| `Alt + 1-9` | Select server |
| `Cmd/Ctrl + Shift + S` | Start server |
| `Cmd/Ctrl + Shift + X` | Stop server |
| `Cmd/Ctrl + Shift + L` | Clear logs |
| `Escape` | Close modal / Clear search |

---

## 🗂️ Project Structure

Mocklify stores configuration in a `.mocklify` folder in your workspace:

```
.mocklify/
├── servers.json      # Server configurations
├── recordings/       # Recorded sessions
└── databases/        # JSON database files
```

---

## 🔧 Configuration

### Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `mocklify.autoStart` | `false` | Auto-start servers on VS Code launch |
| `mocklify.defaultPort` | `3000` | Default port for new servers |
| `mocklify.configPath` | `.mocklify` | Configuration directory path |
| `mocklify.logging.maxEntries` | `1000` | Maximum log entries to keep |
| `mocklify.logging.includeBody` | `true` | Include request/response bodies in logs |

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [Fastify](https://fastify.io/) - Fast and low overhead web framework
- [Faker.js](https://fakerjs.dev/) - Generate realistic fake data
- [Handlebars](https://handlebarsjs.com/) - Semantic templating
- [VS Code Extension API](https://code.visualstudio.com/api) - Extension development

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/sitharaj">Sitharaj</a>
</p>
