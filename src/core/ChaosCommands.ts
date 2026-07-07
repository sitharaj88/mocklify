import * as vscode from 'vscode';
import { MockServerManager } from './MockServerManager.js';
import { ChaosConfig, MockServerConfig } from '../types/core.js';

const DEFAULT_FAILURE_STATUS = 503;

type Preset =
  | { kind: 'off' }
  | { kind: 'config'; chaos: ChaosConfig }
  | { kind: 'custom' };

function describeChaos(chaos: ChaosConfig): string {
  const parts: string[] = [];
  const rate = chaos.failureRate ?? 0;
  if (rate > 0) {
    const status = chaos.failureStatus ?? DEFAULT_FAILURE_STATUS;
    parts.push(
      `${Math.round(rate * 100)}% failures${status === DEFAULT_FAILURE_STATUS ? '' : ` (status ${status})`}`
    );
  }
  if (chaos.minDelayMs !== undefined || chaos.maxDelayMs !== undefined) {
    const lo = chaos.minDelayMs ?? 0;
    const hi = Math.max(lo, chaos.maxDelayMs ?? lo);
    parts.push(`${lo}-${hi}ms jitter`);
  }
  return parts.length > 0 ? parts.join(', ') : 'no failures or jitter configured';
}

function positiveIntValidator(label: string, min: number, max: number): (v: string) => string | undefined {
  return (value) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) {
      return `${label} must be an integer between ${min} and ${max}`;
    }
    return undefined;
  };
}

async function promptCustomChaos(): Promise<ChaosConfig | undefined> {
  const ratePercent = await vscode.window.showInputBox({
    prompt: 'Failure rate as a percentage of requests (0-100)',
    value: '10',
    validateInput: positiveIntValidator('Failure rate', 0, 100),
  });
  if (ratePercent === undefined) return undefined;

  const status = await vscode.window.showInputBox({
    prompt: 'HTTP status code for simulated failures',
    value: String(DEFAULT_FAILURE_STATUS),
    validateInput: positiveIntValidator('Status code', 100, 599),
  });
  if (status === undefined) return undefined;

  const minDelay = await vscode.window.showInputBox({
    prompt: 'Minimum extra delay in ms (0 for none)',
    value: '0',
    validateInput: positiveIntValidator('Minimum delay', 0, 600000),
  });
  if (minDelay === undefined) return undefined;

  const maxDelay = await vscode.window.showInputBox({
    prompt: 'Maximum extra delay in ms (must be >= minimum)',
    value: minDelay,
    validateInput: (value) => {
      const base = positiveIntValidator('Maximum delay', 0, 600000)(value);
      if (base) return base;
      if (Number(value) < Number(minDelay)) {
        return `Maximum delay must be >= minimum delay (${minDelay}ms)`;
      }
      return undefined;
    },
  });
  if (maxDelay === undefined) return undefined;

  const chaos: ChaosConfig = {
    enabled: true,
    failureRate: Number(ratePercent) / 100,
    failureStatus: Number(status),
  };
  if (Number(maxDelay) > 0) {
    chaos.minDelayMs = Number(minDelay);
    chaos.maxDelayMs = Number(maxDelay);
  }
  return chaos;
}

export function registerChaosCommands(
  context: vscode.ExtensionContext,
  manager: MockServerManager
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'mocklify.configureChaos',
      async (item?: { serverId?: string }) => {
        const server = await pickServer(manager, item, 'Select a server to configure chaos on');
        if (!server) {
          return;
        }

        // Chaos is only consulted by HttpMockServer.handleRequest; on other
        // protocols the config would persist but silently never apply.
        if ((server.protocol ?? 'http') !== 'http') {
          vscode.window.showWarningMessage(
            `Mocklify: Chaos simulation is only supported on HTTP servers — "${server.name}" is a ${server.protocol} server.`
          );
          return;
        }

        const items: (vscode.QuickPickItem & { preset: Preset })[] = [
          {
            label: '$(circle-slash) Off',
            description: 'Disable chaos simulation',
            preset: { kind: 'off' },
          },
          {
            label: '$(warning) Flaky',
            description: '10% of requests fail with 503',
            preset: {
              kind: 'config',
              chaos: { enabled: true, failureRate: 0.1, failureStatus: DEFAULT_FAILURE_STATUS },
            },
          },
          {
            label: '$(flame) Unstable',
            description: '30% failures + 500-2000ms jitter',
            preset: {
              kind: 'config',
              chaos: {
                enabled: true,
                failureRate: 0.3,
                failureStatus: DEFAULT_FAILURE_STATUS,
                minDelayMs: 500,
                maxDelayMs: 2000,
              },
            },
          },
          {
            label: '$(gear) Custom…',
            description: 'Set failure rate, status and jitter manually',
            preset: { kind: 'custom' },
          },
        ];

        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: `Chaos for "${server.name}"${server.chaos?.enabled ? ` (currently ON: ${describeChaos(server.chaos)})` : ''}`,
        });
        if (!picked) {
          return;
        }

        let chaos: ChaosConfig | undefined;
        if (picked.preset.kind === 'off') {
          // Keep prior numbers around (disabled) so re-enabling is one toggle away
          chaos = server.chaos ? { ...server.chaos, enabled: false } : undefined;
        } else if (picked.preset.kind === 'config') {
          chaos = picked.preset.chaos;
        } else {
          chaos = await promptCustomChaos();
          if (!chaos) {
            return;
          }
        }

        try {
          await manager.setServerChaos(server.id, chaos);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(`Mocklify: Failed to configure chaos (${detail}).`);
          return;
        }

        if (chaos?.enabled) {
          // Warning (non-blocking): chaos is server-wide, not per-route
          vscode.window.showWarningMessage(
            `Mocklify: Chaos ON for "${server.name}": ${describeChaos(chaos)} — affects ALL routes on this server.`
          );
        } else {
          vscode.window.showInformationMessage(`Mocklify: Chaos OFF for "${server.name}".`);
        }
      }
    )
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
      description: `port ${s.port} · ${s.routes.length} routes${s.chaos?.enabled ? ' · chaos ON' : ''}`,
      server: s,
    })),
    { placeHolder }
  );
  return picked?.server;
}
