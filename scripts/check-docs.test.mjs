import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import { walkDocs } from './lib/mdx.mjs';
import { runRules } from './check-docs.mjs';
import hosts from './rules/hosts.mjs';

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
