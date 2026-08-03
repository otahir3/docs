import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { walkDocs } from './lib/mdx.mjs';

const ROOT = join(import.meta.dirname, '..');

export async function runRules(root, contract, spec, rules) {
  const findings = [];
  const ctx = { contract, spec };
  for await (const page of walkDocs(root)) {
    for (const rule of rules) {
      findings.push(...rule.check(page, ctx));
    }
  }
  return findings;
}

async function loadRules() {
  const names = ['hosts', 'id-prefixes', 'paths', 'error-codes', 'terminology'];
  const mods = await Promise.all(
    names.map((n) => import(`./rules/${n}.mjs`).catch(() => null)),
  );
  return mods.filter(Boolean).map((m) => m.default);
}

async function main() {
  const [contract, spec] = await Promise.all([
    readFile(join(ROOT, 'api-reference', 'docs-contract.json'), 'utf8').then(JSON.parse),
    readFile(join(ROOT, 'api-reference', 'openapi.json'), 'utf8').then(JSON.parse),
  ]);

  const snippet = await readFile(join(ROOT, 'snippets', 'base-url.mdx'), 'utf8');
  if (!snippet.includes(contract.baseUrl)) {
    console.error(
      `snippets/base-url.mdx does not contain the contract's baseUrl (${contract.baseUrl}).\n` +
        'Re-sync docs-contract.json from mb-core and update the snippet.',
    );
    process.exit(1);
  }

  const findings = await runRules(ROOT, contract, spec, await loadRules());

  if (findings.length === 0) {
    console.log('docs check passed');
    return;
  }

  const byRule = new Map();
  for (const f of findings) {
    if (!byRule.has(f.rule)) byRule.set(f.rule, []);
    byRule.get(f.rule).push(f);
  }

  for (const [rule, items] of [...byRule].sort()) {
    console.error(`\n${rule} (${items.length})`);
    for (const f of items) console.error(`  ${f.path}:${f.line}  ${f.message}`);
  }
  console.error(`\n${findings.length} finding(s)`);
  process.exit(1);
}

// Run main() only when invoked directly, so the test file can import runRules
// without triggering a full check. `import.meta.filename` is already a native
// path on Windows, unlike import.meta.url.
if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
