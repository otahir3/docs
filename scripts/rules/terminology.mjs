/**
 * The docs must use the words the API uses. AGENTS.md states this as prose for
 * humans; this rule enforces it.
 *
 * The API has `supplierId` in 125 places and `providerId` in zero, yet the
 * quickstart sent `providerId` and two pages had "Providers" cards. A reader
 * cannot tell a synonym from a distinct concept.
 *
 * Two independent checks run per page:
 *
 *  1. Prose outside fenced code blocks: any whole-word mention of a banned
 *     term. A code sample may legitimately contain a third-party field named
 *     `customer` (Stripe has several), so fenced blocks are skipped here —
 *     flagging those trains people to ignore the rule.
 *
 *  2. Inside fenced code blocks, JSON-style object keys only: a key whose
 *     name *contains the banned term as a whole word-part* (case-insensitive,
 *     so both `providerId` and `provider_id` fire). This exists because part
 *     1's exemption is too broad on its own — `"providerId": "prv_123"` sits
 *     inside a fenced bash block in the quickstart, so a rule that skips
 *     fences entirely never sees it. The id-prefix rule catches only the
 *     *value* (`prv_123`); fixing the value while leaving the key `providerId`
 *     would pass every check, and `providerId` is exactly what the API
 *     rejects. Only key *names* are checked here, never string values or
 *     surrounding prose inside the fence — that keeps Stripe's own JSON
 *     shapes (checked against THIRD_PARTY_KEYS below) from being flagged for
 *     using words like "customer" in a value or comment.
 */

/**
 * JSON/object keys minted by a third party (Stripe), not MarketBox — must
 * never be flagged even though they contain a banned term as a word-part.
 *
 * This is an exact-key allowlist rather than a "this fence belongs to a
 * third party" heuristic on the surrounding block (language tag, nearby
 * prose): the docs mix MarketBox and Stripe JSON in the same guide, and
 * sometimes the same fence (see guides/accept-payments-with-stripe.mdx),
 * so a block-level heuristic would be unreliable in both directions — it
 * could blind the rule to a real MarketBox `customerId` typo sitting next
 * to a Stripe example, or flag a legitimate Stripe field just because it's
 * near MarketBox prose. Excluding by exact key name is precise instead.
 *
 * Each entry is a real Stripe API field name, per Stripe's own API
 * reference, not a guess:
 *  - `customer`         — PaymentIntent.customer / Charge.customer (the id
 *                          of the Stripe Customer object)
 *  - `customer_id`      — snake_case shape as it appears in raw Stripe
 *                          webhook/event JSON
 *  - `customerId`       — camelCase shape, in case a guide quotes a Stripe
 *                          SDK's return type instead of the raw API
 *  - `customer_email`   — Stripe Checkout Session / PaymentIntent field
 *  - `customer_details` — Stripe Checkout Session field (nested object)
 *
 * As of this writing, grepping the docs for these exact keys inside fences
 * finds none — guides/accept-payments-with-stripe.mdx quotes MarketBox's
 * own envelope (`clientId`, `lastPaymentMethodId`, …), not raw Stripe
 * objects. This set is populated preemptively because the payments guide
 * legitimately discusses Stripe's customer object, and a future edit that
 * pastes a raw Stripe payload should not need to touch this rule.
 */
const THIRD_PARTY_KEYS = new Set([
  'customer',
  'customer_id',
  'customerId',
  'customer_email',
  'customer_details',
]);

/** A JSON-ish object key: `"someKey":`. Only the key is captured — matching
 *  stops at the colon, so string *values* are never inspected here. */
const KEY_RE = /"([A-Za-z_][A-Za-z0-9_]*)"\s*:/g;

/** Splits a key into lowercase word-parts on camelCase boundaries and
 *  underscores, e.g. `providerId` -> ['provider','id'], `provider_id` ->
 *  ['provider','id']. Comparing whole words (not substrings) is what keeps
 *  this from flagging words this rule has no opinion about (e.g. a
 *  hypothetical `providence`) while still catching both naming conventions
 *  the docs actually use. */
function keyWords(key) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split('_')
    .filter(Boolean);
}

export default {
  name: 'terminology',
  check(page, { contract }) {
    const findings = [];
    let inFence = false;

    for (const { n, text } of page.lines) {
      if (/^\s*```/.test(text)) {
        inFence = !inFence;
        continue;
      }

      if (inFence) {
        for (const [, key] of text.matchAll(KEY_RE)) {
          if (THIRD_PARTY_KEYS.has(key)) continue;
          const words = keyWords(key);

          for (const { banned, use, allowedIn } of contract.terminology) {
            if (allowedIn?.includes(page.path)) continue;
            if (!words.includes(banned) && !words.includes(`${banned}s`)) continue;

            findings.push({
              rule: 'terminology',
              path: page.path,
              line: n,
              message: `say "${use}", not "${banned}" (found in JSON key "${key}")`,
            });
            break; // one finding per key is enough, even if it somehow matched twice
          }
        }
        continue;
      }

      for (const { banned, use, allowedIn } of contract.terminology) {
        if (allowedIn?.includes(page.path)) continue;
        const re = new RegExp(`\\b${banned}s?\\b`, 'i');
        if (!re.test(text)) continue;

        findings.push({
          rule: 'terminology',
          path: page.path,
          line: n,
          message: `say "${use}", not "${banned}"`,
        });
      }
    }

    return findings;
  },
};
