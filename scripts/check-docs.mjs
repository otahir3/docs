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

// A silently-dropped rule is worse than the drift this checker exists to
// catch: `loadRules()` used to swallow a failed import with `.catch(() =>
// null)` and filter it out, so a renamed/typo'd/syntax-broken rule file
// disabled that rule forever while `npm run check` stayed green. Every
// failure path below throws instead, so a broken rule takes the whole
// checker down loudly rather than quietly checking less than it claims to.
//
// `importRule` is injected (rather than hard-coding the dynamic `import()`
// call here) so the failure path is exercisable from a test with fake
// modules, without touching real files on disk or the real rules list.
export async function loadRuleModules(names, importRule) {
  const results = await Promise.all(
    names.map(async (name) => {
      try {
        const mod = await importRule(name);
        return { name, mod, error: null };
      } catch (error) {
        return { name, mod: null, error };
      }
    }),
  );

  const failed = results.filter((r) => r.error);
  if (failed.length > 0) {
    for (const { name, error } of failed) {
      console.error(`rule "${name}" failed to load: ${error?.stack ?? error}`);
    }
    throw new Error(
      `${failed.length} rule(s) failed to load: ${failed.map((f) => f.name).join(', ')}. ` +
        'See the import error(s) logged above.',
    );
  }

  const malformed = results.filter(
    ({ mod }) =>
      !mod?.default ||
      typeof mod.default.check !== 'function' ||
      typeof mod.default.name !== 'string',
  );
  if (malformed.length > 0) {
    throw new Error(
      `rule(s) loaded but do not export the expected { name, check } shape: ` +
        malformed.map((m) => m.name).join(', '),
    );
  }

  const rules = results.map((r) => r.mod.default);
  if (rules.length !== names.length) {
    // Defense in depth: every branch above should already have thrown
    // before this is reachable, but the count is the real contract this
    // function promises its caller, so assert it explicitly rather than
    // trusting the branches above to stay exhaustive as this evolves.
    throw new Error(`expected ${names.length} rules to load, but got ${rules.length}`);
  }

  return rules;
}

async function loadRules() {
  const names = [
    'hosts',
    'id-prefixes',
    'paths',
    'error-codes',
    'terminology',
    'env-vars',
    'examples',
  ];
  return loadRuleModules(names, (n) => import(`./rules/${n}.mjs`));
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
