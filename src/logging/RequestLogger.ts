import { RequestLogEntry, IRequestLogger } from '../types/core.js';
import { v4 as uuidv4 } from 'uuid';

export class RequestLogger implements IRequestLogger {
  private entries: RequestLogEntry[] = [];
  private maxEntries: number;

  constructor(maxEntries: number = 1000) {
    this.maxEntries = maxEntries;
  }

  /**
   * Log a request/response entry
   */
  log(entry: Omit<RequestLogEntry, 'id'>): void {
    const logEntry: RequestLogEntry = {
      ...entry,
      id: uuidv4(),
    };

    this.entries.unshift(logEntry);

    // Trim to max entries (circular buffer behavior)
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(0, this.maxEntries);
    }
  }

  /**
   * Get log entries, optionally filtered by server ID
   */
  getEntries(serverId?: string, limit?: number): RequestLogEntry[] {
    let result = this.entries;

    if (serverId) {
      result = result.filter((entry) => entry.serverId === serverId);
    }

    if (limit && limit > 0) {
      result = result.slice(0, limit);
    }

    return result;
  }

  /**
   * Clear log entries, optionally for a specific server
   */
  clear(serverId?: string): void {
    if (serverId) {
      this.entries = this.entries.filter((entry) => entry.serverId !== serverId);
    } else {
      this.entries = [];
    }
  }

  /**
   * Get the total number of entries
   */
  getCount(serverId?: string): number {
    if (serverId) {
      return this.entries.filter((entry) => entry.serverId === serverId).length;
    }
    return this.entries.length;
  }

  /**
   * Update the maximum number of entries
   */
  setMaxEntries(max: number): void {
    this.maxEntries = max;
    if (this.entries.length > max) {
      this.entries = this.entries.slice(0, max);
    }
  }

  /**
   * Export entries to HAR format
   */
  exportToHar(serverId?: string): object {
    const entries = this.getEntries(serverId);

    return {
      log: {
        version: '1.2',
        creator: {
          name: 'VS Code Mock Server',
          version: '1.0.0',
        },
        entries: entries.map((entry) => ({
          startedDateTime: entry.timestamp.toISOString(),
          time: entry.response.duration,
          request: {
            method: entry.request.method,
            url: entry.request.url,
            httpVersion: 'HTTP/1.1',
            headers: Object.entries(entry.request.headers)
              .filter(([_, v]) => v !== undefined)
              .map(([name, value]) => ({
                name,
                value: Array.isArray(value) ? value.join(', ') : value,
              })),
            queryString: Object.entries(entry.request.query)
              .filter(([_, v]) => v !== undefined)
              .map(([name, value]) => ({
                name,
                value: Array.isArray(value) ? value.join(', ') : value,
              })),
            postData: entry.request.body
              ? {
                  mimeType: 'application/json',
                  text: typeof entry.request.body === 'string'
                    ? entry.request.body
                    : JSON.stringify(entry.request.body),
                }
              : undefined,
          },
          response: {
            status: entry.response.statusCode,
            statusText: this.getStatusText(entry.response.statusCode),
            httpVersion: 'HTTP/1.1',
            headers: Object.entries(entry.response.headers).map(([name, value]) => ({
              name,
              value,
            })),
            content: {
              size: entry.response.body
                ? JSON.stringify(entry.response.body).length
                : 0,
              mimeType: entry.response.headers['Content-Type'] || 'application/json',
              text: entry.response.body
                ? typeof entry.response.body === 'string'
                  ? entry.response.body
                  : JSON.stringify(entry.response.body)
                : undefined,
            },
          },
          cache: {},
          timings: {
            send: 0,
            wait: entry.response.duration,
            receive: 0,
          },
        })),
      },
    };
  }

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
      500: 'Internal Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable',
    };
    return statusTexts[code] || 'Unknown';
  }
}
