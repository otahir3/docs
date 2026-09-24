---
name: sync-api-docs
description: Sync the MarketBox API docs (this Mintlify repo) with the public API in mb-core's apps/open-api-mb — pull both repos, check the generated spec is current and actually deployed, copy openapi.json and docs-contract.json over, diff them, update every guide, resource page, errors table and the changelog the change touches, validate, publish to Mintlify, and write a change doc for integrators when something breaks. Use this whenever the user says the API changed, asks to update/sync/refresh/regenerate the API docs or API reference, mentions new or changed endpoints/fields/error codes in open-api-mb, asks to publish the docs to Mintlify after an API change, or wants release notes or a change write-up for API developers — even if they don't say "sync".
---

# Sync the API docs with open-api-mb

The docs in this repo describe the MarketBox **public** API served by
`apps/open-api-mb` in the **mb-core** repo. The API reference tab is generated
from `api-reference/openapi.json`; everything else (guides, resource pages,
errors, changelog) is hand-written prose that has to be kept true by hand.

Read `AGENTS.md` first if it isn't already in context — it holds the
terminology, style, id-prefix and content-boundary rules every edit here must
follow, and the history of why the spec is never hand-edited.

The job has two halves, and the second is where the value is:

1. **Mechanical** — make sure mb-core's committed spec is current and
   deployed, then copy it over. Scripts do this.
2. **Judgment** — find every sentence in the prose the change made false, and
   tell integrators what they must change. The drift checker cannot do this:
   it passes happily while a page says a removed value is "still accepted".

## Where things are

- Docs repo: this repo (`C:\_dev\2.0\docs`), deploys from `main` via the Mintlify GitHub app.
- mb-core: sibling repo `../mb-core`, branch **`dev`** (what the dev server runs; `master` is its default branch).
- The environment these docs describe = `servers[0].url` in the spec (currently the dev API Gateway).
- Diff script: `.claude/skills/sync-api-docs/scripts/spec-diff.mjs` (Node, no dependencies).
- Scratch files (old spec snapshots, reports) go in your scratchpad, never in the repo.
- Run the shell steps in **Git Bash** (the Bash tool). Use **absolute paths**
  for `<docs>`, `<mb-core>` and `<scratch>`: the sync scripts run from
  `apps/open-api-mb` and resolve a relative target against that directory.

**The spec diff is the source of truth for what changed** — not the mb-core
commit log. A stale spec on `dev` can hold route changes merged long before
the last sync, and a sync marker can name the wrong commit. Use commit logs
only to understand *why* something changed.

## Workflow

### 1. Pull both repos and check they are clean

```bash
git -C <docs> status --short          # note anything already modified
git -C <docs> pull --ff-only          # others push docs PRs often
git -C <mb-core> fetch
git -C <mb-core> status -sb           # expect "## dev...origin/dev" and nothing else
```

- **Docs has local changes** before you start → they aren't yours. Ask whether
  to include them; otherwise leave them out and stage only your files in step 8.
- **mb-core is behind `origin/dev`** → `git -C <mb-core> merge --ff-only origin/dev`.
- **mb-core is on another branch, is ahead of `origin/dev`, or has local
  changes under `apps/open-api-mb`, `packages/types` or `packages/db`** → stop
  and ask. The sync publishes mb-core's *working tree*, so you'd be documenting
  something that isn't on `dev`.

For context later, list what landed since the last sync:
`git log --grep "sync spec from mb-core" -1 --format=%s` names the mb-core
commit last synced, and
`git -C <mb-core> log --oneline <that>..origin/dev -- apps/open-api-mb packages/types packages/db`
lists the commits whose messages explain the changes.

### 2. Check the committed spec is current

```bash
cd <mb-core>
pnpm --filter @mb-core/open-api-mb openapi:check     # must say "up to date"
pnpm --filter @mb-core/open-api-mb contract:check    # must say "is current"
```

Each rebuilds `@mb-core/types`/`db` and the app first, so each takes a minute
or two — keep the `pnpm --filter` form; running `tsx scripts/openapi.ts`
directly skips the build and can compare against stale compiled output.

**If either is stale**, someone merged a route change without regenerating.
Run `pnpm --filter @mb-core/open-api-mb openapi:write` (or `contract:write`),
re-run the check, and confirm `git -C <mb-core> status` shows only that file.
Committing and pushing in mb-core is outside this repo, so **ask the user
before doing either**; suggested message:
`chore(open-api): regenerate openapi.json for <what was missing>`. mb-core's
pre-commit hook runs prettier on the file — after committing, re-run
`openapi:check` to confirm it still matches.

### 3. Check the change is actually deployed

The docs' "try it" console sends real requests to `servers[0].url`, and an
integrator's agent will believe whatever the docs say. Documenting behaviour
the server doesn't run yet is the exact failure `AGENTS.md` warns about.

Take `servers[0].url` from **mb-core's** `apps/open-api-mb/openapi.json` —
the spec you are about to publish — then:

```bash
cd <docs>
node .claude/skills/sync-api-docs/scripts/spec-diff.mjs --same \
  <mb-core>/apps/open-api-mb/openapi.json <servers[0].url>/v1/openapi.json
```

`SAME` → go on. `DIFFERENT` → the listed paths are what the server doesn't
have yet. Tell the user and ask whether to wait for the deploy; don't publish
a spec ahead of the server.

### 4. Snapshot, sync, diff

```bash
cd <docs>
git show HEAD:api-reference/openapi.json      > <scratch>/old-openapi.json
git show HEAD:api-reference/docs-contract.json > <scratch>/old-contract.json

cd <mb-core>
pnpm --filter @mb-core/open-api-mb openapi:sync  -- <docs>/api-reference/openapi.json
pnpm --filter @mb-core/open-api-mb contract:sync -- <docs>/api-reference/docs-contract.json

cd <docs>
node .claude/skills/sync-api-docs/scripts/spec-diff.mjs \
  <scratch>/old-openapi.json api-reference/openapi.json \
  --old-contract <scratch>/old-contract.json --new-contract api-reference/docs-contract.json \
  > <scratch>/spec-diff.md
```

Read the whole report. It groups changes by endpoint and schema, keys query
parameters by name (so an inserted parameter doesn't look like five renames),
lists enum values added/removed, new error codes from the contract, and — for
changed descriptions — just the sentences added and dropped. `--verbose` prints
full descriptions when you need them.

The report opens with a verdict line:

- `NO SEMANTIC DIFFERENCES — nothing in the spec or the contract changed.` →
  say so and stop; there is nothing to publish. If `git status` still shows
  the synced files changed (formatting only), revert them with
  `git checkout -- api-reference/` rather than committing noise.
- `CHANGES FOUND — …` → carry on. A contract-only or top-level-only change
  still counts: a new error code needs an errors-table row.

### 5. Understand each change before writing about it

The report tells you *what* changed in the spec, not always *what it means*.
Before writing a sentence about a change, be sure of:

- **Is it breaking?** The "Breaking-change candidates" list is a heuristic.
  The most important breaking changes often live only in prose — "`PAID`
  cannot be requested", "`NO_SHOW` can no longer be SET" — so read every
  description sentence diff. A new 4xx on an existing route is breaking when a
  request that used to succeed is now refused; it isn't when the route merely
  documents a failure it always had. The mb-core commit message usually says which.
- **Exact behaviour.** When the description leaves a question open (which
  values count, what is written, what the error message says), read the route
  in `apps/open-api-mb/src/routes/**` and the zod schema or repository it
  calls in `packages/types/src/**` / `packages/db/src/**`. Take error messages
  verbatim from the thrown error so examples match what callers really see.
- **Whether the public API can set it.** New response fields are often written
  only by the MarketBox console (`api-mb`). Document them as readable, and say
  so — never document `api-mb` routes.

### 6. Update the prose

Use `references/page-map.md` to find the pages each kind of change touches.
Then **grep for every changed name** — removed enum values, renamed fields,
changed paths, status names, error codes — across `**/*.mdx`. Grepping is what
finds the stale sentence three pages away from where you'd think to look.

While editing a section, fix anything else in it you find is wrong against the
spec — say so in the commit body. (A past sync found an order lifecycle diagram
showing statuses the API never had.)

Follow `AGENTS.md`: the API's own terms, second person, active voice, one idea
per sentence, real id prefixes, integer minor units. Show the failure: for each
new error an integrator can hit, give the envelope with the real `code`,
`message`, `statusCode` and a `requestId`.

Always update:

- `concepts/errors.mdx` — a row for every new code in the contract (Common
  error codes, or Hold and slate codes), and the status table if a status is new.
- `changelog/overview.mdx` — one new `<Update>` block at the top. Shape in
  `references/writeups.md`.

Don't edit `api-reference/openapi.json` or `docs-contract.json` — they are the
synced copies. A description in the spec that is wrong or unclear is fixed in
mb-core (`.describe()` on the zod schema), then re-synced.

### 7. Validate

```bash
npm run check                          # must end "docs check passed"
node --test scripts/check-docs.test.mjs   # `npm test`'s glob doesn't expand on Windows
```

Then Mintlify (the CLI needs Node ≥ 20.17; in PowerShell run `nvm use 22` first):

```bash
mint validate
mint broken-links
```

`mint broken-links` does not check `#anchors` — confirm by eye that every
`#anchor` you link matches a heading slug.

Checker findings you'll likely meet:

- **terminology: say "client", not "customer"** — also fires on "Stripe
  customer" in prose. Write "the client's record in Stripe".
- **error-codes** — every SCREAMING_SNAKE token must be a contract code or a
  spec enum value. A token that is neither is usually a typo or an `api-mb` code.
- **examples** — request-body JSON in MDX is validated against the spec, which
  is why spec and prose ship in one commit.

### 8. Commit and publish

One commit with the spec, the contract and all prose, so the site is never
half-updated:

```
docs: sync spec from mb-core <short sha> — <two or three themes>

- <page or area>: <what changed>
...
```

Keep the `sync spec from mb-core <sha>` prefix — step 1 finds the last sync by
it. `<sha>` must be the mb-core commit whose **committed** `openapi.json` is
what you synced. If step 2 regenerated the spec, that is the regeneration
commit, so commit it in mb-core before this one. If the user declined that
commit, write `<HEAD sha> + uncommitted regeneration` so the next sync doesn't
trust the marker.

Stage explicitly (`git add api-reference/ <each page you edited>`), not
`git add -A`, so local changes you found in step 1 stay out.

Pushing to `main` publishes to the live docs site. Push when the user asked to
publish or sync the docs; if they only asked to "update" them, ask first. Then
confirm the deploy (the `gh` CLI may not be installed; the API works without it):

```bash
curl -s https://api.github.com/repos/otahir3/docs/commits/<sha>/check-runs
```

Expect `check: completed success` (the drift checker in CI) and
`Mintlify Deployment: completed success`. A pending run → check again shortly.

### 9. Write the change doc for API developers

Write one when the sync contains a **breaking change**, or when the user asks.
Otherwise offer it in one line. It is for integrators, not for the MarketBox
team: what changed, what breaks, and exactly what to change on their side.
Structure in `references/writeups.md`. Create it with the Claude Docs
connector when one is available (load its skill first); otherwise write
Markdown to the scratchpad and send it.

### 10. Report back

A few lines: what the sync covered (and that it covered every change since the
last sync, if the user expected only one), the breaking changes, anything
fixed that was already wrong, the commit and deploy result, anything left
uncommitted or unpushed in mb-core, and the change doc link.
