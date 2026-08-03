import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import { walkDocs } from './lib/mdx.mjs';
import { runRules } from './check-docs.mjs';
import hosts from './rules/hosts.mjs';
import idPrefixes from './rules/id-prefixes.mjs';
import paths from './rules/paths.mjs';
import errorCodes from './rules/error-codes.mjs';
import terminology from './rules/terminology.mjs';

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
