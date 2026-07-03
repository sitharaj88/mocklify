import { describe, it, expect } from 'vitest';
import { MockGenerator } from '../src/ai/MockGenerator';

const validRoute = {
  name: 'List products',
  enabled: true,
  method: 'GET',
  path: '/api/products',
  response: {
    type: 'static',
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: { contentType: 'application/json', content: [{ id: 1, title: 'Desk' }] },
  },
  tags: ['products'],
};

describe('MockGenerator.validateRoutes', () => {
  it('accepts an array of valid routes', () => {
    const routes = MockGenerator.validateRoutes([validRoute]);
    expect(routes).toHaveLength(1);
    expect(routes[0].path).toBe('/api/products');
  });

  it('accepts a single bare route object', () => {
    const routes = MockGenerator.validateRoutes(validRoute);
    expect(routes).toHaveLength(1);
  });

  it('drops invalid entries but keeps valid ones', () => {
    const routes = MockGenerator.validateRoutes([
      validRoute,
      { name: 'broken', method: 'INVALID', path: '' },
    ]);
    expect(routes).toHaveLength(1);
  });

  it('throws when nothing valid was generated', () => {
    expect(() => MockGenerator.validateRoutes([{ nonsense: true }])).toThrow(
      /did not match the expected format/
    );
  });

  it('defaults enabled to true when the model omits it', () => {
    const { enabled: _omitted, ...withoutEnabled } = validRoute;
    const routes = MockGenerator.validateRoutes([withoutEnabled]);
    expect(routes[0].enabled).toBe(true);
  });
});

describe('MockGenerator.withIds', () => {
  it('assigns unique uuids to generated routes', () => {
    const withIds = MockGenerator.withIds([
      MockGenerator.validateRoutes(validRoute)[0],
      MockGenerator.validateRoutes(validRoute)[0],
    ]);
    expect(withIds[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(withIds[0].id).not.toBe(withIds[1].id);
  });
});
