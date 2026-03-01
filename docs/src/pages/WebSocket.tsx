import PageHeader from '../components/PageHeader';
import CodeBlock from '../components/CodeBlock';
import InfoBox from '../components/InfoBox';

export default function WebSocket() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="WebSocket Support"
        description="Create real-time event mocks with rooms, broadcast, and custom handlers."
      />

      {/* Overview */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Overview</h2>
        <p className="theme-text-secondary mb-4">
          Mocklify supports WebSocket mocking for real-time applications. Create event handlers that respond to client messages and simulate server-push events.
        </p>
      </section>

      {/* Creating WebSocket Server */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Creating a WebSocket Server</h2>
        <CodeBlock
          title="WebSocket Server Configuration"
          language="json"
          code={`{
  "name": "WebSocket Server",
  "port": 3001,
  "protocol": "websocket",
  "routes": []
}`}
        />

        <InfoBox type="info">
          WebSocket servers run on their own port, separate from HTTP mock servers.
        </InfoBox>
      </section>

      {/* Event Handlers */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Event Handlers</h2>
        <p className="theme-text-secondary mb-4">
          Define handlers for different event types:
        </p>
        
        <CodeBlock
          title="Chat Message Handler"
          language="json"
          code={`{
  "name": "Chat Message",
  "path": "ws:chat:message",
  "response": {
    "body": {
      "event": "chat:message",
      "data": {
        "id": "{{uuid}}",
        "user": "{{faker 'person.firstName'}}",
        "message": "{{request.body.message}}",
        "timestamp": "{{now}}"
      }
    }
  }
}`}
        />
      </section>

      {/* Connection Events */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Connection Events</h2>
        <p className="theme-text-secondary mb-4">
          Handle connection and disconnection events:
        </p>
        
        <CodeBlock
          title="Connection Handler"
          language="json"
          code={`{
  "name": "On Connect",
  "path": "ws:connection",
  "response": {
    "body": {
      "event": "welcome",
      "data": {
        "message": "Connected to server",
        "sessionId": "{{uuid}}",
        "serverTime": "{{now}}"
      }
    }
  }
}`}
        />

        <CodeBlock
          title="Disconnect Handler"
          language="json"
          code={`{
  "name": "On Disconnect",
  "path": "ws:disconnect",
  "response": {
    "body": {
      "event": "goodbye",
      "data": {
        "message": "Connection closed"
      }
    }
  }
}`}
        />
      </section>

      {/* Rooms */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Rooms</h2>
        <p className="theme-text-secondary mb-4">
          Organize connections into rooms for targeted messaging:
        </p>
        
        <CodeBlock
          title="Join Room Handler"
          language="json"
          code={`{
  "name": "Join Room",
  "path": "ws:room:join",
  "response": {
    "room": "{{request.body.room}}",
    "body": {
      "event": "room:joined",
      "data": {
        "room": "{{request.body.room}}",
        "userId": "{{request.body.userId}}"
      }
    }
  }
}`}
        />

        <CodeBlock
          title="Leave Room Handler"
          language="json"
          code={`{
  "name": "Leave Room",
  "path": "ws:room:leave",
  "response": {
    "room": "{{request.body.room}}",
    "body": {
      "event": "room:left",
      "data": {
        "room": "{{request.body.room}}"
      }
    }
  }
}`}
        />
      </section>

      {/* Broadcast */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Broadcasting</h2>
        <p className="theme-text-secondary mb-4">
          Configure how responses are sent:
        </p>

        <div className="theme-bg-card rounded-xl border theme-border overflow-x-auto mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b theme-border">
                <th className="text-left px-4 py-3 theme-text">Mode</th>
                <th className="text-left px-4 py-3 theme-text">Description</th>
              </tr>
            </thead>
            <tbody className="theme-text-secondary">
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400">reply</td>
                <td className="px-4 py-3">Send only to the sender (default)</td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400">broadcast</td>
                <td className="px-4 py-3">Send to all connected clients</td>
              </tr>
              <tr className="border-b theme-border">
                <td className="px-4 py-3 font-mono text-purple-400">room</td>
                <td className="px-4 py-3">Send to all clients in a room</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-purple-400">others</td>
                <td className="px-4 py-3">Send to all except sender</td>
              </tr>
            </tbody>
          </table>
        </div>

        <CodeBlock
          title="Broadcast Message"
          language="json"
          code={`{
  "name": "Broadcast Notification",
  "path": "ws:notification",
  "response": {
    "broadcast": "broadcast",
    "body": {
      "event": "notification",
      "data": {
        "type": "{{request.body.type}}",
        "message": "{{request.body.message}}",
        "timestamp": "{{now}}"
      }
    }
  }
}`}
        />
      </section>

      {/* Auto Events */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Automatic Events</h2>
        <p className="theme-text-secondary mb-4">
          Configure periodic server-push events:
        </p>
        
        <CodeBlock
          title="Periodic Heartbeat"
          language="json"
          code={`{
  "name": "Heartbeat",
  "path": "ws:auto:heartbeat",
  "interval": 30000,
  "response": {
    "broadcast": "broadcast",
    "body": {
      "event": "heartbeat",
      "data": {
        "timestamp": "{{now}}",
        "serverStatus": "healthy"
      }
    }
  }
}`}
        />
      </section>

      {/* Client Example */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Client Connection</h2>
        <CodeBlock
          title="JavaScript Client Example"
          language="javascript"
          code={`const ws = new WebSocket('ws://localhost:3001');

ws.onopen = () => {
  console.log('Connected');
  
  // Join a room
  ws.send(JSON.stringify({
    event: 'room:join',
    room: 'chat-room-1',
    userId: 'user-123'
  }));
  
  // Send a message
  ws.send(JSON.stringify({
    event: 'chat:message',
    message: 'Hello everyone!'
  }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Received:', data);
};

ws.onclose = () => {
  console.log('Disconnected');
};`}
        />
      </section>

      {/* Complete Example */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Complete Chat Server</h2>
        <CodeBlock
          language="json"
          code={`{
  "name": "Chat Server",
  "port": 3001,
  "protocol": "websocket",
  "routes": [
    {
      "name": "Connection",
      "path": "ws:connection",
      "response": {
        "body": {
          "event": "connected",
          "data": { "sessionId": "{{uuid}}" }
        }
      }
    },
    {
      "name": "Join Room",
      "path": "ws:room:join",
      "response": {
        "room": "{{request.body.room}}",
        "broadcast": "room",
        "body": {
          "event": "user:joined",
          "data": {
            "userId": "{{request.body.userId}}",
            "room": "{{request.body.room}}"
          }
        }
      }
    },
    {
      "name": "Chat Message",
      "path": "ws:chat:message",
      "response": {
        "broadcast": "room",
        "room": "{{request.body.room}}",
        "body": {
          "event": "message",
          "data": {
            "id": "{{uuid}}",
            "userId": "{{request.body.userId}}",
            "message": "{{request.body.message}}",
            "timestamp": "{{now}}"
          }
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
