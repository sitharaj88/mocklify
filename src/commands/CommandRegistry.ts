import * as vscode from 'vscode';
import { MockServerManager } from '../core/MockServerManager.js';
import {
  MockServerTreeViewProvider,
  ServerTreeItem,
  RouteTreeItem,
} from '../views/TreeViewProvider.js';
import { HttpMethod } from '../types/core.js';

export class CommandRegistry {
  private disposables: vscode.Disposable[] = [];

  constructor(
    private context: vscode.ExtensionContext,
    private manager: MockServerManager,
    private treeProvider: MockServerTreeViewProvider
  ) {}

  registerAll(): void {
    this.register('specter.createServer', () => this.createServer());
    this.register('specter.startServer', (item?: ServerTreeItem) =>
      this.startServer(item)
    );
    this.register('specter.stopServer', (item?: ServerTreeItem) =>
      this.stopServer(item)
    );
    this.register('specter.deleteServer', (item?: ServerTreeItem) =>
      this.deleteServer(item)
    );
    this.register('specter.startAll', () => this.startAll());
    this.register('specter.stopAll', () => this.stopAll());
    this.register('specter.addRoute', (item?: ServerTreeItem) =>
      this.addRoute(item)
    );
    this.register('specter.editRoute', (item?: RouteTreeItem) =>
      this.editRoute(item)
    );
    this.register('specter.deleteRoute', (item?: RouteTreeItem) =>
      this.deleteRoute(item)
    );
    this.register('specter.toggleRoute', (item?: RouteTreeItem) =>
      this.toggleRoute(item)
    );
    this.register('specter.refresh', () => this.refresh());
    this.register('specter.showQuickPick', () => this.showQuickPick());

    // New import/export commands
    this.register('specter.importOpenApi', () => this.importOpenApi());
    this.register('specter.importPostman', () => this.importPostman());
    this.register('specter.exportServer', (item?: ServerTreeItem) => this.exportServer(item));
    this.register('specter.exportLogs', (item?: ServerTreeItem) => this.exportLogs(item));

    // Recording commands
    this.register('specter.startRecording', (item?: ServerTreeItem) => this.startRecording(item));
    this.register('specter.stopRecording', (item?: ServerTreeItem) => this.stopRecording(item));
  }

  private register(command: string, callback: (...args: unknown[]) => unknown): void {
    const disposable = vscode.commands.registerCommand(command, callback);
    this.context.subscriptions.push(disposable);
    this.disposables.push(disposable);
  }

  private async createServer(): Promise<void> {
    const name = await vscode.window.showInputBox({
      prompt: 'Enter server name',
      placeHolder: 'My API Server',
      validateInput: (value) => {
        if (!value || value.trim().length === 0) {
          return 'Server name is required';
        }
        return undefined;
      },
    });

    if (!name) {
      return;
    }

    const portStr = await vscode.window.showInputBox({
      prompt: 'Enter port number',
      placeHolder: '3000',
      value: '3000',
      validateInput: (value) => {
        const port = parseInt(value, 10);
        if (isNaN(port) || port < 1 || port > 65535) {
          return 'Port must be a number between 1 and 65535';
        }
        return undefined;
      },
    });

    if (!portStr) {
      return;
    }

    const port = parseInt(portStr, 10);

    try {
      const server = await this.manager.createServer(name.trim(), port);
      vscode.window.showInformationMessage(`Specter: Created server "${server.name}"`);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to create server: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async startServer(item?: ServerTreeItem): Promise<void> {
    const serverId = item?.serverId || (await this.selectServer('stopped'));
    if (!serverId) {
      return;
    }

    try {
      await this.manager.startServer(serverId);
      const config = await this.manager.getServer(serverId);
      vscode.window.showInformationMessage(
        `Started server: ${config?.name} on port ${config?.port}`
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to start server: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async stopServer(item?: ServerTreeItem): Promise<void> {
    const serverId = item?.serverId || (await this.selectServer('running'));
    if (!serverId) {
      return;
    }

    try {
      await this.manager.stopServer(serverId);
      const config = await this.manager.getServer(serverId);
      vscode.window.showInformationMessage(`Stopped server: ${config?.name}`);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to stop server: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async deleteServer(item?: ServerTreeItem): Promise<void> {
    const serverId = item?.serverId || (await this.selectServer());
    if (!serverId) {
      return;
    }

    const config = await this.manager.getServer(serverId);
    if (!config) {
      return;
    }

    const confirmed = await vscode.window.showWarningMessage(
      `Are you sure you want to delete "${config.name}"?`,
      { modal: true },
      'Delete'
    );

    if (confirmed !== 'Delete') {
      return;
    }

    try {
      await this.manager.deleteServer(serverId);
      vscode.window.showInformationMessage(`Deleted server: ${config.name}`);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to delete server: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async startAll(): Promise<void> {
    try {
      await this.manager.startAll();
      vscode.window.showInformationMessage('Started all enabled servers');
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to start servers: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async stopAll(): Promise<void> {
    try {
      await this.manager.stopAll();
      vscode.window.showInformationMessage('Stopped all servers');
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to stop servers: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async addRoute(item?: ServerTreeItem): Promise<void> {
    const serverId = item?.serverId || (await this.selectServer());
    if (!serverId) {
      return;
    }

    // Select HTTP method
    const methodItems: vscode.QuickPickItem[] = [
      { label: 'GET', description: 'Retrieve data' },
      { label: 'POST', description: 'Create data' },
      { label: 'PUT', description: 'Update data' },
      { label: 'DELETE', description: 'Delete data' },
      { label: 'PATCH', description: 'Partial update' },
    ];

    const methodSelection = await vscode.window.showQuickPick(methodItems, {
      placeHolder: 'Select HTTP method',
    });

    if (!methodSelection) {
      return;
    }

    const method = methodSelection.label as HttpMethod;

    // Enter path
    const path = await vscode.window.showInputBox({
      prompt: 'Enter route path',
      placeHolder: '/api/users/:id',
      validateInput: (value) => {
        if (!value || !value.startsWith('/')) {
          return 'Path must start with /';
        }
        return undefined;
      },
    });

    if (!path) {
      return;
    }

    // Enter name
    const name = await vscode.window.showInputBox({
      prompt: 'Enter route name (optional)',
      placeHolder: 'Get User by ID',
    });

    // Select status code
    const statusItems: vscode.QuickPickItem[] = [
      { label: '200', description: 'OK' },
      { label: '201', description: 'Created' },
      { label: '204', description: 'No Content' },
      { label: '400', description: 'Bad Request' },
      { label: '401', description: 'Unauthorized' },
      { label: '403', description: 'Forbidden' },
      { label: '404', description: 'Not Found' },
      { label: '500', description: 'Internal Server Error' },
    ];

    const statusSelection = await vscode.window.showQuickPick(statusItems, {
      placeHolder: 'Select response status code',
    });

    if (!statusSelection) {
      return;
    }

    const statusCode = parseInt(statusSelection.label, 10);

    // Enter response body
    const body = await vscode.window.showInputBox({
      prompt: 'Enter response body (JSON)',
      placeHolder: '{"message": "Hello, World!"}',
      value: '{}',
    });

    let parsedBody: unknown = {};
    if (body) {
      try {
        parsedBody = JSON.parse(body);
      } catch {
        vscode.window.showWarningMessage('Invalid JSON, using as plain text');
        parsedBody = body;
      }
    }

    try {
      await this.manager.addRoute(serverId, {
        name: name || path,
        enabled: true,
        method,
        path,
        response: {
          type: 'static',
          statusCode,
          headers: { 'Content-Type': 'application/json' },
          body: {
            contentType: 'application/json',
            content: parsedBody,
          },
        },
      });
      vscode.window.showInformationMessage(`Added route: ${method} ${path}`);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to add route: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async editRoute(item?: RouteTreeItem): Promise<void> {
    if (!item) {
      vscode.window.showErrorMessage('No route selected');
      return;
    }

    // For now, just open the configuration file
    // In a future version, this could open a WebView editor
    vscode.window.showInformationMessage(
      `Editing route: ${item.route.name}. Use the configuration file to make changes.`
    );
  }

  private async deleteRoute(item?: RouteTreeItem): Promise<void> {
    if (!item) {
      vscode.window.showErrorMessage('No route selected');
      return;
    }

    const confirmed = await vscode.window.showWarningMessage(
      `Are you sure you want to delete route "${item.route.name}"?`,
      { modal: true },
      'Delete'
    );

    if (confirmed !== 'Delete') {
      return;
    }

    try {
      await this.manager.deleteRoute(item.serverId, item.route.id);
      vscode.window.showInformationMessage(`Deleted route: ${item.route.name}`);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to delete route: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async toggleRoute(item?: RouteTreeItem): Promise<void> {
    if (!item) {
      vscode.window.showErrorMessage('No route selected');
      return;
    }

    try {
      await this.manager.toggleRoute(item.serverId, item.route.id);
      const newState = !item.route.enabled;
      vscode.window.showInformationMessage(
        `Route "${item.route.name}" ${newState ? 'enabled' : 'disabled'}`
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to toggle route: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private refresh(): void {
    this.treeProvider.refresh();
  }

  private async showQuickPick(): Promise<void> {
    const servers = await this.manager.getServers();

    if (servers.length === 0) {
      const action = await vscode.window.showQuickPick(
        [{ label: '$(add) Create Server', action: 'create' }],
        { placeHolder: 'No Specter servers configured' }
      );

      if (action?.action === 'create') {
        await this.createServer();
      }
      return;
    }

    const states = this.manager.getAllServerStates();
    const items: (vscode.QuickPickItem & { action: string; serverId?: string })[] = [];

    // Add server actions
    for (const server of servers) {
      const state = states.get(server.id);
      const isRunning = state?.status === 'running';
      const icon = isRunning ? '$(vm-running)' : '$(vm-outline)';
      const status = isRunning ? `Running on :${server.port}` : 'Stopped';

      items.push({
        label: `${icon} ${server.name}`,
        description: status,
        action: isRunning ? 'stop' : 'start',
        serverId: server.id,
      });
    }

    items.push({ label: '', kind: vscode.QuickPickItemKind.Separator, action: '' });
    items.push({ label: '$(add) Create New Server', action: 'create' });
    items.push({ label: '$(run-all) Start All Servers', action: 'startAll' });
    items.push({ label: '$(debug-stop) Stop All Servers', action: 'stopAll' });

    const selection = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a server or action',
    });

    if (!selection) {
      return;
    }

    switch (selection.action) {
      case 'start':
        if (selection.serverId) {
          await this.manager.startServer(selection.serverId);
        }
        break;
      case 'stop':
        if (selection.serverId) {
          await this.manager.stopServer(selection.serverId);
        }
        break;
      case 'create':
        await this.createServer();
        break;
      case 'startAll':
        await this.startAll();
        break;
      case 'stopAll':
        await this.stopAll();
        break;
    }
  }

  private async selectServer(statusFilter?: 'running' | 'stopped'): Promise<string | undefined> {
    const servers = await this.manager.getServers();
    const states = this.manager.getAllServerStates();

    let filteredServers = servers;
    if (statusFilter) {
      filteredServers = servers.filter((s) => {
        const state = states.get(s.id);
        return statusFilter === 'running'
          ? state?.status === 'running'
          : state?.status !== 'running';
      });
    }

    if (filteredServers.length === 0) {
      vscode.window.showInformationMessage('No matching servers found');
      return undefined;
    }

    if (filteredServers.length === 1) {
      return filteredServers[0].id;
    }

    const items = filteredServers.map((s) => ({
      label: s.name,
      description: `:${s.port}`,
      serverId: s.id,
    }));

    const selection = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a server',
    });

    return selection?.serverId;
  }

  private async importOpenApi(): Promise<void> {
    const fileUri = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: {
        'OpenAPI/Swagger': ['json', 'yaml', 'yml'],
      },
      title: 'Select OpenAPI/Swagger file',
    });

    if (!fileUri || fileUri.length === 0) {
      return;
    }

    const serverId = await this.selectServer();
    if (!serverId) {
      // Create new server for imported routes
      const name = await vscode.window.showInputBox({
        prompt: 'Enter server name for imported routes',
        placeHolder: 'Imported API',
      });
      if (!name) return;

      try {
        const server = await this.manager.createServer(name);
        const routes = await this.manager.importFromOpenApi(fileUri[0].fsPath, server.id);
        vscode.window.showInformationMessage(
          `Specter: Imported ${routes.length} routes from OpenAPI spec`
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to import: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    } else {
      try {
        const routes = await this.manager.importFromOpenApi(fileUri[0].fsPath, serverId);
        vscode.window.showInformationMessage(
          `Specter: Imported ${routes.length} routes from OpenAPI spec`
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to import: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }
  }

  private async importPostman(): Promise<void> {
    const fileUri = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: {
        'Postman Collection': ['json'],
      },
      title: 'Select Postman Collection file',
    });

    if (!fileUri || fileUri.length === 0) {
      return;
    }

    const serverId = await this.selectServer();
    if (!serverId) {
      const name = await vscode.window.showInputBox({
        prompt: 'Enter server name for imported routes',
        placeHolder: 'Postman Import',
      });
      if (!name) return;

      try {
        const server = await this.manager.createServer(name);
        const routes = await this.manager.importFromPostman(fileUri[0].fsPath, server.id);
        vscode.window.showInformationMessage(
          `Specter: Imported ${routes.length} routes from Postman collection`
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to import: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    } else {
      try {
        const routes = await this.manager.importFromPostman(fileUri[0].fsPath, serverId);
        vscode.window.showInformationMessage(
          `Specter: Imported ${routes.length} routes from Postman collection`
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to import: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }
  }

  private async exportServer(item?: ServerTreeItem): Promise<void> {
    const serverId = item?.serverId || (await this.selectServer());
    if (!serverId) return;

    const server = await this.manager.getServer(serverId);
    if (!server) return;

    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`${server.name.replace(/\s+/g, '-')}-config.json`),
      filters: {
        'JSON': ['json'],
      },
      title: 'Export Server Configuration',
    });

    if (!saveUri) return;

    try {
      await this.manager.exportServer(serverId, saveUri.fsPath);
      vscode.window.showInformationMessage(`Specter: Exported server configuration`);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to export: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async exportLogs(item?: ServerTreeItem): Promise<void> {
    const serverId = item?.serverId || (await this.selectServer());
    if (!serverId) return;

    const server = await this.manager.getServer(serverId);
    if (!server) return;

    const format = await vscode.window.showQuickPick(
      [
        { label: 'HAR', description: 'HTTP Archive format', value: 'har' },
        { label: 'cURL', description: 'cURL commands', value: 'curl' },
      ],
      { placeHolder: 'Select export format' }
    );

    if (!format) return;

    const extension = format.value === 'har' ? 'har' : 'sh';
    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`${server.name.replace(/\s+/g, '-')}-logs.${extension}`),
      filters: {
        [format.label]: [extension],
      },
      title: 'Export Request Logs',
    });

    if (!saveUri) return;

    try {
      if (format.value === 'har') {
        await this.manager.exportLogsToHar(serverId, saveUri.fsPath);
      } else {
        const logs = this.manager.getLogEntries(serverId);
        const exportService = this.manager.getExportService();
        const content = exportService.exportLogsToCurl(logs, server.port);
        await exportService.exportToFile(saveUri.fsPath, content);
      }
      vscode.window.showInformationMessage(`Specter: Exported request logs`);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to export: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async startRecording(item?: ServerTreeItem): Promise<void> {
    const serverId = item?.serverId || (await this.selectServer());
    if (!serverId) return;

    const server = await this.manager.getServer(serverId);
    if (!server) return;

    // Get target URL
    const targetUrl = await vscode.window.showInputBox({
      prompt: 'Enter target URL to proxy and record',
      placeHolder: 'https://api.example.com',
      validateInput: (value) => {
        try {
          new URL(value);
          return undefined;
        } catch {
          return 'Please enter a valid URL';
        }
      },
    });

    if (!targetUrl) return;

    // Get path filter (optional)
    const pathFilter = await vscode.window.showInputBox({
      prompt: 'Enter path filter regex (optional)',
      placeHolder: '/api/.*',
    });

    try {
      const recordingManager = this.manager.getRecordingManager();
      const session = recordingManager.createSession(serverId, targetUrl, {
        pathFilter: pathFilter ? new RegExp(pathFilter) : undefined,
      });
      session.start();

      vscode.window.showInformationMessage(
        `Specter: Recording started. Requests to localhost:${server.port} will be proxied to ${targetUrl}`
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to start recording: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async stopRecording(item?: ServerTreeItem): Promise<void> {
    const serverId = item?.serverId || (await this.selectServer());
    if (!serverId) return;

    const recordingManager = this.manager.getRecordingManager();
    const session = recordingManager.getSession(serverId);

    if (!session) {
      vscode.window.showWarningMessage('No active recording session for this server');
      return;
    }

    session.stop();
    const recordings = session.getRecordings();

    if (recordings.length === 0) {
      vscode.window.showInformationMessage('Recording stopped. No requests were captured.');
      return;
    }

    const action = await vscode.window.showQuickPick(
      [
        { label: 'Generate Routes', description: 'Create mock routes from recordings', value: 'generate' },
        { label: 'Save Recording', description: 'Save raw recordings to file', value: 'save' },
        { label: 'Discard', description: 'Discard all recordings', value: 'discard' },
      ],
      { placeHolder: `${recordings.length} requests captured. What would you like to do?` }
    );

    if (!action || action.value === 'discard') {
      recordingManager.deleteSession(serverId);
      return;
    }

    if (action.value === 'generate') {
      const routes = session.generateRoutes();
      for (const route of routes) {
        await this.manager.addRoute(serverId, route);
      }
      vscode.window.showInformationMessage(
        `Specter: Generated ${routes.length} routes from recordings`
      );
    } else {
      await recordingManager.saveSession(serverId);
      vscode.window.showInformationMessage('Specter: Recordings saved');
    }

    recordingManager.deleteSession(serverId);
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
