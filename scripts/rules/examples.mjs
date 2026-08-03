/**
 * Every request-body JSON example must satisfy the OpenAPI schema of the
 * operation it targets: no unknown fields, no missing required fields, no
 * out-of-enum string values.
 *
 * This is why: the quickstart's flagship booking body sent `providerId`
 * (the field is `supplierId`), `businessModelType: "SERVICE"` (not in the
 * enum), and omitted `orderId`, `orderItemId` and `locationType` — all six
 * other rules passed it. A reader who copies an example verbatim gets a 400
 * with no idea why.
 *
 * ## The hard part: deciding what to validate
 *
 * Most fenced blocks are responses, config, or shell output — validating one
 * of those against a request schema produces nonsense findings, which is
 * worse than not checking at all (a rule with false positives trains
 * everyone to ignore it). A block is only validated when its operation can
 * be resolved with confidence, from one of three signals:
 *
 *  1. A curl invocation: `-X POST|PUT|PATCH`, a `/v1/...` path in the same
 *     block, and a `-d '...'` body. The body between the outer single quotes
 *     is real JSON (double-quoted throughout in every example that uses this
 *     shape) — see quickstart.mdx's two `curl -d` calls.
 *  2. A `fetch(...)` call: `method: 'POST'|'PUT'|'PATCH'`, a backtick string
 *     containing `/v1/` (the request URL), and `body: JSON.stringify({...})`
 *     whose argument is an inline object literal — not a bare variable
 *     (`JSON.stringify(patch)` has no literal to inspect and is skipped).
 *  3. A `// METHOD /path` comment as the first line *inside* a fenced JSON
 *     block, naming an explicit POST/PUT/PATCH (GET and DELETE never carry a
 *     body, so they're never treated as a request-body signal) and NOT
 *     containing the word "response" — `concepts/booking-engine-model.mdx`
 *     has `// POST /orders response (abridged)` right above a JSON block,
 *     which is exactly the trap this exclusion exists for: same method,
 *     same path, but explicitly labelled as what came back, not what was
 *     sent. The path after the method may be a `...`-truncated suffix
 *     (`.../business-models/{businessModelId}/status`); it resolves only
 *     when that suffix matches exactly one spec path for that method, by
 *     literal trailing path segments (including `{param}` placeholders,
 *     since the docs and the spec name path params identically) — an
 *     ambiguous or unmatched suffix is skipped, never guessed.
 *
 * Every other fenced block — including bare JSON bodies that are genuinely
 * requests but have no literal method+path anywhere nearby, e.g. the
 * `intervals` hold body under "Hold the travel-zone session" in
 * hold-slots-for-checkout.mdx — is silently skipped. That is deliberate:
 * see the brief's own instruction and the coverage numbers in
 * task-11b-report.md for how much of the corpus this leaves unchecked and
 * why that's an honest number rather than a shortfall to paper over.
 *
 * ## Partial examples
 *
 * Some blocks deliberately show only the fields under discussion (an
 * ellipsis, a spread, or a comment standing in for the rest of a nested
 * object). Policy: if the block's body text contains a literal `...`, a
 * unicode `…`, this rule treats the WHOLE block as partial and skips only
 * the missing-required-fields check for it — unknown-field and invalid-enum
 * checks still run, because an extra or wrong field is wrong regardless of
 * how much of the body is shown. This is a block-level (not per-nested-object)
 * policy: simpler to reason about, and it only ever hides a missing-required
 * finding, never an unknown-field or bad-enum one — the more conservative
 * failure mode.
 *
 * ## $ref
 *
 * openapi.json's request schemas are almost entirely inline; the one
 * exception (`POST .../clients/me/addresses`, `$ref: '#/components/schemas/
 * Address'`) and the `Address` `$ref` used inside nested array items are
 * both resolved against `spec.components` rather than skipped.
 *
 * ## Not checked
 *
 * Type mismatches (e.g. a string where the schema wants a number) are out of
 * scope — the brief calls out exactly three finding types (unknown fields,
 * missing required fields, invalid enum values) and this rule sticks to
 * them. Bash/template-literal placeholders (`"$MARKETBOX_PROJECT_ID"`,
 * `` `${orderId}` ``) and bare identifiers (`heldBy: checkoutSessionId`) are
 * parsed as opaque non-literal values: their *field* is checked for
 * presence/unknown-ness, but never compared against an enum, since we can't
 * know what they'll evaluate to.
 */
import { normalisePath } from '../lib/path-normalise.mjs';

const V1_PATH_RE = /\/v1\/[A-Za-z0-9{}_\-/.$]*/;
const CURL_METHOD_RE = /-X\s+(POST|PUT|PATCH)\b/;
const CURL_BODY_RE = /-d\s+'([\s\S]*)'/;
const FETCH_METHOD_RE = /\bmethod:\s*['"](POST|PUT|PATCH)['"]/;
const FETCH_URL_RE = /`[^`]*\/v1\/[^`]*`/;
const STRINGIFY_TOKEN = 'JSON.stringify(';
const COMMENT_HEADER_RE = /^\s*\/\/\s*(POST|PUT|PATCH)\s+(\S+)/;
const PARTIAL_RE = /\.\.\.|…/;

// ---------------------------------------------------------------------------
// Fence extraction
// ---------------------------------------------------------------------------

/** Splits a page's lines into fenced code blocks: language tag, the line the
 *  opening fence is on, and the raw content lines (original line numbers are
 *  reconstructed as contentStartLine + index while walking, not stored per
 *  line — every block is contiguous). */
function extractFences(page) {
  const fences = [];
  let open = null;
  for (const { n, text } of page.lines) {
    const m = /^\s*```(\S*)/.exec(text);
    if (m) {
      if (!open) {
        open = { lang: m[1] || '', startLine: n, lines: [] };
      } else {
        fences.push(open);
        open = null;
      }
      continue;
    }
    if (open) open.lines.push(text);
  }
  return fences;
}

// ---------------------------------------------------------------------------
// Lenient JS-object-literal / JSON parser
//
// Handles real JSON (from curl -d bodies) and JS object-literal syntax (from
// fetch's JSON.stringify argument): unquoted/quoted keys, single/double/
// template-literal string values, comments, trailing commas, spread, and
// bare identifiers/expressions as values. It never evaluates anything — an
// identifier or a template literal with `${...}` interpolation becomes an
// 'other' node (present, but its value is unknowable), never a crash.
// ---------------------------------------------------------------------------

class ParseError extends Error {}

function skipTrivia(text, i) {
  for (;;) {
    const start = i;
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text.startsWith('//', i)) {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
    }
    if (i === start) return i;
  }
}

/** Consumes a quoted string starting at `text[i]` (which must be `"` or `'`).
 *  Returns the raw (unescaped) inner text — good enough for equality checks
 *  against enum values, which are always plain identifiers in this API. */
function parseQuoted(text, i) {
  const quote = text[i];
  const start = i;
  i++;
  let value = '';
  while (i < text.length && text[i] !== quote) {
    if (text[i] === '\\') {
      value += text[i + 1];
      i += 2;
    } else {
      value += text[i];
      i++;
    }
  }
  if (text[i] !== quote) throw new ParseError('unterminated string');
  i++;
  return { node: { type: 'string', value, start }, index: i };
}

/** Template literal. A static one (`` `America/Toronto` ``, no `${...}`) is
 *  treated as a string literal; one with interpolation is 'other' (dynamic —
 *  see the file header). */
function parseTemplate(text, i) {
  const start = i;
  i++;
  let value = '';
  let dynamic = false;
  while (i < text.length && text[i] !== '`') {
    if (text[i] === '\\') {
      value += text[i + 1];
      i += 2;
    } else if (text[i] === '$' && text[i + 1] === '{') {
      dynamic = true;
      let depth = 1;
      i += 2;
      while (i < text.length && depth > 0) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') depth--;
        i++;
      }
    } else {
      value += text[i];
      i++;
    }
  }
  if (text[i] !== '`') throw new ParseError('unterminated template literal');
  i++;
  return dynamic
    ? { node: { type: 'other', start }, index: i }
    : { node: { type: 'string', value, start }, index: i };
}

/** An identifier, number, boolean, null, or arbitrary expression
 *  (`crypto.randomUUID()`, `slot.startUtc`, `new Date()`) as a value.
 *  Consumed by balanced-bracket scanning so nested `()`/`[]`/`{}` and
 *  strings inside the expression don't get mistaken for the enclosing
 *  object/array's own delimiters. Stops at a top-level `,`, `}`, `]`. */
function parseOther(text, i) {
  const start = i;
  let depth = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") {
      ({ index: i } = parseQuoted(text, i));
      continue;
    }
    if (c === '`') {
      ({ index: i } = parseTemplate(text, i));
      continue;
    }
    if (c === '(' || c === '[' || c === '{') {
      depth++;
      i++;
      continue;
    }
    if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) break;
      depth--;
      i++;
      continue;
    }
    if (c === ',' && depth === 0) break;
    i++;
  }
  if (i === start) throw new ParseError(`unexpected character '${text[i]}'`);
  return { node: { type: 'other', start }, index: i };
}

function parseObject(text, i) {
  const start = i;
  i++; // consume '{'
  const props = new Map();
  i = skipTrivia(text, i);
  if (text[i] === '}') return { node: { type: 'object', props, start }, index: i + 1 };

  for (;;) {
    i = skipTrivia(text, i);
    if (text.startsWith('...', i)) {
      // Spread — e.g. `...someVar`. Consumed for correct positioning but
      // contributes no key: an object built with a spread can carry fields
      // this rule cannot see, which is exactly what the partial-example
      // ellipsis policy (see file header) is for.
      i += 3;
      ({ index: i } = parseOther(text, i));
    } else {
      const keyStart = i;
      let key;
      if (text[i] === '"' || text[i] === "'") {
        ({ node: { value: key }, index: i } = parseQuoted(text, i));
      } else {
        const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(text.slice(i));
        if (!m) throw new ParseError(`expected object key at ${i}`);
        key = m[0];
        i += m[0].length;
      }
      i = skipTrivia(text, i);
      let valueNode;
      if (text[i] === ':') {
        i = skipTrivia(text, i + 1);
        ({ node: valueNode, index: i } = parseValue(text, i));
      } else {
        // Shorthand property: `{ cursor }` === `{ cursor: cursor }`.
        valueNode = { type: 'other', start: keyStart };
      }
      props.set(key, { node: valueNode, start: keyStart });
    }
    i = skipTrivia(text, i);
    if (text[i] === ',') {
      i = skipTrivia(text, i + 1);
      if (text[i] === '}') {
        i++;
        break;
      }
      continue;
    }
    if (text[i] === '}') {
      i++;
      break;
    }
    throw new ParseError(`expected ',' or '}' at ${i}`);
  }
  return { node: { type: 'object', props, start }, index: i };
}

function parseArray(text, i) {
  const start = i;
  i++; // consume '['
  const items = [];
  i = skipTrivia(text, i);
  if (text[i] === ']') return { node: { type: 'array', items, start }, index: i + 1 };

  for (;;) {
    i = skipTrivia(text, i);
    if (text.startsWith('...', i)) {
      i += 3;
      ({ index: i } = parseOther(text, i));
    } else {
      const { node, index } = parseValue(text, i);
      items.push(node);
      i = index;
    }
    i = skipTrivia(text, i);
    if (text[i] === ',') {
      i = skipTrivia(text, i + 1);
      if (text[i] === ']') {
        i++;
        break;
      }
      continue;
    }
    if (text[i] === ']') {
      i++;
      break;
    }
    throw new ParseError(`expected ',' or ']' at ${i}`);
  }
  return { node: { type: 'array', items, start }, index: i };
}

function parseValue(text, i) {
  i = skipTrivia(text, i);
  if (i >= text.length) throw new ParseError('unexpected end of input');
  const c = text[i];
  if (c === '{') return parseObject(text, i);
  if (c === '[') return parseArray(text, i);
  if (c === '"' || c === "'") return parseQuoted(text, i);
  if (c === '`') return parseTemplate(text, i);
  return parseOther(text, i);
}

// ---------------------------------------------------------------------------
// Operation resolution
// ---------------------------------------------------------------------------

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

function buildOperationIndex(spec, idPrefixes) {
  const index = new Map(); // `${METHOD} ${normalisedPath}` -> { schema, specPath }
  for (const [specPath, methods] of Object.entries(spec.paths ?? {})) {
    const norm = normalisePath(specPath, idPrefixes);
    for (const [method, op] of Object.entries(methods ?? {})) {
      const upper = method.toUpperCase();
      if (!BODY_METHODS.has(upper)) continue;
      const schema = op?.requestBody?.content?.['application/json']?.schema;
      if (!schema) continue;
      index.set(`${upper} ${norm}`, { schema, specPath, method: upper });
    }
  }
  return index;
}

function lookupByPath(opIndex, method, rawPath, idPrefixes) {
  const cleaned = rawPath.replace(/[.,)]+$/, '');
  const norm = normalisePath(cleaned, idPrefixes);
  return opIndex.get(`${method} ${norm}`) ?? null;
}

/** Resolves a `// METHOD .../suffix` comment path by literal trailing path
 *  segments (see the file header). Returns the operation only when exactly
 *  one spec path matches — an ambiguous or absent match resolves nothing. */
function lookupBySuffix(spec, method, suffix) {
  const suffixSegs = suffix
    .replace(/^\.\.\.\/?/, '')
    .replace(/^\//, '')
    .split('/')
    .filter(Boolean);
  if (suffixSegs.length === 0) return null;

  const matches = [];
  for (const [specPath, methods] of Object.entries(spec.paths ?? {})) {
    if (!methods?.[method.toLowerCase()]) continue;
    const specSegs = specPath.split('/').filter(Boolean);
    if (specSegs.length < suffixSegs.length) continue;
    const tail = specSegs.slice(specSegs.length - suffixSegs.length);
    if (tail.join('/') === suffixSegs.join('/')) matches.push(specPath);
  }
  if (matches.length !== 1) return null;

  const schema =
    spec.paths[matches[0]][method.toLowerCase()]?.requestBody?.content?.['application/json']
      ?.schema;
  if (!schema) return null;
  return { schema, specPath: matches[0], method };
}

function resolveSchema(schema, spec) {
  if (!schema) return schema;
  if (schema.$ref) {
    const node = schema.$ref
      .replace(/^#\//, '')
      .split('/')
      .reduce((acc, seg) => acc?.[seg], spec);
    return node ? resolveSchema(node, spec) : schema;
  }
  return schema;
}

/** Finds the request body for a fenced block, trying curl, then fetch, then
 *  the `// METHOD path` comment header, in that order. Returns null (skip)
 *  whenever any required signal is missing or the operation can't be
 *  resolved — see the file header for what "confidently" means here. */
function resolveBlock(fence, opIndex, spec, idPrefixes) {
  const text = fence.lines.join('\n');
  const contentStartLine = fence.startLine + 1;

  // Signal 1: curl -X METHOD ".../v1/..." ... -d '{...}'
  const curlMethod = CURL_METHOD_RE.exec(text);
  const curlBody = CURL_BODY_RE.exec(text);
  if (curlMethod && curlBody) {
    const pathMatch = V1_PATH_RE.exec(text);
    if (!pathMatch) return null;
    const op = lookupByPath(opIndex, curlMethod[1], pathMatch[0], idPrefixes);
    if (!op) return null;
    // curlBody.index is where "-d '...'" starts; the captured JSON body
    // starts one character after the opening quote inside that match, which
    // is *not* the top of the block — the curl flags come first — so the
    // line number has to account for everything before it, not just before
    // the fence.
    const bodyAbsStart = curlBody.index + curlBody[0].indexOf("'") + 1;
    const bodyStartLine = lineFromIndex(contentStartLine, text, bodyAbsStart);
    return finalize(op, curlBody[1], bodyStartLine);
  }

  // Signal 2: fetch(..., { method: 'POST', ..., body: JSON.stringify({...}) })
  const fetchMethod = FETCH_METHOD_RE.exec(text);
  if (fetchMethod) {
    const urlMatch = FETCH_URL_RE.exec(text);
    const stringifyAt = text.indexOf(STRINGIFY_TOKEN);
    if (!urlMatch || stringifyAt === -1) return null;
    const pathMatch = V1_PATH_RE.exec(urlMatch[0]);
    if (!pathMatch) return null;
    const argStart = skipTrivia(text, stringifyAt + STRINGIFY_TOKEN.length);
    if (text[argStart] !== '{') return null; // not an inline object literal
    const op = lookupByPath(opIndex, fetchMethod[1], pathMatch[0], idPrefixes);
    if (!op) return null;
    let root;
    let rootEnd;
    try {
      ({ node: root, index: rootEnd } = parseValue(text, argStart));
    } catch {
      return null;
    }
    // Partiality is judged only from the JSON payload itself (argStart..
    // rootEnd), not the surrounding fetch() call/imports/route handler —
    // an unrelated "..." in a comment elsewhere in the block must not
    // suppress a real missing-required finding inside the payload.
    return root.type === 'object'
      ? { op, root, text, contentStartLine, partial: PARTIAL_RE.test(text.slice(argStart, rootEnd)) }
      : null;
  }

  // Signal 3: `// METHOD .../path` as the first content line of the fence.
  const firstLine = fence.lines.find((l) => l.trim() !== '');
  if (firstLine) {
    const commentMatch = COMMENT_HEADER_RE.exec(firstLine);
    if (commentMatch && !/response/i.test(firstLine)) {
      const op = lookupBySuffix(spec, commentMatch[1], commentMatch[2]);
      if (!op) return null;
      const bodyStart = fence.lines.indexOf(firstLine) + 1;
      const bodyText = fence.lines.slice(bodyStart).join('\n');
      let root;
      try {
        ({ node: root } = parseValue(bodyText, skipTrivia(bodyText, 0)));
      } catch {
        return null;
      }
      return root.type === 'object'
        ? {
            op,
            root,
            text: bodyText,
            contentStartLine: contentStartLine + bodyStart,
            partial: PARTIAL_RE.test(bodyText),
          }
        : null;
    }
  }

  return null;
}

function finalize(op, bodyText, bodyStartLine) {
  let root;
  try {
    ({ node: root } = parseValue(bodyText, 0));
  } catch {
    return null;
  }
  if (root.type !== 'object') return null;
  return {
    op,
    root,
    text: bodyText,
    contentStartLine: bodyStartLine,
    partial: PARTIAL_RE.test(bodyText),
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function lineFromIndex(contentStartLine, text, index) {
  let line = contentStartLine;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

function walk(node, schema, label, ctx) {
  if (!schema || !node) return;
  schema = resolveSchema(schema, ctx.spec);

  if (schema.enum) {
    if (node.type === 'string' && !schema.enum.includes(node.value)) {
      ctx.findings.push({
        rule: 'examples',
        path: ctx.page.path,
        line: lineFromIndex(ctx.contentStartLine, ctx.text, node.start),
        message:
          `\`${node.value}\` is not a valid value for \`${label}\` on ${ctx.op.method} ` +
          `${ctx.op.specPath} — expected one of ${schema.enum.map((v) => `\`${v}\``).join(', ')}`,
      });
    }
    return;
  }

  if (schema.properties || schema.type === 'object') {
    if (node.type !== 'object') return; // e.g. a variable reference — nothing to check
    const props = schema.properties ?? {};
    const permissiveExtra = schema.additionalProperties && schema.additionalProperties !== false;

    for (const [key, { node: valueNode, start }] of node.props) {
      if (!(key in props)) {
        if (!permissiveExtra) {
          ctx.findings.push({
            rule: 'examples',
            path: ctx.page.path,
            line: lineFromIndex(ctx.contentStartLine, ctx.text, start),
            message: `\`${key}\` is not a property of ${ctx.op.method} ${ctx.op.specPath} (in \`${label}\`)`,
          });
        }
        continue;
      }
      walk(valueNode, props[key], `${label}.${key}`, ctx);
    }

    if (!ctx.partial) {
      for (const required of schema.required ?? []) {
        if (!node.props.has(required)) {
          ctx.findings.push({
            rule: 'examples',
            path: ctx.page.path,
            line: lineFromIndex(ctx.contentStartLine, ctx.text, node.start),
            message: `${ctx.op.method} ${ctx.op.specPath} requires \`${required}\` — missing from \`${label}\``,
          });
        }
      }
    }
    return;
  }

  if (schema.items || schema.type === 'array') {
    if (node.type !== 'array') return;
    node.items.forEach((item, idx) => walk(item, schema.items, `${label}[${idx}]`, ctx));
  }
}

export default {
  name: 'examples',
  check(page, { contract, spec }) {
    const idPrefixes = new Set(contract.idPrefixes);
    const opIndex = buildOperationIndex(spec, idPrefixes);
    const findings = [];

    for (const fence of extractFences(page)) {
      const resolved = resolveBlock(fence, opIndex, spec, idPrefixes);
      if (!resolved) continue;

      const ctx = {
        page,
        spec,
        op: resolved.op,
        text: resolved.text,
        contentStartLine: resolved.contentStartLine,
        partial: resolved.partial,
        findings,
      };
      walk(resolved.root, resolveSchema(resolved.op.schema, spec), 'body', ctx);
    }

    return findings;
  },
};
