/**
 * Pure helpers for enriching codebase-scan AI chunks with data-model context
 * and detecting GraphQL client usage. No vscode dependency so this is fully
 * unit-testable; the vscode-coupled file resolution lives in
 * CodebaseMockGenerator.
 */

/** GraphQL client usage signals (mirrors the scanner's GraphQL markers). */
const GRAPHQL_MARKERS: RegExp[] = [
  /\bApolloClient\b|\bInMemoryCache\b|\buseLazyQuery\b/,
  /\bgql\s*(?:`|\()/,
  /\bGraphQLClient\b|['"`]graphql-request['"`]/,
  /['"`]@?urql(?:\/[\w-]+)?['"`]/,
  /["'`][^"'`\s]*\/graphql\b/,
];

export function hasGraphQlMarkers(text: string): boolean {
  return GRAPHQL_MARKERS.some((marker) => marker.test(text));
}

/**
 * Filename stems a PascalCase model type is typically defined under across
 * ecosystems: User -> User.kt / user.ts / user_model.dart-style snake case.
 */
export function modelFileNameCandidates(typeName: string): string[] {
  const snake = typeName.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  const candidates = [typeName, typeName.toLowerCase(), snake];
  return candidates.filter((name, index) => candidates.indexOf(name) === index);
}

export interface ModelFileContext {
  /** Workspace-relative path of the file the definitions came from. */
  path: string;
  /** Extracted type definition blocks. */
  definitions: string;
}

/**
 * Assemble the "## Data models" prompt section from extracted definition
 * blocks, keeping whole files until the budget runs out. Returns '' when
 * there is nothing to show (never a bare header).
 */
export function formatModelSection(files: ModelFileContext[], maxChars: number): string {
  const header = '## Data models (from the same codebase — response bodies must match these shapes)\n\n';
  let body = '';
  for (const file of files) {
    if (!file.definitions.trim()) {
      continue;
    }
    const block = `// File: ${file.path}\n${file.definitions.trim()}\n\n`;
    if (header.length + body.length + block.length > maxChars) {
      break;
    }
    body += block;
  }
  return body ? header + body.trimEnd() : '';
}
