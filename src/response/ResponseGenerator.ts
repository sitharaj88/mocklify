import { ResponseConfig, DelayConfig, RouteConfig } from '../types/core.js';
import { TemplateEngine } from './TemplateEngine.js';
import { ProxyHandler, ProxyRequestOptions } from '../proxy/ProxyHandler.js';
import { responseStateManager } from '../state/ResponseStateManager.js';
import { DatabaseService, DatabaseQuery } from '../services/DatabaseService.js';

export interface ResponseContext {
  params: Record<string, string>;
  query: Record<string, string | string[] | undefined>;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  path: string;
  method: string;
  serverId?: string;
}

export interface GeneratedResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
}

export class ResponseGenerator {
  private templateEngine: TemplateEngine;
  private proxyHandler: ProxyHandler;
  private databaseService?: DatabaseService;

  constructor(databaseService?: DatabaseService) {
    this.templateEngine = new TemplateEngine();
    this.proxyHandler = new ProxyHandler();
    this.databaseService = databaseService;
  }

  /**
   * Generate a response for a matched route
   */
  async generate(route: RouteConfig, context: ResponseContext): Promise<GeneratedResponse> {
    const { response, delay } = route;

    // Check for response sequence
    if (context.serverId && responseStateManager.hasSequence(context.serverId, route.id)) {
      const sequenceResponse = responseStateManager.getNextSequenceResponse(context.serverId, route.id);
      if (sequenceResponse) {
        if (delay) await this.applyDelay(delay);
        return this.generateByType(sequenceResponse, context);
      }
    }

    // Record call
    if (context.serverId) {
      responseStateManager.recordCall(context.serverId, route.id);
    }

    // Apply delay if configured
    if (delay) {
      await this.applyDelay(delay);
    }

    return this.generateByType(response, context);
  }

  /**
   * Generate response based on type
   */
  private async generateByType(response: ResponseConfig, context: ResponseContext): Promise<GeneratedResponse> {
    switch (response.type) {
      case 'static':
        return this.generateStaticResponse(response, context);

      case 'dynamic':
        return this.generateDynamicResponse(response, context);

      case 'proxy':
        return this.generateProxyResponse(response, context);

      case 'database' as string:
        return this.generateDatabaseResponse(response, context);

      default:
        return {
          statusCode: 500,
          headers: { 'Content-Type': 'application/json' },
          body: { error: 'Unknown response type' },
        };
    }
  }

  /**
   * Generate a proxy response
   */
  private async generateProxyResponse(
    response: ResponseConfig,
    context: ResponseContext
  ): Promise<GeneratedResponse> {
    if (!response.proxy?.targetUrl) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Proxy target URL not configured' },
      };
    }

    const proxyOptions: ProxyRequestOptions = {
      method: context.method,
      path: context.path,
      headers: context.headers,
      query: context.query,
      body: context.body,
      targetUrl: response.proxy.targetUrl,
      preserveHost: response.proxy.preserveHost,
      timeout: response.proxy.timeout,
    };

    const proxyResponse = await this.proxyHandler.forward(proxyOptions);

    return {
      statusCode: proxyResponse.statusCode,
      headers: proxyResponse.headers,
      body: proxyResponse.body,
    };
  }

  /**
   * Generate a database response
   */
  private async generateDatabaseResponse(
    response: ResponseConfig,
    context: ResponseContext
  ): Promise<GeneratedResponse> {
    if (!this.databaseService) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Database service not configured' },
      };
    }

    // Database config should be in response body or a special field
    const dbConfig = response.body?.content as Record<string, unknown> | undefined;
    if (!dbConfig?.connectionId || !dbConfig?.operation) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Database operation not configured' },
      };
    }

    const query: DatabaseQuery = {
      operation: dbConfig.operation as DatabaseQuery['operation'],
      collection: dbConfig.collection as string | undefined,
      table: dbConfig.table as string | undefined,
      filter: this.applyContextToFilter(dbConfig.filter as Record<string, unknown> | undefined, context),
      data: context.body as Record<string, unknown> | undefined,
      query: dbConfig.query as string | undefined,
      limit: dbConfig.limit as number | undefined,
      skip: dbConfig.skip as number | undefined,
    };

    const result = await this.databaseService.executeQuery(dbConfig.connectionId as string, query);

    if (!result.success) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: { error: result.error },
      };
    }

    return {
      statusCode: response.statusCode,
      headers: { 'Content-Type': 'application/json', ...response.headers },
      body: result.data,
    };
  }

  /**
   * Apply context variables to database filter
   */
  private applyContextToFilter(
    filter: Record<string, unknown> | undefined,
    context: ResponseContext
  ): Record<string, unknown> | undefined {
    if (!filter) return undefined;

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(filter)) {
      if (typeof value === 'string') {
        // Replace {{params.id}} style placeholders
        result[key] = value.replace(/\{\{(\w+)\.(\w+)\}\}/g, (match, type, prop) => {
          switch (type) {
            case 'params':
              return context.params[prop] ?? match;
            case 'query':
              const qVal = context.query[prop];
              return (Array.isArray(qVal) ? qVal[0] : qVal) ?? match;
            default:
              return match;
          }
        });
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  /**
   * Generate a static response
   */
  private generateStaticResponse(
    response: ResponseConfig,
    context: ResponseContext
  ): GeneratedResponse {
    const headers: Record<string, string> = {
      ...response.headers,
    };

    let body: unknown = null;

    if (response.body) {
      headers['Content-Type'] = response.body.contentType;
      body = response.body.content;

      // If body is a string, replace simple placeholders like {{params.id}}
      if (typeof body === 'string') {
        body = this.replaceSimplePlaceholders(body, context);
      } else if (typeof body === 'object' && body !== null) {
        body = this.replaceObjectPlaceholders(body as Record<string, unknown>, context);
      }
    }

    return {
      statusCode: response.statusCode,
      headers,
      body,
    };
  }

  /**
   * Generate a dynamic response using templates
   */
  private async generateDynamicResponse(
    response: ResponseConfig,
    context: ResponseContext
  ): Promise<GeneratedResponse> {
    const headers: Record<string, string> = {
      ...response.headers,
    };

    let body: unknown = null;

    if (response.template) {
      const templateContext = {
        params: context.params,
        query: this.normalizeQuery(context.query),
        headers: this.normalizeHeaders(context.headers),
        body: context.body,
        request: {
          path: context.path,
          method: context.method,
        },
      };

      const rendered = await this.templateEngine.render(response.template.template, templateContext);

      // Try to parse as JSON if content type is JSON
      const contentType = headers['Content-Type'] || response.body?.contentType || 'application/json';
      headers['Content-Type'] = contentType;

      if (contentType.includes('application/json')) {
        try {
          body = JSON.parse(rendered);
        } catch {
          body = rendered;
        }
      } else {
        body = rendered;
      }
    } else if (response.body) {
      headers['Content-Type'] = response.body.contentType;
      body = response.body.content;
    }

    return {
      statusCode: response.statusCode,
      headers,
      body,
    };
  }

  /**
   * Apply configured delay
   */
  private async applyDelay(delay: DelayConfig): Promise<void> {
    let ms: number;

    if (delay.type === 'fixed') {
      ms = delay.value ?? 0;
    } else {
      // Random delay between min and max
      const min = delay.min ?? 0;
      const max = delay.max ?? 1000;
      ms = Math.floor(Math.random() * (max - min + 1)) + min;
    }

    if (ms > 0) {
      await new Promise((resolve) => setTimeout(resolve, ms));
    }
  }

  /**
   * Replace simple placeholders in a string
   */
  private replaceSimplePlaceholders(str: string, context: ResponseContext): string {
    return str.replace(/\{\{(\w+)\.(\w+)\}\}/g, (match, type, key) => {
      switch (type) {
        case 'params':
          return context.params[key] ?? match;
        case 'query':
          const queryVal = context.query[key];
          return (Array.isArray(queryVal) ? queryVal[0] : queryVal) ?? match;
        case 'headers':
          const headerVal = context.headers[key.toLowerCase()];
          return (Array.isArray(headerVal) ? headerVal[0] : headerVal) ?? match;
        default:
          return match;
      }
    });
  }

  /**
   * Replace placeholders in an object recursively
   */
  private replaceObjectPlaceholders(
    obj: Record<string, unknown>,
    context: ResponseContext
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        result[key] = this.replaceSimplePlaceholders(value, context);
      } else if (Array.isArray(value)) {
        result[key] = value.map((item) =>
          typeof item === 'object' && item !== null
            ? this.replaceObjectPlaceholders(item as Record<string, unknown>, context)
            : typeof item === 'string'
              ? this.replaceSimplePlaceholders(item, context)
              : item
        );
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.replaceObjectPlaceholders(value as Record<string, unknown>, context);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Normalize query parameters to simple key-value pairs
   */
  private normalizeQuery(
    query: Record<string, string | string[] | undefined>
  ): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        result[key] = Array.isArray(value) ? value[0] : value;
      }
    }
    return result;
  }

  /**
   * Normalize headers to simple key-value pairs
   */
  private normalizeHeaders(
    headers: Record<string, string | string[] | undefined>
  ): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined) {
        result[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
      }
    }
    return result;
  }

  /**
   * Generate a fallback response for unmatched requests
   */
  generateNotFound(path: string, method: string): GeneratedResponse {
    return {
      statusCode: 404,
      headers: {
        'Content-Type': 'application/json',
      },
      body: {
        error: 'Not Found',
        message: `No mock found for ${method} ${path}`,
        path,
        method,
      },
    };
  }
}
