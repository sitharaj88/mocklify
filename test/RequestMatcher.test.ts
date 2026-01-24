import { describe, it, expect } from 'vitest';
import { RequestMatcher, RequestInfo } from '../src/matching/RequestMatcher.js';
import { RouteConfig } from '../src/types/core.js';

describe('RequestMatcher', () => {
  const matcher = new RequestMatcher();

  const createRoute = (
    method: string | string[],
    path: string,
    enabled = true
  ): RouteConfig => ({
    id: 'test-route',
    name: 'Test Route',
    enabled,
    method: method as any,
    path,
    response: {
      type: 'static',
      statusCode: 200,
    },
  });

  const createRequest = (method: string, path: string): RequestInfo => ({
    method,
    path,
    headers: {},
    query: {},
  });

  describe('method matching', () => {
    it('should match exact method', () => {
      const routes = [createRoute('GET', '/api/users')];
      const request = createRequest('GET', '/api/users');
      const result = matcher.match(request, routes);
      expect(result.matched).toBe(true);
    });

    it('should match method case-insensitively', () => {
      const routes = [createRoute('GET', '/api/users')];
      const request = createRequest('get', '/api/users');
      const result = matcher.match(request, routes);
      expect(result.matched).toBe(true);
    });

    it('should match when multiple methods are specified', () => {
      const routes = [createRoute(['GET', 'POST'], '/api/users')];
      const request = createRequest('POST', '/api/users');
      const result = matcher.match(request, routes);
      expect(result.matched).toBe(true);
    });

    it('should not match wrong method', () => {
      const routes = [createRoute('GET', '/api/users')];
      const request = createRequest('POST', '/api/users');
      const result = matcher.match(request, routes);
      expect(result.matched).toBe(false);
    });
  });

  describe('path matching', () => {
    it('should match exact path', () => {
      const routes = [createRoute('GET', '/api/users')];
      const request = createRequest('GET', '/api/users');
      const result = matcher.match(request, routes);
      expect(result.matched).toBe(true);
    });

    it('should match path with parameters', () => {
      const routes = [createRoute('GET', '/api/users/:id')];
      const request = createRequest('GET', '/api/users/123');
      const result = matcher.match(request, routes);
      expect(result.matched).toBe(true);
      expect(result.params.id).toBe('123');
    });

    it('should match path with multiple parameters', () => {
      const routes = [createRoute('GET', '/api/users/:userId/posts/:postId')];
      const request = createRequest('GET', '/api/users/1/posts/2');
      const result = matcher.match(request, routes);
      expect(result.matched).toBe(true);
      expect(result.params.userId).toBe('1');
      expect(result.params.postId).toBe('2');
    });

    it('should match path with wildcard', () => {
      const routes = [createRoute('GET', '/api/*/items')];
      const request = createRequest('GET', '/api/products/items');
      const result = matcher.match(request, routes);
      expect(result.matched).toBe(true);
    });

    it('should match path with catch-all', () => {
      const routes = [createRoute('GET', '/api/**')];
      const request = createRequest('GET', '/api/users/123/posts');
      const result = matcher.match(request, routes);
      expect(result.matched).toBe(true);
    });

    it('should not match different path', () => {
      const routes = [createRoute('GET', '/api/users')];
      const request = createRequest('GET', '/api/posts');
      const result = matcher.match(request, routes);
      expect(result.matched).toBe(false);
    });
  });

  describe('route priority', () => {
    it('should prefer exact match over parameter match', () => {
      const routes = [
        createRoute('GET', '/api/users/:id'),
        createRoute('GET', '/api/users/me'),
      ];
      const request = createRequest('GET', '/api/users/me');
      const result = matcher.match(request, routes);
      expect(result.matched).toBe(true);
      expect(result.route?.path).toBe('/api/users/me');
    });

    it('should not match disabled routes', () => {
      const routes = [createRoute('GET', '/api/users', false)];
      const request = createRequest('GET', '/api/users');
      const result = matcher.match(request, routes);
      expect(result.matched).toBe(false);
    });
  });

  describe('header matching', () => {
    it('should match when headers match', () => {
      const routes: RouteConfig[] = [
        {
          ...createRoute('GET', '/api/users'),
          matcher: {
            headers: { 'content-type': 'application/json' },
          },
        },
      ];
      const request: RequestInfo = {
        method: 'GET',
        path: '/api/users',
        headers: { 'content-type': 'application/json' },
        query: {},
      };
      const result = matcher.match(request, routes);
      expect(result.matched).toBe(true);
    });

    it('should not match when headers do not match', () => {
      const routes: RouteConfig[] = [
        {
          ...createRoute('GET', '/api/users'),
          matcher: {
            headers: { 'content-type': 'application/json' },
          },
        },
      ];
      const request: RequestInfo = {
        method: 'GET',
        path: '/api/users',
        headers: { 'content-type': 'text/plain' },
        query: {},
      };
      const result = matcher.match(request, routes);
      expect(result.matched).toBe(false);
    });
  });

  describe('query parameter matching', () => {
    it('should match when query params match', () => {
      const routes: RouteConfig[] = [
        {
          ...createRoute('GET', '/api/users'),
          matcher: {
            queryParams: { status: 'active' },
          },
        },
      ];
      const request: RequestInfo = {
        method: 'GET',
        path: '/api/users',
        headers: {},
        query: { status: 'active' },
      };
      const result = matcher.match(request, routes);
      expect(result.matched).toBe(true);
    });
  });
});
