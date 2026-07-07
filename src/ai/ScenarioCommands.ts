import * as vscode from 'vscode';
import { MockServerManager } from '../core/MockServerManager.js';
import { MockServerConfig, RouteConfig } from '../types/core.js';

const NEGATIVE_TAG = 'negative';

const STATUS_HINTS: Record<string, string> = {
  '400': 'bad request',
  '401': 'unauthorized',
  '403': 'forbidden',
  '404': 'not found',
  '408': 'timeouts',
  '409': 'conflicts',
  '422': 'validation errors',
  '429': 'rate limiting',
};

export type Scenario = { kind: 'happy-path' } | { kind: 'failure'; status: string };

export interface ScenarioPlan {
  changes: { routeId: string; enabled: boolean }[];
  /** Distinct "METHOD path" endpoints that will serve the failure (empty for happy path). */
  failingEndpoints: string[];
}

/** Non-status scenario tags the generators emit alongside "negative". */
const SCENARIO_TAG_LABELS: Record<string, string> = {
  timeout: 'slow responses',
  graphql: 'GraphQL errors',
};

function isNegative(route: RouteConfig): boolean {
  return route.tags?.includes(NEGATIVE_TAG) ?? false;
}

/**
 * Scenario key for a negative route: a named scenario tag ("timeout",
 * "graphql") wins over the generator's ["negative", "<status>"] tag pair;
 * fall back to the response code.
 */
function negativeStatus(route: RouteConfig): string {
  const named = route.tags?.find((tag) => tag in SCENARIO_TAG_LABELS);
  if (named) {
    return named;
  }
  return route.tags?.find((tag) => /^[1-5]\d{2}$/.test(tag)) ?? String(route.response.statusCode);
}

function endpointKeys(route: RouteConfig): string[] {
  const methods = Array.isArray(route.method) ? route.method : [route.method];
  return methods.map((method) => `${method} ${route.path}`);
}

function statusLabel(status: string): string {
  return STATUS_HINTS[status] ?? (status.startsWith('5') ? 'errors' : 'failures');
}

/** Human-readable scenario name: "slow responses", "404 not found", "500 errors". */
export function scenarioDescription(key: string): string {
  return SCENARIO_TAG_LABELS[key] ?? `${key} ${statusLabel(key)}`;
}

export function distinctNegativeStatuses(routes: RouteConfig[]): string[] {
  const statuses = new Set(routes.filter(isNegative).map(negativeStatus));
  return [...statuses].sort();
}

/**
 * Both scenarios start from the happy-path baseline (success routes on, failure
 * routes off) so switching between failure scenarios never stacks; a failure
 * scenario then turns on its negatives and turns off the success routes for
 * the same method+path so the failure wins the match.
 */
export function planScenario(routes: RouteConfig[], scenario: Scenario): ScenarioPlan {
  const desired = new Map<string, boolean>();
  for (const route of routes) {
    desired.set(route.id, !isNegative(route));
  }

  const failingKeys = new Set<string>();
  if (scenario.kind === 'failure') {
    const targets = routes.filter(
      (route) => isNegative(route) && negativeStatus(route) === scenario.status
    );
    for (const target of targets) {
      desired.set(target.id, true);
      for (const key of endpointKeys(target)) {
        failingKeys.add(key);
      }
    }
    for (const route of routes) {
      if (!isNegative(route) && endpointKeys(route).some((key) => failingKeys.has(key))) {
        desired.set(route.id, false);
      }
    }
  }

  const changes = routes
    .filter((route) => desired.get(route.id) !== route.enabled)
    .map((route) => ({ routeId: route.id, enabled: desired.get(route.id) as boolean }));

  return { changes, failingEndpoints: [...failingKeys].sort() };
}

export function registerScenarioCommands(
  context: vscode.ExtensionContext,
  manager: MockServerManager
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'mocklify.simulateScenario',
      async (item?: { serverId?: string }) => {
        const server = await pickServer(manager, item, 'Select a server to switch scenarios');
        if (!server) {
          return;
        }

        const statuses = distinctNegativeStatuses(server.routes);
        if (statuses.length === 0) {
          const action = await vscode.window.showInformationMessage(
            `Mocklify: Server "${server.name}" has no failure routes (tagged "negative"). ` +
              'Generate them with the codebase or traffic mock generators.',
            'Generate from Codebase'
          );
          if (action === 'Generate from Codebase') {
            await vscode.commands.executeCommand('mocklify.aiGenerateFromCodebase');
          }
          return;
        }

        const negativeRoutes = server.routes.filter(isNegative);
        const items: (vscode.QuickPickItem & { scenario: Scenario })[] = [
          {
            label: '$(check) Happy path',
            description: 'Disable all failure routes and enable success routes',
            scenario: { kind: 'happy-path' },
          },
          ...statuses.map((status) => {
            const count = negativeRoutes.filter((r) => negativeStatus(r) === status).length;
            return {
              label: `$(warning) Simulate ${scenarioDescription(status)}`,
              description: `${count} failure route${count === 1 ? '' : 's'}`,
              scenario: { kind: 'failure', status } as Scenario,
            };
          }),
        ];

        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: `Pick a scenario for "${server.name}"`,
        });
        if (!picked) {
          return;
        }

        const plan = planScenario(server.routes, picked.scenario);
        try {
          for (const change of plan.changes) {
            await manager.updateRoute(server.id, change.routeId, { enabled: change.enabled });
          }
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(
            `Mocklify: Scenario switch failed part-way (${detail}). ` +
              'Run "Simulate Scenario" again and pick "Happy path" to restore a consistent state.'
          );
          return;
        }

        if (picked.scenario.kind === 'failure') {
          const n = plan.failingEndpoints.length;
          vscode.window.showInformationMessage(
            `Mocklify: Simulating ${scenarioDescription(picked.scenario.status)} on ${n} endpoint${n === 1 ? '' : 's'} — run Happy path to restore.`
          );
        } else if (plan.changes.length === 0) {
          vscode.window.showInformationMessage(
            `Mocklify: "${server.name}" is already on the happy path.`
          );
        } else {
          vscode.window.showInformationMessage(
            `Mocklify: Restored happy path on "${server.name}" (${plan.changes.length} route${plan.changes.length === 1 ? '' : 's'} updated).`
          );
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
      description: `port ${s.port} · ${s.routes.length} routes`,
      server: s,
    })),
    { placeHolder }
  );
  return picked?.server;
}
