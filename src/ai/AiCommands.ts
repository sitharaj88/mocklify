import * as vscode from 'vscode';
import { MockServerManager } from '../core/MockServerManager.js';
import { MockServerConfig } from '../types/core.js';
import { OpenApiExportService } from '../services/OpenApiExportService.js';
import { AiService } from './AiService.js';
import { AiProviderId, AiUnavailableError } from './providers/types.js';
import { ApiKeyManager } from './providers/ApiKeyManager.js';
import { MockGenerator } from './MockGenerator.js';
import { DocumentationGenerator } from './DocumentationGenerator.js';

const KEY_PROVIDERS: { id: AiProviderId; label: string; hint: string }[] = [
  { id: 'claude', label: 'Claude (Anthropic)', hint: 'sk-ant-…  from console.anthropic.com' },
  { id: 'openai', label: 'OpenAI', hint: 'sk-…  from platform.openai.com' },
  { id: 'gemini', label: 'Google Gemini', hint: 'AIza…  from aistudio.google.com' },
];

/**
 * AI-powered and documentation commands: generate docs, export OpenAPI,
 * create servers/routes from natural language, and manage AI providers.
 */
export function registerAiCommands(
  context: vscode.ExtensionContext,
  manager: MockServerManager,
  ai: AiService,
  keys: ApiKeyManager,
  mockGenerator: MockGenerator,
  docsGenerator: DocumentationGenerator
): void {
  const openApiExport = new OpenApiExportService();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const register = (command: string, callback: (...args: any[]) => unknown) => {
    context.subscriptions.push(vscode.commands.registerCommand(command, callback));
  };

  register('mocklify.generateDocs', async (item?: { serverId?: string }) => {
    const server = await pickServer(manager, item, 'Select a server to document');
    if (!server) {
      return;
    }
    if (server.routes.filter((r) => r.enabled).length === 0) {
      vscode.window.showWarningMessage(`Mocklify: Server "${server.name}" has no enabled routes to document.`);
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Mocklify: Generating API documentation for "${server.name}"…`,
        cancellable: true,
      },
      async (_progress, token) => {
        try {
          const result = await docsGenerator.generate(server, { token });
          if (token.isCancellationRequested) {
            return;
          }
          await saveAndOpenDocs(server, result.markdown);
          if (!result.aiEnhanced) {
            vscode.window.showInformationMessage(
              'Mocklify: GitHub Copilot was unavailable — generated reference documentation instead.'
            );
          }
        } catch (error) {
          showAiError(error);
        }
      }
    );
  });

  register('mocklify.exportOpenApi', async (item?: { serverId?: string }) => {
    const server = await pickServer(manager, item, 'Select a server to export as OpenAPI');
    if (!server) {
      return;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    const fileName = `${slugify(server.name)}-openapi.json`;
    const target = await vscode.window.showSaveDialog({
      defaultUri: workspaceRoot ? vscode.Uri.joinPath(workspaceRoot, fileName) : undefined,
      filters: { 'OpenAPI JSON': ['json'] },
    });
    if (!target) {
      return;
    }

    await vscode.workspace.fs.writeFile(
      target,
      Buffer.from(openApiExport.exportToJson(server), 'utf-8')
    );
    const action = await vscode.window.showInformationMessage(
      `Mocklify: Exported OpenAPI spec for "${server.name}".`,
      'Open File'
    );
    if (action === 'Open File') {
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target));
    }
  });

  register('mocklify.aiGenerateServer', async () => {
    const description = await vscode.window.showInputBox({
      prompt: 'Describe the API you want to mock',
      placeHolder: 'e.g. An e-commerce API with products, carts, and orders',
      ignoreFocusOut: true,
    });
    if (!description) {
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Mocklify: Designing your mock API…',
        cancellable: true,
      },
      async (_progress, token) => {
        try {
          const defaultPort = vscode.workspace.getConfiguration('mocklify').get<number>('defaultPort', 3000);
          const generated = await mockGenerator.generateServer(description, { token, defaultPort });
          if (token.isCancellationRequested) {
            return;
          }

          const routeList = generated.routes
            .map((r) => `${Array.isArray(r.method) ? r.method.join(',') : r.method} ${r.path}`)
            .join(', ');
          const confirm = await vscode.window.showInformationMessage(
            `Create "${generated.name}" on port ${generated.port} with ${generated.routes.length} routes? (${routeList})`,
            { modal: true },
            'Create',
            'Create & Start'
          );
          if (!confirm) {
            return;
          }

          const server = await manager.createServer(generated.name, generated.port);
          for (const route of generated.routes) {
            await manager.addRoute(server.id, route);
          }
          if (confirm === 'Create & Start') {
            await manager.startServer(server.id);
            vscode.window.showInformationMessage(
              `Mocklify: "${server.name}" running at http://localhost:${server.port}`
            );
          } else {
            vscode.window.showInformationMessage(`Mocklify: Created "${server.name}".`);
          }
        } catch (error) {
          showAiError(error);
        }
      }
    );
  });

  register('mocklify.aiGenerateRoute', async (item?: { serverId?: string }) => {
    const server = await pickServer(manager, item, 'Select a server to add AI-generated routes to');
    if (!server) {
      return;
    }

    const description = await vscode.window.showInputBox({
      prompt: `Describe the route(s) to add to "${server.name}"`,
      placeHolder: 'e.g. GET /api/users/:id returning a user profile, 404 when not found',
      ignoreFocusOut: true,
    });
    if (!description) {
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Mocklify: Generating routes for "${server.name}"…`,
        cancellable: true,
      },
      async (_progress, token) => {
        try {
          const routes = await mockGenerator.generateRoutes(description, server, { token });
          if (token.isCancellationRequested) {
            return;
          }
          for (const route of routes) {
            await manager.addRoute(server.id, route);
          }
          vscode.window.showInformationMessage(
            `Mocklify: Added ${routes.length} route(s) to "${server.name}".`
          );
        } catch (error) {
          showAiError(error);
        }
      }
    );
  });

  register('mocklify.openChat', async () => {
    await vscode.commands.executeCommand('workbench.action.chat.open', { query: '@mocklify ' });
  });

  register('mocklify.selectAiProvider', async () => {
    const providers = ai.getAllProviders();
    const availability = await Promise.all(providers.map((p) => p.isAvailable()));
    const current = ai.getConfiguredProviderId();

    const items: (vscode.QuickPickItem & { value: string })[] = [
      {
        label: 'Auto',
        description: current === 'auto' ? 'current' : undefined,
        detail: 'Use the first available provider (Copilot → Claude → OpenAI → Gemini)',
        value: 'auto',
      },
      ...providers.map((p, i) => ({
        label: p.label,
        description: [current === p.id ? 'current' : '', availability[i] ? 'ready' : 'not configured']
          .filter(Boolean)
          .join(' · '),
        value: p.id,
      })),
    ];

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Choose the AI provider for Mocklify',
    });
    if (!picked) {
      return;
    }

    await vscode.workspace
      .getConfiguration('mocklify')
      .update('ai.provider', picked.value, vscode.ConfigurationTarget.Global);

    if (picked.value !== 'auto' && picked.value !== 'copilot') {
      const hasKey = await keys.hasKey(picked.value as AiProviderId);
      if (!hasKey) {
        const action = await vscode.window.showInformationMessage(
          `Mocklify: ${picked.label} selected. An API key is required.`,
          'Set API Key'
        );
        if (action === 'Set API Key') {
          await vscode.commands.executeCommand('mocklify.setApiKey', picked.value);
        }
        return;
      }
    }
    vscode.window.showInformationMessage(`Mocklify: AI provider set to ${picked.label}.`);
  });

  register('mocklify.setApiKey', async (providerId?: AiProviderId) => {
    const provider =
      KEY_PROVIDERS.find((p) => p.id === providerId) ??
      (await vscode.window.showQuickPick(
        KEY_PROVIDERS.map((p) => ({ label: p.label, description: p.hint, id: p.id, hint: p.hint })),
        { placeHolder: 'Which provider is this API key for?' }
      ));
    if (!provider) {
      return;
    }

    const key = await vscode.window.showInputBox({
      prompt: `Enter your ${provider.label} API key (stored encrypted in VS Code secret storage)`,
      placeHolder: provider.hint,
      password: true,
      ignoreFocusOut: true,
    });
    if (!key?.trim()) {
      return;
    }

    await keys.setKey(provider.id, key.trim());
    vscode.window.showInformationMessage(`Mocklify: ${provider.label} API key saved.`);
  });

  register('mocklify.testAiProvider', async () => {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Mocklify: Testing AI provider…',
        cancellable: true,
      },
      async (_progress, token) => {
        try {
          const provider = await ai.resolveProvider();
          const start = Date.now();
          const reply = await ai.sendRequest(
            'Reply with exactly the word OK and nothing else.',
            { token, justification: 'Mocklify is testing your AI provider configuration.' }
          );
          if (token.isCancellationRequested) {
            return;
          }
          const seconds = ((Date.now() - start) / 1000).toFixed(1);
          const preview = reply.trim().slice(0, 60) || '(empty response)';
          vscode.window.showInformationMessage(
            `Mocklify: ${provider.label} responded in ${seconds}s — AI is working. Reply: "${preview}"`
          );
        } catch (error) {
          showAiError(error);
        }
      }
    );
  });

  register('mocklify.clearApiKey', async () => {
    const stored = [];
    for (const p of KEY_PROVIDERS) {
      if (await keys.hasKey(p.id)) {
        stored.push(p);
      }
    }
    if (stored.length === 0) {
      vscode.window.showInformationMessage('Mocklify: No API keys are stored.');
      return;
    }

    const picked = await vscode.window.showQuickPick(
      stored.map((p) => ({ label: p.label, id: p.id })),
      { placeHolder: 'Remove which API key?' }
    );
    if (!picked) {
      return;
    }
    await keys.deleteKey(picked.id);
    vscode.window.showInformationMessage(`Mocklify: ${picked.label} API key removed.`);
  });
}

async function pickServer(
  manager: MockServerManager,
  item: { serverId?: string } | undefined,
  placeHolder: string
): Promise<MockServerConfig | undefined> {
  if (item?.serverId) {
    return manager.getServer(item.serverId);
  }

  const servers = await manager.getServers();
  if (servers.length === 0) {
    vscode.window.showWarningMessage('Mocklify: No servers configured. Create one first.');
    return undefined;
  }
  if (servers.length === 1) {
    return servers[0];
  }

  const picked = await vscode.window.showQuickPick(
    servers.map((s) => ({
      label: s.name,
      description: `port ${s.port} · ${s.routes.length} routes`,
      server: s,
    })),
    { placeHolder }
  );
  return picked?.server;
}

async function saveAndOpenDocs(server: MockServerConfig, markdown: string): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  const fileName = `${slugify(server.name)}-docs.md`;

  let target: vscode.Uri | undefined;
  if (workspaceRoot) {
    const docsDir = vscode.Uri.joinPath(workspaceRoot, 'docs');
    await vscode.workspace.fs.createDirectory(docsDir);
    target = vscode.Uri.joinPath(docsDir, fileName);
  } else {
    target = await vscode.window.showSaveDialog({ filters: { Markdown: ['md'] } });
  }
  if (!target) {
    return;
  }

  await vscode.workspace.fs.writeFile(target, Buffer.from(markdown, 'utf-8'));
  const doc = await vscode.workspace.openTextDocument(target);
  await vscode.window.showTextDocument(doc, { preview: false });
  await vscode.commands.executeCommand('markdown.showPreviewToSide', target);
}

function showAiError(error: unknown): void {
  if (error instanceof AiUnavailableError) {
    vscode.window
      .showErrorMessage(`Mocklify: ${error.message}`, 'Select AI Provider', 'Set API Key')
      .then((action) => {
        if (action === 'Select AI Provider') {
          vscode.commands.executeCommand('mocklify.selectAiProvider');
        } else if (action === 'Set API Key') {
          vscode.commands.executeCommand('mocklify.setApiKey', error.providerId);
        }
      });
    return;
  }
  vscode.window.showErrorMessage(
    `Mocklify AI: ${error instanceof Error ? error.message : String(error)}`
  );
}

function slugify(value: string): string {
  return value.replace(/[^A-Za-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'api';
}
