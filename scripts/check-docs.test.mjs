import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import { walkDocs } from './lib/mdx.mjs';

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
