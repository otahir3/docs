/**
 * No page may name a host that is not on the allowlist.
 *
 * The base URL literal is permitted in exactly one file — snippets/base-url.mdx
 * — and must equal the contract's baseUrl, which comes from the running API's
 * openapi.json servers[0].url. Every other page refers to $MARKETBOX_API_URL.
 *
 * This is why: the docs previously named api.marketbox.io, app.marketbox.io and
 * api.staging.marketbox.io. The company domain is gomarketbox.com; no staging
 * account exists; and the spec's only server was a raw dev API Gateway URL. An
 * agent reading the docs top-down failed at DNS on its first request.
 *
 * Two independent scans run per line:
 *  - URL_RE catches `https?://host` occurrences (curl examples, markdown links).
 *  - BARE_MARKETBOX_RE catches schemeless mentions such as an HTTP example's
 *    `Host: api.marketbox.io` header line. It is scoped to the marketbox.io
 *    suffix specifically (not a generic hostname matcher) so it doesn't flag
 *    unrelated dotted tokens like `package.json` or `v1.0` in prose/code, and
 *    it never re-flags a host already inside a scheme'd URL (see the
 *    lookbehind: a match can't start right after `//`, or mid-token after a
 *    word char or `.`).
 */
const BASE_URL_FILE = 'snippets/base-url.mdx';

/** Hosts that legitimately appear in prose and are not the API. */
const ALWAYS_ALLOWED = new Set([
  'app.gomarketbox.com',
  'docs.gomarketbox.com',
  'gomarketbox.com',
  'github.com',
  'openapi-generator.tech',
  'orval.dev',
  'stripe.com',
  'docs.stripe.com',
  'www.iana.org',
  'en.wikipedia.org',
  // Added beyond the brief's seed list after grepping the real docs:
  'localhost', // CONTRIBUTING.md / README.md local-dev instructions ("mint dev")
  'mintlify.com', // README.md — the docs framework this site is built on
  'bitbucket.org', // README.md — link to the mb-core source repo
]);

const URL_RE = /https?:\/\/([A-Za-z0-9.-]+)/g;
const BARE_MARKETBOX_RE =
  /(?<![\w.\/])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*marketbox\.io\b/gi;

export default {
  name: 'hosts',
  check(page, { contract }) {
    const allowed = new Set([...ALWAYS_ALLOWED, ...contract.hostAllowlist]);
    const findings = [];

    for (const { n, text } of page.lines) {
      for (const [full, host] of text.matchAll(URL_RE)) {
        if (host.endsWith('marketbox.io')) {
          findings.push({
            rule: 'hosts',
            path: page.path,
            line: n,
            message: `${host} is not a MarketBox domain — the company domain is gomarketbox.com`,
          });
          continue;
        }

        if (!allowed.has(host)) {
          findings.push({
            rule: 'hosts',
            path: page.path,
            line: n,
            message: `host ${host} is not on the allowlist`,
          });
          continue;
        }

        if (contract.hostAllowlist.includes(host) && page.path !== BASE_URL_FILE) {
          findings.push({
            rule: 'hosts',
            path: page.path,
            line: n,
            message: `the API base URL may only appear in ${BASE_URL_FILE}; use $MARKETBOX_API_URL here (found ${full})`,
          });
        }
      }

      for (const [bare] of text.matchAll(BARE_MARKETBOX_RE)) {
        findings.push({
          rule: 'hosts',
          path: page.path,
          line: n,
          message: `${bare} is not a MarketBox domain — the company domain is gomarketbox.com`,
        });
      }
    }

    return findings;
  },
};
