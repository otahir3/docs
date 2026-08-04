import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import { walkDocs } from './lib/mdx.mjs';
import { runRules, loadRuleModules } from './check-docs.mjs';
import hosts from './rules/hosts.mjs';
import idPrefixes from './rules/id-prefixes.mjs';
import paths from './rules/paths.mjs';
import errorCodes from './rules/error-codes.mjs';
import terminology from './rules/terminology.mjs';
import envVars from './rules/env-vars.mjs';
import examples from './rules/examples.mjs';

test('walkDocs strips frontmatter and keeps original line numbers', async () => {
  const pages = [];
  for await (const page of walkDocs(join(import.meta.dirname, '__fixtures__', 'walk'))) {
    pages.push(page);
  }

  assert.equal(pages.length, 1);
  const body = pages[0].lines.filter((l) => l.text.trim() !== '');
  assert.deepEqual(body, [
    { n: 5, text: 'First body line.' },
    { n: 7, text: 'Second body line.' },
  ]);
});

const CONTRACT = {
  baseUrl: 'https://rtgic12qk9.execute-api.us-east-1.amazonaws.com/dev',
  hostAllowlist: ['rtgic12qk9.execute-api.us-east-1.amazonaws.com'],
  idPrefixes: ['prj', 'sup', 'srv', 'off', 'cli', 'bk', 'ord'],
  errorCodes: ['NOT_FOUND', 'BAD_REQUEST'],
  holdConversionReasons: ['HOLD_EXPIRED'],
  terminology: [{ banned: 'provider', use: 'supplier', allowedIn: [] }],
};

test('hosts rule flags every non-allowlisted host', async () => {
  const findings = await runRules(
    join(import.meta.dirname, '__fixtures__', 'hosts'),
    CONTRACT,
    { paths: {} },
    [hosts],
  );

  assert.equal(findings.length, 2);
  assert.deepEqual(findings.map((f) => f.line), [5, 7]);
  assert.match(findings[0].message, /api\.marketbox\.io/);
});

test('id-prefixes rule flags unknown prefixes only', async () => {
  const findings = await runRules(
    join(import.meta.dirname, '__fixtures__', 'id-prefixes'),
    CONTRACT,
    { paths: {} },
    [idPrefixes],
  );

  const flagged = findings.map((f) => f.message.match(/`([a-z]+)_`/)[1]).sort();
  assert.deepEqual(flagged, ['prv', 'proj', 'svc'].sort());
  assert.deepEqual(findings.map((f) => f.line).sort((a, b) => a - b), [5, 7, 7]);
});

const SPEC = {
  paths: {
    '/v1/projects/{projectId}/bookings': {},
    '/v1/projects/{projectId}/services/{serviceId}/offerings': {},
  },
};

test('paths rule flags only paths absent from the spec', async () => {
  const findings = await runRules(
    join(import.meta.dirname, '__fixtures__', 'paths'),
    CONTRACT,
    SPEC,
    [paths],
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 5);
  assert.match(findings[0].message, /offerings/);
});

test('error-codes rule flags unregistered codes only', async () => {
  const findings = await runRules(
    join(import.meta.dirname, '__fixtures__', 'error-codes'),
    CONTRACT,
    { paths: {} },
    [errorCodes],
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 7);
  assert.match(findings[0].message, /SLOT_UNAVAILABLE_ERROR/);
});

test('terminology rule flags banned words', async () => {
  const findings = await runRules(
    join(import.meta.dirname, '__fixtures__', 'terminology'),
    CONTRACT,
    { paths: {} },
    [terminology],
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 5);
  assert.match(findings[0].message, /provider/);
});

// Amendment to Task 8: the brief's terminology rule skips fenced code blocks
// entirely, so `"providerId": "prv_123"` inside a fenced bash/json block
// (exactly what the quickstart shipped) is invisible to it. This fixture
// exercises the amended behavior: JSON-style keys inside fences are checked
// by word-part, third-party keys are excluded by exact name, and values
// (even ones containing a banned word) are never inspected.
test('terminology rule flags banned JSON keys inside fenced blocks, but not third-party keys or values', async () => {
  // Extends CONTRACT with a `customer` ban (the real contract has one; the
  // shared fixture CONTRACT above deliberately doesn't, see the comment on
  // the `terminology rule flags banned words` test). Banning `customer` here
  // is what makes this test actually exercise the THIRD_PARTY_KEYS
  // exclusion for `customer_id` — without it, that key wouldn't be a
  // candidate in the first place and the exclusion would go untested.
  const contractWithCustomer = {
    ...CONTRACT,
    terminology: [...CONTRACT.terminology, { banned: 'customer', use: 'client', allowedIn: [] }],
  };

  const findings = await runRules(
    join(import.meta.dirname, '__fixtures__', 'terminology-fenced'),
    contractWithCustomer,
    { paths: {} },
    [terminology],
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 6);
  assert.match(findings[0].message, /providerId/);
});

// Fix round 1 (task-10-report.md): MARKETBOX_API_URL and API_BASE_URL (same
// for MARKETBOX_PROJECT_ID / PROJECT_ID) were both live in the docs at once,
// meaning two internally-consistent pages could disagree with each other.
// This rule flags any known-wrong alias by name; it must not flag the
// canonical names themselves, nor unrelated real env vars that happen to
// share a token (MARKETBOX_API_KEY, STRIPE_SECRET_KEY, NEXT_PUBLIC_*).
test('env-vars rule flags known aliases only, never the canonical names', async () => {
  const findings = await runRules(
    join(import.meta.dirname, '__fixtures__', 'env-vars'),
    CONTRACT,
    { paths: {} },
    [envVars],
  );

  assert.equal(findings.length, 4);
  assert.deepEqual(findings.map((f) => f.line).sort((a, b) => a - b), [5, 5, 7, 7]);
  const flagged = findings.map((f) => f.message.match(/`([A-Z_]+)`/)[1]).sort();
  assert.deepEqual(flagged, ['API_BASE_URL', 'API_BASE_URL', 'PROJECT_ID', 'PROJECT_ID'].sort());
});

// Task 11b: examples validates a request-body JSON example against the
// openapi.json schema of the operation it targets. This spec is a trimmed
// stand-in for the real POST /bookings schema — just enough surface (a
// top-level enum, a required array, a nested required array with its own
// enum) to exercise all three finding types without pulling in the whole
// real spec.
const EXAMPLES_SPEC = {
  paths: {
    '/v1/projects/{projectId}/bookings': {
      post: {
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  supplierId: { type: 'string' },
                  clientId: { type: 'string' },
                  bookingStartUtc: { type: 'string' },
                  bookingEndUtc: { type: 'string' },
                  bookingTz: { type: 'string' },
                  locationType: { type: 'string', enum: ['PHYSICAL', 'VIRTUAL', 'TRAVEL_ZONE'] },
                  capacity: { type: 'integer' },
                  notes: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        scope: { type: 'string', enum: ['BOOKING', 'BOOKING_SERVICE'] },
                        noteText: { type: 'string' },
                      },
                      required: ['scope', 'noteText'],
                    },
                  },
                  services: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        serviceId: { type: 'string' },
                        offeringId: { type: 'string' },
                        businessModelType: { type: 'string', enum: ['SINGLE_BOOKING', 'PACKAGE'] },
                        quantity: { type: 'integer' },
                        orderId: { type: 'string' },
                        orderItemId: { type: 'string' },
                      },
                      required: ['serviceId', 'offeringId', 'businessModelType', 'orderId', 'orderItemId'],
                    },
                  },
                },
                required: [
                  'clientId',
                  'bookingStartUtc',
                  'bookingEndUtc',
                  'bookingTz',
                  'locationType',
                  'services',
                ],
              },
            },
          },
        },
      },
    },
  },
};

test('examples rule flags unknown fields, missing required fields, and invalid enum values — and skips an unresolvable block', async () => {
  const findings = await runRules(
    join(import.meta.dirname, '__fixtures__', 'examples'),
    CONTRACT,
    EXAMPLES_SPEC,
    [examples],
  );

  const byFile = findings.filter((f) => f.path === 'bad.mdx');
  assert.equal(byFile.length, 3, JSON.stringify(byFile, null, 2));

  const unknown = byFile.find((f) => /is not a property of/.test(f.message));
  assert.ok(unknown);
  assert.match(unknown.message, /`providerId`/);

  const missing = byFile.find((f) => /requires `bookingTz`/.test(f.message));
  assert.ok(missing);

  const badEnum = byFile.find((f) => /`MOON`/.test(f.message));
  assert.ok(badEnum);
  assert.match(badEnum.message, /locationType/);

  // The "response, not a request" block below the three bad ones also
  // contains a `providerId` key, but carries no curl/fetch/comment-header
  // signal naming an operation — it must not be flagged. This is the
  // "correctly-skipped block" case: silence here is the rule working, not a
  // gap in it.
  assert.equal(
    findings.filter((f) => /sup_should_not_be_flagged|response, not a request/.test(f.message)).length,
    0,
  );
});

// Proves the rule would have caught the real defect that motivated it: the
// pre-fix quickstart booking body sent `providerId` (unknown — the field is
// `supplierId`), `businessModelType: "SERVICE"` (not a real enum value), and
// omitted `locationType`, `orderId`, and `orderItemId`. Six other rules
// passed this body; this one must not.
test('examples rule catches the original pre-fix quickstart booking defect', async () => {
  const findings = await runRules(
    join(import.meta.dirname, '__fixtures__', 'examples'),
    CONTRACT,
    EXAMPLES_SPEC,
    [examples],
  );

  const byFile = findings.filter((f) => f.path === 'quickstart-defect.mdx');

  assert.ok(
    byFile.some((f) => /`providerId`/.test(f.message) && /is not a property of/.test(f.message)),
    'expected an unknown-field finding for providerId',
  );
  assert.ok(
    byFile.some((f) => /requires `locationType`/.test(f.message)),
    'expected a missing-required finding for locationType',
  );
  assert.ok(
    byFile.some((f) => /requires `orderId`/.test(f.message)),
    'expected a missing-required finding for orderId',
  );
  assert.ok(
    byFile.some((f) => /requires `orderItemId`/.test(f.message)),
    'expected a missing-required finding for orderItemId',
  );
  assert.ok(
    byFile.some((f) => /`SERVICE`/.test(f.message) && /businessModelType/.test(f.message)),
    'expected an invalid-enum finding for businessModelType: "SERVICE"',
  );
  assert.equal(byFile.length, 5, JSON.stringify(byFile, null, 2));
});

// Fix round 1 (task-11b-report.md): $ref resolution existed in the code
// (resolveSchema follows schema.$ref against spec.components) but nothing
// exercised it — not the tests, not a single block in the real corpus. An
// unexercised branch in a validator is a liability: it will silently
// degrade to passing everything the day a real $ref-based schema is
// documented and nobody would notice. This spec mirrors the real
// openapi.json's two $ref shapes: a requestBody schema that IS a $ref
// (POST .../clients/me/addresses -> #/components/schemas/Address), and a
// $ref nested inside an array item's property (sessions[].address on
// POST .../package-bookings).
const REF_SPEC = {
  paths: {
    '/v1/projects/{projectId}/clients/me/addresses': {
      post: {
        requestBody: {
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/Address' } },
          },
        },
      },
    },
    '/v1/projects/{projectId}/orders/{orderId}/package-bookings': {
      post: {
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  orderItemId: { type: 'string' },
                  sessions: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        supplierId: { type: 'string' },
                        address: { $ref: '#/components/schemas/Address' },
                      },
                      required: ['supplierId'],
                    },
                  },
                },
                required: ['orderItemId'],
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Address: {
        type: 'object',
        properties: {
          addressOneLine: { type: 'string' },
          streetNumber: { type: 'string' },
          streetName: { type: 'string' },
          city: { type: 'string' },
          state: { type: 'string' },
          country: { type: 'string' },
          zipCode: { type: 'string' },
          unitNumber: { type: 'string' },
        },
        required: [
          'addressOneLine',
          'streetNumber',
          'streetName',
          'city',
          'state',
          'country',
          'zipCode',
        ],
      },
    },
  },
};

test('examples rule resolves $ref, including one nested inside an array item', async () => {
  const findings = await runRules(
    join(import.meta.dirname, '__fixtures__', 'examples'),
    CONTRACT,
    REF_SPEC,
    [examples],
  );

  const byFile = findings.filter((f) => f.path === 'ref.mdx');
  assert.equal(byFile.length, 4, JSON.stringify(byFile, null, 2));

  // Top-level $ref (the whole requestBody schema is `{ $ref: ... }`):
  // "zip" is unknown (the real field is zipCode), and both "state" and
  // "zipCode" are missing.
  assert.ok(byFile.some((f) => /`zip`/.test(f.message) && /is not a property of/.test(f.message)));
  assert.ok(byFile.some((f) => /requires `state`/.test(f.message)));
  assert.ok(byFile.some((f) => /requires `zipCode`/.test(f.message)));

  // $ref nested inside sessions[0].address: missing `country`, and the
  // label must show the full nested path, proving the $ref was resolved
  // *at that nesting depth*, not just at the schema root.
  const nested = byFile.find((f) => /requires `country`/.test(f.message));
  assert.ok(nested);
  assert.match(nested.message, /body\.sessions\[0\]\.address/);
});

// The bug this covers: `loadRules()` used to swallow a failed rule import
// with `.catch(() => null)` and `filter(Boolean)` it out of the list, so a
// renamed/typo'd/broken rule file silently disabled that rule forever while
// `npm run check` kept printing "docs check passed". `loadRuleModules` takes
// an injected importer so this is exercisable with fake modules — no real
// files need to be broken to prove the failure path is loud.
test('loadRuleModules throws, naming the rule, when an import fails', async () => {
  const boom = new Error('Cannot find module');
  const importRule = async (name) => {
    if (name === 'terminology') throw boom;
    return { default: { name, check: () => [] } };
  };

  await assert.rejects(
    () => loadRuleModules(['hosts', 'terminology', 'paths'], importRule),
    (err) => {
      assert.match(err.message, /terminology/);
      assert.doesNotMatch(err.message, /hosts/);
      assert.doesNotMatch(err.message, /paths/);
      return true;
    },
  );
});

test('loadRuleModules throws when a loaded module does not export { name, check }', async () => {
  const importRule = async (name) => {
    if (name === 'examples') return { default: { name } }; // missing `check`
    return { default: { name, check: () => [] } };
  };

  await assert.rejects(
    () => loadRuleModules(['hosts', 'examples'], importRule),
    (err) => {
      assert.match(err.message, /examples/);
      assert.match(err.message, /name, check/);
      return true;
    },
  );
});

test('loadRuleModules returns every rule when all imports succeed', async () => {
  const names = ['hosts', 'id-prefixes', 'paths'];
  const importRule = async (name) => ({ default: { name, check: () => [] } });

  const rules = await loadRuleModules(names, importRule);

  assert.equal(rules.length, names.length);
  assert.deepEqual(rules.map((r) => r.name), names);
});
