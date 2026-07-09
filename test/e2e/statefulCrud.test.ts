import * as assert from 'node:assert';
import { HttpMockServer } from '../../src/servers/HttpMockServer.js';
import { findFreePort, serverConfig, staticRoute } from './helpers.js';

// Drives the stateful CRUD engine over real HTTP: POST creates, GET reflects,
// DELETE returns 204, and a missing id returns 404 — all in one live server run.
suite('Stateful CRUD', () => {
  let server: HttpMockServer | undefined;
  let base = '';

  setup(async () => {
    const port = await findFreePort();
    base = `http://127.0.0.1:${port}`;
    server = new HttpMockServer(
      serverConfig(port, [
        staticRoute({
          name: 'Users collection',
          method: ['GET', 'POST'],
          path: '/users',
          stateful: { collection: 'users' },
          response: {
            type: 'static',
            statusCode: 200,
            body: { contentType: 'application/json', content: [] },
          },
        }),
        staticRoute({
          name: 'User item',
          method: ['GET', 'PUT', 'DELETE'],
          path: '/users/:id',
          stateful: { collection: 'users', idParam: 'id' },
          response: {
            type: 'static',
            statusCode: 200,
            body: { contentType: 'application/json', content: {} },
          },
        }),
      ])
    );
    await server.start();
  });

  teardown(async () => {
    if (server) {
      await server.stop().catch(() => undefined);
      server = undefined;
    }
  });

  test('POST creates, GET reflects, DELETE 204, missing id 404', async () => {
    // POST creates (stateful insert → 201) and assigns an id.
    const created = await fetch(`${base}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Grace' }),
    });
    assert.strictEqual(created.status, 201);
    const createdBody = (await created.json()) as { id: string; name: string };
    assert.strictEqual(createdBody.name, 'Grace');
    assert.ok(createdBody.id, 'created item should have an id');

    // GET reflects the new item.
    const got = await fetch(`${base}/users/${createdBody.id}`);
    assert.strictEqual(got.status, 200);
    const gotBody = (await got.json()) as { id: string; name: string };
    assert.strictEqual(gotBody.name, 'Grace');

    // The collection now lists exactly one item.
    const list = await fetch(`${base}/users`);
    assert.strictEqual(list.status, 200);
    const listBody = (await list.json()) as unknown[];
    assert.strictEqual(listBody.length, 1);

    // DELETE returns 204.
    const deleted = await fetch(`${base}/users/${createdBody.id}`, { method: 'DELETE' });
    assert.strictEqual(deleted.status, 204);

    // The item is gone → 404.
    const gone = await fetch(`${base}/users/${createdBody.id}`);
    assert.strictEqual(gone.status, 404);

    // An unknown id also 404s.
    const missing = await fetch(`${base}/users/does-not-exist`);
    assert.strictEqual(missing.status, 404);
  });
});
