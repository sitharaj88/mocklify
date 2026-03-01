import * as fs from 'fs/promises';
import { MockServerConfig, RouteConfig, RequestLogEntry } from '../types/core.js';

export interface ExportFormat {
  type: 'json' | 'yaml' | 'har' | 'curl';
}

export interface HarLog {
  version: string;
  creator: { name: string; version: string };
  entries: HarEntry[];
}

export interface HarEntry {
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    httpVersion: string;
    headers: { name: string; value: string }[];
    queryString: { name: string; value: string }[];
    bodySize: number;
    postData?: { mimeType: string; text: string };
  };
  response: {
    status: number;
    statusText: string;
    httpVersion: string;
    headers: { name: string; value: string }[];
    content: { size: number; mimeType: string; text?: string };
    bodySize: number;
  };
  cache: object;
  timings: { wait: number; receive: number };
}

export interface ExportOptions {
  pretty?: boolean;
  includeDisabled?: boolean;
  includeMetadata?: boolean;
}

export class ExportService {
  /**
   * Export server configuration to JSON
   */
  exportServerToJson(server: MockServerConfig, options?: ExportOptions): string {
    const data = options?.includeMetadata
      ? server
      : this.stripMetadata(server);

    return options?.pretty
      ? JSON.stringify(data, null, 2)
      : JSON.stringify(data);
  }

  /**
   * Export routes to JSON
   */
  exportRoutesToJson(routes: RouteConfig[], options?: ExportOptions): string {
    const filteredRoutes = options?.includeDisabled
      ? routes
      : routes.filter((r) => r.enabled);

    return options?.pretty
      ? JSON.stringify(filteredRoutes, null, 2)
      : JSON.stringify(filteredRoutes);
  }

  /**
   * Export request logs to HAR format
   */
  exportLogsToHar(logs: RequestLogEntry[], serverPort: number = 3000): HarLog {
    const entries: HarEntry[] = logs.map((log) => ({
      startedDateTime: log.timestamp instanceof Date 
        ? log.timestamp.toISOString() 
        : new Date(log.timestamp).toISOString(),
      time: log.response.duration,
      request: {
        method: log.request.method,
        url: `http://localhost:${serverPort}${log.request.url}`,
        httpVersion: 'HTTP/1.1',
        headers: Object.entries(log.request.headers)
          .filter(([, v]) => v !== undefined)
          .map(([name, value]) => ({
            name,
            value: Array.isArray(value) ? value.join(', ') : value || '',
          })),
        queryString: Object.entries(log.request.query)
          .filter(([, v]) => v !== undefined)
          .map(([name, value]) => ({
            name,
            value: Array.isArray(value) ? value.join(', ') : value || '',
          })),
        bodySize: log.request.body ? JSON.stringify(log.request.body).length : 0,
        postData: log.request.body
          ? {
              mimeType: 'application/json',
              text: typeof log.request.body === 'string'
                ? log.request.body
                : JSON.stringify(log.request.body),
            }
          : undefined,
      },
      response: {
        status: log.response.statusCode,
        statusText: this.getStatusText(log.response.statusCode),
        httpVersion: 'HTTP/1.1',
        headers: Object.entries(log.response.headers).map(([name, value]) => ({
          name,
          value,
        })),
        content: {
          size: log.response.body ? JSON.stringify(log.response.body).length : 0,
          mimeType: log.response.headers['Content-Type'] || 'application/json',
          text: log.response.body
            ? typeof log.response.body === 'string'
              ? log.response.body
              : JSON.stringify(log.response.body)
            : undefined,
        },
        bodySize: log.response.body ? JSON.stringify(log.response.body).length : 0,
      },
      cache: {},
      timings: {
        wait: log.response.duration,
        receive: 0,
      },
    }));

    return {
      version: '1.2',
      creator: {
        name: 'Mocklify',
        version: '0.1.0',
      },
      entries,
    };
  }

  /**
   * Export request log to cURL command
   */
  exportLogToCurl(log: RequestLogEntry, serverPort: number = 3000): string {
    const parts: string[] = ['curl'];

    // Method
    if (log.request.method !== 'GET') {
      parts.push(`-X ${log.request.method}`);
    }

    // Headers
    for (const [name, value] of Object.entries(log.request.headers)) {
      if (value && !['host', 'content-length'].includes(name.toLowerCase())) {
        const headerValue = Array.isArray(value) ? value.join(', ') : value;
        parts.push(`-H '${name}: ${headerValue}'`);
      }
    }

    // Body
    if (log.request.body) {
      const body = typeof log.request.body === 'string'
        ? log.request.body
        : JSON.stringify(log.request.body);
      parts.push(`-d '${body.replace(/'/g, "\\'")}'`);
    }

    // URL
    parts.push(`'http://localhost:${serverPort}${log.request.url}'`);

    return parts.join(' \\\n  ');
  }

  /**
   * Export multiple logs to cURL commands
   */
  exportLogsToCurl(logs: RequestLogEntry[], serverPort: number = 3000): string {
    return logs.map((log) => this.exportLogToCurl(log, serverPort)).join('\n\n');
  }

  /**
   * Export configuration to file
   */
  async exportToFile(filePath: string, content: string | object): Promise<void> {
    const data = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    await fs.writeFile(filePath, data, 'utf-8');
  }

  /**
   * Import configuration from file
   */
  async importFromFile<T>(filePath: string): Promise<T> {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  }

  /**
   * Strip metadata from server config for cleaner export
   */
  private stripMetadata(server: MockServerConfig): Partial<MockServerConfig> {
    const { createdAt, updatedAt, ...rest } = server;
    return {
      ...rest,
      routes: rest.routes.map((route) => {
        const { id, ...routeRest } = route;
        return routeRest as RouteConfig;
      }),
    };
  }

  /**
   * Get HTTP status text
   */
  private getStatusText(code: number): string {
    const statusTexts: Record<number, string> = {
      200: 'OK',
      201: 'Created',
      204: 'No Content',
      301: 'Moved Permanently',
      302: 'Found',
      304: 'Not Modified',
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      405: 'Method Not Allowed',
      409: 'Conflict',
      422: 'Unprocessable Entity',
      429: 'Too Many Requests',
      500: 'Internal Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable',
      504: 'Gateway Timeout',
    };

    return statusTexts[code] || 'Unknown';
  }
}
