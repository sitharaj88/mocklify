import * as vscode from 'vscode';
import { MockServerManager } from '../core/MockServerManager.js';

export class StatusBarController {
  private statusBarItem: vscode.StatusBarItem;
  private manager: MockServerManager;

  constructor(manager: MockServerManager) {
    this.manager = manager;

    // Create status bar item
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.statusBarItem.command = 'mocklify.showQuickPick';

    // Update on server changes
    manager.onDidChangeServers(() => this.update());

    // Subscribe to events
    manager.onEvent((event) => {
      if (
        event.type === 'server:started' ||
        event.type === 'server:stopped' ||
        event.type === 'server:error' ||
        event.type === 'request:received'
      ) {
        this.update();
      }
    });

    // Initial update
    this.update();
  }

  private update(): void {
    const states = this.manager.getAllServerStates();
    const runningCount = Array.from(states.values()).filter(
      (s) => s.status === 'running'
    ).length;
    const totalRequests = Array.from(states.values()).reduce(
      (sum, s) => sum + s.requestCount,
      0
    );

    if (runningCount > 0) {
      this.statusBarItem.text = `$(ghost) Mocklify: ${runningCount} server${runningCount !== 1 ? 's' : ''} (${totalRequests} req)`;
      this.statusBarItem.backgroundColor = undefined;
      this.statusBarItem.tooltip = this.buildTooltip(states);
    } else if (states.size > 0) {
      this.statusBarItem.text = `$(ghost) Mocklify: ${states.size} server${states.size !== 1 ? 's' : ''}`;
      this.statusBarItem.tooltip = 'Click to manage Mocklify servers';
    } else {
      this.statusBarItem.text = `$(ghost) Mocklify`;
      this.statusBarItem.tooltip = 'Click to create a Mocklify server';
    }

    this.statusBarItem.show();
  }

  private buildTooltip(states: Map<string, { status: string; port: number; requestCount: number }>): string {
    const lines: string[] = ['Mocklify Servers', ''];

    for (const [id, state] of states) {
      const statusIcon = state.status === 'running' ? '●' : '○';
      lines.push(`${statusIcon} :${state.port} - ${state.status} (${state.requestCount} requests)`);
    }

    lines.push('', 'Click to manage servers');
    return lines.join('\n');
  }

  show(): void {
    this.statusBarItem.show();
  }

  hide(): void {
    this.statusBarItem.hide();
  }

  dispose(): void {
    this.statusBarItem.dispose();
  }
}
