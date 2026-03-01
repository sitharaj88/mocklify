export interface ProxyAuthConfig {
  type: 'basic' | 'bearer' | 'apiKey';
  username?: string;
  password?: string;
  token?: string;
  apiKey?: string;
  apiKeyHeader?: string;
}

export interface ProxyRequestOptions {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | string[] | undefined>;
  body?: unknown;
  targetUrl: string;
  preserveHost?: boolean;
  timeout?: number;
  followRedirects?: boolean;
  rewriteHeaders?: Record<string, string>;
  stripHeaders?: string[];
  auth?: ProxyAuthConfig;
}

export interface ProxyResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  duration: number;
}

export class ProxyHandler {
  private defaultTimeout = 30000;

  /**
   * Forward a request to the target URL
   */
  async forward(options: ProxyRequestOptions): Promise<ProxyResponse> {
    const startTime = Date.now();

    // Build target URL
    const targetUrl = this.buildTargetUrl(options);

    // Build headers
    const headers = this.buildHeaders(options);

    // Build request options
    const fetchOptions: RequestInit = {
      method: options.method,
      headers,
      redirect: options.followRedirects !== false ? 'follow' : 'manual',
    };

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, options.timeout ?? this.defaultTimeout);

    fetchOptions.signal = controller.signal;

    // Add body for non-GET/HEAD requests
    if (options.body && !['GET', 'HEAD'].includes(options.method.toUpperCase())) {
      if (typeof options.body === 'string') {
        fetchOptions.body = options.body;
      } else if (Buffer.isBuffer(options.body)) {
        fetchOptions.body = options.body;
      } else {
        fetchOptions.body = JSON.stringify(options.body);
        if (!headers['content-type']) {
          headers['content-type'] = 'application/json';
        }
      }
    }

    try {
      const response = await fetch(targetUrl.toString(), fetchOptions);
      clearTimeout(timeoutId);

      // Parse response body
      const contentType = response.headers.get('content-type') || '';
      let body: unknown;

      if (contentType.includes('application/json')) {
        try {
          body = await response.json();
        } catch {
          body = await response.text();
        }
      } else if (contentType.includes('text/')) {
        body = await response.text();
      } else {
        const arrayBuffer = await response.arrayBuffer();
        body = Buffer.from(arrayBuffer);
      }

      // Convert response headers
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        if (!this.isHopByHopHeader(key)) {
          responseHeaders[key] = value;
        }
      });

      return {
        statusCode: response.status,
        headers: responseHeaders,
        body,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          return {
            statusCode: 504,
            headers: { 'Content-Type': 'application/json' },
            body: {
              error: 'Gateway Timeout',
              message: `Proxy request timed out after ${options.timeout ?? this.defaultTimeout}ms`,
              target: targetUrl.toString(),
            },
            duration,
          };
        }

        return {
          statusCode: 502,
          headers: { 'Content-Type': 'application/json' },
          body: {
            error: 'Bad Gateway',
            message: error.message,
            target: targetUrl.toString(),
          },
          duration,
        };
      }

      return {
        statusCode: 502,
        headers: { 'Content-Type': 'application/json' },
        body: {
          error: 'Bad Gateway',
          message: 'Unknown proxy error',
          target: targetUrl.toString(),
        },
        duration,
      };
    }
  }

  /**
   * Build the full target URL including query parameters
   */
  private buildTargetUrl(options: ProxyRequestOptions): URL {
    const baseUrl = options.targetUrl.endsWith('/')
      ? options.targetUrl.slice(0, -1)
      : options.targetUrl;

    const path = options.path.startsWith('/') ? options.path : `/${options.path}`;
    const url = new URL(`${baseUrl}${path}`);

    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined) {
        if (Array.isArray(value)) {
          value.forEach((v) => url.searchParams.append(key, v));
        } else {
          url.searchParams.set(key, value);
        }
      }
    }

    return url;
  }

  /**
   * Build headers for the proxy request
   */
  private buildHeaders(options: ProxyRequestOptions): Record<string, string> {
    const headers: Record<string, string> = {};

    for (const [key, value] of Object.entries(options.headers)) {
      if (value !== undefined && !this.isHopByHopHeader(key)) {
        headers[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
      }
    }

    if (!options.preserveHost) {
      const targetUrl = new URL(options.targetUrl);
      headers['host'] = targetUrl.host;
    }

    if (options.rewriteHeaders) {
      for (const [key, value] of Object.entries(options.rewriteHeaders)) {
        headers[key.toLowerCase()] = value;
      }
    }

    if (options.stripHeaders) {
      for (const header of options.stripHeaders) {
        delete headers[header.toLowerCase()];
      }
    }

    if (options.auth) {
      this.addAuthHeaders(headers, options.auth);
    }

    headers['x-forwarded-by'] = 'mocklify-proxy';

    return headers;
  }

  /**
   * Add authentication headers
   */
  private addAuthHeaders(headers: Record<string, string>, auth: ProxyAuthConfig): void {
    switch (auth.type) {
      case 'basic':
        if (auth.username && auth.password) {
          const credentials = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
          headers['authorization'] = `Basic ${credentials}`;
        }
        break;

      case 'bearer':
        if (auth.token) {
          headers['authorization'] = `Bearer ${auth.token}`;
        }
        break;

      case 'apiKey':
        if (auth.apiKey) {
          const headerName = auth.apiKeyHeader || 'x-api-key';
          headers[headerName.toLowerCase()] = auth.apiKey;
        }
        break;
    }
  }

  /**
   * Check if a header is a hop-by-hop header
   */
  private isHopByHopHeader(header: string): boolean {
    const hopByHopHeaders = [
      'connection',
      'keep-alive',
      'proxy-authenticate',
      'proxy-authorization',
      'te',
      'trailer',
      'transfer-encoding',
      'upgrade',
    ];
    return hopByHopHeaders.includes(header.toLowerCase());
  }
}
