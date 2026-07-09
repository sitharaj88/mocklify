import * as assert from 'node:assert';
import { HttpMockServer } from '../../src/servers/HttpMockServer.js';
import { findFreePort, serverConfig, staticRoute } from './helpers.js';

// Exercises the real HTTP engine inside the extension host: start, serve a live
// request over the loopback interface, and stop. Offline — no AI, no network
// beyond localhost.
suite('Server lifecycle', () => {
  let server: HttpMockServer | undefined;

  teardown(async () => {
    if (server) {
      await server.stop().catch(() => undefined);
      server = undefined;
    }
  });

  test('starts, serves a real GET, and stops', async () => {
    const port = await findFreePort();
    server = new HttpMockServer(
      serverConfig(port, [
        staticRoute({
          method: 'GET',
          path: '/api/ping',
          response: {
            type: 'static',
            statusCode: 200,
            body: { contentType: 'application/json', content: { message: 'pong' } },
          },
        }),
      ])
    );

    await server.start();

    const res = await fetch(`http://127.0.0.1:${port}/api/ping`);
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { message: string };
    assert.strictEqual(body.message, 'pong');

    await server.stop();
    server = undefined;

    // After stop the port should no longer accept connections.
    await assert.rejects(fetch(`http://127.0.0.1:${port}/api/ping`));
  });

  test('unmatched route yields a 404', async () => {
    const port = await findFreePort();
    server = new HttpMockServer(
      serverConfig(port, [staticRoute({ method: 'GET', path: '/known' })])
    );
    await server.start();

    const res = await fetch(`http://127.0.0.1:${port}/does-not-exist`);
    assert.strictEqual(res.status, 404);
  });
});
