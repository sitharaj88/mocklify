import { readFileSync } from 'node:fs';
import { isAbsolute, resolve as resolvePath } from 'node:path';
import { OpenApiImportService } from './OpenApiImportService.js';
import type { RouteConfig } from '../types/core.js';

/**
 * Pure, vscode-free OpenAPI 3.x request contract validator (Engineer E3).
 *
 * The interfaces below mirror the shared contract's §2 types verbatim. They are
 * defined locally (rather than imported from types/core.ts) so this module
 * compiles standalone regardless of E5's progress on core.ts; TypeScript's
 * structural typing keeps them assignment-compatible with the versions E5 adds,
 * so the engine can call `validator.validate(...)` and INTEGRATION can pass the
 * validator to `new HttpMockServer(config, validator)` without friction.
 */

export interface ContractViolation {
  field: string;
  message: string;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; violations: ContractViolation[] };

/** vscode-free, pure request view handed to the validator. */
export interface ValidatedRequest {
  method: string;
  path: string; // path only, no query string
  params: Record<string, string>; // matched path params
  query: Record<string, string | string[] | undefined>;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

/** Synchronous and pure: no I/O, no vscode. Spec parsing happens in the factory. */
export interface RequestValidator {
  validate(req: ValidatedRequest, route: RouteConfig): ValidationResult;
}

export interface ContractConfig {
  specPath: string;
  mode: 'off' | 'warn' | 'enforce';
}

// --- Guardrails (§3 of the E3 brief) --------------------------------------
/** Hard cap on violations returned per request — logs stay bounded. */
const MAX_VIOLATIONS = 50;
/** Max schema recursion depth — deeper nodes are not descended into. */
const MAX_DEPTH = 64;
/** Node-visit budget per validate() call — guarantees termination on
 * adversarial (deeply nested / cyclic) schemas without an exponential walk. */
const MAX_VISITS = 20000;
/** Cap on oneOf/anyOf branches explored so a wide union cannot blow up. */
const MAX_UNION_BRANCHES = 24;

type JsonRecord = Record<string, unknown>;

/** Thrown internally when the visit budget is exhausted; caught in validate(). */
class BudgetExceededError extends Error {}

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

// --- Path template compilation --------------------------------------------
interface CompiledPath {
  template: string;
  segments: { literal: boolean; value: string; name?: string }[];
  /** Specificity: literal-segment count (higher = more specific). */
  literalCount: number;
  item: JsonRecord;
}

function compilePath(template: string, item: JsonRecord): CompiledPath {
  const parts = template.split('/').filter(Boolean);
  let literalCount = 0;
  const segments = parts.map((part) => {
    const m = /^\{(.+)\}$/.exec(part);
    if (m) {
      return { literal: false, value: part, name: m[1] };
    }
    literalCount++;
    return { literal: true, value: part };
  });
  return { template, segments, literalCount, item };
}

function matchCompiledPath(
  compiled: CompiledPath,
  reqSegments: string[]
): Record<string, string> | undefined {
  if (compiled.segments.length !== reqSegments.length) {
    return undefined;
  }
  const params: Record<string, string> = {};
  for (let i = 0; i < compiled.segments.length; i++) {
    const seg = compiled.segments[i];
    const actual = reqSegments[i];
    if (seg.literal) {
      if (seg.value !== actual) {
        return undefined;
      }
    } else {
      if (actual.length === 0) {
        return undefined;
      }
      params[seg.name as string] = decodeURIComponentSafe(actual);
    }
  }
  return params;
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// --- The validator implementation -----------------------------------------
class OpenApiRequestValidator implements RequestValidator {
  private readonly root: JsonRecord;
  private readonly paths: CompiledPath[];

  constructor(spec: JsonRecord) {
    this.root = spec;
    const paths = asRecord(spec.paths) ?? {};
    this.paths = Object.entries(paths)
      .map(([template, item]) => {
        const rec = asRecord(item);
        return rec ? compilePath(template, rec) : undefined;
      })
      .filter((p): p is CompiledPath => p !== undefined);
  }

  validate(req: ValidatedRequest, _route: RouteConfig): ValidationResult {
    const ctx: WalkContext = { visits: 0, refStack: [] };
    try {
      const violations = this.run(req, ctx);
      if (violations.length === 0) {
        return { ok: true };
      }
      return { ok: false, violations: sortAndCap(violations) };
    } catch (error) {
      const message =
        error instanceof BudgetExceededError
          ? 'Validation aborted: schema exceeded the safe traversal budget.'
          : `Validation could not complete: ${error instanceof Error ? error.message : String(error)}`;
      return { ok: false, violations: [{ field: 'validator', message }] };
    }
  }

  private run(req: ValidatedRequest, ctx: WalkContext): ContractViolation[] {
    // Match against the raw segments; captured params are decoded inside.
    const rawSegments = req.path.split('/').filter(Boolean);

    // Find the most specific matching spec path template.
    let best: { compiled: CompiledPath; params: Record<string, string> } | undefined;
    for (const compiled of this.paths) {
      const params = matchCompiledPath(compiled, rawSegments);
      if (!params) {
        continue;
      }
      if (
        !best ||
        compiled.literalCount > best.compiled.literalCount ||
        (compiled.literalCount === best.compiled.literalCount &&
          compiled.template < best.compiled.template)
      ) {
        best = { compiled, params };
      }
    }

    if (!best) {
      return [
        {
          field: 'path',
          message: `unknown-path: no matching path template in the contract for "${req.path}".`,
        },
      ];
    }

    const method = req.method.toLowerCase();
    const operation = asRecord(best.compiled.item[method]);
    if (!operation) {
      return [
        {
          field: 'method',
          message: `unknown-operation: the contract has no ${req.method.toUpperCase()} operation for path "${best.compiled.template}".`,
        },
      ];
    }

    const violations: ContractViolation[] = [];
    const parameters = collectParameters(best.compiled.item, operation);

    this.validateParameters(req, best.params, parameters, ctx, violations);
    this.validateBody(req, operation, ctx, violations);

    return violations;
  }

  private validateParameters(
    req: ValidatedRequest,
    pathParams: Record<string, string>,
    parameters: JsonRecord[],
    ctx: WalkContext,
    out: ContractViolation[]
  ): void {
    for (const param of parameters) {
      const name = typeof param.name === 'string' ? param.name : undefined;
      const location = typeof param.in === 'string' ? param.in : undefined;
      if (!name || !location) {
        continue;
      }
      const schema = asRecord(param.schema) ?? {};
      const required = param.required === true || location === 'path';

      let rawValue: string | string[] | undefined;
      if (location === 'path') {
        rawValue = pathParams[name];
      } else if (location === 'query') {
        rawValue = req.query[name];
      } else if (location === 'header') {
        rawValue = lookupHeader(req.headers, name);
      } else {
        // cookie and other locations are out of scope; skip.
        continue;
      }

      if (rawValue === undefined || (Array.isArray(rawValue) && rawValue.length === 0)) {
        if (required) {
          out.push({
            field: `${location}.${name}`,
            message: `Missing required ${location} parameter "${name}".`,
          });
        }
        continue;
      }

      const values = Array.isArray(rawValue) ? rawValue : [rawValue];
      const itemSchema =
        schema.type === 'array' ? asRecord(schema.items) ?? {} : schema;
      for (const value of values) {
        this.checkScalarParam(value, itemSchema, `${location}.${name}`, ctx, out);
      }
    }
  }

  private checkScalarParam(
    value: string,
    schema: JsonRecord,
    field: string,
    ctx: WalkContext,
    out: ContractViolation[]
  ): void {
    visit(ctx);
    const resolved = this.resolveSchema(schema, ctx);
    const types = normalizeTypes(resolved.type);
    if (types.length > 0 && !types.includes('string')) {
      const coerced = coerceString(value, types);
      if (!coerced.ok) {
        out.push({
          field,
          message: `Parameter "${field}" value "${value}" is not a valid ${types.join(' | ')}.`,
        });
        return;
      }
    }
    if (Array.isArray(resolved.enum) && !enumIncludesString(resolved.enum, value)) {
      out.push({
        field,
        message: `Parameter "${field}" must be one of: ${formatEnum(resolved.enum)}.`,
      });
    }
  }

  private validateBody(
    req: ValidatedRequest,
    operation: JsonRecord,
    ctx: WalkContext,
    out: ContractViolation[]
  ): void {
    const requestBody = asRecord(operation.requestBody);
    if (!requestBody) {
      return;
    }
    const content = asRecord(requestBody.content);
    const schema = content ? selectBodySchema(content) : undefined;
    const bodyRequired = requestBody.required === true;

    const bodyMissing =
      req.body === undefined ||
      (typeof req.body === 'string' && req.body.length === 0);

    if (bodyMissing) {
      if (bodyRequired) {
        out.push({ field: 'body', message: 'A request body is required by the contract.' });
      }
      return;
    }
    if (!schema) {
      return;
    }
    this.validateValue(req.body, schema, 'body', ctx, out, 0);
  }

  // --- Schema walk ---------------------------------------------------------
  private validateValue(
    value: unknown,
    schemaIn: JsonRecord,
    field: string,
    ctx: WalkContext,
    out: ContractViolation[],
    depth: number
  ): void {
    if (depth > MAX_DEPTH || out.length >= MAX_VIOLATIONS) {
      return;
    }
    visit(ctx);
    const schema = this.resolveSchema(schemaIn, ctx);

    // null handling (nullable 3.0 / type:'null' 3.1).
    if (value === null) {
      const types = normalizeTypes(schema.type);
      const nullableAllowed = schema.nullable === true || types.includes('null');
      if (!nullableAllowed && types.length > 0) {
        out.push({ field, message: `${field} must not be null.` });
      }
      return;
    }

    // Composition keywords (best-effort).
    if (Array.isArray(schema.allOf)) {
      for (const sub of schema.allOf.slice(0, MAX_UNION_BRANCHES)) {
        const subRec = asRecord(sub);
        if (subRec) {
          // Suppress additionalProperties inside allOf branches — properties may
          // legitimately live in sibling branches.
          this.validateValue(value, { ...subRec, additionalProperties: true }, field, ctx, out, depth + 1);
        }
      }
    }
    if (Array.isArray(schema.anyOf)) {
      if (!this.someBranchMatches(value, schema.anyOf, field, ctx, depth)) {
        out.push({ field, message: `${field} does not match any of the allowed schemas (anyOf).` });
      }
    }
    if (Array.isArray(schema.oneOf)) {
      // Best-effort: only a body that matches NO branch is a violation. Matching
      // more than one branch is treated as valid — non-discriminated open-object
      // unions (no `discriminator`, no `additionalProperties: false`) legitimately
      // satisfy several branches at once, and rejecting them in enforce mode would
      // block valid client traffic. This mirrors the anyOf semantics above.
      if (!this.someBranchMatches(value, schema.oneOf, field, ctx, depth)) {
        out.push({
          field,
          message: `${field} does not match any of the allowed schemas (oneOf).`,
        });
      }
    }

    const types = normalizeTypes(schema.type);
    if (types.length > 0 && !types.some((t) => matchesType(value, t))) {
      out.push({
        field,
        message: `${field} should be of type ${types.join(' | ')} but got ${jsType(value)}.`,
      });
      return; // type is wrong; deeper checks would be noise
    }

    if (Array.isArray(schema.enum) && !enumIncludes(schema.enum, value)) {
      out.push({ field, message: `${field} must be one of: ${formatEnum(schema.enum)}.` });
    }

    if (matchesType(value, 'object') && (types.includes('object') || types.length === 0)) {
      this.validateObject(value as JsonRecord, schema, field, ctx, out, depth);
    }

    if (Array.isArray(value) && (types.includes('array') || types.length === 0)) {
      const items = asRecord(schema.items);
      if (items) {
        const limit = Math.min(value.length, 500);
        for (let i = 0; i < limit; i++) {
          if (out.length >= MAX_VIOLATIONS) {
            break;
          }
          this.validateValue(value[i], items, `${field}[${i}]`, ctx, out, depth + 1);
        }
      }
    }
  }

  private validateObject(
    value: JsonRecord,
    schema: JsonRecord,
    field: string,
    ctx: WalkContext,
    out: ContractViolation[],
    depth: number
  ): void {
    const properties = asRecord(schema.properties) ?? {};

    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key === 'string' && !(key in value)) {
          out.push({ field: `${field}.${key}`, message: `Missing required property "${key}".` });
        }
      }
    }

    for (const [key, propValue] of Object.entries(value)) {
      if (out.length >= MAX_VIOLATIONS) {
        return;
      }
      const propSchema = asRecord(properties[key]);
      if (propSchema) {
        this.validateValue(propValue, propSchema, `${field}.${key}`, ctx, out, depth + 1);
      } else if (schema.additionalProperties === false) {
        out.push({
          field: `${field}.${key}`,
          message: `Unexpected property "${key}" is not allowed (additionalProperties: false).`,
        });
      } else {
        const addl = asRecord(schema.additionalProperties);
        if (addl) {
          this.validateValue(propValue, addl, `${field}.${key}`, ctx, out, depth + 1);
        }
      }
    }
  }

  private someBranchMatches(
    value: unknown,
    branches: unknown[],
    field: string,
    ctx: WalkContext,
    depth: number
  ): boolean {
    for (const branch of branches.slice(0, MAX_UNION_BRANCHES)) {
      const rec = asRecord(branch);
      if (!rec) {
        continue;
      }
      const probe: ContractViolation[] = [];
      this.validateValue(value, rec, field, ctx, probe, depth + 1);
      if (probe.length === 0) {
        return true;
      }
    }
    return false;
  }

  /** Resolve a possibly-$ref schema against the root, cycle-safe + budgeted. */
  private resolveSchema(schema: JsonRecord, ctx: WalkContext): JsonRecord {
    let current = schema;
    let hops = 0;
    while (typeof current.$ref === 'string') {
      const ref = current.$ref;
      if (ctx.refStack.includes(ref) || hops >= MAX_DEPTH) {
        return {}; // cyclic or over-deep ref → treat as unconstrained
      }
      visit(ctx);
      const target = lookupPointer(this.root, ref);
      const rec = asRecord(target);
      if (!rec) {
        return {};
      }
      ctx.refStack.push(ref);
      current = rec;
      hops++;
    }
    // Pop refs consumed on this resolution so sibling branches see a clean stack.
    if (hops > 0) {
      ctx.refStack.splice(ctx.refStack.length - hops, hops);
    }
    return current;
  }
}

interface WalkContext {
  visits: number;
  refStack: string[];
}

function visit(ctx: WalkContext): void {
  ctx.visits++;
  if (ctx.visits > MAX_VISITS) {
    throw new BudgetExceededError();
  }
}

// --- Helpers ---------------------------------------------------------------
function collectParameters(pathItem: JsonRecord, operation: JsonRecord): JsonRecord[] {
  const byKey = new Map<string, JsonRecord>();
  const add = (list: unknown): void => {
    if (!Array.isArray(list)) {
      return;
    }
    for (const entry of list) {
      const rec = asRecord(entry);
      if (rec && typeof rec.name === 'string' && typeof rec.in === 'string') {
        byKey.set(`${rec.in}:${rec.name}`, rec);
      }
    }
  };
  add(pathItem.parameters); // path-level first
  add(operation.parameters); // operation-level overrides by (in,name)
  return [...byKey.values()];
}

function lookupHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | string[] | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      return value;
    }
  }
  return undefined;
}

function selectBodySchema(content: JsonRecord): JsonRecord | undefined {
  const preferOrder = ['application/json', 'application/*+json', '*/*'];
  for (const ct of preferOrder) {
    const media = asRecord(content[ct]);
    const schema = media && asRecord(media.schema);
    if (schema) {
      return schema;
    }
  }
  // fall back to any content type declaring a JSON-ish schema
  for (const key of Object.keys(content)) {
    if (key.includes('json')) {
      const media = asRecord(content[key]);
      const schema = media && asRecord(media.schema);
      if (schema) {
        return schema;
      }
    }
  }
  const first = Object.values(content)[0];
  const media = asRecord(first);
  return media ? asRecord(media.schema) : undefined;
}

function normalizeTypes(type: unknown): string[] {
  if (typeof type === 'string') {
    return [type];
  }
  if (Array.isArray(type)) {
    return type.filter((t): t is string => typeof t === 'string');
  }
  return [];
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'null':
      return value === null;
    default:
      return true; // unknown type keyword → do not fail
  }
}

function jsType(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value;
}

function coerceString(value: string, types: string[]): { ok: boolean } {
  const trimmed = value.trim();
  for (const type of types) {
    switch (type) {
      case 'string':
        return { ok: true };
      case 'integer':
        if (/^[+-]?\d+$/.test(trimmed)) {
          return { ok: true };
        }
        break;
      case 'number':
        if (trimmed !== '' && Number.isFinite(Number(trimmed))) {
          return { ok: true };
        }
        break;
      case 'boolean':
        if (trimmed === 'true' || trimmed === 'false') {
          return { ok: true };
        }
        break;
      default:
        return { ok: true };
    }
  }
  return { ok: false };
}

function enumIncludes(list: unknown[], value: unknown): boolean {
  return list.some((entry) => deepEqual(entry, value));
}

function enumIncludesString(list: unknown[], value: string): boolean {
  return list.some((entry) => String(entry) === value);
}

function formatEnum(list: unknown[]): string {
  return list
    .slice(0, 20)
    .map((v) => (typeof v === 'string' ? `"${v}"` : String(v)))
    .join(', ');
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== typeof b) {
    return false;
  }
  if (a && b && typeof a === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) {
      return false;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
    }
    const ao = a as JsonRecord;
    const bo = b as JsonRecord;
    const ak = Object.keys(ao);
    const bk = Object.keys(bo);
    return ak.length === bk.length && ak.every((k) => deepEqual(ao[k], bo[k]));
  }
  return false;
}

function lookupPointer(root: unknown, ref: string): unknown {
  if (!ref.startsWith('#/')) {
    return undefined;
  }
  const parts = ref
    .slice(2)
    .split('/')
    .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let current: unknown = root;
  for (const part of parts) {
    const rec = asRecord(current);
    if (!rec || !(part in rec)) {
      return undefined;
    }
    current = rec[part];
  }
  return current;
}

/** Deterministic ordering: by field, then message. Stable + capped. */
function sortAndCap(violations: ContractViolation[]): ContractViolation[] {
  const indexed = violations.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => {
    if (a.v.field !== b.v.field) {
      return a.v.field < b.v.field ? -1 : 1;
    }
    if (a.v.message !== b.v.message) {
      return a.v.message < b.v.message ? -1 : 1;
    }
    return a.i - b.i;
  });
  return indexed.slice(0, MAX_VIOLATIONS).map((e) => e.v);
}

// --- Public factory functions ---------------------------------------------

/**
 * Compile a RequestValidator from an already-parsed OpenAPI 3.x document.
 * The document MAY still contain local `$ref` pointers — they are resolved
 * lazily and cycle-safely during validation (bounded by a node-visit budget),
 * so a pre-resolved document (e.g. from OpenApiImportService) and a raw one
 * both work. Never throws; a non-object spec yields a validator that reports an
 * unknown-path violation for every request.
 */
export function buildValidator(spec: unknown): RequestValidator {
  const root = asRecord(spec) ?? {};
  return new OpenApiRequestValidator(root);
}

/**
 * Load, parse and compile a validator from a server's contract config. Returns
 * `undefined` when the spec cannot be read or parsed, so the engine degrades to
 * mode 'off'. Ref resolution reuses OpenApiImportService.parseSpec (the repo's
 * existing cycle-safe resolver). Runs in the extension host / CLI — never at
 * module top level.
 */
export function createRequestValidator(
  contract: ContractConfig,
  opts: { workspaceRoot?: string }
): RequestValidator | undefined {
  try {
    const specPath = isAbsolute(contract.specPath)
      ? contract.specPath
      : resolvePath(opts.workspaceRoot ?? process.cwd(), contract.specPath);
    const text = readFileSync(specPath, 'utf8');
    const parsed = new OpenApiImportService().parseSpec(text);
    return buildValidator(parsed.document);
  } catch {
    return undefined;
  }
}
