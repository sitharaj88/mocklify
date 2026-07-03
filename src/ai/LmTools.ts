import * as vscode from 'vscode';
import { MockServerManager } from '../core/MockServerManager.js';
import { MockServerConfig, HttpMethod } from '../types/core.js';

/**
 * Language Model Tools exposed to GitHub Copilot agent mode. With these
 * registered, Copilot can list, create, populate, start, and inspect mock
 * servers autonomously ("create a mock payments API and start it").
 *
 * Tool names/schemas are declared in package.json under
 * contributes.languageModelTools; this file provides the implementations.
 */
export function registerLanguageModelTools(
  context: vscode.ExtensionContext,
  manager: MockServerManager
): void {
  context.subscriptions.push(
    vscode.lm.registerTool('mocklify_list_servers', new ListServersTool(manager)),
    vscode.lm.registerTool('mocklify_create_server', new CreateServerTool(manager)),
    vscode.lm.registerTool('mocklify_add_route', new AddRouteTool(manager)),
    vscode.lm.registerTool('mocklify_start_server', new StartStopServerTool(manager, 'start')),
    vscode.lm.registerTool('mocklify_stop_server', new StartStopServerTool(manager, 'stop')),
    vscode.lm.registerTool('mocklify_get_request_logs', new GetLogsTool(manager))
  );
}

function textResult(text: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
}

async function findServer(
  manager: MockServerManager,
  ref: string | undefined
): Promise<MockServerConfig | undefined> {
  const servers = await manager.getServers();
  if (!ref) {
    return servers.length === 1 ? servers[0] : undefined;
  }
  const lowered = ref.toLowerCase();
  return (
    servers.find((s) => s.id === ref) ??
    servers.find((s) => s.name.toLowerCase() === lowered) ??
    servers.find((s) => s.name.toLowerCase().includes(lowered))
  );
}

class ListServersTool implements vscode.LanguageModelTool<Record<string, never>> {
  constructor(private manager: MockServerManager) {}

  async invoke(): Promise<vscode.LanguageModelToolResult> {
    const servers = await this.manager.getServers();
    if (servers.length === 0) {
      return textResult('No mock servers configured.');
    }

    const summary = servers.map((s) => {
      const state = this.manager.getServerState(s.id);
      return {
        id: s.id,
        name: s.name,
        port: s.port,
        protocol: s.protocol,
        status: state?.status ?? 'stopped',
        baseUrl: `http://localhost:${s.port}`,
        routes: s.routes.map((r) => ({
          method: r.method,
          path: r.path,
          statusCode: r.response.statusCode,
          enabled: r.enabled,
        })),
      };
    });
    return textResult(JSON.stringify(summary, null, 2));
  }
}

interface CreateServerInput {
  name: string;
  port?: number;
}

class CreateServerTool implements vscode.LanguageModelTool<CreateServerInput> {
  constructor(private manager: MockServerManager) {}

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<CreateServerInput>
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: `Creating mock server "${options.input.name}"`,
      confirmationMessages: {
        title: 'Create mock server',
        message: new vscode.MarkdownString(
          `Create mock server **${options.input.name}**${options.input.port ? ` on port ${options.input.port}` : ''}?`
        ),
      },
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<CreateServerInput>
  ): Promise<vscode.LanguageModelToolResult> {
    const server = await this.manager.createServer(options.input.name, options.input.port);
    return textResult(
      `Created mock server "${server.name}" (id: ${server.id}) on port ${server.port}. It is not started yet.`
    );
  }
}

interface AddRouteInput {
  server: string;
  method: string;
  path: string;
  name?: string;
  statusCode?: number;
  responseBody?: string;
}

class AddRouteTool implements vscode.LanguageModelTool<AddRouteInput> {
  constructor(private manager: MockServerManager) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<AddRouteInput>
  ): Promise<vscode.LanguageModelToolResult> {
    const input = options.input;
    const server = await findServer(this.manager, input.server);
    if (!server) {
      return textResult(
        `Server "${input.server}" not found. Use mocklify_list_servers to see available servers.`
      );
    }

    let content: unknown = { message: 'OK' };
    if (input.responseBody) {
      try {
        content = JSON.parse(input.responseBody);
      } catch {
        content = input.responseBody;
      }
    }

    const method = input.method.toUpperCase() as HttpMethod;
    const route = await this.manager.addRoute(server.id, {
      name: input.name ?? `${method} ${input.path}`,
      enabled: true,
      method,
      path: input.path,
      response: {
        type: 'static',
        statusCode: input.statusCode ?? 200,
        headers: { 'Content-Type': 'application/json' },
        body: { contentType: 'application/json', content },
      },
    });

    return textResult(
      `Added route ${method} ${input.path} (id: ${route.id}) to server "${server.name}". Base URL: http://localhost:${server.port}`
    );
  }
}

interface ServerRefInput {
  server: string;
}

class StartStopServerTool implements vscode.LanguageModelTool<ServerRefInput> {
  constructor(
    private manager: MockServerManager,
    private action: 'start' | 'stop'
  ) {}

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ServerRefInput>
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: `${this.action === 'start' ? 'Starting' : 'Stopping'} mock server "${options.input.server}"`,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ServerRefInput>
  ): Promise<vscode.LanguageModelToolResult> {
    const server = await findServer(this.manager, options.input.server);
    if (!server) {
      return textResult(`Server "${options.input.server}" not found.`);
    }

    if (this.action === 'start') {
      await this.manager.startServer(server.id);
      return textResult(`Server "${server.name}" is running at http://localhost:${server.port}`);
    }

    await this.manager.stopServer(server.id);
    return textResult(`Server "${server.name}" stopped.`);
  }
}

interface GetLogsInput {
  server?: string;
  limit?: number;
}

class GetLogsTool implements vscode.LanguageModelTool<GetLogsInput> {
  constructor(private manager: MockServerManager) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<GetLogsInput>
  ): Promise<vscode.LanguageModelToolResult> {
    const server = options.input.server
      ? await findServer(this.manager, options.input.server)
      : undefined;

    const logs = this.manager.getLogEntries(server?.id, options.input.limit ?? 25);
    if (logs.length === 0) {
      return textResult('No request logs recorded.');
    }

    const summary = logs.map((l) => ({
      timestamp: new Date(l.timestamp).toISOString(),
      method: l.request.method,
      path: l.request.path,
      statusCode: l.response.statusCode,
      durationMs: l.response.duration,
      matched: l.matched,
    }));
    return textResult(JSON.stringify(summary, null, 2));
  }
}
