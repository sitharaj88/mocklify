import { GraphQlRoute } from '../types/core.js';

export type GraphQlOperationType = 'query' | 'mutation' | 'subscription';

export interface ParsedGraphQlOperation {
  operationType?: GraphQlOperationType;
  operationName?: string;
}

export interface GraphQlBody {
  query: string;
  operationName?: string;
  variables?: unknown;
}

const NAME_START = /[A-Za-z_]/;
const NAME_CHAR = /[A-Za-z0-9_]/;

// Upper bound on operations scanned from one document. A single GraphQL request
// realistically carries a handful of operations; the cap keeps an adversarial
// document (e.g. 200KB of `{}{}…`) from growing an unbounded operation list.
const MAX_SCANNED_OPERATIONS = 100;

/**
 * Scan every top-level operation from a GraphQL document, in order, skipping
 * leading/interleaved `fragment` definitions. Single-pass, non-backtracking —
 * O(n) in the query length with no nested quantifiers, so a pathological 200KB
 * query cannot cause catastrophic regex backtracking.
 *
 * Recognizes: `query|mutation|subscription [Name]`, the anonymous shorthand `{`
 * (typed as a query), and skips whitespace, commas, `# ...` comments and
 * `fragment Name on Type { ... }` blocks. `limit` stops the scan early once that
 * many operations have been collected (the common single-operation fast path).
 */
export function scanOperations(query: string, limit = MAX_SCANNED_OPERATIONS): ParsedGraphQlOperation[] {
  const len = query.length;
  const cap = Math.min(limit, MAX_SCANNED_OPERATIONS);
  const ops: ParsedGraphQlOperation[] = [];
  let i = 0;

  const skipIgnored = (): void => {
    while (i < len) {
      const c = query[i];
      if (c === '#') {
        while (i < len && query[i] !== '\n') i++;
      } else if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ',' || c === '﻿') {
        i++;
      } else {
        break;
      }
    }
  };

  const readName = (): string => {
    const start = i;
    while (i < len && NAME_CHAR.test(query[i])) i++;
    return query.slice(start, i);
  };

  // Skip a GraphQL string (`"..."` or `"""..."""`) so a brace inside a string
  // never throws off selection-set brace balancing.
  const skipString = (): void => {
    if (query.startsWith('"""', i)) {
      i += 3;
      while (i < len && !query.startsWith('"""', i)) i++;
      i += 3;
      return;
    }
    i++; // opening quote
    while (i < len && query[i] !== '"') {
      if (query[i] === '\\') i++;
      i++;
    }
    i++; // closing quote
  };

  // Advance past the current definition's selection set: scan to the first `{`
  // (arguments/directives before it are skipped), then consume balanced braces,
  // respecting strings and comments. No-op if no `{` exists before EOF.
  const skipSelectionSet = (): void => {
    let depth = 0;
    let entered = false;
    while (i < len) {
      const c = query[i];
      if (c === '#') {
        while (i < len && query[i] !== '\n') i++;
        continue;
      }
      if (c === '"') {
        skipString();
        continue;
      }
      if (c === '{') {
        depth++;
        entered = true;
        i++;
        continue;
      }
      if (c === '}') {
        i++;
        if (entered && --depth === 0) return;
        continue;
      }
      i++;
    }
  };

  while (i < len && ops.length < cap) {
    skipIgnored();
    if (i >= len) break;

    // Anonymous shorthand: a document beginning with a selection set is a query.
    if (query[i] === '{') {
      ops.push({ operationType: 'query' });
      if (ops.length >= cap) break;
      skipSelectionSet();
      continue;
    }

    if (!NAME_START.test(query[i])) break;
    const keyword = readName();

    if (keyword === 'fragment') {
      skipSelectionSet(); // skips `Name on Type { ... }`
      continue;
    }

    if (keyword === 'query' || keyword === 'mutation' || keyword === 'subscription') {
      const operationType = keyword as GraphQlOperationType;
      skipIgnored();
      // A Name here is the operation name; `(`, `{` or `@` mean an anonymous op.
      const operationName = i < len && NAME_START.test(query[i]) ? readName() : undefined;
      ops.push(operationName ? { operationType, operationName } : { operationType });
      if (ops.length >= cap) break;
      skipSelectionSet();
      continue;
    }

    break; // unknown leading token — stop
  }

  return ops;
}

/**
 * Extract the first operation's name and (when present) type from GraphQL query
 * text. Leading `fragment` definitions are skipped. Returns {} when no operation
 * can be identified.
 */
export function parseOperationNameFromQuery(query: string): ParsedGraphQlOperation {
  return scanOperations(query, 1)[0] ?? {};
}

/**
 * Coerce a request body into a GraphQL request shape. Accepts an already-parsed
 * object (fastify JSON parsing) or a raw JSON string. Returns null for anything
 * that is not `{ query: string, ... }` — the caller treats null as "no match"
 * and never throws a 500.
 */
export function parseGraphQlBody(body: unknown): GraphQlBody | null {
  let obj: unknown = body;
  if (typeof body === 'string') {
    try {
      obj = JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object') return null;
  const record = obj as Record<string, unknown>;
  const query = record.query;
  if (typeof query !== 'string') return null;
  const operationName = typeof record.operationName === 'string' ? record.operationName : undefined;
  return { query, operationName, variables: record.variables };
}

/**
 * True when a POST request body targets the given graphql route's operation.
 * Effective operation name is `body.operationName ?? first parsed operation`.
 * The operation-type guard uses the type of the operation actually selected:
 * when `body.operationName` names one of several operations, that operation's
 * type is checked (not the first operation's). When the named operation cannot
 * be located in the parsed document, the type guard is skipped rather than
 * mismatched. A malformed/unparseable body yields false, never an error.
 */
export function matchesGraphQlRoute(
  method: string,
  body: unknown,
  graphql: GraphQlRoute
): boolean {
  if (method.toUpperCase() !== 'POST') return false;
  const parsedBody = parseGraphQlBody(body);
  if (!parsedBody) return false;

  const ops = scanOperations(parsedBody.query);
  const firstOp = ops[0];
  const opName = parsedBody.operationName ?? firstOp?.operationName;
  if (!opName || opName !== graphql.operationName) return false;

  // Select the operation whose type to enforce. With an explicit
  // body.operationName, use the matching operation (undefined type ⇒ skip the
  // guard). Otherwise the effective name came from the first operation.
  const selected = parsedBody.operationName
    ? ops.find((o) => o.operationName === parsedBody.operationName)
    : firstOp;
  if (selected?.operationType && selected.operationType !== graphql.operationType) return false;

  return true;
}
