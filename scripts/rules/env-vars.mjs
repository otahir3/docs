/**
 * Every example must call the API base URL and the project id by their one
 * canonical env var name: `MARKETBOX_API_URL` and `MARKETBOX_PROJECT_ID`.
 *
 * This is why: before this rule existed, the docs used `MARKETBOX_API_URL` in
 * 8 files (quickstart, the API reference, four `concepts/*` pages,
 * booking-flow-auth, index) and `API_BASE_URL` in the rest of the integration
 * guides (accept-payments-with-stripe, availability-and-slates,
 * create-a-package-booking, create-a-single-booking, hold-slots-for-checkout,
 * search-suppliers-by-availability, show-a-package-storefront) — same value,
 * two names, both plausible. Each page reads fine in isolation; a reader who
 * follows the quickstart, exports `MARKETBOX_API_URL`, then pastes the
 * payments guide's `process.env.API_BASE_URL` gets `undefined` and every
 * request goes to `undefined/v1/...`. The project id had the identical split
 * (`PROJECT_ID` vs `MARKETBOX_PROJECT_ID`). No existing rule catches this —
 * `hosts` only looks at literal hostnames, and both spellings are otherwise
 * ordinary-looking identifiers.
 *
 * The check is deliberately narrow: a small, hand-maintained map of aliases
 * that are known to mean "the API base URL" or "the project id" but are not
 * the canonical spelling. It does not attempt to validate arbitrary env var
 * names — `STRIPE_SECRET_KEY`, every `NEXT_PUBLIC_*` browser config value,
 * and the OIDC variable names are real, distinct values with no canonical
 * alternative in this codebase, and must stay silent.
 *
 * Matching uses `\b`, which cannot fire inside `MARKETBOX_API_URL` or
 * `MARKETBOX_PROJECT_ID` themselves: `_` is a word character in JS regex, so
 * there is no boundary between the `_` in `MARKETBOX_` and the `A`/`P` that
 * follows — `\bAPI_URL\b` and `\bPROJECT_ID\b` simply cannot start a match
 * mid-token there. This is the same reasoning `hosts.mjs`'s
 * BARE_MARKETBOX_RE relies on to avoid re-flagging a host already inside a
 * scheme'd URL.
 */

/**
 * Known-wrong spellings, mapped to the one canonical name each refers to.
 * Add an alias here only when it has actually appeared in the docs meaning
 * this value — this is not a general "guess what a var might be named" list.
 */
const ALIASES = new Map([
  // Seen in the wild: guides/accept-payments-with-stripe.mdx and six other
  // integration guides used this instead of MARKETBOX_API_URL.
  ['API_BASE_URL', 'MARKETBOX_API_URL'],
  // Not yet seen in the docs, but an equally plausible name for the same
  // value — flagged pre-emptively so it can never sneak in un-caught.
  ['BASE_URL', 'MARKETBOX_API_URL'],
  ['API_URL', 'MARKETBOX_API_URL'],
  ['MB_API_URL', 'MARKETBOX_API_URL'],
  // Seen in the wild: the same seven guides used this instead of
  // MARKETBOX_PROJECT_ID, including as a bare `PROJECT_ID` placeholder
  // embedded directly in an example URL path (no `$`/`process.env.` prefix).
  ['PROJECT_ID', 'MARKETBOX_PROJECT_ID'],
  ['MB_PROJECT_ID', 'MARKETBOX_PROJECT_ID'],
]);

const ALIAS_RE = new RegExp(`\\b(${[...ALIASES.keys()].join('|')})\\b`, 'g');

export default {
  name: 'env-vars',
  check(page) {
    const findings = [];

    for (const { n, text } of page.lines) {
      for (const [, alias] of text.matchAll(ALIAS_RE)) {
        const canonical = ALIASES.get(alias);
        findings.push({
          rule: 'env-vars',
          path: page.path,
          line: n,
          message: `\`${alias}\` is not the canonical env var — use \`${canonical}\``,
        });
      }
    }

    return findings;
  },
};
