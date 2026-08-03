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
 *
 * Fix round 1 (review Critical): the body pattern originally required
 * `[a-z0-9]{3,32}` and a trailing `\b`. That misses two real shapes the docs
 * actually use for example ids:
 *  - truncated bodies, written as `req_...` or `off_…` (ASCII triple-dot or
 *    the single ellipsis character) — a body of 0+ chars followed by the
 *    truncation marker. `\b` also can't sit on an ellipsis boundary, since
 *    the marker is neither a word char nor absent, so the old regex simply
 *    never matched these at all.
 *  - mixed-case bodies, e.g. `req_2hY3...` — `[a-z0-9]` excludes uppercase.
 * Both mechanisms independently hid real wrong-prefix examples (`svc_...`,
 * `prv_…`) from the rule. See task-6-report.md, fix round 1, for the full
 * before/after finding list.
 */

/** A prefixed id: lowercase prefix, underscore, then one of two body shapes:
 *  - the original full body, `[a-z0-9]{3,32}` (min 3 chars so ordinary
 *    snake_case words like `content_type` are not matched), or
 *  - a truncated/mixed-case body: 0-20 alphanumeric chars (upper or lower),
 *    the truncation marker (`...` or `…`), then 0-10 more alphanumeric chars.
 *    The marker itself is what makes this branch safe against prose — it
 *    doesn't fire on ordinary words, only on the literal truncation dots.
 *  Lookaround (not \b) delimits both branches, because \b cannot sit right
 *  after an ellipsis (a non-word char) when the next char is also non-word
 *  (e.g. a closing backtick) — the two zero-width assertions never agree
 *  that's a boundary, so \b silently failed to close truncated matches.
 */
const ID_RE =
  /(?<![A-Za-z0-9_])([a-z]{2,8})_(?:[a-z0-9]{3,32}|[A-Za-z0-9]{0,20}(?:\.\.\.|…)[A-Za-z0-9]{0,10})(?![A-Za-z0-9_])/g;

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

/**
 * Prefixes minted by a third party, not MarketBox — must never be flagged
 * even though they are not in contract.idPrefixes. Kept separate from
 * NOT_IDS: NOT_IDS excludes strings that only look like ids (ordinary
 * words); this excludes strings that ARE real prefixed ids, just not ours.
 *
 * Populated only with prefixes actually grepped out of the docs (fix round
 * 1) — not a generic Stripe prefix list. Confirmed absent from the docs and
 * therefore deliberately NOT included: `sk`, `cus`, `seti`.
 */
const THIRD_PARTY_PREFIXES = new Set([
  'acct', // Stripe Connect account id — guides/accept-payments-with-stripe.mdx
  'pk',   // Stripe publishable key (pk_test_..., pk_...)
  'pi',   // Stripe PaymentIntent id (pi_3Tp...)
  'pm',   // Stripe PaymentMethod id (pm_1SxYz...)
]);

export default {
  name: 'id-prefixes',
  check(page, { contract }) {
    const known = new Set(contract.idPrefixes);
    const findings = [];

    for (const { n, text } of page.lines) {
      for (const [match, prefix] of text.matchAll(ID_RE)) {
        if (NOT_IDS.has(match)) continue;
        if (THIRD_PARTY_PREFIXES.has(prefix)) continue;
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
