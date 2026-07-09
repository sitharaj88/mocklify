import { describe, it, expect } from 'vitest';
import { buildValidator, createRequestValidator } from '../src/services/ContractValidator';
import type { ValidatedRequest, ValidationResult } from '../src/services/ContractValidator';
import type { RouteConfig } from '../src/types/core';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A throwaway RouteConfig — the validator ignores it (matches on spec paths).
const ROUTE = { id: 'x', name: 'x', enabled: true, method: 'GET', path: '/x' } as unknown as RouteConfig;

function req(overrides: Partial<ValidatedRequest>): ValidatedRequest {
  return {
    method: 'GET',
    path: '/',
    params: {},
    query: {},
    headers: {},
    ...overrides,
  };
}

function violations(result: ValidationResult) {
  return result.ok ? [] : result.violations;
}

const spec = {
  openapi: '3.0.3',
  info: { title: 'Test', version: '1.0.0' },
  paths: {
    '/users/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
      get: {
        parameters: [
          { name: 'expand', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } },
        ],
        responses: { '200': { description: 'ok' } },
      },
    },
    '/users/me': {
      get: { responses: { '200': { description: 'ok' } } },
    },
    '/users': {
      post: {
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                additionalProperties: false,
                required: ['name', 'role'],
                properties: {
                  name: { type: 'string' },
                  age: { type: 'integer' },
                  role: { type: 'string', enum: ['admin', 'user'] },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'created' } },
      },
    },
  },
};

describe('ContractValidator — happy path', () => {
  it('accepts a valid request', () => {
    const v = buildValidator(spec);
    const r = v.validate(
      req({ method: 'GET', path: '/users/42', query: { expand: 'profile' } }),
      ROUTE
    );
    expect(r.ok).toBe(true);
  });

  it('accepts a valid POST body', () => {
    const v = buildValidator(spec);
    const r = v.validate(
      req({ method: 'POST', path: '/users', body: { name: 'Ada', role: 'admin', age: 30 } }),
      ROUTE
    );
    expect(r.ok).toBe(true);
  });
});

describe('ContractValidator — parameter validation', () => {
  it('flags a missing required query param', () => {
    const v = buildValidator(spec);
    const r = v.validate(req({ method: 'GET', path: '/users/42' }), ROUTE);
    expect(r.ok).toBe(false);
    expect(violations(r)).toContainEqual({
      field: 'query.expand',
      message: 'Missing required query parameter "expand".',
    });
  });

  it('flags a non-integer path param', () => {
    const v = buildValidator(spec);
    const r = v.validate(
      req({ method: 'GET', path: '/users/abc', query: { expand: 'x' } }),
      ROUTE
    );
    expect(r.ok).toBe(false);
    expect(violations(r).some((x) => x.field === 'path.id')).toBe(true);
  });

  it('flags a non-integer query param', () => {
    const v = buildValidator(spec);
    const r = v.validate(
      req({ method: 'GET', path: '/users/42', query: { expand: 'x', limit: 'notnum' } }),
      ROUTE
    );
    expect(r.ok).toBe(false);
    expect(violations(r).some((x) => x.field === 'query.limit')).toBe(true);
  });
});

describe('ContractValidator — body validation', () => {
  it('flags a wrong body property type', () => {
    const v = buildValidator(spec);
    const r = v.validate(
      req({ method: 'POST', path: '/users', body: { name: 'Ada', role: 'admin', age: 'old' } }),
      ROUTE
    );
    expect(r.ok).toBe(false);
    expect(violations(r).some((x) => x.field === 'body.age')).toBe(true);
  });

  it('flags a missing required property', () => {
    const v = buildValidator(spec);
    const r = v.validate(
      req({ method: 'POST', path: '/users', body: { name: 'Ada' } }),
      ROUTE
    );
    expect(r.ok).toBe(false);
    expect(violations(r)).toContainEqual({
      field: 'body.role',
      message: 'Missing required property "role".',
    });
  });

  it('flags an enum violation', () => {
    const v = buildValidator(spec);
    const r = v.validate(
      req({ method: 'POST', path: '/users', body: { name: 'Ada', role: 'wizard' } }),
      ROUTE
    );
    expect(r.ok).toBe(false);
    expect(violations(r).some((x) => x.field === 'body.role' && /one of/.test(x.message))).toBe(true);
  });

  it('rejects additionalProperties when false', () => {
    const v = buildValidator(spec);
    const r = v.validate(
      req({ method: 'POST', path: '/users', body: { name: 'Ada', role: 'user', extra: 1 } }),
      ROUTE
    );
    expect(r.ok).toBe(false);
    expect(violations(r).some((x) => x.field === 'body.extra' && /not allowed/.test(x.message))).toBe(
      true
    );
  });

  it('flags a missing required body', () => {
    const v = buildValidator(spec);
    const r = v.validate(req({ method: 'POST', path: '/users' }), ROUTE);
    expect(r.ok).toBe(false);
    expect(violations(r).some((x) => x.field === 'body')).toBe(true);
  });
});

describe('ContractValidator — path resolution', () => {
  it('reports unknown-path distinctly', () => {
    const v = buildValidator(spec);
    const r = v.validate(req({ method: 'GET', path: '/nope' }), ROUTE);
    expect(r.ok).toBe(false);
    expect(violations(r)[0].field).toBe('path');
    expect(violations(r)[0].message).toMatch(/unknown-path/);
  });

  it('reports unknown-operation distinctly', () => {
    const v = buildValidator(spec);
    const r = v.validate(req({ method: 'DELETE', path: '/users/42' }), ROUTE);
    expect(r.ok).toBe(false);
    expect(violations(r)[0].field).toBe('method');
    expect(violations(r)[0].message).toMatch(/unknown-operation/);
  });

  it('prefers the most specific of two candidate paths', () => {
    const v = buildValidator(spec);
    // /users/me matches both /users/{id} and the literal /users/me — the literal
    // one has no query requirements, so a bare request must succeed.
    const r = v.validate(req({ method: 'GET', path: '/users/me' }), ROUTE);
    expect(r.ok).toBe(true);
  });
});

describe('ContractValidator — cycle-safe refs', () => {
  const cyclicSpec = {
    openapi: '3.0.3',
    info: { title: 'C', version: '1' },
    paths: {
      '/node': {
        post: {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Node' } } },
          },
          responses: { '200': { description: 'ok' } },
        },
      },
    },
    components: {
      schemas: {
        Node: {
          type: 'object',
          required: ['value'],
          properties: {
            value: { type: 'string' },
            next: { $ref: '#/components/schemas/Node' },
          },
        },
      },
    },
  };

  it('validates a recursive schema without hanging', () => {
    const v = buildValidator(cyclicSpec);
    const r = v.validate(
      req({ method: 'POST', path: '/node', body: { value: 'a', next: { value: 'b' } } }),
      ROUTE
    );
    expect(r.ok).toBe(true);
  });

  it('flags a violation deep in a recursive schema', () => {
    const v = buildValidator(cyclicSpec);
    const r = v.validate(
      req({ method: 'POST', path: '/node', body: { value: 'a', next: { value: 123 } } }),
      ROUTE
    );
    expect(r.ok).toBe(false);
    expect(violations(r).some((x) => x.field === 'body.next.value')).toBe(true);
  });
});

describe('ContractValidator — guardrails', () => {
  it('caps violations at 50', () => {
    const bigSpec = {
      openapi: '3.0.3',
      info: { title: 'Big', version: '1' },
      paths: {
        '/bulk': {
          post: {
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { type: 'object', additionalProperties: false, properties: {} },
                },
              },
            },
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    };
    const body: Record<string, number> = {};
    for (let i = 0; i < 200; i++) {
      body[`k${i}`] = i;
    }
    const v = buildValidator(bigSpec);
    const r = v.validate(req({ method: 'POST', path: '/bulk', body }), ROUTE);
    expect(r.ok).toBe(false);
    expect(violations(r).length).toBe(50);
  });

  it('terminates quickly on a deeply nested schema (visit budget)', () => {
    // Build a schema nested ~2000 objects deep and a matching value.
    let schema: Record<string, unknown> = { type: 'string' };
    let value: unknown = 'leaf';
    for (let i = 0; i < 2000; i++) {
      schema = { type: 'object', properties: { child: schema } };
      value = { child: value };
    }
    const deepSpec = {
      openapi: '3.0.3',
      info: { title: 'Deep', version: '1' },
      paths: {
        '/deep': {
          post: {
            requestBody: {
              required: true,
              content: { 'application/json': { schema } },
            },
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    };
    const v = buildValidator(deepSpec);
    const start = Date.now();
    const r = v.validate(req({ method: 'POST', path: '/deep', body: value }), ROUTE);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);
    // It either passes (depth capped) or reports a bounded set — never hangs/throws.
    expect(typeof r.ok).toBe('boolean');
  });

  it('never throws on a garbage spec', () => {
    const v = buildValidator(null);
    const r = v.validate(req({ method: 'GET', path: '/anything' }), ROUTE);
    expect(r.ok).toBe(false);
    expect(violations(r)[0].field).toBe('path');
  });
});

describe('ContractValidator — deterministic ordering', () => {
  it('produces a stable violation order', () => {
    const v = buildValidator(spec);
    const r1 = v.validate(req({ method: 'POST', path: '/users', body: { extra: 1, zzz: 2 } }), ROUTE);
    const r2 = v.validate(req({ method: 'POST', path: '/users', body: { zzz: 2, extra: 1 } }), ROUTE);
    expect(violations(r1)).toEqual(violations(r2));
  });
});

describe('createRequestValidator', () => {
  it('loads a spec from disk and validates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mocklify-contract-'));
    try {
      writeFileSync(join(dir, 'api.json'), JSON.stringify(spec), 'utf8');
      const v = createRequestValidator({ specPath: 'api.json', mode: 'enforce' }, { workspaceRoot: dir });
      expect(v).toBeDefined();
      const r = v!.validate(req({ method: 'GET', path: '/users/42', query: { expand: 'x' } }), ROUTE);
      expect(r.ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns undefined when the spec is missing', () => {
    const v = createRequestValidator({ specPath: 'nope.json', mode: 'warn' }, { workspaceRoot: tmpdir() });
    expect(v).toBeUndefined();
  });

  it('resolves $ref specs via OpenApiImportService', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mocklify-contract-'));
    try {
      const refSpec = {
        openapi: '3.0.3',
        info: { title: 'R', version: '1' },
        paths: {
          '/thing': {
            post: {
              requestBody: {
                required: true,
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Thing' } } },
              },
              responses: { '200': { description: 'ok' } },
            },
          },
        },
        components: {
          schemas: {
            Thing: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
          },
        },
      };
      writeFileSync(join(dir, 'ref.json'), JSON.stringify(refSpec), 'utf8');
      const v = createRequestValidator({ specPath: 'ref.json', mode: 'enforce' }, { workspaceRoot: dir });
      expect(v).toBeDefined();
      const bad = v!.validate(req({ method: 'POST', path: '/thing', body: { id: 'x' } }), ROUTE);
      expect(bad.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
