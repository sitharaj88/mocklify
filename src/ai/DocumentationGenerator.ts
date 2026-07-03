import * as vscode from 'vscode';
import { MockServerConfig } from '../types/core.js';
import { DocsService } from '../services/DocsService.js';
import { OpenApiExportService } from '../services/OpenApiExportService.js';
import { AiService } from './AiService.js';
import { AiUnavailableError } from './providers/types.js';

export interface DocsGenerationResult {
  markdown: string;
  /** True when AI enhanced the docs; false when the deterministic fallback was used. */
  aiEnhanced: boolean;
}

/**
 * Generates polished API documentation for a mock server. Uses the active AI
 * provider to write overviews, endpoint descriptions, and usage guides
 * grounded in the actual server configuration; falls back to accurate
 * deterministic reference docs when no AI provider is available.
 */
export class DocumentationGenerator {
  private docsService = new DocsService();
  private openApiExport = new OpenApiExportService();

  constructor(private ai: AiService) {}

  /**
   * Generate documentation, streaming Markdown fragments via onFragment when
   * Copilot is available.
   */
  async generate(
    server: MockServerConfig,
    options?: {
      token?: vscode.CancellationToken;
      onFragment?: (fragment: string) => void;
    }
  ): Promise<DocsGenerationResult> {
    const referenceDocs = this.docsService.generateMarkdown(server);

    try {
      const prompt = this.buildPrompt(server, referenceDocs);
      let markdown = '';
      for await (const fragment of this.ai.streamRequest(prompt, {
        token: options?.token,
        justification: 'Mocklify uses AI to write API documentation for your mock servers.',
      })) {
        markdown += fragment;
        options?.onFragment?.(fragment);
      }

      const cleaned = this.stripOuterFence(markdown).trim();
      if (cleaned.length < 100) {
        // Model returned something unusable — keep the accurate fallback
        return { markdown: referenceDocs, aiEnhanced: false };
      }
      return { markdown: cleaned, aiEnhanced: true };
    } catch (error) {
      if (error instanceof AiUnavailableError) {
        return { markdown: referenceDocs, aiEnhanced: false };
      }
      throw error;
    }
  }

  /**
   * Deterministic reference docs only (no AI).
   */
  generateReference(server: MockServerConfig): string {
    return this.docsService.generateMarkdown(server);
  }

  /**
   * OpenAPI 3.0 JSON for the server.
   */
  generateOpenApi(server: MockServerConfig): string {
    return this.openApiExport.exportToJson(server);
  }

  private buildPrompt(server: MockServerConfig, referenceDocs: string): string {
    const spec = this.openApiExport.exportToJson(server);

    return `You are a senior technical writer producing world-class API documentation.

Below is the complete, factual reference documentation and OpenAPI spec for a mock API server. Rewrite it as polished developer documentation in Markdown.

Requirements:
- Start with a title, a one-paragraph overview of what this API does (infer the domain from the endpoints), and a Quick Start section showing how to call the API at http://localhost:${server.port}.
- Document EVERY endpoint from the reference — do not invent endpoints that are not listed, and do not omit any.
- For each endpoint: a clear description of its purpose, parameters, the example response shown in the reference, and a curl example.
- Add an "Error Handling" section if error routes (4xx/5xx) exist.
- Keep all paths, methods, status codes, ports, and response bodies EXACTLY as given in the reference.
- Output pure Markdown only — no surrounding code fence, no commentary about the task.

## Reference documentation (source of truth)

${referenceDocs}

## OpenAPI specification

\`\`\`json
${spec}
\`\`\``;
  }

  private stripOuterFence(markdown: string): string {
    const trimmed = markdown.trim();
    const match = trimmed.match(/^```(?:markdown|md)?\n([\s\S]*)\n```$/);
    return match ? match[1] : trimmed;
  }
}
