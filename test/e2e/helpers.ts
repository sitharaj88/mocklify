// Shared helpers for the Mocklify E2E suites. Compiled by tsconfig.e2e into
// out-test/e2e/helpers.js and imported by the *.test.ts files. Everything here
// is vscode-free (or type-only) so it runs in the extension host and stays
// deterministic and offline.
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { extractJson } from '../../src/ai/extractJson.js';
import type { AiService } from '../../src/ai/AiService.js';
import type { AiProvider } from '../../src/ai/providers/types.js';
import type { MockServerConfig, RouteConfig } from '../../src/types/core.js';
import { FakeAiProvider } from '../../src/testing/FakeAiProvider.js';

/** Reserve a free TCP port (bind to 0, read the assigned port, release). */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const { port } = addr;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('Could not determine a free port')));
      }
    });
  });
}

/** A minimal static JSON route. */
export function staticRoute(partial: Partial<RouteConfig> & Pick<RouteConfig, 'method' | 'path'>): RouteConfig {
  return {
    id: randomUUID(),
    name: partial.name ?? `${String(partial.method)} ${partial.path}`,
    enabled: true,
    response: {
      type: 'static',
      statusCode: 200,
      body: { contentType: 'application/json', content: { ok: true } },
    },
    ...partial,
  } as RouteConfig;
}

/** Build a valid MockServerConfig with the given routes on the given port. */
export function serverConfig(port: number, routes: RouteConfig[], name = 'E2E Server'): MockServerConfig {
  return {
    id: randomUUID(),
    name,
    port,
    protocol: 'http',
    enabled: true,
    routes,
  };
}

/**
 * A structurally-compatible AiService that routes every request through a
 * FakeAiProvider, mirroring how the real AiService drives a provider
 * (streamRequest → extractJson). Cast to AiService for the scan collaborators;
 * only the members the scan actually touches are implemented.
 */
export function fakeAiService(fake: FakeAiProvider): AiService {
  async function drain(prompt: string): Promise<string> {
    let text = '';
    for await (const chunk of fake.streamRequest(prompt)) {
      text += chunk;
    }
    return text;
  }
  const stub = {
    resolveProvider: async (): Promise<AiProvider> => fake,
    getActiveProviderLabel: async (): Promise<string> => fake.label,
    isAvailable: async (): Promise<boolean> => fake.isAvailable(),
    sendRequest: (prompt: string): Promise<string> => drain(prompt),
    async sendJsonRequest<T = unknown>(prompt: string): Promise<T> {
      return extractJson<T>(await drain(prompt));
    },
    async *streamRequest(prompt: string): AsyncGenerator<string, void, undefined> {
      yield* fake.streamRequest(prompt);
    },
  };
  return stub as unknown as AiService;
}

/** Scripted response the fast scan accepts: two GET routes on /api/users. */
export const SCAN_ROUTES_RESPONSE = JSON.stringify({
  routes: [
    {
      name: 'List users',
      method: 'GET',
      path: '/api/users',
      response: {
        type: 'static',
        statusCode: 200,
        body: { contentType: 'application/json', content: [{ id: 1, name: 'Ada' }] },
      },
    },
    {
      name: 'Get user',
      method: 'GET',
      path: '/api/users/:id',
      response: {
        type: 'static',
        statusCode: 200,
        body: { contentType: 'application/json', content: { id: 1, name: 'Ada' } },
      },
    },
  ],
});
