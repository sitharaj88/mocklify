import { RouteConfig, RequestMatcher as RequestMatcherConfig, HttpMethod } from '../types/core.js';

export interface MatchResult {
  matched: boolean;
  route?: RouteConfig;
  params: Record<string, string>;
  score: number;
}

export interface RequestInfo {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | string[] | undefined>;
  body?: unknown;
}

export class RequestMatcher {
  /**
   * Match an incoming request against a list of routes
   */
  match(request: RequestInfo, routes: RouteConfig[]): MatchResult {
    let bestMatch: MatchResult = { matched: false, params: {}, score: -1 };

    for (const route of routes) {
      if (!route.enabled) {
        continue;
      }

      const result = this.matchRoute(request, route);
      if (result.matched && result.score > bestMatch.score) {
        bestMatch = result;
      }
    }

    return bestMatch;
  }

  /**
   * Match a single route against a request
   */
  private matchRoute(request: RequestInfo, route: RouteConfig): MatchResult {
    // Check method
    if (!this.matchMethod(request.method, route.method)) {
      return { matched: false, params: {}, score: -1 };
    }

    // Check path
    const pathResult = this.matchPath(request.path, route.path);
    if (!pathResult.matched) {
      return { matched: false, params: {}, score: -1 };
    }

    let score = pathResult.score;

    // Check matcher conditions if present
    if (route.matcher) {
      const matcherResult = this.matchConditions(request, route.matcher);
      if (!matcherResult.matched) {
        return { matched: false, params: {}, score: -1 };
      }
      score += matcherResult.score;
    }

    // Add priority if specified
    if (route.priority !== undefined) {
      score += route.priority * 1000;
    }

    return {
      matched: true,
      route,
      params: pathResult.params,
      score,
    };
  }

  /**
   * Check if request method matches route method(s)
   */
  private matchMethod(requestMethod: string, routeMethod: HttpMethod | HttpMethod[]): boolean {
    const methods = Array.isArray(routeMethod) ? routeMethod : [routeMethod];
    return methods.includes(requestMethod.toUpperCase() as HttpMethod);
  }

  /**
   * Match request path against route pattern
   * Supports:
   * - Exact match: /api/users
   * - Path parameters: /api/users/:id
   * - Wildcards: /api/*
   * - Catch-all: /api/**
   */
  private matchPath(
    requestPath: string,
    routePattern: string
  ): { matched: boolean; params: Record<string, string>; score: number } {
    const params: Record<string, string> = {};
    let score = 0;

    // Normalize paths
    const reqParts = this.normalizePath(requestPath).split('/').filter(Boolean);
    const routeParts = this.normalizePath(routePattern).split('/').filter(Boolean);

    let reqIdx = 0;
    let routeIdx = 0;

    while (routeIdx < routeParts.length) {
      const routePart = routeParts[routeIdx];

      // Catch-all wildcard
      if (routePart === '**') {
        // Match everything remaining
        const remainingPath = reqParts.slice(reqIdx).join('/');
        params['**'] = remainingPath;
        score += 1; // Lower score for catch-all
        return { matched: true, params, score };
      }

      // No more request parts but route expects more
      if (reqIdx >= reqParts.length) {
        return { matched: false, params: {}, score: -1 };
      }

      const reqPart = reqParts[reqIdx];

      // Single segment wildcard
      if (routePart === '*') {
        params[`*${routeIdx}`] = reqPart;
        score += 5; // Medium score for wildcard
        reqIdx++;
        routeIdx++;
        continue;
      }

      // Path parameter
      if (routePart.startsWith(':')) {
        const paramName = routePart.slice(1);
        params[paramName] = reqPart;
        score += 10; // Higher score for named param
        reqIdx++;
        routeIdx++;
        continue;
      }

      // Exact match
      if (routePart.toLowerCase() === reqPart.toLowerCase()) {
        score += 20; // Highest score for exact match
        reqIdx++;
        routeIdx++;
        continue;
      }

      // No match
      return { matched: false, params: {}, score: -1 };
    }

    // Check if all request parts were consumed
    if (reqIdx < reqParts.length) {
      return { matched: false, params: {}, score: -1 };
    }

    return { matched: true, params, score };
  }

  /**
   * Match additional conditions (headers, query params, body)
   */
  private matchConditions(
    request: RequestInfo,
    matcher: RequestMatcherConfig
  ): { matched: boolean; score: number } {
    let score = 0;

    // Check headers
    if (matcher.headers) {
      for (const [key, expectedValue] of Object.entries(matcher.headers)) {
        const actualValue = this.getHeaderValue(request.headers, key);
        if (!this.matchValue(actualValue, expectedValue)) {
          return { matched: false, score: -1 };
        }
        score += 5;
      }
    }

    // Check query parameters
    if (matcher.queryParams) {
      for (const [key, expectedValue] of Object.entries(matcher.queryParams)) {
        const actualValue = this.getQueryValue(request.query, key);
        if (!this.matchValue(actualValue, expectedValue)) {
          return { matched: false, score: -1 };
        }
        score += 5;
      }
    }

    // Check body
    if (matcher.body && request.body !== undefined) {
      if (!this.matchBody(request.body, matcher.body)) {
        return { matched: false, score: -1 };
      }
      score += 10;
    }

    return { matched: true, score };
  }

  /**
   * Match a value against expected value (supports regex)
   */
  private matchValue(actual: string | undefined, expected: string): boolean {
    if (actual === undefined) {
      return false;
    }

    // Check if expected is a regex pattern
    if (expected.startsWith('/') && expected.endsWith('/')) {
      const pattern = expected.slice(1, -1);
      try {
        const regex = new RegExp(pattern, 'i');
        return regex.test(actual);
      } catch {
        // Invalid regex, fall back to exact match
      }
    }

    return actual.toLowerCase() === expected.toLowerCase();
  }

  /**
   * Match request body against body matcher
   */
  private matchBody(
    body: unknown,
    matcher: { type: 'exact' | 'contains' | 'jsonPath' | 'regex'; value: string; jsonPath?: string }
  ): boolean {
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);

    switch (matcher.type) {
      case 'exact':
        return bodyStr === matcher.value;

      case 'contains':
        return bodyStr.includes(matcher.value);

      case 'regex':
        try {
          const regex = new RegExp(matcher.value);
          return regex.test(bodyStr);
        } catch {
          return false;
        }

      case 'jsonPath':
        // Basic JSONPath support (only simple paths like $.user.name)
        if (matcher.jsonPath && typeof body === 'object' && body !== null) {
          const value = this.getJsonPath(body as Record<string, unknown>, matcher.jsonPath);
          return String(value) === matcher.value;
        }
        return false;

      default:
        return false;
    }
  }

  /**
   * Get header value (case-insensitive)
   */
  private getHeaderValue(
    headers: Record<string, string | string[] | undefined>,
    key: string
  ): string | undefined {
    const lowerKey = key.toLowerCase();
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === lowerKey) {
        return Array.isArray(v) ? v[0] : v;
      }
    }
    return undefined;
  }

  /**
   * Get query parameter value
   */
  private getQueryValue(
    query: Record<string, string | string[] | undefined>,
    key: string
  ): string | undefined {
    const value = query[key];
    return Array.isArray(value) ? value[0] : value;
  }

  /**
   * Simple JSONPath implementation
   */
  private getJsonPath(obj: Record<string, unknown>, path: string): unknown {
    // Remove leading $. if present
    const normalizedPath = path.replace(/^\$\.?/, '');
    const parts = normalizedPath.split('.');

    let current: unknown = obj;
    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      if (typeof current === 'object') {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  /**
   * Normalize a path (remove trailing slashes, etc.)
   */
  private normalizePath(path: string): string {
    return path.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
  }
}
