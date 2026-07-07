import { describe, it, expect } from 'vitest';
import {
  buildApiDocsHtml,
  buildConfluenceStorageXhtml,
  buildRouteCurl,
  formatBody,
  MAX_BODY_CHARS,
} from '../src/services/DocsExportService';
import { MockServerConfig, RouteConfig } from '../src/types/core';

function makeRoute(overrides: Partial<RouteConfig>): RouteConfig {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'List users',
    enabled: true,
    method: 'GET',
    path: '/api/users',
    response: {
      type: 'static',
      statusCode: 200,
      body: {
        contentType: 'application/json',
        content: [{ id: 1, name: 'Ada Lovelace' }],
      },
    },
    ...overrides,
  };
}

function makeServer(overrides?: Partial<MockServerConfig>): MockServerConfig {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Users API',
    port: 3100,
    protocol: 'http',
    enabled: true,
    routes: [
      makeRoute({ tags: ['users'] }),
      makeRoute({
        id: '33333333-3333-4333-8333-333333333333',
        name: 'Create user',
        method: 'POST',
        path: '/api/users',
        tags: ['users'],
        matcher: {
          headers: { 'X-Api-Key': 'secret' },
          body: { type: 'exact', value: '{"name":"Ada"}' },
        },
        response: {
          type: 'static',
          statusCode: 201,
          headers: { Location: '/api/users/2' },
          body: { contentType: 'application/json', content: { id: 2, name: 'Ada' } },
        },
      }),
      makeRoute({
        id: '44444444-4444-4444-8444-444444444444',
        name: 'Get user',
        path: '/api/users/:id',
        matcher: { queryParams: { expand: 'profile' } },
      }),
      makeRoute({
        id: '55555555-5555-4555-8555-555555555555',
        name: 'Server error',
        enabled: false,
        path: '/api/users',
        response: {
          type: 'static',
          statusCode: 500,
          body: { contentType: 'application/json', content: { error: 'boom' } },
        },
      }),
    ],
    ...overrides,
  };
}

/** Tiny XML well-formedness check: balanced tags, terminated CDATA, valid entities. */
function checkWellFormedXml(fragment: string): void {
  const src = `<root>${fragment}</root>`;
  const stack: string[] = [];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      break;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt);
      expect(end, 'unterminated CDATA section').toBeGreaterThan(-1);
      i = end + 3;
      continue;
    }
    const gt = src.indexOf('>', lt);
    expect(gt, `unterminated tag at index ${lt}`).toBeGreaterThan(-1);
    const raw = src.slice(lt + 1, gt);
    if (raw.startsWith('/')) {
      expect(stack.pop(), `unexpected closing tag </${raw.slice(1)}>`).toBe(raw.slice(1).trim());
    } else if (!raw.endsWith('/')) {
      const name = raw.split(/\s/)[0];
      expect(name).toMatch(/^[A-Za-z_][\w.:-]*$/);
      stack.push(name);
    }
    i = gt + 1;
  }
  expect(stack, 'unclosed tags remain').toEqual([]);
  const outsideCdata = src.replace(/<!\[CDATA\[[\s\S]*?]]>/g, '');
  expect(outsideCdata).not.toMatch(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/);
}

describe('buildApiDocsHtml', () => {
  it('is fully self-contained (no external src/href, styles, or imports)', () => {
    const html = buildApiDocsHtml(makeServer(), {
      version: '1.2.3',
      markdown: '# Overview\n\nSee [the repo](https://github.com/sitharaj88/mocklify) for details.',
    });
    const urls = [...html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      if (/^https?:/i.test(url)) {
        expect(url).toMatch(/^https?:\/\/localhost/);
      }
    }
    expect(html).not.toMatch(/<link\s/i);
    expect(html).not.toMatch(/@import/i);
    expect(html).not.toMatch(/url\(\s*["']?https?:/i);
    expect(html).not.toMatch(/<script\s+[^>]*src/i);
  });

  it('escapes route-provided HTML so injected markup stays inert', () => {
    const server = makeServer({
      routes: [
        makeRoute({
          name: '<img src=x onerror=alert(1)>',
          path: '/api/<script>alert(2)</script>',
          tags: ['<b>bad</b>'],
        }),
      ],
    });
    const html = buildApiDocsHtml(server);
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>alert(2)');
    expect(html).not.toContain('<b>bad</b>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('renders header, tag-grouped TOC, badges, and version footer', () => {
    const html = buildApiDocsHtml(makeServer(), { version: '9.9.9' });
    expect(html).toContain('Users API');
    expect(html).toContain('http://localhost:3100');
    expect(html).toContain('3 endpoints');
    expect(html).toContain('class="toc-tag">users<');
    expect(html).toContain('class="toc-tag">General<');
    expect(html).toContain('class="badge m-get"');
    expect(html).toContain('class="badge m-post"');
    expect(html).toContain('Generated by Mocklify v9.9.9');
    expect(html).toContain('id="filter"');
    expect(html).toContain('id="theme-toggle"');
    expect(html).toContain('prefers-color-scheme');
  });

  it('renders matcher summary, response details, and a curl example per endpoint', () => {
    const html = buildApiDocsHtml(makeServer());
    expect(html).toContain('Header X-Api-Key: secret');
    expect(html).toContain('Body exact: {&quot;name&quot;:&quot;Ada&quot;}');
    expect(html).toContain('Query expand = profile');
    expect(html).toContain('<code>Location</code>: /api/users/2');
    const curlCount = html.split('curl \\').length - 1;
    expect(curlCount).toBeGreaterThanOrEqual(2);
    expect(html).toContain('-X POST');
  });

  it('renders disabled routes in a collapsed failure-scenarios section', () => {
    const html = buildApiDocsHtml(makeServer());
    expect(html).toContain('<details class="failures"><summary>Failure scenarios (1)</summary>');
    expect(html).toContain('Server error');
  });

  it('collects disabled routes without a matching endpoint into a page-level section', () => {
    const server = makeServer({
      routes: [
        makeRoute({}),
        makeRoute({
          id: '66666666-6666-4666-8666-666666666666',
          name: 'Orphan failure',
          enabled: false,
          method: 'HEAD',
          path: '/api/orphan',
          response: { type: 'static', statusCode: 503 },
        }),
      ],
    });
    const html = buildApiDocsHtml(server);
    expect(html).toContain('Other failure scenarios (1)');
    expect(html).toContain('Orphan failure');
    expect(html).toContain('class="badge m-other"');
  });

  it('caps oversized bodies and notes the truncation', () => {
    const server = makeServer({
      routes: [
        makeRoute({
          response: {
            type: 'static',
            statusCode: 200,
            body: { contentType: 'application/json', content: { data: 'x'.repeat(30_000) } },
          },
        }),
      ],
    });
    const html = buildApiDocsHtml(server);
    expect(html).toMatch(new RegExp(`showing first ${MAX_BODY_CHARS} of \\d+ characters`));
  });

  it('renders provided markdown prose with escaped content and no external links', () => {
    const html = buildApiDocsHtml(makeServer(), {
      markdown:
        '# Overview\n\nHello **world** with `code` and [a link](https://example.com/docs).\n\n- item one\n\n```json\n{"a":1}\n```',
    });
    expect(html).toContain('<h2>Overview</h2>');
    expect(html).toContain('<strong>world</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<li>item one</li>');
    expect(html).toContain('a link');
    expect(html).not.toContain('href="https://example.com');
  });
});

describe('buildRouteCurl', () => {
  it('builds a GET with query parameters and no -X flag', () => {
    const route = makeRoute({ matcher: { queryParams: { page: '1', q: 'a b' } } });
    const curl = buildRouteCurl(route, 3100);
    expect(curl).not.toContain('-X');
    expect(curl).toContain("'http://localhost:3100/api/users?page=1&q=a%20b'");
  });

  it('builds a POST with headers, JSON content type, and body', () => {
    const route = makeRoute({
      method: 'POST',
      matcher: {
        headers: { 'X-Api-Key': 'secret' },
        body: { type: 'exact', value: '{"name":"Ada"}' },
      },
    });
    const curl = buildRouteCurl(route, 3100);
    expect(curl).toContain('-X POST');
    expect(curl).toContain("-H 'X-Api-Key: secret'");
    expect(curl).toContain("-H 'Content-Type: application/json'");
    expect(curl).toContain('-d \'{"name":"Ada"}\'');
    expect(curl).toContain("'http://localhost:3100/api/users'");
    expect(curl.split(' \\\n  ').length).toBeGreaterThan(1);
  });

  it('uses the first method for multi-method routes and escapes quotes in bodies', () => {
    const route = makeRoute({
      method: ['PUT', 'PATCH'],
      matcher: { body: { type: 'exact', value: "it's" } },
    });
    const curl = buildRouteCurl(route, 3000);
    expect(curl).toContain('-X PUT');
    expect(curl).toContain("-d 'it'\\''s'");
  });

  it('uses POSIX-safe quoting for apostrophes in bodies, headers, and the URL', () => {
    const route = makeRoute({
      method: 'POST',
      path: "/api/o'brien",
      matcher: {
        headers: { 'X-Note': "it's fine" },
        body: { type: 'exact', value: '{"name":"O\'Brien"}' },
      },
    });
    const curl = buildRouteCurl(route, 3000);
    expect(curl).toContain("-H 'X-Note: it'\\''s fine'");
    expect(curl).toContain('-d \'{"name":"O\'\\\'\'Brien"}\'');
    expect(curl).toContain("'http://localhost:3000/api/o'\\''brien'");
    expect(curl).not.toMatch(/\\'(?!')/);
  });
});

describe('formatBody', () => {
  it('pretty-prints JSON and reports truncation', () => {
    const small = formatBody({ a: 1 });
    expect(small?.text).toBe('{\n  "a": 1\n}');
    expect(small?.truncated).toBe(false);

    const big = formatBody('y'.repeat(MAX_BODY_CHARS + 5));
    expect(big?.truncated).toBe(true);
    expect(big?.text.length).toBe(MAX_BODY_CHARS);
    expect(big?.totalChars).toBe(MAX_BODY_CHARS + 5);

    expect(formatBody(undefined)).toBeUndefined();
    expect(formatBody(null)).toBeUndefined();
  });
});

describe('buildConfluenceStorageXhtml', () => {
  it('produces well-formed storage-format XML', () => {
    const xml = buildConfluenceStorageXhtml(makeServer(), {
      version: '1.2.3',
      markdown: '# Overview\n\nProse with **bold** text.\n\n| A | B |\n|---|---|\n| 1 | 2 |',
    });
    checkWellFormedXml(xml);
    expect(xml).toContain('<h1>Users API — API Documentation</h1>');
    expect(xml).toContain('Generated by Mocklify v1.2.3');
    expect(xml).toContain('<h2>Endpoint summary</h2>');
    expect(xml).toContain('<h2>users</h2>');
  });

  it('emits code macros with language parameter and CDATA bodies', () => {
    const xml = buildConfluenceStorageXhtml(makeServer());
    expect(xml).toContain('<ac:structured-macro ac:name="code">');
    expect(xml).toContain('<ac:parameter ac:name="language">json</ac:parameter>');
    expect(xml).toContain('<ac:parameter ac:name="language">bash</ac:parameter>');
    expect(xml).toContain('<ac:plain-text-body><![CDATA[');
    expect(xml).toContain('<ac:structured-macro ac:name="status">');
    expect(xml).toContain('<ac:parameter ac:name="colour">Green</ac:parameter>');
  });

  it("split-escapes ']]>' inside CDATA bodies", () => {
    const server = makeServer({
      routes: [
        makeRoute({
          response: {
            type: 'static',
            statusCode: 200,
            body: { contentType: 'application/json', content: { note: 'ends ]]> here' } },
          },
        }),
      ],
    });
    const xml = buildConfluenceStorageXhtml(server);
    expect(xml).toContain(']]]]><![CDATA[>');
    checkWellFormedXml(xml);
  });

  it('XML-escapes route-provided text', () => {
    const server = makeServer({
      routes: [makeRoute({ name: 'Cats & <Dogs>', path: '/api/pets?a=1&b=2' })],
    });
    const xml = buildConfluenceStorageXhtml(server);
    expect(xml).toContain('Cats &amp; &lt;Dogs&gt;');
    expect(xml).not.toContain('<Dogs>');
    checkWellFormedXml(xml);
  });

  it('renders failure scenarios inside a collapsed expand macro', () => {
    const xml = buildConfluenceStorageXhtml(makeServer());
    expect(xml).toContain('<ac:structured-macro ac:name="expand">');
    expect(xml).toContain('<ac:parameter ac:name="title">Failure scenarios (1)</ac:parameter>');
    expect(xml).toContain('Server error');
    checkWellFormedXml(xml);
  });

  it('notes truncation for oversized bodies', () => {
    const server = makeServer({
      routes: [
        makeRoute({
          response: {
            type: 'static',
            statusCode: 200,
            body: { contentType: 'application/json', content: { data: 'x'.repeat(30_000) } },
          },
        }),
      ],
    });
    const xml = buildConfluenceStorageXhtml(server);
    expect(xml).toMatch(new RegExp(`showing first ${MAX_BODY_CHARS} of \\d+ characters`));
    checkWellFormedXml(xml);
  });
});
