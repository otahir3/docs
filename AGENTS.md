# MarketBox API documentation — project instructions

## About this project

- Mintlify docs site for the **MarketBox public API** (the `open-api-mb` service).
- Pages are MDX with YAML frontmatter. Configuration is `docs.json`.
- `mint dev` previews locally. `mint broken-links` checks links.
- Roughly half of this site's readers are AI agents, not people. Mintlify already
  serves clean Markdown, `llms.txt` and `llms-full.txt` automatically — you do not
  need to generate or maintain any of those.

## `api-reference/openapi.json` is GENERATED — never hand-edit it

It is produced from the running API in the **mb-core** repository. Editing it here
is always wrong: the next regeneration silently discards your change, and until
then the reference contradicts the API.

To change the API reference, change the route schema in mb-core and regenerate:

```bash
# in mb-core
pnpm --filter @mb-core/open-api-mb openapi:write   # regenerate the committed spec
pnpm --filter @mb-core/open-api-mb openapi:check   # what CI runs; fails when stale
pnpm --filter @mb-core/open-api-mb openapi:sync -- <path-to>/docs/api-reference/openapi.json
```

Descriptions, examples and enum documentation come from `.describe(...)` and
`.meta({ example })` on the Zod schemas in mb-core — mostly in
`apps/open-api-mb/src/routes/**` and `packages/types/src/**`. Shared parameter
descriptions live in `apps/open-api-mb/src/lib/params.ts`, so describing an id
once covers every route that takes it.

mb-core's CI enforces two things: the committed spec matches the code
(`openapi:check`), and documentation coverage never goes backwards
(`apps/open-api-mb/src/openapi-coverage.test.ts`).

**This history is why the rules above are strict:** the spec drifted from the API
for months. The guides told integrators to send `reservationId`/`locationId`/`address`
on order create; the machine-readable spec did not list those fields at all. A
customer's AI agent read the spec, believed it, and stayed stuck.

## Terminology

Use these words, consistently — they are the words the API itself uses.

| Term | Meaning | Don't say |
| --- | --- | --- |
| **project** | The tenant. Everything is scoped to one. | account, workspace, org |
| **client** | The person the service is for. | customer, end user¹ |
| **supplier** | The person or resource delivering the service. | provider, staff, vendor |
| **service** | The sellable thing. | product |
| **offering** | A bookable variant of a service, with duration and pricing. | option, variant |
| **package** | Prepaid bundle of sessions, drawn down by bookings. | bundle, credit pack |
| **booking** | One scheduled appointment. | appointment, session² |
| **order** / **order item** | The commercial record and its lines. | invoice, cart |
| **hold** (reservation) | Temporarily reserved supplier time, converted to bookings. | lock, block |

¹ "end user" has a specific meaning in auth: the human holding the Cognito JWT.
Use it only when discussing the end-user auth plane.
² "session" is correct for the individual bookings a package funds.

## Style preferences

- Active voice, second person ("you").
- One idea per sentence. Sentence case for headings.
- Bold for UI elements: Click **Settings**. Code formatting for fields, commands,
  paths and IDs.
- Show the failure, not just the happy path. When an endpoint has a common way to
  go wrong, document the error the caller will actually see and what it means.
- Examples must use the real id prefixes: `prj_`, `srv_`, `off_`, `pkg_`, `bk_`,
  `ord_`, `oi_`, `cli_`, `sup_`, `resv_`, `loc_`. A wrong prefix is worse than no
  example — it gets copied verbatim and fails.
- Amounts are integer **minor units** (cents). `4500` is $45.00. Never write a
  decimal amount in a request example.

## Content boundaries

- Document the **public API** only. `api-mb` is the internal backoffice API and
  is not covered here.
- Do not document unreleased endpoints, or environments a release has not reached.
  The `servers` block in the reference names the environment these docs describe,
  and the "try it" console sends real requests to it. Never advertise a host that
  does not yet carry the release the surrounding docs describe — an agent will
  believe the docs and call the wrong one.
- Do not put credentials, real customer data, or real API keys in examples.
