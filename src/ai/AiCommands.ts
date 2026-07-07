import * as vscode from 'vscode';
import { MockServerManager } from '../core/MockServerManager.js';
import { MockServerConfig } from '../types/core.js';
import { OpenApiExportService } from '../services/OpenApiExportService.js';
import { AiService } from './AiService.js';
import { AiProviderId, AiUnavailableError } from './providers/types.js';
import { ApiKeyManager } from './providers/ApiKeyManager.js';
import { MockGenerator } from './MockGenerator.js';
import { DocumentationGenerator } from './DocumentationGenerator.js';
import { CodebaseMockGenerator } from './CodebaseMockGenerator.js';
import { TrafficMockGenerator } from './TrafficMockGenerator.js';
import { OpenApiImportService, OpenApiImportResult } from '../services/OpenApiImportService.js';
import { SpecEnricher, EnrichedImportResult, formatImportBlocks } from './SpecEnricher.js';

const KEY_PROVIDERS: { id: AiProviderId; label: string; hint: string }[] = [
  { id: 'claude', label: 'Claude (Anthropic)', hint: 'sk-ant-…  from console.anthropic.com' },
  { id: 'openai', label: 'OpenAI', hint: 'sk-…  from platform.openai.com' },
  { id: 'gemini', label: 'Google Gemini', hint: 'AIza…  from aistudio.google.com' },
];

type ModelProviderId = Exclude<AiProviderId, 'copilot'>;

interface ModelCatalogEntry {
  label: string;
  settingKey: string;
  customHint: string;
  models: { id: string; detail: string }[];
}

/**
 * Known models per provider, shown by "Mocklify: Select AI Model". The list is
 * a convenience, not a gate — "Custom model ID" covers gateway-specific IDs
 * (e.g. Bedrock-style `anthropic.claude-opus-4-8`) and models released later.
 */
const MODEL_CATALOG: Record<ModelProviderId, ModelCatalogEntry> = {
  claude: {
    label: 'Claude (Anthropic)',
    settingKey: 'ai.claudeModel',
    customHint: 'e.g. anthropic.claude-opus-4-8 for a Bedrock-compatible gateway',
    models: [
      { id: 'claude-opus-4-8', detail: 'Most capable Opus — recommended default' },
      { id: 'claude-sonnet-5', detail: 'Best balance of speed and intelligence' },
      { id: 'claude-sonnet-4-6', detail: 'Previous-generation Sonnet' },
      { id: 'claude-haiku-4-5', detail: 'Fastest and most cost-effective' },
      { id: 'claude-opus-4-7', detail: 'Previous-generation Opus' },
      { id: 'claude-opus-4-6', detail: 'Older Opus' },
    ],
  },
  openai: {
    label: 'OpenAI',
    settingKey: 'ai.openaiModel',
    customHint: 'e.g. a deployment name on an Azure OpenAI-compatible gateway',
    models: [
      { id: 'gpt-4o', detail: 'Flagship multimodal model' },
      { id: 'gpt-4o-mini', detail: 'Fast and cost-effective' },
      { id: 'gpt-4.1', detail: 'Strong coding and instruction following' },
      { id: 'gpt-4.1-mini', detail: 'Smaller, faster 4.1' },
    ],
  },
  gemini: {
    label: 'Google Gemini',
    settingKey: 'ai.geminiModel',
    customHint: 'e.g. a model ID exposed by your Gemini-compatible gateway',
    models: [
      { id: 'gemini-2.5-flash', detail: 'Fast, cost-effective default' },
      { id: 'gemini-2.5-pro', detail: 'Most capable Gemini' },
      { id: 'gemini-2.0-flash', detail: 'Previous-generation Flash' },
    ],
  },
};

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
          await manager.addRoutes(server.id, generated.routes);
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

  register('mocklify.aiGenerateRoute', async (item?: { serverId?: string; description?: string }) => {
    const server = await pickServer(manager, item, 'Select a server to add AI-generated routes to');
    if (!server) {
      return;
    }

    const description = await vscode.window.showInputBox({
      prompt: `Describe the route(s) to add to "${server.name}"`,
      placeHolder: 'e.g. GET /api/users/:id returning a user profile, 404 when not found',
      value: item?.description,
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
          await manager.addRoutes(server.id, routes);
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

  // Warnings from spec imports (per-path $ref / non-JSON issues) go to an
  // output channel so they don't flood notifications.
  let importChannel: vscode.OutputChannel | undefined;
  const getImportChannel = (): vscode.OutputChannel => {
    if (!importChannel) {
      importChannel = vscode.window.createOutputChannel('Mocklify Import');
      context.subscriptions.push(importChannel);
    }
    return importChannel;
  };

  register('mocklify.importOpenApi', async () => {
    const specUri = await pickSpecFile();
    if (!specUri) {
      return;
    }

    let importResult: OpenApiImportResult;
    try {
      const bytes = await vscode.workspace.fs.readFile(specUri);
      const text = Buffer.from(bytes).toString('utf-8');
      // Parsing a large spec is synchronous CPU work — surface progress first
      // and yield once so the notification paints before the parse blocks.
      importResult = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Mocklify: Parsing "${vscode.workspace.asRelativePath(specUri)}"…`,
        },
        async () => {
          await new Promise<void>((resolve) => setImmediate(resolve));
          return new OpenApiImportService().importSpec(text);
        }
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Mocklify: Could not import spec: ${error instanceof Error ? error.message : String(error)}`
      );
      return;
    }

    if (importResult.warnings.length > 0) {
      const channel = getImportChannel();
      channel.appendLine(
        `[${new Date().toISOString()}] ${importResult.warnings.length} warning(s) importing ${vscode.workspace.asRelativePath(specUri)}:`
      );
      for (const warning of importResult.warnings) {
        channel.appendLine(`  - ${warning}`);
      }
    }

    if (importResult.routes.length === 0) {
      vscode.window.showWarningMessage(
        'Mocklify: The spec contains no importable JSON routes' +
          (importResult.warnings.length > 0
            ? ' — see the "Mocklify Import" output channel for details.'
            : '.')
      );
      if (importResult.warnings.length > 0) {
        getImportChannel().show(true);
      }
      return;
    }

    if (importResult.warnings.length > 0) {
      vscode.window
        .showInformationMessage(
          `Mocklify: Spec parsed with ${importResult.warnings.length} warning(s).`,
          'Show Warnings'
        )
        .then((action) => {
          if (action === 'Show Warnings') {
            getImportChannel().show(true);
          }
        });
    }

    // Disclose the cost of enrichment up front: one AI request per chunk.
    const enrichRequestCount = formatImportBlocks(importResult).length;
    const mode = await vscode.window.showQuickPick<vscode.QuickPickItem & { enrich: boolean }>(
      [
        {
          label: '$(file-code) Import as-is',
          detail: 'Deterministic: spec examples + schema-generated data. No AI calls.',
          enrich: false,
        },
        {
          label: '$(sparkle) Import + AI enrich',
          detail:
            `AI rewrites example data to be coherent across routes and adds disabled failure routes (400/401/404/429/500) — about ${enrichRequestCount} AI request${enrichRequestCount === 1 ? '' : 's'}. Falls back to as-is if AI is unavailable.`,
          enrich: true,
        },
      ],
      {
        placeHolder: `"${importResult.name}" — ${importResult.routes.length} route(s) parsed. How should Mocklify import it?`,
      }
    );
    if (!mode) {
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Mocklify: Importing "${importResult.name}"…`,
        cancellable: true,
      },
      async (progress, token) => {
        try {
          let result: EnrichedImportResult = { ...importResult, enriched: false };
          if (mode.enrich) {
            let lastFraction = 0;
            result = await new SpecEnricher().enrich(importResult, ai, {
              token,
              onProgress: ({ message, fraction }) => {
                progress.report({
                  message,
                  increment: Math.max(0, (fraction - lastFraction) * 100),
                });
                lastFraction = Math.max(lastFraction, fraction);
              },
            });
          }
          if (token.isCancellationRequested) {
            return;
          }
          if (mode.enrich && !result.enriched) {
            vscode.window.showInformationMessage(
              'Mocklify: AI enrichment was unavailable — using the deterministic import.'
            );
          } else if (mode.enrich && (result.chunksFailed ?? 0) > 0) {
            vscode.window.showWarningMessage(
              `Mocklify: AI enrichment succeeded for ${(result.chunksTotal ?? 0) - (result.chunksFailed ?? 0)} of ${result.chunksTotal} part(s) — the rest keep deterministic data.`
            );
          }

          const negativeCount = result.routes.filter((r) => !r.enabled).length;
          const positiveCount = result.routes.length - negativeCount;
          const confirm = await vscode.window.showInformationMessage(
            `Create "${result.name}" with ${result.routes.length} routes — ` +
              `${positiveCount} success + ${negativeCount} failure routes? ` +
              `(Failure routes are disabled; enable one to simulate that error in your app.)`,
            { modal: true },
            'Create',
            'Create & Start'
          );
          if (!confirm) {
            return;
          }

          const servers = await manager.getServers();
          const usedPorts = new Set(servers.map((s) => s.port));
          let port = vscode.workspace.getConfiguration('mocklify').get<number>('defaultPort', 3000);
          while (usedPorts.has(port)) {
            port++;
          }

          const server = await manager.createServer(result.name, port);
          progress.report({ message: `Adding ${result.routes.length} route(s)…` });
          await manager.addRoutes(server.id, result.routes);

          if (confirm === 'Create & Start') {
            await manager.startServer(server.id);
            vscode.window.showInformationMessage(
              `Mocklify: "${server.name}" running at http://localhost:${server.port}`
            );
          } else {
            vscode.window.showInformationMessage(`Mocklify: Created "${server.name}".`);
          }
        } catch (error) {
          if (error instanceof vscode.CancellationError) {
            return;
          }
          showAiError(error);
        }
      }
    );
  });

  register('mocklify.aiGenerateFromCodebase', async () => {
    if (!vscode.workspace.workspaceFolders?.length) {
      vscode.window.showWarningMessage('Mocklify: Open a folder or workspace to scan for API calls.');
      return;
    }

    const codebaseGenerator = new CodebaseMockGenerator(ai);

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Mocklify: Generating mocks from your codebase',
        cancellable: true,
      },
      async (progress, token) => {
        try {
          let lastFraction = 0;
          const summary = await codebaseGenerator.generate({
            token,
            onProgress: ({ message, fraction }) => {
              progress.report({
                message,
                increment: Math.max(0, (fraction - lastFraction) * 100),
              });
              lastFraction = Math.max(lastFraction, fraction);
            },
          });
          if (token.isCancellationRequested) {
            return;
          }

          const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name ?? 'App';
          const verificationNote =
            summary.repairedCount > 0 || summary.droppedCount > 0
              ? ` Self-verification auto-repaired ${summary.repairedCount} and dropped ${summary.droppedCount} invalid route(s).`
              : '';
          const confirm = await vscode.window.showInformationMessage(
            `Found API usage in ${summary.matchedFileCount} of ${summary.scannedFileCount} scanned files. ` +
              `Create "${workspaceName} Mock API" with ${summary.routes.length} routes — ` +
              `${summary.positiveCount} success + ${summary.negativeCount} failure routes? ` +
              `(Failure routes are disabled; enable one to simulate that error in your app.)` +
              verificationNote,
            { modal: true },
            'Create',
            'Create & Start'
          );
          if (!confirm) {
            return;
          }

          const servers = await manager.getServers();
          const usedPorts = new Set(servers.map((s) => s.port));
          let port = vscode.workspace.getConfiguration('mocklify').get<number>('defaultPort', 3000);
          while (usedPorts.has(port)) {
            port++;
          }

          const server = await manager.createServer(`${workspaceName} Mock API`, port);
          await manager.addRoutes(server.id, summary.routes);

          if (confirm === 'Create & Start') {
            await manager.startServer(server.id);
            vscode.window.showInformationMessage(
              `Mocklify: "${server.name}" running at http://localhost:${server.port} — point your app's base URL there.`
            );
          } else {
            vscode.window.showInformationMessage(`Mocklify: Created "${server.name}".`);
          }
        } catch (error) {
          if (error instanceof vscode.CancellationError) {
            return;
          }
          showAiError(error);
        }
      }
    );
  });

  register('mocklify.aiGenerateFromTraffic', async (item?: { serverId?: string }) => {
    const entries = manager.getLogEntries(item?.serverId);
    const trafficGenerator = new TrafficMockGenerator(ai);

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Mocklify: Generating mocks from recorded traffic',
        cancellable: true,
      },
      async (progress, token) => {
        try {
          let lastFraction = 0;
          const summary = await trafficGenerator.generate(entries, {
            token,
            onProgress: ({ message, fraction }) => {
              progress.report({
                message,
                increment: Math.max(0, (fraction - lastFraction) * 100),
              });
              lastFraction = Math.max(lastFraction, fraction);
            },
          });
          if (token.isCancellationRequested) {
            return;
          }

          const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name ?? 'App';
          const confirm = await vscode.window.showInformationMessage(
            `Replayed ${summary.entryCount} recorded request(s) across ${summary.endpointCount} endpoint(s). ` +
              `Create "${workspaceName} Recorded API" with ${summary.routes.length} routes — ` +
              `${summary.positiveCount} success + ${summary.negativeCount} failure routes? ` +
              `(Failure routes are disabled; enable one to simulate that error in your app.)`,
            { modal: true },
            'Create',
            'Create & Start'
          );
          if (!confirm) {
            return;
          }

          const servers = await manager.getServers();
          const usedPorts = new Set(servers.map((s) => s.port));
          let port = vscode.workspace.getConfiguration('mocklify').get<number>('defaultPort', 3000);
          while (usedPorts.has(port)) {
            port++;
          }

          const server = await manager.createServer(`${workspaceName} Recorded API`, port);
          await manager.addRoutes(server.id, summary.routes);

          if (confirm === 'Create & Start') {
            await manager.startServer(server.id);
            vscode.window.showInformationMessage(
              `Mocklify: "${server.name}" running at http://localhost:${server.port} — point your app's base URL there.`
            );
          } else {
            vscode.window.showInformationMessage(`Mocklify: Created "${server.name}".`);
          }
        } catch (error) {
          if (error instanceof vscode.CancellationError) {
            return;
          }
          showAiError(error);
        }
      }
    );
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

  register('mocklify.selectAiModel', async (providerId?: ModelProviderId) => {
    const config = vscode.workspace.getConfiguration('mocklify');

    // Resolve which provider's model to change: explicit arg → configured
    // provider (if key-based) → ask.
    let target = providerId && MODEL_CATALOG[providerId] ? providerId : undefined;
    if (!target) {
      const configured = ai.getConfiguredProviderId();
      if (configured in MODEL_CATALOG) {
        target = configured as ModelProviderId;
      }
    }
    if (!target) {
      const picked = await vscode.window.showQuickPick(
        (Object.keys(MODEL_CATALOG) as ModelProviderId[]).map((id) => ({
          label: MODEL_CATALOG[id].label,
          description: config.get<string>(MODEL_CATALOG[id].settingKey, ''),
          id,
        })),
        { placeHolder: 'Change the model for which AI provider? (Copilot picks its model in chat)' }
      );
      if (!picked) {
        return;
      }
      target = picked.id;
    }

    const catalog = MODEL_CATALOG[target];
    const current = config.get<string>(catalog.settingKey, '');
    const CUSTOM = '$(edit) Custom model ID…';

    const items: (vscode.QuickPickItem & { id?: string })[] = [
      ...catalog.models.map((m) => ({
        label: m.id,
        description: m.id === current ? 'current' : undefined,
        detail: m.detail,
        id: m.id,
      })),
      { label: CUSTOM, detail: catalog.customHint },
    ];
    if (current && !catalog.models.some((m) => m.id === current)) {
      items.unshift({ label: current, description: 'current · custom', id: current });
    }

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: `Choose the ${catalog.label} model for Mocklify`,
    });
    if (!picked) {
      return;
    }

    let model = picked.id;
    if (!model) {
      model = (
        await vscode.window.showInputBox({
          prompt: `Enter the ${catalog.label} model ID your endpoint expects`,
          placeHolder: catalog.customHint,
          value: current,
          ignoreFocusOut: true,
        })
      )?.trim();
      if (!model) {
        return;
      }
    }

    await config.update(catalog.settingKey, model, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Mocklify: ${catalog.label} model set to ${model}.`);
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

const SPEC_FILE_FILTERS: Record<string, string[]> = { 'OpenAPI / Swagger': ['json', 'yaml', 'yml'] };

async function browseForSpecFile(): Promise<vscode.Uri | undefined> {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: SPEC_FILE_FILTERS,
    title: 'Select an OpenAPI / Swagger spec',
    openLabel: 'Import',
  });
  return picked?.[0];
}

/** Offer spec-looking workspace files in a QuickPick, with a Browse… escape hatch. */
async function pickSpecFile(): Promise<vscode.Uri | undefined> {
  const exclude = '{**/node_modules/**,**/dist/**,**/out/**,**/build/**,**/.git/**}';
  const candidates = new Map<string, vscode.Uri>();
  for (const pattern of ['**/*{openapi,swagger}*.{json,yaml,yml}', '**/openapi.{json,yaml,yml}']) {
    for (const uri of await vscode.workspace.findFiles(pattern, exclude, 50)) {
      candidates.set(uri.fsPath, uri);
    }
  }
  if (candidates.size === 0) {
    return browseForSpecFile();
  }

  const items: (vscode.QuickPickItem & { uri?: vscode.Uri })[] = [
    ...[...candidates.values()].map((uri) => ({
      label: `$(file-code) ${vscode.workspace.asRelativePath(uri)}`,
      uri,
    })),
    { label: '$(folder-opened) Browse…', detail: 'Pick a spec file anywhere on disk' },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select an OpenAPI / Swagger spec to import',
  });
  if (!picked) {
    return undefined;
  }
  return picked.uri ?? browseForSpecFile();
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
