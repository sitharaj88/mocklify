import * as vscode from 'vscode';
import { MockServerManager } from '../core/MockServerManager.js';
import { MockServerConfig } from '../types/core.js';
import { OpenApiExportService } from '../services/OpenApiExportService.js';
import { buildApiDocsHtml, buildConfluenceStorageXhtml } from '../services/DocsExportService.js';
import {
  buildHttpFile,
  buildOpenApiYaml,
  buildPostmanCollection,
} from '../services/CollectionExportService.js';
import { getExtensionVersion } from '../version.js';
import { AiService } from './AiService.js';
import { AiProviderId, AiUnavailableError } from './providers/types.js';
import { ApiKeyManager } from './providers/ApiKeyManager.js';
import { MockGenerator } from './MockGenerator.js';
import { DocumentationGenerator } from './DocumentationGenerator.js';
import { CENSUS_NO_ROUTES_MESSAGE, CodebaseScanProgress } from './CodebaseMockGenerator.js';
import { ScanOrchestrator } from './ScanOrchestrator.js';
import { TrafficMockGenerator } from './TrafficMockGenerator.js';
import { MODEL_CATALOG, ModelProviderId } from './modelCatalog.js';
import { OpenApiImportService, OpenApiImportResult } from '../services/OpenApiImportService.js';
import { SpecEnricher, EnrichedImportResult, formatImportBlocks } from './SpecEnricher.js';

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

    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Mocklify: Generating API documentation for "${server.name}"…`,
        cancellable: true,
      },
      async (_progress, token) => {
        try {
          const generated = await docsGenerator.generate(server, { token });
          return token.isCancellationRequested ? undefined : generated;
        } catch (error) {
          showAiError(error);
          return undefined;
        }
      }
    );
    if (!result) {
      return;
    }

    await saveAndOpenDocs(server, result.markdown);
    if (!result.aiEnhanced) {
      vscode.window.showInformationMessage(
        'Mocklify: GitHub Copilot was unavailable — generated reference documentation instead.'
      );
    }

    // AI prose becomes the overview of the richer formats; the deterministic
    // fallback already duplicates the endpoint reference.
    const markdown = result.aiEnhanced ? result.markdown : undefined;
    const also = await vscode.window.showInformationMessage(
      'Mocklify: Also export the documentation as…',
      'Web Page',
      'Confluence'
    );
    if (also === 'Web Page') {
      await saveServerExport(server, 'html', buildApiDocsHtml(server, { markdown }));
    } else if (also === 'Confluence') {
      await saveServerExport(server, 'confluence', buildConfluenceStorageXhtml(server, { markdown }));
    }
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

  register('mocklify.exportServerAs', async (item?: { serverId?: string }) => {
    const server = await pickServer(manager, item, 'Select a server to export');
    if (!server) {
      return;
    }

    const picked = await vscode.window.showQuickPick<vscode.QuickPickItem & { id: ExportFormatId }>(
      [
        {
          label: '$(json) OpenAPI 3.0 — JSON',
          detail: 'Spec with inferred response schemas',
          id: 'openapi-json',
        },
        {
          label: '$(file-code) OpenAPI 3.0 — YAML',
          detail: 'The same spec serialized as YAML',
          id: 'openapi-yaml',
        },
        {
          label: '$(package) Postman Collection v2.1',
          detail: 'Folders per tag, saved example responses, failure scenarios',
          id: 'postman',
        },
        {
          label: '$(terminal) REST Client (.http)',
          detail: 'Runnable requests for the VS Code REST Client extension',
          id: 'http',
        },
        {
          label: '$(globe) API Docs — Web Page (.html)',
          detail: 'Self-contained page with search, curl examples, and dark mode',
          id: 'html',
        },
        {
          label: '$(book) API Docs — Confluence (.xml)',
          detail: 'Confluence Storage Format — paste into a page via Insert markup or the REST API',
          id: 'confluence',
        },
        {
          label: '$(markdown) API Docs — Markdown (.md)',
          detail: 'AI-written docs with a deterministic fallback',
          id: 'markdown',
        },
      ],
      { placeHolder: `Export "${server.name}" as…` }
    );
    if (!picked) {
      return;
    }

    let content: string | undefined;
    switch (picked.id) {
      case 'openapi-json':
        content = openApiExport.exportToJson(server);
        break;
      case 'openapi-yaml':
        content = buildOpenApiYaml(server, openApiExport.exportToOpenApi(server));
        break;
      case 'postman':
        content = JSON.stringify(
          buildPostmanCollection(server, { version: getExtensionVersion() }),
          null,
          2
        );
        break;
      case 'http':
        content = buildHttpFile(server);
        break;
      default:
        // Docs formats: AI prose when a provider is available, deterministic
        // reference otherwise (DocumentationGenerator handles the fallback).
        content = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Mocklify: Generating documentation for "${server.name}"…`,
            cancellable: true,
          },
          async (_progress, token) => {
            try {
              const result = await docsGenerator.generate(server, { token });
              if (token.isCancellationRequested) {
                return undefined;
              }
              if (picked.id === 'markdown') {
                if (!result.aiEnhanced) {
                  vscode.window.showInformationMessage(
                    'Mocklify: AI was unavailable — generated reference documentation instead.'
                  );
                }
                return result.markdown;
              }
              const markdown = result.aiEnhanced ? result.markdown : undefined;
              return picked.id === 'html'
                ? buildApiDocsHtml(server, { markdown })
                : buildConfluenceStorageXhtml(server, { markdown });
            } catch (error) {
              showAiError(error);
              return undefined;
            }
          }
        );
    }
    if (content === undefined) {
      return;
    }

    await saveServerExport(server, picked.id, content);
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

  // Accepts an optional pre-resolved spec Uri so the codebase-scan spec-first
  // shortcut (and the dashboard) can reuse the whole import pipeline.
  register('mocklify.importOpenApi', async (specArg?: vscode.Uri) => {
    const specUri = specArg instanceof vscode.Uri ? specArg : await pickSpecFile();
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

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Mocklify: Generating mocks from your codebase',
        cancellable: true,
      },
      async (progress, token) => {
        try {
          let lastFraction = 0;
          const onProgress = ({ message, fraction }: CodebaseScanProgress) => {
            progress.report({
              message,
              increment: Math.max(0, (fraction - lastFraction) * 100),
            });
            lastFraction = Math.max(lastFraction, fraction);
          };

          // The orchestrator runs recon once, picks the best strategy per API
          // surface (spec > agentic > fast > census, honoring the scanMode
          // setting), and falls back to the fast scan itself when the
          // provider cannot run the agentic loop.
          const summary = await new ScanOrchestrator(ai).generate({ token, onProgress });
          if (token.isCancellationRequested) {
            return;
          }

          // Spec-first shortcut: an existing API spec gives exact routes
          // without inference — offer it before creating anything.
          if (summary.specFiles?.length) {
            const choice = await offerSpecImport(summary.specFiles);
            if (choice === 'import' || choice === 'both') {
              await importWorkspaceSpec(summary.specFiles);
              if (choice === 'import') {
                return;
              }
            }
          }

          // Zero-route agentic completion: the agent explored the workspace
          // and concluded there is nothing to mock — an informational
          // outcome, never an error.
          if (summary.noApiSurfaceReason) {
            const followUp = await vscode.window.showInformationMessage(
              `Mocklify explored the workspace and found no API surface to mock: ${summary.noApiSurfaceReason}`,
              'Generate from Description'
            );
            if (followUp === 'Generate from Description') {
              await vscode.commands.executeCommand('mocklify.aiGenerateServer');
            }
            return;
          }

          const strategyBySurface = new Map(
            (summary.strategies ?? []).map((entry) => [entry.surface, entry.strategy])
          );
          const strategyNote = summary.strategies?.length
            ? ` Scan strategy: ${summary.strategies
                .map((entry) => `${entry.surface} → ${entry.strategy}`)
                .join(', ')}.`
            : '';

          const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name ?? 'App';
          const verificationNote =
            summary.repairedCount > 0 || summary.droppedCount > 0
              ? ` Self-verification auto-repaired ${summary.repairedCount} and dropped ${summary.droppedCount} invalid route(s).`
              : '';

          const servers = await manager.getServers();
          const usedPorts = new Set(servers.map((s) => s.port));
          let port = vscode.workspace.getConfiguration('mocklify').get<number>('defaultPort', 3000);
          const nextFreePort = (): number => {
            while (usedPorts.has(port)) {
              port++;
            }
            usedPorts.add(port);
            return port;
          };

          const surfaces = summary.surfaces ?? [];
          if (surfaces.length > 1) {
            // Multi-surface workspace: one mock server per API surface.
            const planned = surfaces.map((surface) => ({
              surface,
              serverName: `${surface.name} Mock API`,
              port: nextFreePort(),
            }));
            const lines = planned.map(({ surface, port: plannedPort }) => {
              const negative = surface.routes.filter((r) => r.tags?.includes('negative')).length;
              const positive = surface.routes.length - negative;
              const strategy = strategyBySurface.get(surface.name);
              const via = strategy ? ` · ${strategy === 'spec' ? 'spec found' : `${strategy} scan`}` : '';
              return `${surface.name} [${surface.direction}${via}]: ${surface.routes.length} routes (${positive} success + ${negative} failure) — port ${plannedPort}`;
            });
            const confirm = await vscode.window.showInformationMessage(
              `Found ${surfaces.length} API surfaces in ${summary.matchedFileCount} of ${summary.scannedFileCount} scanned files — Mocklify will create one mock server per surface.`,
              {
                modal: true,
                detail:
                  `${lines.join('\n')}\n\n` +
                  `"serves" = a backend's contract, mocked for its clients; "consumes" = the endpoints an app calls. ` +
                  `Failure routes are disabled; enable one to simulate that error.${verificationNote}`,
              },
              'Create All',
              'Create All & Start'
            );
            if (!confirm) {
              return;
            }

            const created: MockServerConfig[] = [];
            for (const plan of planned) {
              const server = await manager.createServer(plan.serverName, plan.port);
              await manager.addRoutes(server.id, plan.surface.routes);
              created.push(server);
            }
            if (confirm === 'Create All & Start') {
              for (const server of created) {
                try {
                  await manager.startServer(server.id);
                } catch (error) {
                  vscode.window.showErrorMessage(
                    `Mocklify: "${server.name}" was created but failed to start: ${error instanceof Error ? error.message : String(error)}`
                  );
                }
              }
            }
            const namesList = created.map((s) => `"${s.name}" (port ${s.port})`).join(', ');
            vscode.window.showInformationMessage(
              confirm === 'Create All & Start'
                ? `Mocklify: Started ${created.length} mock servers — ${namesList}. Point each app at its server's base URL.`
                : `Mocklify: Created ${created.length} mock servers — ${namesList}.`
            );
            return;
          }

          const confirm = await vscode.window.showInformationMessage(
            `Found API usage in ${summary.matchedFileCount} of ${summary.scannedFileCount} scanned files. ` +
              `Create "${workspaceName} Mock API" with ${summary.routes.length} routes — ` +
              `${summary.positiveCount} success + ${summary.negativeCount} failure routes? ` +
              `(Failure routes are disabled; enable one to simulate that error in your app.)` +
              verificationNote +
              strategyNote,
            { modal: true },
            'Create',
            'Create & Start'
          );
          if (!confirm) {
            return;
          }

          const server = await manager.createServer(`${workspaceName} Mock API`, nextFreePort());
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
          // Even the census scan found nothing to mock — an informational
          // outcome (empty workspace), not a failure.
          if (error instanceof Error && error.message === CENSUS_NO_ROUTES_MESSAGE) {
            vscode.window.showInformationMessage(`Mocklify: ${error.message}`);
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
      // A configured gateway endpoint makes the provider usable without a key.
      const available = await ai.getProvider(picked.value as AiProviderId).isAvailable();
      if (!available) {
        const action = await vscode.window.showInformationMessage(
          `Mocklify: ${picked.label} selected. An API key (or a gateway endpoint in mocklify.ai.${picked.value}BaseUrl) is required.`,
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

  register('mocklify.selectAiModel', async (providerId?: ModelProviderId | 'copilot') => {
    const config = vscode.workspace.getConfiguration('mocklify');

    // Copilot models are discovered live from the user's subscription — the
    // static catalog only covers the API-key providers.
    const pickCopilotModel = async () => {
      const models = await ai.listCopilotModels();
      if (models.length === 0) {
        vscode.window.showWarningMessage(
          'Mocklify: No GitHub Copilot models are available. Install and sign in to GitHub Copilot first.'
        );
        return;
      }
      const current = config.get<string>('ai.copilotModel', '');
      const picked = await vscode.window.showQuickPick(
        [
          {
            label: '$(zap) Auto',
            description: current === '' ? 'current' : undefined,
            detail: 'Best available model (recommended)',
            family: '',
          },
          ...models.map((m) => ({
            label: m.family,
            description: m.family === current ? 'current' : undefined,
            detail: m.name,
            family: m.family,
          })),
        ],
        { placeHolder: 'Choose the GitHub Copilot model for Mocklify' }
      );
      if (!picked) {
        return;
      }
      await config.update('ai.copilotModel', picked.family, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(
        `Mocklify: Copilot model set to ${picked.family || 'Auto (best available)'}.`
      );
    };

    // Resolve which provider's model to change: explicit arg → configured
    // provider → ask.
    let target: ModelProviderId | 'copilot' | undefined =
      providerId === 'copilot' || (providerId && MODEL_CATALOG[providerId])
        ? providerId
        : undefined;
    if (!target) {
      const configured = ai.getConfiguredProviderId();
      if (configured === 'copilot' || configured in MODEL_CATALOG) {
        target = configured as ModelProviderId | 'copilot';
      }
    }
    if (!target) {
      const picked = await vscode.window.showQuickPick(
        [
          {
            label: 'GitHub Copilot',
            description: config.get<string>('ai.copilotModel', '') || 'auto',
            id: 'copilot' as const,
          },
          ...(Object.keys(MODEL_CATALOG) as ModelProviderId[]).map((id) => ({
            label: MODEL_CATALOG[id].label,
            description: config.get<string>(MODEL_CATALOG[id].settingKey, ''),
            id,
          })),
        ],
        { placeHolder: 'Change the model for which AI provider?' }
      );
      if (!picked) {
        return;
      }
      target = picked.id;
    }

    if (target === 'copilot') {
      await pickCopilotModel();
      return;
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

type ExportFormatId =
  | 'openapi-json'
  | 'openapi-yaml'
  | 'postman'
  | 'http'
  | 'html'
  | 'confluence'
  | 'markdown';

const EXPORT_FILES: Record<ExportFormatId, { suffix: string; filters: Record<string, string[]> }> = {
  'openapi-json': { suffix: '-openapi.json', filters: { 'OpenAPI JSON': ['json'] } },
  'openapi-yaml': { suffix: '-openapi.yaml', filters: { 'OpenAPI YAML': ['yaml', 'yml'] } },
  postman: { suffix: '.postman_collection.json', filters: { 'Postman Collection': ['json'] } },
  http: { suffix: '.http', filters: { 'REST Client': ['http'] } },
  html: { suffix: '-docs.html', filters: { 'Web Page': ['html'] } },
  confluence: { suffix: '-docs.xml', filters: { 'Confluence Storage Format': ['xml'] } },
  markdown: { suffix: '-docs.md', filters: { Markdown: ['md'] } },
};

async function saveServerExport(
  server: MockServerConfig,
  format: ExportFormatId,
  content: string
): Promise<void> {
  const { suffix, filters } = EXPORT_FILES[format];
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  const fileName = `${slugify(server.name)}${suffix}`;
  const target = await vscode.window.showSaveDialog({
    defaultUri: workspaceRoot ? vscode.Uri.joinPath(workspaceRoot, fileName) : undefined,
    filters,
  });
  if (!target) {
    return;
  }

  await vscode.workspace.fs.writeFile(target, Buffer.from(content, 'utf-8'));

  if (format === 'html') {
    const action = await vscode.window.showInformationMessage(
      `Mocklify: Exported "${server.name}" docs as a web page.`,
      'Open in Browser',
      'Reveal'
    );
    if (action === 'Open in Browser') {
      await vscode.env.openExternal(target);
    } else if (action === 'Reveal') {
      await vscode.commands.executeCommand('revealFileInOS', target);
    }
    return;
  }

  const action = await vscode.window.showInformationMessage(
    `Mocklify: Exported "${server.name}" as ${fileName}.`,
    'Open File'
  );
  if (action === 'Open File') {
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target));
  }
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

export type SpecOfferChoice = 'import' | 'scan' | 'both';

/**
 * Non-blocking (non-modal) offer shown when a codebase scan found API spec
 * files: import the spec for exact routes, keep the AI scan results, or both.
 * Dismissing the notification keeps the scan results (the safe default).
 */
export async function offerSpecImport(specFiles: string[]): Promise<SpecOfferChoice> {
  const n = specFiles.length;
  const listed = n === 1 ? specFiles[0] : `${specFiles[0]}, …`;
  const choice = await vscode.window.showInformationMessage(
    `Mocklify: Found ${n} API spec file${n === 1 ? '' : 's'} in this workspace (${listed}). Importing a spec directly gives exact routes without AI inference.`,
    'Import Spec Instead',
    'Use Scan Results',
    'Both'
  );
  if (choice === 'Import Spec Instead') {
    return 'import';
  }
  if (choice === 'Both') {
    return 'both';
  }
  return 'scan';
}

const POSTMAN_SPEC_RE = /postman_collection\.json$/i;
const OPENAPI_SPEC_RE = /\.(json|ya?ml)$/i;

/**
 * Import one of the workspace-relative spec files the scan found. OpenAPI /
 * Swagger documents go through the full mocklify.importOpenApi pipeline;
 * formats without a direct importer (proto, GraphQL, Postman) are opened in
 * the editor with a note.
 */
export async function importWorkspaceSpec(specFiles: string[]): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root || specFiles.length === 0) {
    return;
  }
  let relative = specFiles[0];
  if (specFiles.length > 1) {
    const picked = await vscode.window.showQuickPick(specFiles, {
      placeHolder: 'Which spec file should Mocklify import?',
    });
    if (!picked) {
      return;
    }
    relative = picked;
  }
  const uri = vscode.Uri.joinPath(root, relative);
  if (OPENAPI_SPEC_RE.test(relative) && !POSTMAN_SPEC_RE.test(relative)) {
    await vscode.commands.executeCommand('mocklify.importOpenApi', uri);
    return;
  }
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
  vscode.window.showInformationMessage(
    'Mocklify: This spec format has no direct importer yet — the file was opened instead. OpenAPI/Swagger specs (JSON or YAML) can be imported directly.'
  );
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
