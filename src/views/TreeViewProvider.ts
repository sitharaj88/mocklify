import * as vscode from 'vscode';
import { MockServerConfig, RouteConfig, ServerRuntimeState, HttpMethod } from '../types/core.js';
import { MockServerManager } from '../core/MockServerManager.js';

export type TreeItemType = 'server' | 'route' | 'routes-folder';

export interface ServerTreeItem extends vscode.TreeItem {
  type: 'server';
  serverId: string;
  config: MockServerConfig;
  state: ServerRuntimeState | undefined;
}

export interface RouteTreeItem extends vscode.TreeItem {
  type: 'route';
  serverId: string;
  route: RouteConfig;
}

export interface RoutesFolderTreeItem extends vscode.TreeItem {
  type: 'routes-folder';
  serverId: string;
}

export type MockServerTreeItem = ServerTreeItem | RouteTreeItem | RoutesFolderTreeItem;

export class MockServerTreeViewProvider
  implements vscode.TreeDataProvider<MockServerTreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<MockServerTreeItem | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private manager: MockServerManager) {
    // Refresh tree when servers change
    manager.onDidChangeServers(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: MockServerTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: MockServerTreeItem): Promise<MockServerTreeItem[]> {
    if (!element) {
      // Root level - show servers
      return this.getServerItems();
    }

    if (element.type === 'server') {
      // Server level - show routes folder
      return this.getRoutesFolderItems(element);
    }

    if (element.type === 'routes-folder') {
      // Routes folder - show routes
      return this.getRouteItems(element.serverId);
    }

    return [];
  }

  private async getServerItems(): Promise<ServerTreeItem[]> {
    const servers = await this.manager.getServers();

    return servers.map((config) => {
      const state = this.manager.getServerState(config.id);
      const isRunning = state?.status === 'running';

      const item: ServerTreeItem = {
        type: 'server',
        serverId: config.id,
        config,
        state,
        label: config.name,
        description: this.getServerDescription(config, state),
        tooltip: this.getServerTooltip(config, state),
        iconPath: new vscode.ThemeIcon(
          isRunning ? 'vm-running' : 'vm-outline',
          isRunning
            ? new vscode.ThemeColor('testing.runAction')
            : undefined
        ),
        contextValue: isRunning ? 'server-running' : 'server-stopped',
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
      };

      return item;
    });
  }

  private getRoutesFolderItems(serverItem: ServerTreeItem): RoutesFolderTreeItem[] {
    const routeCount = serverItem.config.routes.length;

    const item: RoutesFolderTreeItem = {
      type: 'routes-folder',
      serverId: serverItem.serverId,
      label: 'Routes',
      description: `${routeCount} route${routeCount !== 1 ? 's' : ''}`,
      iconPath: new vscode.ThemeIcon('symbol-interface'),
      collapsibleState:
        routeCount > 0
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.None,
    };

    return [item];
  }

  private async getRouteItems(serverId: string): Promise<RouteTreeItem[]> {
    const config = await this.manager.getServer(serverId);
    if (!config) {
      return [];
    }

    return config.routes.map((route) => {
      const methods = this.formatMethods(route.method);
      const isEnabled = route.enabled;

      const item: RouteTreeItem = {
        type: 'route',
        serverId,
        route,
        label: route.name || route.path,
        description: `${methods} ${route.path}`,
        tooltip: this.getRouteTooltip(route),
        iconPath: new vscode.ThemeIcon(
          isEnabled ? 'symbol-method' : 'circle-outline',
          isEnabled ? undefined : new vscode.ThemeColor('disabledForeground')
        ),
        contextValue: 'route',
        collapsibleState: vscode.TreeItemCollapsibleState.None,
      };

      return item;
    });
  }

  private getServerDescription(
    config: MockServerConfig,
    state: ServerRuntimeState | undefined
  ): string {
    const statusText = state?.status || 'stopped';
    const portText = `:${config.port}`;

    if (state?.status === 'running') {
      return `${portText} - Running (${state.requestCount} requests)`;
    } else if (state?.status === 'error') {
      return `${portText} - Error`;
    }

    return `${portText} - ${statusText}`;
  }

  private getServerTooltip(
    config: MockServerConfig,
    state: ServerRuntimeState | undefined
  ): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`### ${config.name}\n\n`);
    md.appendMarkdown(`**Port:** ${config.port}\n\n`);
    md.appendMarkdown(`**Protocol:** ${config.protocol}\n\n`);
    md.appendMarkdown(`**Status:** ${state?.status || 'stopped'}\n\n`);
    md.appendMarkdown(`**Routes:** ${config.routes.length}\n\n`);

    if (state?.status === 'running') {
      md.appendMarkdown(`**Requests:** ${state.requestCount}\n\n`);
      if (state.startedAt) {
        md.appendMarkdown(`**Started:** ${state.startedAt.toLocaleString()}\n\n`);
      }
    }

    if (state?.error) {
      md.appendMarkdown(`**Error:** ${state.error}\n\n`);
    }

    return md;
  }

  private getRouteTooltip(route: RouteConfig): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    const methods = this.formatMethods(route.method);

    md.appendMarkdown(`### ${route.name || route.path}\n\n`);
    md.appendMarkdown(`**Method:** ${methods}\n\n`);
    md.appendMarkdown(`**Path:** \`${route.path}\`\n\n`);
    md.appendMarkdown(`**Status:** ${route.response.statusCode}\n\n`);
    md.appendMarkdown(`**Type:** ${route.response.type}\n\n`);
    md.appendMarkdown(`**Enabled:** ${route.enabled ? 'Yes' : 'No'}\n\n`);

    if (route.delay) {
      if (route.delay.type === 'fixed') {
        md.appendMarkdown(`**Delay:** ${route.delay.value}ms\n\n`);
      } else {
        md.appendMarkdown(`**Delay:** ${route.delay.min}-${route.delay.max}ms\n\n`);
      }
    }

    return md;
  }

  private formatMethods(method: HttpMethod | HttpMethod[]): string {
    if (Array.isArray(method)) {
      return method.join(', ');
    }
    return method;
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}

/**
 * Tree view provider for request logs
 */
export class RequestLogsTreeViewProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private manager: MockServerManager) {
    // Subscribe to request events
    manager.onEvent((event) => {
      if (event.type === 'request:received') {
        this.refresh();
      }
    });
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    const entries = this.manager.getLogEntries(undefined, 50);

    return entries.map((entry) => {
      const statusIcon = this.getStatusIcon(entry.response.statusCode);
      const item = new vscode.TreeItem(
        `${entry.request.method} ${entry.request.path}`,
        vscode.TreeItemCollapsibleState.None
      );

      item.description = `${entry.response.statusCode} - ${entry.response.duration}ms`;
      item.iconPath = new vscode.ThemeIcon(
        statusIcon.icon,
        new vscode.ThemeColor(statusIcon.color)
      );

      const tooltip = new vscode.MarkdownString();
      tooltip.appendMarkdown(`### Request\n`);
      tooltip.appendMarkdown(`**Time:** ${entry.timestamp.toLocaleTimeString()}\n\n`);
      tooltip.appendMarkdown(`**Method:** ${entry.request.method}\n\n`);
      tooltip.appendMarkdown(`**Path:** \`${entry.request.path}\`\n\n`);
      tooltip.appendMarkdown(`**Matched:** ${entry.matched ? 'Yes' : 'No'}\n\n`);
      tooltip.appendMarkdown(`### Response\n`);
      tooltip.appendMarkdown(`**Status:** ${entry.response.statusCode}\n\n`);
      tooltip.appendMarkdown(`**Duration:** ${entry.response.duration}ms\n\n`);
      item.tooltip = tooltip;

      return item;
    });
  }

  private getStatusIcon(status: number): { icon: string; color: string } {
    if (status >= 200 && status < 300) {
      return { icon: 'check', color: 'testing.iconPassed' };
    } else if (status >= 300 && status < 400) {
      return { icon: 'arrow-right', color: 'debugIcon.pauseForeground' };
    } else if (status >= 400 && status < 500) {
      return { icon: 'warning', color: 'list.warningForeground' };
    } else if (status >= 500) {
      return { icon: 'error', color: 'testing.iconFailed' };
    }
    return { icon: 'circle-outline', color: 'foreground' };
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
