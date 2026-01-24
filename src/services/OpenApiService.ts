import * as fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { RouteConfig, MockServerConfig, HttpMethod, ResponseConfig } from '../types/core.js';

interface OpenApiSpec {
  openapi?: string;
  swagger?: string;
  info?: { title?: string; version?: string };
  paths?: Record<string, OpenApiPathItem>;
  components?: { schemas?: Record<string, unknown> };
}

interface OpenApiPathItem {
  get?: OpenApiOperation;
  post?: OpenApiOperation;
  put?: OpenApiOperation;
  delete?: OpenApiOperation;
  patch?: OpenApiOperation;
  options?: OpenApiOperation;
  head?: OpenApiOperation;
}

interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: {
    content?: Record<string, { schema?: unknown; example?: unknown }>;
  };
  responses?: Record<string, OpenApiResponse>;
}

interface OpenApiParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  schema?: unknown;
  example?: unknown;
}

interface OpenApiResponse {
  description?: string;
  content?: Record<string, { schema?: unknown; example?: unknown; examples?: Record<string, { value: unknown }> }>;
  headers?: Record<string, unknown>;
}

export interface ImportOptions {
  serverName?: string;
  serverPort?: number;
  generateFakeData?: boolean;
  includeExamples?: boolean;
  pathPrefix?: string;
}

export interface ImportResult {
  success: boolean;
  serverConfig?: MockServerConfig;
  routes: RouteConfig[];
  warnings: string[];
  errors: string[];
}

export class OpenApiService {
  /**
   * Import routes from an OpenAPI/Swagger spec file
   */
  async importFromFile(filePath: string, options?: ImportOptions): Promise<ImportResult> {
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
   * Import routes from an OpenAPI/Swagger spec string
   */
  importFromString(content: string, options?: ImportOptions): ImportResult {
    const warnings: string[] = [];
    const errors: string[] = [];
    const routes: RouteConfig[] = [];

    let spec: OpenApiSpec;
    try {
      spec = JSON.parse(content);
    } catch {
      try {
        // Try YAML parsing (basic)
        spec = this.parseYaml(content);
      } catch {
        return {
          success: false,
          routes: [],
          warnings: [],
          errors: ['Invalid JSON or YAML format'],
        };
      }
    }

    // Validate spec version
    const isOpenApi3 = spec.openapi?.startsWith('3.');
    const isSwagger2 = spec.swagger?.startsWith('2.');

    if (!isOpenApi3 && !isSwagger2) {
      warnings.push('Unrecognized spec version, attempting to parse anyway');
    }

    // Parse paths
    if (!spec.paths) {
      return {
        success: false,
        routes: [],
        warnings,
        errors: ['No paths found in spec'],
      };
    }

    const pathPrefix = options?.pathPrefix || '';

    for (const [pathPattern, pathItem] of Object.entries(spec.paths)) {
      const methods: (keyof OpenApiPathItem)[] = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'];

      for (const method of methods) {
        const operation = pathItem[method];
        if (!operation) continue;

        try {
          const route = this.createRouteFromOperation(
            method.toUpperCase() as HttpMethod,
            pathPrefix + this.convertPath(pathPattern),
            operation,
            options
          );
          routes.push(route);
        } catch (error) {
          warnings.push(`Failed to create route for ${method.toUpperCase()} ${pathPattern}: ${error}`);
        }
      }
    }

    // Create server config if name provided
    let serverConfig: MockServerConfig | undefined;
    if (options?.serverName) {
      serverConfig = {
        id: uuidv4(),
        name: options.serverName,
        port: options.serverPort || 3000,
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
   * Convert OpenAPI path to Express-style path
   * e.g., /users/{id} -> /users/:id
   */
  private convertPath(path: string): string {
    return path.replace(/\{([^}]+)\}/g, ':$1');
  }

  /**
   * Create a route from an OpenAPI operation
   */
  private createRouteFromOperation(
    method: HttpMethod,
    path: string,
    operation: OpenApiOperation,
    options?: ImportOptions
  ): RouteConfig {
    const name = operation.operationId || operation.summary || `${method} ${path}`;

    // Find the success response (prefer 200, 201, or first 2xx)
    const responses = operation.responses || {};
    const successCode = this.findSuccessResponseCode(responses);
    const successResponse = responses[successCode];

    const response: ResponseConfig = {
      type: options?.generateFakeData ? 'dynamic' : 'static',
      statusCode: parseInt(successCode, 10) || 200,
      headers: { 'Content-Type': 'application/json' },
    };

    // Extract example or generate template
    if (successResponse?.content) {
      const jsonContent = successResponse.content['application/json'];
      if (jsonContent) {
        if (options?.includeExamples && jsonContent.example) {
          response.body = {
            contentType: 'application/json',
            content: jsonContent.example,
          };
        } else if (options?.includeExamples && jsonContent.examples) {
          const firstExample = Object.values(jsonContent.examples)[0];
          if (firstExample?.value) {
            response.body = {
              contentType: 'application/json',
              content: firstExample.value,
            };
          }
        } else if (options?.generateFakeData && jsonContent.schema) {
          response.template = {
            engine: 'handlebars',
            template: this.generateTemplateFromSchema(jsonContent.schema),
          };
        }
      }
    }

    // Default body if none set
    if (!response.body && !response.template) {
      response.body = {
        contentType: 'application/json',
        content: { message: 'Success' },
      };
    }

    return {
      id: uuidv4(),
      name,
      enabled: true,
      method,
      path,
      response,
    };
  }

  /**
   * Find the first success response code (2xx)
   */
  private findSuccessResponseCode(responses: Record<string, OpenApiResponse>): string {
    const codes = Object.keys(responses);
    
    // Prefer specific codes
    if (codes.includes('200')) return '200';
    if (codes.includes('201')) return '201';
    if (codes.includes('204')) return '204';

    // Find any 2xx
    const successCode = codes.find((code) => code.startsWith('2'));
    if (successCode) return successCode;

    // Fall back to first code or default
    return codes[0] || '200';
  }

  /**
   * Generate a Handlebars template from a JSON schema
   */
  private generateTemplateFromSchema(schema: unknown): string {
    if (!schema || typeof schema !== 'object') {
      return '{ "message": "{{faker.lorem.sentence}}" }';
    }

    const schemaObj = schema as Record<string, unknown>;

    if (schemaObj.type === 'array') {
      const itemTemplate = this.generateTemplateFromSchema(schemaObj.items);
      return `[{{#repeat 3}}${itemTemplate}{{#unless @last}},{{/unless}}{{/repeat}}]`;
    }

    if (schemaObj.type === 'object' || schemaObj.properties) {
      const properties = (schemaObj.properties as Record<string, unknown>) || {};
      const fields: string[] = [];

      for (const [key, prop] of Object.entries(properties)) {
        const propObj = prop as Record<string, unknown>;
        const value = this.getTemplateValueForProperty(key, propObj);
        fields.push(`"${key}": ${value}`);
      }

      return `{ ${fields.join(', ')} }`;
    }

    return this.getTemplateValueForProperty('value', schemaObj);
  }

  /**
   * Get a template value based on property name and type
   */
  private getTemplateValueForProperty(name: string, prop: Record<string, unknown>): string {
    const type = prop.type as string;
    const format = prop.format as string;
    const nameLower = name.toLowerCase();

    // Smart matching based on property name
    if (nameLower.includes('email')) return '"{{faker.internet.email}}"';
    if (nameLower.includes('name') && nameLower.includes('first')) return '"{{faker.person.firstName}}"';
    if (nameLower.includes('name') && nameLower.includes('last')) return '"{{faker.person.lastName}}"';
    if (nameLower.includes('name')) return '"{{faker.person.fullName}}"';
    if (nameLower.includes('phone')) return '"{{faker.phone.number}}"';
    if (nameLower.includes('address')) return '"{{faker.location.streetAddress}}"';
    if (nameLower.includes('city')) return '"{{faker.location.city}}"';
    if (nameLower.includes('country')) return '"{{faker.location.country}}"';
    if (nameLower.includes('zip') || nameLower.includes('postal')) return '"{{faker.location.zipCode}}"';
    if (nameLower.includes('url') || nameLower.includes('website')) return '"{{faker.internet.url}}"';
    if (nameLower.includes('avatar') || nameLower.includes('image')) return '"{{faker.image.avatar}}"';
    if (nameLower.includes('company')) return '"{{faker.company.name}}"';
    if (nameLower.includes('title')) return '"{{faker.lorem.sentence}}"';
    if (nameLower.includes('description') || nameLower.includes('bio')) return '"{{faker.lorem.paragraph}}"';
    if (nameLower === 'id' || nameLower.endsWith('id')) return '"{{faker.string.uuid}}"';

    // Type-based fallbacks
    if (format === 'email') return '"{{faker.internet.email}}"';
    if (format === 'uri' || format === 'url') return '"{{faker.internet.url}}"';
    if (format === 'uuid') return '"{{faker.string.uuid}}"';
    if (format === 'date') return '"{{now "YYYY-MM-DD"}}"';
    if (format === 'date-time') return '"{{now "iso"}}"';

    switch (type) {
      case 'string':
        return '"{{faker.lorem.word}}"';
      case 'integer':
      case 'number':
        return '{{faker.number.int max=1000}}';
      case 'boolean':
        return '{{faker.datatype.boolean}}';
      case 'array':
        return '[]';
      case 'object':
        return '{}';
      default:
        return 'null';
    }
  }

  /**
   * Basic YAML parser for simple cases
   */
  private parseYaml(content: string): OpenApiSpec {
    // This is a very basic YAML parser
    // For production, use a proper YAML library
    const lines = content.split('\n');
    const result: Record<string, unknown> = {};
    const stack: { indent: number; obj: Record<string, unknown> }[] = [{ indent: -1, obj: result }];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const indent = line.search(/\S/);
      const match = trimmed.match(/^([^:]+):\s*(.*)$/);

      if (match) {
        const [, key, value] = match;

        // Pop stack until we find parent
        while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
          stack.pop();
        }

        const parent = stack[stack.length - 1].obj;

        if (value) {
          // Simple value
          parent[key.trim()] = this.parseYamlValue(value);
        } else {
          // Nested object
          const newObj: Record<string, unknown> = {};
          parent[key.trim()] = newObj;
          stack.push({ indent, obj: newObj });
        }
      }
    }

    return result as OpenApiSpec;
  }

  private parseYamlValue(value: string): unknown {
    const trimmed = value.trim();
    
    // Remove quotes
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      return trimmed.slice(1, -1);
    }

    // Boolean
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;

    // Null
    if (trimmed === 'null' || trimmed === '~') return null;

    // Number
    const num = Number(trimmed);
    if (!isNaN(num)) return num;

    return trimmed;
  }
}
