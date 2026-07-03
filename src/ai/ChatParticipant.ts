import * as vscode from 'vscode';
import { MockServerManager } from '../core/MockServerManager.js';
import { MockServerConfig } from '../types/core.js';
import { AiService } from './AiService.js';
import { AiUnavailableError } from './providers/types.js';
import { MockGenerator, GeneratedServer } from './MockGenerator.js';
import { DocumentationGenerator } from './DocumentationGenerator.js';

export const PARTICIPANT_ID = 'mocklify.assistant';

/**
 * The @mocklify chat participant. Lets users design, document, and debug mock
 * APIs conversationally from Copilot Chat:
 *
 *   @mocklify /create an e-commerce API with products and orders
 *   @mocklify /route add pagination to GET /products
 *   @mocklify /docs
 *   @mocklify /test
 *   @mocklify /analyze why are my requests returning 404?
 *   @mocklify /list
 */
export class MocklifyChatParticipant {
  private participant: vscode.ChatParticipant;

  constructor(
    private context: vscode.ExtensionContext,
    private manager: MockServerManager,
    private ai: AiService,
    private mockGenerator: MockGenerator,
    private docsGenerator: DocumentationGenerator
  ) {
    this.participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, (request, chatContext, stream, token) =>
      this.handle(request, chatContext, stream, token)
    );
    this.participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'icon.png');
    this.participant.followupProvider = {
      provideFollowups: (result) => this.provideFollowups(result),
    };

    context.subscriptions.push(this.participant);
    this.registerApplyCommands();
  }

  private async handle(
    request: vscode.ChatRequest,
    _chatContext: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<vscode.ChatResult> {
    try {
      switch (request.command) {
        case 'create':
          return await this.handleCreate(request, stream, token);
        case 'route':
          return await this.handleRoute(request, stream, token);
        case 'docs':
          return await this.handleDocs(request, stream, token);
        case 'test':
          return await this.handleTest(request, stream, token);
        case 'analyze':
          return await this.handleAnalyze(request, stream, token);
        case 'list':
          return await this.handleList(stream);
        default:
          return await this.handleGeneral(request, stream, token);
      }
    } catch (error) {
      if (error instanceof AiUnavailableError) {
        stream.markdown(error.message);
        return { errorDetails: { message: error.message } };
      }
      const message = error instanceof Error ? error.message : String(error);
      stream.markdown(`Something went wrong: ${message}`);
      return { errorDetails: { message } };
    }
  }

  // --- /create -------------------------------------------------------------

  private async handleCreate(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<vscode.ChatResult> {
    if (!request.prompt.trim()) {
      stream.markdown(
        'Describe the API you want, e.g. `@mocklify /create a bookstore API with books, authors, and reviews`.'
      );
      return { metadata: { command: 'create' } };
    }

    stream.progress('Designing your mock API…');

    const defaultPort = vscode.workspace
      .getConfiguration('mocklify')
      .get<number>('defaultPort', 3000);

    const generated = await this.mockGenerator.generateServer(request.prompt, {
      token,
      defaultPort: await this.suggestFreePort(defaultPort),
    });

    stream.markdown(`### ${generated.name}\n\nPort \`${generated.port}\` · ${generated.routes.length} routes\n\n`);
    stream.markdown('| Method | Path | Status |\n|--------|------|--------|\n');
    for (const route of generated.routes) {
      const methods = Array.isArray(route.method) ? route.method.join(', ') : route.method;
      stream.markdown(`| \`${methods}\` | \`${route.path}\` | ${route.response.statusCode} |\n`);
    }
    stream.markdown('\n');

    stream.button({
      command: 'mocklify.chat.applyServer',
      title: '$(add) Create this server',
      arguments: [generated],
    });

    return { metadata: { command: 'create' } };
  }

  // --- /route --------------------------------------------------------------

  private async handleRoute(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<vscode.ChatResult> {
    const server = await this.resolveServer(request.prompt, stream);
    if (!server) {
      return { metadata: { command: 'route' } };
    }

    if (!request.prompt.trim()) {
      stream.markdown(
        'Describe the route(s) you want, e.g. `@mocklify /route GET /api/orders returning a paginated list of orders`.'
      );
      return { metadata: { command: 'route' } };
    }

    stream.progress(`Generating routes for "${server.name}"…`);

    const routes = await this.mockGenerator.generateRoutes(request.prompt, server, { token });

    stream.markdown(`Generated **${routes.length}** route(s) for **${server.name}**:\n\n`);
    for (const route of routes) {
      const methods = Array.isArray(route.method) ? route.method.join(', ') : route.method;
      stream.markdown(`- \`${methods} ${route.path}\` — ${route.name} (${route.response.statusCode})\n`);
    }
    stream.markdown('\n');

    stream.button({
      command: 'mocklify.chat.applyRoutes',
      title: `$(add) Add to ${server.name}`,
      arguments: [server.id, routes],
    });

    return { metadata: { command: 'route' } };
  }

  // --- /docs ---------------------------------------------------------------

  private async handleDocs(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<vscode.ChatResult> {
    const server = await this.resolveServer(request.prompt, stream);
    if (!server) {
      return { metadata: { command: 'docs' } };
    }

    if (server.routes.filter((r) => r.enabled).length === 0) {
      stream.markdown(`Server **${server.name}** has no enabled routes to document yet.`);
      return { metadata: { command: 'docs' } };
    }

    stream.progress(`Writing documentation for "${server.name}"…`);

    const result = await this.docsGenerator.generate(server, {
      token,
      onFragment: (fragment) => stream.markdown(fragment),
    });

    if (!result.aiEnhanced) {
      stream.markdown(result.markdown);
      stream.markdown('\n\n_No AI provider was available, so this is the generated reference documentation._\n');
    }

    stream.button({
      command: 'mocklify.chat.saveDocs',
      title: '$(save) Save as Markdown file',
      arguments: [server.id, result.markdown],
    });

    return { metadata: { command: 'docs' } };
  }

  // --- /test ---------------------------------------------------------------

  private async handleTest(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<vscode.ChatResult> {
    const server = await this.resolveServer(request.prompt, stream);
    if (!server) {
      return { metadata: { command: 'test' } };
    }

    stream.progress(`Generating test requests for "${server.name}"…`);

    const routesSummary = server.routes
      .filter((r) => r.enabled)
      .map((r) => {
        const methods = Array.isArray(r.method) ? r.method.join('|') : r.method;
        return `${methods} ${r.path} -> ${r.response.statusCode} ${JSON.stringify(r.response.body?.content ?? null)?.slice(0, 200)}`;
      })
      .join('\n');

    const prompt = `Generate test requests for this mock API running at http://localhost:${server.port}.

Routes:
${routesSummary}

${request.prompt.trim() ? `Focus on: ${request.prompt}` : ''}

Produce:
1. A "curl" section with a curl command per route (use realistic bodies for POST/PUT/PATCH).
2. A "REST Client" section with the same requests in .http file format (### separated).
Keep paths, ports, and methods exactly as given. Output Markdown.`;

    for await (const fragment of this.ai.streamRequest(prompt, { token })) {
      stream.markdown(fragment);
    }

    return { metadata: { command: 'test' } };
  }

  // --- /analyze ------------------------------------------------------------

  private async handleAnalyze(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<vscode.ChatResult> {
    const logs = this.manager.getLogEntries(undefined, 50);
    if (logs.length === 0) {
      stream.markdown(
        'No request logs yet. Start a server and send some requests, then ask me to analyze the traffic.'
      );
      return { metadata: { command: 'analyze' } };
    }

    stream.progress(`Analyzing ${logs.length} logged requests…`);

    const logSummary = logs
      .map(
        (l) =>
          `${new Date(l.timestamp).toISOString()} ${l.request.method} ${l.request.path} -> ${l.response.statusCode} (${l.response.duration}ms, matched=${l.matched})`
      )
      .join('\n');

    const prompt = `You are analyzing traffic captured by a mock API server. Recent requests (newest last):

${logSummary}

${request.prompt.trim() ? `The user asks: ${request.prompt}` : 'Summarize the traffic, flag anomalies (errors, unmatched requests, slow responses), and suggest missing mock routes for any unmatched requests.'}

Unmatched requests (matched=false) hit the server but no mock route handled them — suggest concrete routes to add for those. Output Markdown.`;

    for await (const fragment of this.ai.streamRequest(prompt, { token })) {
      stream.markdown(fragment);
    }

    return { metadata: { command: 'analyze' } };
  }

  // --- /list ---------------------------------------------------------------

  private async handleList(stream: vscode.ChatResponseStream): Promise<vscode.ChatResult> {
    const servers = await this.manager.getServers();
    if (servers.length === 0) {
      stream.markdown('No mock servers configured yet. Try `@mocklify /create <description of your API>`.');
      return { metadata: { command: 'list' } };
    }

    stream.markdown('| Server | Port | Status | Routes |\n|--------|------|--------|--------|\n');
    for (const server of servers) {
      const state = this.manager.getServerState(server.id);
      const status = state?.status === 'running' ? '🟢 running' : '⚪ stopped';
      stream.markdown(`| ${server.name} | ${server.port} | ${status} | ${server.routes.length} |\n`);
    }

    return { metadata: { command: 'list' } };
  }

  // --- default -------------------------------------------------------------

  private async handleGeneral(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<vscode.ChatResult> {
    const servers = await this.manager.getServers();
    const serverContext = servers
      .map((s) => {
        const state = this.manager.getServerState(s.id);
        const routes = s.routes
          .map((r) => `  - ${Array.isArray(r.method) ? r.method.join('|') : r.method} ${r.path} (${r.response.statusCode})`)
          .join('\n');
        return `- "${s.name}" on port ${s.port} [${state?.status ?? 'stopped'}]\n${routes}`;
      })
      .join('\n');

    const prompt = `You are the Mocklify assistant inside VS Code. Mocklify is an API mocking extension: users create mock HTTP/GraphQL/WebSocket servers with routes, dynamic Handlebars+faker templates, request matching, proxying, recording, and OpenAPI/Postman import.

Current workspace mock servers:
${serverContext || '(none configured)'}

Available slash commands the user can run: /create (design a new mock API from a description), /route (add routes to a server), /docs (generate API documentation), /test (generate curl/.http test requests), /analyze (analyze request logs), /list (list servers).

Answer the user's question helpfully and concisely in Markdown. Suggest the relevant slash command when it would accomplish what they want.

User: ${request.prompt}`;

    for await (const fragment of this.ai.streamRequest(prompt, { token })) {
      stream.markdown(fragment);
    }

    return {};
  }

  // --- helpers ---------------------------------------------------------------

  /**
   * Pick the target server: match a server name mentioned in the prompt, else
   * the only server, else the first with routes; explains when none exist.
   */
  private async resolveServer(
    prompt: string,
    stream: vscode.ChatResponseStream
  ): Promise<MockServerConfig | undefined> {
    const servers = await this.manager.getServers();
    if (servers.length === 0) {
      stream.markdown('No mock servers configured yet. Create one first with `@mocklify /create <description>`.');
      return undefined;
    }

    const lowered = prompt.toLowerCase();
    const byName = servers.find((s) => lowered.includes(s.name.toLowerCase()));
    if (byName) {
      return byName;
    }

    if (servers.length === 1) {
      return servers[0];
    }

    const withRoutes = servers.find((s) => s.routes.length > 0);
    const chosen = withRoutes ?? servers[0];
    stream.markdown(
      `_Using server **${chosen.name}** — mention a server name to target a different one (${servers.map((s) => s.name).join(', ')})._\n\n`
    );
    return chosen;
  }

  private async suggestFreePort(defaultPort: number): Promise<number> {
    const servers = await this.manager.getServers();
    const used = new Set(servers.map((s) => s.port));
    let port = defaultPort;
    while (used.has(port)) {
      port++;
    }
    return port;
  }

  private provideFollowups(result: vscode.ChatResult): vscode.ChatFollowup[] {
    const command = (result.metadata as { command?: string } | undefined)?.command;
    switch (command) {
      case 'create':
        return [
          { prompt: 'generate documentation', command: 'docs', label: 'Generate API docs' },
          { prompt: 'generate test requests', command: 'test', label: 'Generate test requests' },
        ];
      case 'route':
        return [
          { prompt: 'generate documentation', command: 'docs', label: 'Update API docs' },
        ];
      case 'docs':
        return [
          { prompt: 'generate test requests', command: 'test', label: 'Generate test requests' },
        ];
      case 'analyze':
        return [
          { prompt: 'add mock routes for the unmatched requests', command: 'route', label: 'Mock unmatched requests' },
        ];
      default:
        return [];
    }
  }

  /**
   * Commands invoked by chat response buttons to apply generated content.
   */
  private registerApplyCommands(): void {
    this.context.subscriptions.push(
      vscode.commands.registerCommand('mocklify.chat.applyServer', async (generated: GeneratedServer) => {
        try {
          const server = await this.manager.createServer(generated.name, generated.port);
          for (const route of generated.routes) {
            await this.manager.addRoute(server.id, route);
          }
          const action = await vscode.window.showInformationMessage(
            `Mocklify: Created "${server.name}" with ${generated.routes.length} routes on port ${server.port}.`,
            'Start Server'
          );
          if (action === 'Start Server') {
            await this.manager.startServer(server.id);
            vscode.window.showInformationMessage(
              `Mocklify: "${server.name}" running at http://localhost:${server.port}`
            );
          }
        } catch (error) {
          vscode.window.showErrorMessage(
            `Failed to create server: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }),

      vscode.commands.registerCommand(
        'mocklify.chat.applyRoutes',
        async (serverId: string, routes: Parameters<MockServerManager['addRoute']>[1][]) => {
          try {
            for (const route of routes) {
              await this.manager.addRoute(serverId, route);
            }
            vscode.window.showInformationMessage(`Mocklify: Added ${routes.length} route(s).`);
          } catch (error) {
            vscode.window.showErrorMessage(
              `Failed to add routes: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      ),

      vscode.commands.registerCommand('mocklify.chat.saveDocs', async (serverId: string, markdown: string) => {
        const server = await this.manager.getServer(serverId);
        const fileName = `${(server?.name ?? 'api').replace(/[^A-Za-z0-9-_]+/g, '-').toLowerCase()}-docs.md`;
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        const defaultUri = workspaceRoot
          ? vscode.Uri.joinPath(workspaceRoot, 'docs', fileName)
          : vscode.Uri.file(fileName);

        const target = await vscode.window.showSaveDialog({
          defaultUri,
          filters: { Markdown: ['md'] },
        });
        if (!target) {
          return;
        }
        await vscode.workspace.fs.writeFile(target, Buffer.from(markdown, 'utf-8'));
        const doc = await vscode.workspace.openTextDocument(target);
        await vscode.window.showTextDocument(doc, { preview: false });
        vscode.commands.executeCommand('markdown.showPreviewToSide', target);
      })
    );
  }
}
