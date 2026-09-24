# The changelog entry and the change doc

Both are for integrators — developers building on the public API, and their
AI agents. They care about three things: what breaks, what they must change,
and what they can now do. Lead with those. Use the API's own terms (see
`AGENTS.md`), real id prefixes, integer minor units, and real error envelopes.

## Changelog entry (`changelog/overview.mdx`)

One `<Update>` block per sync, newest first, directly under the frontmatter.
Match the existing entries:

```mdx
<Update label="September 23, 2026" tags={["API"]}>

## <Headline naming the two or three things that changed>

<One short paragraph: what changed and why it matters.>

**<Breaking/additive verdict in one bold sentence.>** <Which decoders need regenerating.>

**Breaking**

- **<What no longer works.>** <What happens now, the error, what to do instead.>

**New**

- **<Field/endpoint/parameter>** — <what it does, its rules>.

**Changed**

- **<Behaviour>** — <before vs now>.

**What this means for you**

- **<Imperative action.>** <One line why.>

Full detail: [<Page → Section>](/path#anchor), …

</Update>
```

- Leave out empty sections (no **Breaking** heading when nothing breaks).
- The verdict line is what a reader scans first. "Purely additive" is a promise,
  so only write it when no request that worked before can now fail.
- Link to the sections you updated, not just the pages.

## Change doc for API developers

A standalone document the user shares with the teams integrating against the
API, so they can make the changes on their side. Title:
`MarketBox API changes — <Month D, YYYY>`. Sections, in this order:

1. **Summary** — one sentence saying how many breaking changes there are, the
   environment it is live on (from `servers`), then a table:
   `Change | Type (Breaking / Behaviour change / New / Additive) | Who is affected`.
2. **Breaking changes** — one subsection each: what changed, a **Before** /
   **Now** pair with the real request and the real error envelope, and **What
   to change** as bullets.
3. **Behaviour changes to review** — a table `Area | What changes now | What to check`
   for changes that don't break a valid request but change what happens
   (settlement, emails, validation that now 404s instead of writing).
4. **New capabilities** — one subsection per feature with a minimal request
   example and its rules; group small ones under "Smaller additions".
5. **New response fields and error codes** — two tables for people with typed
   clients: `Object | New field | Values and meaning`, and
   `Code | Status | Where | What to do`. Say that enums can grow.
6. **Migration checklist** — checkbox lists: "Must do (breaking)" then "Should do".
7. **References** — the docs pages that cover each change.

Keep sentences short and specific. No internal ticket ids, mb-core file paths,
or `api-mb` routes — the reader never sees those.
