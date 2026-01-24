import * as fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { RouteConfig, MockServerConfig, HttpMethod, ResponseConfig } from '../types/core.js';

interface PostmanCollection {
  info?: { name?: string; schema?: string };
  item?: PostmanItem[];
  variable?: PostmanVariable[];
}

interface PostmanItem {
  name?: string;
  request?: PostmanRequest;
  response?: PostmanResponse[];
  item?: PostmanItem[]; // Nested folders
}

interface PostmanRequest {
  method?: string;
  url?: string | PostmanUrl;
  header?: PostmanHeader[];
  body?: PostmanBody;
}

interface PostmanUrl {
  raw?: string;
  protocol?: string;
  host?: string[];
  path?: string[];
  query?: PostmanQuery[];
  variable?: PostmanVariable[];
}

interface PostmanHeader {
  key: string;
  value: string;
  disabled?: boolean;
}

interface PostmanQuery {
  key: string;
  value: string;
  disabled?: boolean;
}

interface PostmanVariable {
  key: string;
  value: string;
}

interface PostmanBody {
  mode?: 'raw' | 'formdata' | 'urlencoded' | 'file' | 'graphql';
  raw?: string;
  options?: { raw?: { language?: string } };
}

interface PostmanResponse {
  name?: string;
  originalRequest?: PostmanRequest;
  status?: string;
  code?: number;
  header?: PostmanHeader[];
  body?: string;
}

export interface PostmanImportOptions {
  serverName?: string;
  serverPort?: number;
  includeExamples?: boolean;
  convertVariables?: boolean;
  pathPrefix?: string;
}

export interface PostmanImportResult {
  success: boolean;
  serverConfig?: MockServerConfig;
  routes: RouteConfig[];
  warnings: string[];
  errors: string[];
}

export class PostmanService {
  /**
   * Import from a Postman collection file
   */
  async importFromFile(filePath: string, options?: PostmanImportOptions): Promise<PostmanImportResult> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return this.importFromString(content, options);
    } catch (error) {
      return {
        success: false,
        routes: [],
        warnings: [],
        errors: [error instanceof Error ? error.message : 'Failed to read file'],
      };
    }
  }

  /**
   * Import from a Postman collection string
   */
  importFromString(content: string, options?: PostmanImportOptions): PostmanImportResult {
    const warnings: string[] = [];
    const errors: string[] = [];
    const routes: RouteConfig[] = [];

    let collection: PostmanCollection;
    try {
      collection = JSON.parse(content);
    } catch {
      return {
        success: false,
        routes: [],
        warnings: [],
        errors: ['Invalid JSON format'],
      };
    }

    // Check if it's a Postman collection
    if (!collection.info?.schema?.includes('postman')) {
      warnings.push('This may not be a valid Postman collection');
    }

    // Process items recursively
    const variables = this.extractVariables(collection.variable || []);
    this.processItems(collection.item || [], routes, warnings, options, variables);

    // Create server config if name provided
    let serverConfig: MockServerConfig | undefined;
    const serverName = options?.serverName || collection.info?.name;

    if (serverName) {
      serverConfig = {
        id: uuidv4(),
        name: serverName,
        port: options?.serverPort || 3000,
        protocol: 'http',
        enabled: true,
        routes,
        settings: {
          cors: { enabled: true },
          logging: { enabled: true, includeBody: true },
        },
      };
    }

    return {
      success: routes.length > 0,
      serverConfig,
      routes,
      warnings,
      errors,
    };
  }

  /**
   * Process Postman items recursively (handles folders)
   */
  private processItems(
    items: PostmanItem[],
    routes: RouteConfig[],
    warnings: string[],
    options?: PostmanImportOptions,
    variables?: Map<string, string>,
    prefix: string = ''
  ): void {
    for (const item of items) {
      // If item has nested items, it's a folder
      if (item.item && item.item.length > 0) {
        const folderPrefix = prefix ? `${prefix}/${item.name}` : item.name || '';
        this.processItems(item.item, routes, warnings, options, variables, folderPrefix);
        continue;
      }

      // Process as request
      if (item.request) {
        try {
          const route = this.createRouteFromRequest(item, options, variables);
          if (route) {
            routes.push(route);
          }
        } catch (error) {
          warnings.push(`Failed to create route for "${item.name}": ${error}`);
        }
      }
    }
  }

  /**
   * Extract variables from collection
   */
  private extractVariables(variables: PostmanVariable[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const v of variables) {
      if (v.key && v.value !== undefined) {
        map.set(v.key, v.value);
      }
    }
    return map;
  }

  /**
   * Create a route from a Postman request
   */
  private createRouteFromRequest(
    item: PostmanItem,
    options?: PostmanImportOptions,
    variables?: Map<string, string>
  ): RouteConfig | null {
    const request = item.request;
    if (!request) return null;

    const method = (request.method || 'GET').toUpperCase() as HttpMethod;
    let path = this.extractPath(request.url, options, variables);

    if (!path) {
      return null;
    }

    // Find best response example
    const exampleResponse = this.findBestResponse(item.response);

    const response: ResponseConfig = {
      type: 'static',
      statusCode: exampleResponse?.code || 200,
      headers: { 'Content-Type': 'application/json' },
    };

    // Use example response body if available
    if (options?.includeExamples && exampleResponse?.body) {
      try {
        const parsedBody = JSON.parse(exampleResponse.body);
        response.body = {
          contentType: 'application/json',
          content: parsedBody,
        };
      } catch {
        response.body = {
          contentType: 'text/plain',
          content: exampleResponse.body,
        };
      }
    } else {
      response.body = {
        contentType: 'application/json',
        content: { message: 'Success' },
      };
    }

    // Apply path prefix
    if (options?.pathPrefix) {
      path = options.pathPrefix + path;
    }

    return {
      id: uuidv4(),
      name: item.name || `${method} ${path}`,
      enabled: true,
      method,
      path,
      response,
    };
  }

  /**
   * Extract path from Postman URL
   */
  private extractPath(
    url: string | PostmanUrl | undefined,
    options?: PostmanImportOptions,
    variables?: Map<string, string>
  ): string {
    if (!url) return '/';

    let path: string;

    if (typeof url === 'string') {
      // Parse URL string
      try {
        const parsed = new URL(url);
        path = parsed.pathname;
      } catch {
        // Not a full URL, treat as path
        path = url.split('?')[0];
      }
    } else {
      // Postman URL object
      path = '/' + (url.path || []).join('/');
    }

    // Replace Postman variables with Express-style params
    if (options?.convertVariables) {
      path = path.replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
        // If it's a path parameter, convert to :param
        if (varName.includes('id') || varName.includes('Id')) {
          return ':' + varName.replace(/[^a-zA-Z0-9]/g, '');
        }
        // Otherwise substitute from variables if available
        if (variables?.has(varName)) {
          return variables.get(varName)!;
        }
        return ':' + varName.replace(/[^a-zA-Z0-9]/g, '');
      });

      // Also convert :variable: format
      path = path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*):/g, ':$1');
    }

    return path || '/';
  }

  /**
   * Find the best response from examples
   */
  private findBestResponse(responses?: PostmanResponse[]): PostmanResponse | undefined {
    if (!responses || responses.length === 0) return undefined;

    // Prefer 200 responses
    const ok = responses.find((r) => r.code === 200);
    if (ok) return ok;

    // Then any 2xx
    const success = responses.find((r) => r.code && r.code >= 200 && r.code < 300);
    if (success) return success;

    // Fall back to first
    return responses[0];
  }

  /**
   * Export routes to Postman collection format
   */
  exportToPostman(routes: RouteConfig[], collectionName: string): PostmanCollection {
    const items: PostmanItem[] = routes.map((route) => {
      const methods = Array.isArray(route.method) ? route.method : [route.method];

      return {
        name: route.name,
        request: {
          method: methods[0],
          url: {
            raw: `{{baseUrl}}${route.path}`,
            host: ['{{baseUrl}}'],
            path: route.path.split('/').filter(Boolean),
          },
          header: route.response.headers
            ? Object.entries(route.response.headers).map(([key, value]) => ({
                key,
                value,
              }))
            : [],
        },
        response: route.response.body
          ? [
              {
                name: 'Example Response',
                code: route.response.statusCode,
                body:
                  typeof route.response.body.content === 'string'
                    ? route.response.body.content
                    : JSON.stringify(route.response.body.content, null, 2),
              },
            ]
          : [],
      };
    });

    return {
      info: {
        name: collectionName,
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: items,
      variable: [
        {
          key: 'baseUrl',
          value: 'http://localhost:3000',
        },
      ],
    };
  }
}
