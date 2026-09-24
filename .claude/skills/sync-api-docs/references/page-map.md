# Which pages a change touches

Start from the row that matches the changed route or concept, then **grep** for
each changed name across `**/*.mdx` — this table finds the obvious pages, the
grep finds the rest.

| Change in the spec | Pages to review |
| --- | --- |
| Any integrator-visible change | `changelog/overview.mdx` (new `<Update>` at the top) |
| New error code in `docs-contract.json` | `concepts/errors.mdx` — Common error codes, or Hold and slate codes; the Status codes table if the HTTP status is new there |
| `/bookings…`, booking statuses, participants, notes | `resources/bookings.mdx` (lifecycle table, creating, rescheduling, endpoint index), `guides/create-a-single-booking.mdx` |
| `/orders…`, order items, order status | `resources/orders.mdx` (lifecycle, creating, listing, settling, endpoint index), `concepts/service-fees.mdx`, `concepts/regional-pricing.mdx` when pricing changes |
| `/transactions`, `/payment-intent`, settlement, card saving | `guides/accept-payments-with-stripe.mdx`, `resources/orders.mdx#settling-an-order` |
| `/clients/me…` (onboarding, profile, credits, addresses) | `guides/booking-flow-auth.mdx`, `concepts/end-user-authentication.mdx`, `guides/accept-payments-with-stripe.mdx` (client profile shape) |
| Addresses, `locationType`, travel zones, coordinates | `guides/booking-addresses.mdx`, `guides/hold-slots-for-checkout.mdx` |
| `/availability/search`, `/time-slots`, `/availability/suppliers` | `resources/availability.mdx`, `guides/search-suppliers-by-availability.mdx` |
| `/availability/package-slate`, `/package-options`, slates, cadence | `guides/availability-and-slates.mdx`, `guides/create-a-package-booking.mdx`, `guides/show-a-package-storefront.mdx` |
| `/orders/{orderId}/package-bookings`, package credits | `guides/create-a-package-booking.mdx`, `resources/orders.mdx` |
| `/holds…`, occupancy conflicts (`SLOT_HELD`, `SLOT_BOOKED`) | `guides/hold-slots-for-checkout.mdx`, `concepts/concurrency.mdx` |
| `/suppliers…` | `resources/suppliers.mdx` (fields, write rules, listing, endpoint index) |
| `/reviews…`, review links | `resources/reviews.mdx`, `concepts/emails.mdx` |
| Emails a route sends | `concepts/emails.mdx` |
| Timezone fields, local/UTC times | `concepts/timezones.mdx`, `resources/availability.mdx#slot-times-and-zones` |
| Pagination (`limit`, `cursor`, `nextCursor`) | `concepts/pagination.mdx`, and the page for that list |
| API keys, project scope, 401/403 | `concepts/authentication.mdx`, `concepts/projects-and-scope.mdx` |
| Services, offerings, business models, packages catalog | `concepts/booking-engine-model.mdx` |
| A whole new resource or tag | `api-reference/introduction.mdx` and `index.mdx` cards; a new `resources/` page and its `docs.json` nav entry |
| Terms defined or renamed | `glossary.mdx` |

## Grep checklist

For each item in the spec diff, grep for:

- removed or renamed enum values (`NO_SHOW`, `OPEN`) — a page may still say they are accepted;
- the endpoint path fragment (`/clients/me`, `/status`) — endpoint tables and "Endpoints used in this guide" lists;
- the field name — example JSON bodies, field tables;
- phrases that describe the old behaviour ("is required", "deprecated", "will be removed", "cannot").
