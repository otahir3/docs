/**
 * Every SCREAMING_SNAKE token that looks like an error code must be one the
 * API actually emits, or a documented hold-conversion reason.
 *
 * Documenting a code the API never returns teaches an agent to branch on a
 * condition that cannot occur, and hides the one that can.
 */
const CODE_RE = /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/g;

/** SCREAMING_SNAKE tokens in the docs that are not error codes. */
const NOT_CODES = new Set([
  'API_KEY', 'PROJECT_ID', 'SERVICE_ID', 'OFFERING_ID', 'BOOKING_ID',
  'ORDER_ID', 'CLIENT_ID', 'SUPPLIER_ID', 'PACKAGE_ID', 'MARKETBOX_API_KEY',
  'MARKETBOX_API_URL', 'MARKETBOX_PROJECT_ID', 'SINGLE_SESSION', 'PAY_PER_REQUEST',
  'X_REQUEST_ID', 'CONTENT_TYPE',
  // Found running against the real docs (task-8-report.md): a real
  // `Booking notes` request/response `scope` enum value, not an error code.
  // Confirmed in api-reference/openapi.json — the `scope` schema on
  // `POST .../bookings/{id}/notes` (and its siblings) is `["BOOKING",
  // "BOOKING_SERVICE"]`. It only reaches the two-sided guard because it
  // starts with the `BOOKING_` domain prefix, same as real codes like
  // `BOOKING_NOT_FOUND` would.
  'BOOKING_SERVICE',
]);

export default {
  name: 'error-codes',
  check(page, { contract }) {
    const known = new Set([
      ...contract.errorCodes,
      ...contract.holdConversionReasons,
    ]);
    const findings = [];

    for (const { n, text } of page.lines) {
      for (const [token] of text.matchAll(CODE_RE)) {
        if (NOT_CODES.has(token)) continue;
        if (known.has(token)) continue;
        if (!/_(ERROR|FAILED|INVALID|NOT_FOUND|CONFLICT|EXPIRED|UNAVAILABLE|DENIED|REQUIRED)$/.test(token)
            && !/^(SLOT|RESERVATION|HOLD|ORDER|BOOKING|PAYMENT|PROJECT|CLIENT|SUPPLIER|SERVICE|PACKAGE)_/.test(token)) {
          continue;
        }

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
