import * as assert from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenApiExportService } from '../../src/services/OpenApiExportService.js';
import { buildPostmanCollection } from '../../src/services/CollectionExportService.js';
import { serverConfig, staticRoute } from './helpers.js';

// Mirrors the mocklify.exportServerAs command's openapi-json and postman
// branches: produce the content, write it to a temp file, and assert both
// parse as JSON. Temp dir is cleaned up after the suite.
suite('Export', () => {
  let dir = '';

  setup(() => {
    dir = mkdtempSync(join(tmpdir(), 'mocklify-e2e-'));
  });

  teardown(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = '';
    }
  });

  test('exports OpenAPI JSON and Postman to files that parse', () => {
    const server = serverConfig(
      3000,
      [
        staticRoute({
          name: 'List widgets',
          method: 'GET',
          path: '/api/widgets',
          tags: ['widgets'],
          response: {
            type: 'static',
            statusCode: 200,
            body: { contentType: 'application/json', content: [{ id: 1, name: 'Widget' }] },
          },
        }),
        staticRoute({
          name: 'Create widget',
          method: 'POST',
          path: '/api/widgets',
          tags: ['widgets'],
          response: {
            type: 'static',
            statusCode: 201,
            body: { contentType: 'application/json', content: { id: 2, name: 'New' } },
          },
        }),
      ],
      'Widgets API'
    );

    // openapi-json
    const openApiJson = new OpenApiExportService().exportToJson(server);
    const openApiPath = join(dir, 'openapi.json');
    writeFileSync(openApiPath, openApiJson, 'utf-8');
    const openApi = JSON.parse(readFileSync(openApiPath, 'utf-8')) as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    assert.ok(openApi.openapi.startsWith('3.'), 'should be an OpenAPI 3.x doc');
    assert.ok(openApi.paths['/api/widgets'], 'the path should be present in the spec');

    // postman
    const postmanJson = JSON.stringify(
      buildPostmanCollection(server, { version: '0.0.0-e2e' }),
      null,
      2
    );
    const postmanPath = join(dir, 'postman.json');
    writeFileSync(postmanPath, postmanJson, 'utf-8');
    const postman = JSON.parse(readFileSync(postmanPath, 'utf-8')) as {
      info: { schema: string };
      item: unknown[];
    };
    assert.ok(
      postman.info.schema.includes('v2.1.0'),
      'should be a Postman Collection v2.1 document'
    );
    assert.ok(Array.isArray(postman.item) && postman.item.length > 0, 'collection should have items');
  });
});
