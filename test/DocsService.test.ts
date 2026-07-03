import { describe, it, expect } from 'vitest';
import { DocsService } from '../src/services/DocsService';
import { MockServerConfig } from '../src/types/core';

const service = new DocsService();

const server: MockServerConfig = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Orders API',
  port: 4000,
  protocol: 'http',
  enabled: true,
  routes: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Get order',
      enabled: true,
      method: 'GET',
      path: '/api/orders/:orderId',
      matcher: { headers: { 'x-api-key': 'secret' }, queryParams: { expand: 'items' } },
      response: {
        type: 'static',
        statusCode: 200,
        body: { contentType: 'application/json', content: { id: 'ord_1', total: 99.5 } },
      },
      tags: ['orders'],
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Create order',
      enabled: true,
      method: 'POST',
      path: '/api/orders',
      response: {
        type: 'dynamic',
        statusCode: 201,
        template: { engine: 'handlebars', template: '{ "id": "{{uuid}}" }' },
      },
      tags: ['orders'],
    },
    {
      id: '44444444-4444-4444-8444-444444444444',
      name: 'Hidden',
      enabled: false,
      method: 'DELETE',
      path: '/api/orders/:orderId',
      response: { type: 'static', statusCode: 204 },
    },
  ],
};

describe('DocsService', () => {
  const markdown = service.generateMarkdown(server);

  it('includes title, base URL, and endpoint count', () => {
    expect(markdown).toContain('# Orders API — API Documentation');
    expect(markdown).toContain('http://localhost:4000');
    expect(markdown).toContain('**Endpoints:** 2');
  });

  it('renders an endpoint summary table', () => {
    expect(markdown).toContain('| `GET` | `/api/orders/:orderId` | Get order | 200 |');
    expect(markdown).toContain('| `POST` | `/api/orders` | Create order | 201 |');
  });

  it('omits disabled routes', () => {
    expect(markdown).not.toContain('Hidden');
    expect(markdown).not.toContain('DELETE');
  });

  it('documents path parameters, query parameters, and headers', () => {
    expect(markdown).toContain('- `orderId` (string, required)');
    expect(markdown).toContain('- `expand` — matched value: `items`');
    expect(markdown).toContain('- `x-api-key: secret`');
  });

  it('includes example response bodies and templates', () => {
    expect(markdown).toContain('"id": "ord_1"');
    expect(markdown).toContain('```handlebars');
    expect(markdown).toContain('{{uuid}}');
  });

  it('includes curl examples with the server port', () => {
    expect(markdown).toContain("curl \\\n  'http://localhost:4000/api/orders/{orderId}'");
    expect(markdown).toContain('-X POST');
  });

  it('handles servers with no routes', () => {
    const empty = service.generateMarkdown({ ...server, routes: [] });
    expect(empty).toContain('no enabled routes');
  });
});
