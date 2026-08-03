/**
 * Every id literal in the docs must use a prefix the API actually mints.
 *
 * A wrong prefix is worse than no example: it gets copied verbatim and fails.
 * The quickstart shipped `prv_123`, `proj_acme` and `svc_...`; the real
 * prefixes are `sup`, `prj` and `srv`.
 *
 * Ground truth is packages/db/src/id.ts in mb-core, surfaced through
 * docs-contract.json. Note that `off` is correct and `offr` is not, despite
 * what ID_PREFIXES in @mb-core/types claims.
 */

/** A prefixed id: lowercase prefix, underscore, then base32-ish body. Requires
 *  at least 3 body chars so ordinary snake_case words are not matched. */
const ID_RE = /\b([a-z]{2,8})_([a-z0-9]{3,32})\b/g;

/** snake_case identifiers that are not ids and must not be flagged. */
const NOT_IDS = new Set([
  'content_type', 'client_secret', 'payment_intent', 'x_api', 'request_id',
  'next_cursor', 'status_code', 'api_key', 'mb_test', 'mb_live',
  // Found scanning the real docs (see task-6-report.md for the full triage):
  'fee_booking', 'fee_admin', // feeId is a client-supplied stable string
  // (ServiceFeeSchema in mb-core), not a generated id — see service.zod.ts.
  'if_required', // Stripe's stripe.confirmPayment({ redirect: 'if_required' })
  'best_effort', // the `atomicity: "best_effort"` enum value
  'logout_uri', 'redirect_uri', 'response_type', 'token_endpoint',
  'jwks_uri', 'access_token', // OAuth/OIDC parameter names, booking-flow-auth.mdx
  'checkout_9f2c1b', // example checkoutSessionId — heldBy is caller-chosen, not minted
]);

export default {
  name: 'id-prefixes',
  check(page, { contract }) {
    const known = new Set(contract.idPrefixes);
    const findings = [];

    for (const { n, text } of page.lines) {
      for (const [match, prefix] of text.matchAll(ID_RE)) {
        if (NOT_IDS.has(match)) continue;
        if (known.has(prefix)) continue;

        findings.push({
          rule: 'id-prefixes',
          path: page.path,
          line: n,
          message: `\`${prefix}_\` is not a MarketBox id prefix (in \`${match}\`)`,
        });
      }
    }

    return findings;
  },
};
