/**
 * Every /v1/... path named in prose must exist in openapi.json.
 *
 * The quickstart documented GET /v1/projects/{id}/offerings, which has never
 * existed — offerings are nested under a service. An agent following the
 * quickstart 404s on its first real call and starts guessing.
 *
 * Matching normalises both sides: any segment that is a placeholder — {param},
 * SCREAMING_CASE, or a real prefixed id — collapses to {}.
 *
 * Fix round 1 (first real-docs run, see task-7-report.md): the initial
 * character class excluded `$`, so every TS template-literal path
 * (`` `/v1/projects/${projectId}/bookings` ``) and every bash example using
 * `$PROJECT_ID` truncated at the `$` — the match stopped after
 * `/v1/projects/`, which then couldn't normalise to anything and was flagged
 * as a phantom path. That was the overwhelming majority of the first run's
 * findings (~27 of 47) and is a normaliser bug, not a doc defect: the paths
 * are real, the matcher just couldn't see past the interpolation. `$` is now
 * part of the match, and normalise() treats `${...}` and a `$SCREAMING_CASE`
 * shell variable the same as any other placeholder segment.
 */
const PATH_RE = /\/v1\/[A-Za-z0-9{}_\-/.$]*/g;

function normalise(path, idPrefixes) {
  return path
    .replace(/\/+$/, '')
    .split('/')
    .map((seg) => {
      if (seg === '') return seg;
      if (/^\{.+\}$/.test(seg)) return '{}';
      if (/^\$\{.+\}$/.test(seg)) return '{}'; // TS template literal: ${projectId}
      if (/^\$?[A-Z][A-Z0-9_]*$/.test(seg)) return '{}'; // PROJECT_ID or $PROJECT_ID
      const [prefix] = seg.split('_');
      if (seg.includes('_') && idPrefixes.has(prefix)) return '{}';
      return seg;
    })
    .join('/');
}

/**
 * Real, live paths that are never in spec.paths because they are outside the
 * documented v1 surface itself:
 *  - `/v1/openapi.json` serves the spec document — confirmed at
 *    apps/open-api-mb/src/app.ts (`app.doc('/v1/openapi.json', ...)`) and
 *    exercised in apps/open-api-mb/src/app.test.ts. A spec never lists the
 *    route that serves itself, so this rule would otherwise flag every
 *    mention of it as a phantom path even though it is real and load-bearing
 *    (codegen, `curl .../v1/openapi.json` in the README).
 */
const KNOWN_EXTRA_PATHS = new Set(['/v1/openapi.json']);

export default {
  name: 'paths',
  check(page, { contract, spec }) {
    const idPrefixes = new Set(contract.idPrefixes);
    const known = new Set([
      ...Object.keys(spec.paths ?? {}).map((p) => normalise(p, idPrefixes)),
      ...KNOWN_EXTRA_PATHS,
    ]);
    const findings = [];

    for (const { n, text } of page.lines) {
      for (const [raw] of text.matchAll(PATH_RE)) {
        const path = raw.replace(/[.,)]+$/, '');
        if (known.has(normalise(path, idPrefixes))) continue;

        findings.push({
          rule: 'paths',
          path: page.path,
          line: n,
          message: `\`${path}\` is not a path in openapi.json`,
        });
      }
    }

    return findings;
  },
};
