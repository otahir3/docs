/**
 * Every SCREAMING_SNAKE token in the docs must be traceable to something
 * real: a code the public API actually returns (or a documented
 * hold-conversion reason), or a legitimate enum value the public API's own
 * spec declares for some other field. Anything else is either a stray from
 * the wrong API (the backoffice `api-mb`, which these docs don't describe)
 * or simply invented.
 *
 * Documenting a code the API never returns teaches an agent to branch on a
 * condition that cannot occur, and hides the one that can.
 *
 * Fix round 1 (review Critical, see task-8-report.md): the original rule
 * only treated a token as a *candidate* code if it lexically looked like one
 * — ending in an error-ish suffix (`_ERROR`, `_EXPIRED`, …) or starting with
 * a domain prefix (`SLOT_`, `BOOKING_`, …) — before checking it against the
 * registry. That guess missed six real defects sitting in the very table
 * (concepts/errors.mdx's "Common error codes") that also contains codes the
 * guard *did* catch: `INVALID_CURSOR`, `INVALID_STATUS_TRANSITION`,
 * `CURRENCY_MISMATCH`, `OFFERING_NOT_BOOKABLE`, `CAPACITY_EXCEEDED`,
 * `PARTICIPANT_ALREADY_REGISTERED`. None of those happen to end in a
 * suffix or start with a prefix the guard knew about — the guard's lexical
 * shape was never what made a code real or fake; registry membership is.
 *
 * So the guard is gone. Every SCREAMING_SNAKE token is now a candidate, and
 * acceptance is entirely data-driven:
 *  - real error codes / hold-conversion reasons (`contract.errorCodes`,
 *    `contract.holdConversionReasons`), or
 *  - any string that appears in an `enum` array anywhere in openapi.json —
 *    collected by walking the spec, not hand-listed, so a new enum value
 *    (`SINGLE_SESSION`, `ACTIVE`, `BOOKING_SERVICE`, a future one, …) never
 *    needs a change here.
 * Everything else is either flagged or added to NOT_CODES below with a
 * per-entry justification — never by loosening the candidate pattern, since
 * that's exactly how the original guard went blind.
 */
const CODE_RE = /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/g;

/**
 * SCREAMING_SNAKE tokens in the docs that are real but are neither an error
 * code/hold-conversion reason nor an openapi.json enum value. Each entry
 * needs its own justification — unlike the old suffix/prefix guard, nothing
 * here is inferred from shape.
 */
const NOT_CODES = new Set([
  // Placeholder ids in URL/body examples — stand-ins, not values of any
  // real field, so they can't appear in an openapi.json enum.
  'PROJECT_ID', 'SERVICE_ID', 'OFFERING_ID', 'BOOKING_ID', 'ORDER_ID',
  'CLIENT_ID', 'SUPPLIER_ID', 'PACKAGE_ID',
  // Environment variable names, quoted verbatim in setup/auth instructions.
  'MARKETBOX_API_KEY', 'MARKETBOX_API_URL', 'MARKETBOX_PROJECT_ID',
  // HTTP-header/auth-scheme-shaped tokens in prose and tables — not JSON
  // field values, so they don't appear in any schema's `enum`.
  'API_KEY', 'X_REQUEST_ID', 'CONTENT_TYPE',
  // DynamoDB billing-mode literal, mentioned in passing where docs describe
  // infra behavior (see root CLAUDE.md) — not part of the public HTTP API.
  'PAY_PER_REQUEST',
  // Fix round 1 (task-8-report.md): the following are all environment
  // variable / config placeholder names quoted verbatim in `.env` snippets,
  // `process.env.X` reads, or `{VAR}`-style prose placeholders across the
  // integration guides. Confirmed by reading each site — none is ever used
  // as a `code` in an error envelope or a JSON field value.
  //
  // Generic API base URL placeholder, reused across nearly every guide's
  // curl/fetch examples (e.g. `{API_BASE_URL}/v1/projects/{PROJECT_ID}/...`).
  'API_BASE_URL',
  // guides/accept-payments-with-stripe.mdx: browser-side Stripe config.
  'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_STRIPE_ACCOUNT_ID',
  // guides/booking-flow-auth.mdx: browser-side OIDC/OAuth client config.
  'NEXT_PUBLIC_OIDC_CLIENT_ID', 'NEXT_PUBLIC_OIDC_ISSUER',
  'NEXT_PUBLIC_OIDC_AUTHORIZE_URL', 'NEXT_PUBLIC_OIDC_TOKEN_URL',
  'NEXT_PUBLIC_OIDC_LOGOUT_URL', 'NEXT_PUBLIC_OAUTH_SCOPES',
  'NEXT_PUBLIC_APP_ORIGIN',
]);

/** Recursively collects every string member of every `enum` array anywhere
 *  in the OpenAPI document into `out`. This is what makes acceptance
 *  data-driven instead of guessed: any legitimate SCREAMING_SNAKE value the
 *  spec declares for *any* field (order status, business-model type,
 *  booking-note scope, …) is accepted without this rule needing to know
 *  what that field is. */
function collectEnumValues(node, out) {
  if (Array.isArray(node)) {
    for (const item of node) collectEnumValues(item, out);
    return;
  }
  if (node && typeof node === 'object') {
    if (Array.isArray(node.enum)) {
      for (const v of node.enum) {
        if (typeof v === 'string') out.add(v);
      }
    }
    for (const key of Object.keys(node)) collectEnumValues(node[key], out);
  }
}

export default {
  name: 'error-codes',
  check(page, { contract, spec }) {
    const known = new Set([
      ...contract.errorCodes,
      ...contract.holdConversionReasons,
    ]);
    collectEnumValues(spec, known);

    const findings = [];

    for (const { n, text } of page.lines) {
      for (const [token] of text.matchAll(CODE_RE)) {
        if (NOT_CODES.has(token)) continue;
        if (known.has(token)) continue;

        findings.push({
          rule: 'error-codes',
          path: page.path,
          line: n,
          message: `\`${token}\` is not a code the API emits`,
        });
      }
    }

    return findings;
  },
};
