import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import {
  RouteConfig,
  RouteConfigSchema,
  HttpMethodSchema,
  MockServerConfig,
} from '../types/core.js';
import type { AiService, AiRequestOptions } from './AiService.js';

/** Route shape the model is asked to produce (no ids — we assign them). */
const GeneratedRouteSchema = RouteConfigSchema.omit({ id: true }).extend({
  enabled: z.boolean().default(true),
});

const GeneratedServerSchema = z.object({
  name: z.string().min(1),
  port: z.number().min(1024).max(65535).default(3000),
  routes: z.array(GeneratedRouteSchema),
});

export interface GeneratedServer {
  name: string;
  port: number;
  routes: Omit<RouteConfig, 'id'>[];
}

export const ROUTE_FORMAT_INSTRUCTIONS = `Each route object must follow this exact JSON shape:
{
  "name": "Human readable route name",
  "enabled": true,
  "method": "GET",                    // one of GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS
  "path": "/api/users/:id",           // Express-style path, use :param for path parameters
  "response": {
    "type": "static",                 // "static" for fixed JSON, "dynamic" for templated responses
    "statusCode": 200,
    "headers": { "Content-Type": "application/json" },
    "body": { "contentType": "application/json", "content": { /* realistic example JSON */ } }
  },
  "tags": ["users"]
}

For dynamic/randomized responses use "type": "dynamic" and add a Handlebars template instead of a body:
  "template": { "engine": "handlebars", "template": "{ \\"id\\": \\"{{faker 'string.uuid'}}\\", \\"name\\": \\"{{faker 'person.fullName'}}\\" }" }
Available template helpers: {{faker 'namespace.method'}} (faker.js v8 API), {{request.params.name}}, {{request.query.name}}, {{request.body.field}}, {{now}}, {{uuid}}.

To simulate a slow response add an optional top-level delay field (milliseconds):
  "delay": { "type": "fixed", "value": 10000 }

Rules:
- Response bodies must contain realistic, domain-appropriate example data (never "string", "example", or lorem ipsum).
- Cover the full CRUD lifecycle when the request implies a resource (list, get by id, create with 201, update, delete with 204).
- Include sensible error routes (404 for missing ids, 400 for validation) when useful.
- When asked for multiple routes, either a bare JSON array or an object of the form {"routes": [...]} is accepted.
- Return ONLY a JSON value, no explanation.`;

/**
 * JSON Schema for generated routes, forwarded to providers with native
 * structured outputs. Written to the strict dialect both Anthropic structured
 * outputs and OpenAI json_schema accept: object root, additionalProperties:
 * false on every object, no minLength/minimum/maximum (validateRoutes and
 * verifyRoutes enforce those), and no string-map `headers` (strict dialects
 * can't express maps). validateRoutes unwraps the {"routes": [...]} root.
 */
export const ROUTES_JSON_SCHEMA: Record<string, unknown> = (() => {
  const method = { type: 'string', enum: HttpMethodSchema.options };
  const route = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      enabled: { type: 'boolean' },
      method: { anyOf: [method, { type: 'array', items: method }] },
      path: { type: 'string' },
      response: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['static', 'dynamic', 'proxy', 'database', 'sequence'],
          },
          statusCode: { type: 'integer' },
          body: {
            type: 'object',
            properties: { contentType: { type: 'string' }, content: {} },
            required: ['contentType', 'content'],
            additionalProperties: false,
          },
          template: {
            type: 'object',
            properties: {
              engine: { type: 'string', enum: ['handlebars'] },
              template: { type: 'string' },
            },
            required: ['engine', 'template'],
            additionalProperties: false,
          },
        },
        required: ['type', 'statusCode'],
        additionalProperties: false,
      },
      delay: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['fixed', 'random'] },
          value: { type: 'number' },
          min: { type: 'number' },
          max: { type: 'number' },
        },
        required: ['type'],
        additionalProperties: false,
      },
      priority: { type: 'number' },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['name', 'method', 'path', 'response'],
    additionalProperties: false,
  };
  return {
    type: 'object',
    properties: { routes: { type: 'array', items: route } },
    required: ['routes'],
    additionalProperties: false,
  };
})();

export interface RejectedRoute {
  route: Omit<RouteConfig, 'id'>;
  reasons: string[];
}

export interface RouteVerification {
  accepted: Omit<RouteConfig, 'id'>[];
  rejected: RejectedRoute[];
}

/**
 * Generates mock servers and routes from natural language descriptions using
 * the active AI provider (Copilot, Claude, OpenAI, or Gemini), validating
 * everything against Mocklify's Zod schemas before it touches the
 * configuration store.
 */
export class MockGenerator {
  constructor(private ai: AiService) {}

  /**
   * Generate a complete mock server (name, port, routes) from a description.
   */
  async generateServer(
    description: string,
    options?: AiRequestOptions & { defaultPort?: number }
  ): Promise<GeneratedServer> {
    const prompt = `You are an API design expert. Design a mock REST API for the following request:

"${description}"

Return a single JSON object:
{
  "name": "Short server name",
  "port": ${options?.defaultPort ?? 3000},
  "routes": [ /* array of route objects */ ]
}

${ROUTE_FORMAT_INSTRUCTIONS}`;

    const raw = await this.ai.sendJsonRequest(prompt, options);
    return this.validateServer(raw);
  }

  /**
   * Generate one or more routes for an existing server from a description.
   */
  async generateRoutes(
    description: string,
    existingServer?: Pick<MockServerConfig, 'name' | 'routes'>,
    options?: AiRequestOptions
  ): Promise<Omit<RouteConfig, 'id'>[]> {
    const context = existingServer
      ? `The routes will be added to an existing mock server named "${existingServer.name}" which already has these routes:\n${existingServer.routes
          .map((r) => `- ${Array.isArray(r.method) ? r.method.join('|') : r.method} ${r.path}`)
          .join('\n') || '(none)'}\nDo not duplicate existing routes.`
      : '';

    const prompt = `You are an API design expert. Create mock API route(s) for the following request:

"${description}"

${context}

Return a JSON array of route objects.

${ROUTE_FORMAT_INSTRUCTIONS}`;

    const raw = await this.ai.sendJsonRequest(prompt, options, ROUTES_JSON_SCHEMA);
    return MockGenerator.validateRoutes(raw);
  }

  /**
   * Generate a realistic response body for a route from a description.
   */
  async generateResponseBody(
    method: string,
    path: string,
    description: string,
    options?: AiRequestOptions
  ): Promise<unknown> {
    const prompt = `Generate a realistic JSON response body for this API endpoint:

${method} ${path}
Purpose: ${description}

Use realistic, domain-appropriate example data. Return ONLY the JSON body, no explanation.`;

    return this.ai.sendJsonRequest(prompt, options);
  }

  private validateServer(raw: unknown): GeneratedServer {
    const parsed = GeneratedServerSchema.parse(raw);
    return {
      name: parsed.name,
      port: parsed.port,
      routes: parsed.routes as Omit<RouteConfig, 'id'>[],
    };
  }

  /**
   * Validate model output as an array of routes. Accepts a bare route object,
   * an array, or an object wrapping the array (structured outputs and OpenAI
   * json_object mode produce {"routes": [...]}); drops invalid entries only
   * if at least one valid route remains.
   */
  static validateRoutes(raw: unknown): Omit<RouteConfig, 'id'>[] {
    let value = raw;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record);
      if (Array.isArray(record.routes)) {
        value = record.routes;
      } else if (keys.length === 1 && Array.isArray(record[keys[0]])) {
        value = record[keys[0]];
      }
    }
    const items = Array.isArray(value) ? value : [value];
    const valid: Omit<RouteConfig, 'id'>[] = [];
    const errors: string[] = [];

    for (const item of items) {
      const result = GeneratedRouteSchema.safeParse(item);
      if (result.success) {
        valid.push(result.data as Omit<RouteConfig, 'id'>);
      } else {
        errors.push(result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      }
    }

    if (valid.length === 0) {
      throw new Error(
        `The generated routes did not match the expected format: ${errors[0] ?? 'empty result'}`
      );
    }

    return valid;
  }

  /**
   * Programmatic sanity checks on schema-valid routes that Zod alone can't
   * express: path shape, :param syntax, plausible status codes, serializable
   * bodies, and negative routes being disabled. Rejections carry reasons so a
   * repair prompt can quote them back to the model.
   */
  static verifyRoutes(routes: Omit<RouteConfig, 'id'>[]): RouteVerification {
    const accepted: Omit<RouteConfig, 'id'>[] = [];
    const rejected: RejectedRoute[] = [];

    for (const route of routes) {
      const reasons: string[] = [];

      if (!route.path.startsWith('/')) {
        reasons.push(`path must start with "/" (got "${route.path}")`);
      }
      if (/\s/.test(route.path)) {
        reasons.push('path must not contain whitespace');
      }
      if (/[{}<>]/.test(route.path)) {
        reasons.push(
          `path parameters must use :name form, not {name} or <name> (got "${route.path}")`
        );
      }
      for (const segment of route.path.split('/')) {
        if (segment.startsWith(':') && !/^:[A-Za-z_][A-Za-z0-9_]*$/.test(segment)) {
          reasons.push(`invalid path parameter "${segment}" — use :paramName`);
        }
      }

      const status = route.response.statusCode;
      if (!Number.isInteger(status) || status < 200 || status > 599) {
        reasons.push(`implausible response status code ${status} (expected 200-599)`);
      }

      if (route.response.body !== undefined) {
        if (route.response.body.content === undefined) {
          reasons.push('response body is present but has no content');
        } else {
          try {
            JSON.stringify(route.response.body.content);
          } catch {
            reasons.push('response body content is not JSON-serializable');
          }
        }
      }

      if (route.tags?.includes('negative') && route.enabled) {
        reasons.push('negative-flow routes must have "enabled": false');
      }

      if (reasons.length === 0) {
        accepted.push(route);
      } else {
        rejected.push({ route, reasons });
      }
    }

    return { accepted, rejected };
  }

  /** Attach fresh ids so generated routes can be stored. */
  static withIds(routes: Omit<RouteConfig, 'id'>[]): RouteConfig[] {
    return routes.map((route) => ({ ...route, id: uuidv4() }));
  }
}
