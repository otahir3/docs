#!/usr/bin/env node
/**
 * Semantic diff of two OpenAPI specs (and, optionally, two docs contracts),
 * printed as Markdown for a human or an agent to turn into prose changes.
 *
 *   node spec-diff.mjs <old> <new> [--old-contract <p>] [--new-contract <p>] [--verbose]
 *   node spec-diff.mjs --same <a> <b>        exit 0 if the two specs are semantically equal
 *
 * <old>/<new> are file paths or http(s) URLs (e.g. the live `/v1/openapi.json`).
 * For a committed revision: `git show <rev>:api-reference/openapi.json > old.json`.
 *
 * Why not `git diff`: the committed spec is ~30k lines of pretty-printed JSON,
 * and query parameters are an ARRAY, so inserting one parameter shifts every
 * later index and a textual diff reports renames that never happened. This
 * script keys parameters by `in`+`name`, walks schemas by property name, and
 * reports enum values added/removed — the changes that actually break callers.
 */
import fs from 'node:fs';

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

async function load(src) {
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`${src} returned ${res.status}`);
    return res.json();
  }
  // A snapshot written by PowerShell 5.1 (`git show … > file`) carries a BOM,
  // and may be UTF-16; JSON.parse rejects both.
  const buf = fs.readFileSync(src);
  const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le') : buf.toString('utf8');
  return JSON.parse(text.replace(/^﻿/, ''));
}

/** Key-order-independent equality: the live spec and the committed one serialise keys differently. */
function canonical(x) {
  if (Array.isArray(x)) return x.map(canonical);
  if (x && typeof x === 'object') {
    return Object.fromEntries(Object.keys(x).sort().map((k) => [k, canonical(x[k])]));
  }
  return x;
}
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

function ops(doc) {
  const out = new Map();
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const m of METHODS) if (item[m]) out.set(`${m.toUpperCase()} ${path}`, item[m]);
  }
  return out;
}

const SCALAR_KEYS = ['type', 'format', 'nullable', 'minimum', 'maximum', 'exclusiveMinimum',
  'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern', 'default', '$ref'];

/**
 * Walks two JSON schemas in parallel and pushes findings as
 * { path, kind, detail, breaking }. `side` is 'request' or 'response':
 * narrowing a request is breaking for callers, widening a response is
 * breaking only for strict decoders (reported, not flagged).
 */
function diffSchema(a, b, path, side, out, verbose) {
  a ??= {}; b ??= {};
  for (const k of SCALAR_KEYS) {
    if (!same(a[k], b[k])) {
      out.push({ path, kind: 'changed', detail: `${k}: ${fmt(a[k])} → ${fmt(b[k])}`,
        breaking: side === 'request' && (k === 'type' || (k === 'nullable' && !b[k]) || k.startsWith('max') || k.startsWith('min')) });
    }
  }
  if (!same(a.enum, b.enum)) {
    const ea = new Set(a.enum ?? []), eb = new Set(b.enum ?? []);
    const added = [...eb].filter((v) => !ea.has(v)), removed = [...ea].filter((v) => !eb.has(v));
    if (added.length) out.push({ path, kind: 'enum+', detail: added.map(fmt).join(', '), breaking: false });
    if (removed.length) out.push({ path, kind: 'enum-', detail: removed.map(fmt).join(', '), breaking: side === 'request' || side === 'param' });
  }
  if (a.description !== b.description && (a.description || b.description)) {
    out.push({ path, kind: 'description', detail: verbose ? `\n    - ${fmt(a.description)}\n    + ${fmt(b.description)}` : '', breaking: false });
  }
  const ra = new Set(a.required ?? []), rb = new Set(b.required ?? []);
  for (const r of rb) if (!ra.has(r) && a.properties?.[r]) out.push({ path: `${path}.${r}`, kind: 'now required', detail: '', breaking: side === 'request' });
  for (const r of ra) if (!rb.has(r) && b.properties?.[r]) out.push({ path: `${path}.${r}`, kind: 'now optional', detail: '', breaking: side === 'response' });
  const pa = a.properties ?? {}, pb = b.properties ?? {};
  for (const k of Object.keys(pb)) {
    if (!pa[k]) {
      const req = rb.has(k) ? ' (required)' : '';
      out.push({ path: `${path}.${k}`, kind: 'added', detail: `${summarise(pb[k])}${req}`, breaking: side === 'request' && !!req });
    }
  }
  for (const k of Object.keys(pa)) if (!pb[k]) out.push({ path: `${path}.${k}`, kind: 'removed', detail: '', breaking: true });
  for (const k of Object.keys(pb)) if (pa[k]) diffSchema(pa[k], pb[k], `${path}.${k}`, side, out, verbose);
  if (a.items || b.items) diffSchema(a.items, b.items, `${path}[]`, side, out, verbose);
  for (const comb of ['allOf', 'oneOf', 'anyOf']) {
    const la = a[comb] ?? [], lb = b[comb] ?? [];
    for (let i = 0; i < Math.max(la.length, lb.length); i++) diffSchema(la[i], lb[i], `${path}<${comb}${i}>`, side, out, verbose);
  }
}

function summarise(s) {
  if (!s) return '';
  if (s.$ref) return s.$ref.replace('#/components/schemas/', '→');
  const bits = [s.type ?? (s.allOf ? 'allOf' : s.oneOf ? 'oneOf' : '')];
  if (s.enum) bits.push(`[${s.enum.join('|')}]`);
  if (s.nullable) bits.push('nullable');
  return bits.filter(Boolean).join(' ');
}
const fmt = (v) => (v === undefined ? '∅' : typeof v === 'string' ? JSON.stringify(v.length > 160 ? `${v.slice(0, 157)}…` : v) : JSON.stringify(v));

/**
 * Sentence-level diff of two description strings. Descriptions are where the
 * API states behaviour a schema cannot express ("PAID cannot be requested",
 * "NO_SHOW can no longer be SET"), so a bare "description changed" hides the
 * most important breaking changes. Printing only the sentences that were
 * added or dropped keeps the report short without losing them.
 */
function sentenceDiff(a = '', b = '') {
  const split = (s) => s.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  const sa = new Set(split(a)), sb = new Set(split(b));
  const plus = [...sb].filter((x) => !sa.has(x)), minus = [...sa].filter((x) => !sb.has(x));
  return [...minus.map((x) => `\n    − ${x}`), ...plus.map((x) => `\n    + ${x}`)].join('');
}

function bodySchema(op) {
  return op.requestBody?.content?.['application/json']?.schema;
}
function paramKey(p) { return `${p.in}:${p.name}`; }

function diffOp(a, b, verbose) {
  const out = [];
  if (a.summary !== b.summary) out.push({ path: 'summary', kind: 'text', detail: `${fmt(a.summary)} → ${fmt(b.summary)}`, breaking: false });
  if (a.description !== b.description) {
    out.push({ path: 'description', kind: 'text', detail: verbose ? `\n    - ${fmt(a.description)}\n    + ${fmt(b.description)}` : sentenceDiff(a.description, b.description), breaking: false });
  }
  const pa = new Map((a.parameters ?? []).map((p) => [paramKey(p), p]));
  const pb = new Map((b.parameters ?? []).map((p) => [paramKey(p), p]));
  for (const [k, p] of pb) if (!pa.has(k)) out.push({ path: `param ${k}`, kind: 'added', detail: `${summarise(p.schema)}${p.required ? ' (required)' : ''}`, breaking: !!p.required });
  for (const [k] of pa) if (!pb.has(k)) out.push({ path: `param ${k}`, kind: 'removed', detail: '', breaking: true });
  for (const [k, p] of pb) {
    const old = pa.get(k);
    if (!old) continue;
    if (!!old.required !== !!p.required) out.push({ path: `param ${k}`, kind: p.required ? 'now required' : 'now optional', detail: '', breaking: !!p.required });
    diffSchema(old.schema, p.schema, `param ${k}`, 'param', out, verbose);
  }
  const ba = bodySchema(a), bb = bodySchema(b);
  if (!ba && bb) {
    // A first body on an existing route: list what it accepts rather than
    // walking it against nothing (which reads as a type change).
    out.push({ path: 'body', kind: 'added', detail: `${b.requestBody?.required ? 'required' : 'optional'} — ${Object.keys(bb.properties ?? {}).join(', ')}`, breaking: !!b.requestBody?.required });
    for (const [k, s] of Object.entries(bb.properties ?? {})) out.push({ path: `body.${k}`, kind: 'added', detail: summarise(s), breaking: false });
  } else if (ba && !bb) out.push({ path: 'body', kind: 'removed', detail: '', breaking: true });
  else diffSchema(ba, bb, 'body', 'request', out, verbose);
  const ra = a.responses ?? {}, rb = b.responses ?? {};
  // A new 4xx on an existing route means some request that used to succeed may
  // now be refused — or the route merely documents a failure it always had.
  // Only the route code / description can tell, so flag it for a look.
  for (const s of Object.keys(rb)) if (!ra[s]) out.push({ path: `response ${s}`, kind: 'added', detail: fmt(rb[s].description), breaking: /^4/.test(s) });
  for (const s of Object.keys(ra)) if (!rb[s]) out.push({ path: `response ${s}`, kind: 'removed', detail: fmt(ra[s].description), breaking: false });
  for (const s of Object.keys(rb)) {
    if (!ra[s]) continue;
    if (ra[s].description !== rb[s].description) out.push({ path: `response ${s}`, kind: 'text', detail: `${fmt(ra[s].description)} → ${fmt(rb[s].description)}`, breaking: false });
    diffSchema(ra[s].content?.['application/json']?.schema, rb[s].content?.['application/json']?.schema, `response ${s}`, 'response', out, verbose);
  }
  return out;
}

function line(f) {
  const flag = f.breaking ? ' **⚠ breaking?**' : '';
  return `- \`${f.path}\` ${f.kind}${f.detail ? `: ${f.detail}` : ''}${flag}`;
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (n) => { const i = args.indexOf(n); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const verbose = args.includes('--verbose'); if (verbose) args.splice(args.indexOf('--verbose'), 1);
  if (args[0] === '--same') {
    // `servers` is ignored: the committed spec names the environment
    // ("Development") while the running app labels itself differently, so
    // a live-vs-committed check would never pass on that block alone.
    const [x, y] = await Promise.all([load(args[1]), load(args[2])]);
    delete x.servers; delete y.servers;
    const diffs = [];
    (function walk(p, u, v) {
      if (diffs.length >= 20 || same(u, v)) return;
      if (u && v && typeof u === 'object' && typeof v === 'object' && Array.isArray(u) === Array.isArray(v) &&
          (!Array.isArray(u) || u.length === v.length)) {
        for (const k of new Set([...Object.keys(u), ...Object.keys(v)])) walk(`${p}/${k}`, u[k], v[k]);
      } else diffs.push(p || '/');
    })('', x, y);
    console.log(diffs.length
      ? `DIFFERENT (servers ignored) at:\n${diffs.map((d) => `  ${d}`).join('\n')}`
      : 'SAME — semantically identical (servers ignored)');
    process.exit(diffs.length ? 1 : 0);
  }
  const oldContract = flag('--old-contract'), newContract = flag('--new-contract');
  const [oldSrc, newSrc] = args;
  if (!oldSrc || !newSrc) {
    console.error('usage: spec-diff.mjs <old> <new> [--old-contract p] [--new-contract p] [--verbose] | --same <a> <b>');
    process.exit(2);
  }
  const [a, b] = await Promise.all([load(oldSrc), load(newSrc)]);
  const oa = ops(a), ob = ops(b);
  const md = [];
  const breaking = [];

  // Everything outside paths and component schemas: servers, info, tags,
  // security, securitySchemes, other components. Rare, but a servers change
  // moves the "try it" console and a security change affects every caller.
  const topLines = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (k === 'paths') continue;
    if (k === 'components') {
      for (const c of new Set([...Object.keys(a.components ?? {}), ...Object.keys(b.components ?? {})])) {
        if (c !== 'schemas' && !same(a.components?.[c], b.components?.[c])) topLines.push(`- \`components.${c}\` changed`);
      }
    } else if (!same(a[k], b[k])) topLines.push(`- \`${k}\` changed: ${fmt(a[k])} → ${fmt(b[k])}`);
  }
  if (topLines.length) md.push('## Top-level changes\n', ...topLines, '');

  const added = [...ob.keys()].filter((k) => !oa.has(k));
  const removed = [...oa.keys()].filter((k) => !ob.has(k));
  if (added.length || removed.length) {
    md.push('## Endpoints added / removed\n');
    for (const k of added) md.push(`- **added** \`${k}\` — ${ob.get(k).summary ?? ''}`);
    for (const k of removed) { md.push(`- **removed** \`${k}\` **⚠ breaking**`); breaking.push(`removed ${k}`); }
    md.push('');
  }

  const changed = [];
  for (const [k, op] of ob) {
    if (!oa.has(k)) continue;
    const f = diffOp(oa.get(k), op, verbose);
    if (f.length) changed.push([k, f]);
  }
  if (changed.length) {
    md.push('## Endpoints changed\n');
    for (const [k, f] of changed) {
      md.push(`### \`${k}\`\n`);
      for (const x of f) { md.push(line(x)); if (x.breaking) breaking.push(`${k} — ${x.path} ${x.kind} ${x.detail}`.trim()); }
      md.push('');
    }
  }

  const ca = a.components?.schemas ?? {}, cb = b.components?.schemas ?? {};
  const schemaLines = [];
  for (const k of Object.keys(cb)) if (!ca[k]) schemaLines.push(`- **added** schema \`${k}\``);
  for (const k of Object.keys(ca)) if (!cb[k]) schemaLines.push(`- **removed** schema \`${k}\` **⚠ breaking?**`);
  for (const k of Object.keys(cb)) {
    if (!ca[k] || same(ca[k], cb[k])) continue;
    const f = [];
    diffSchema(ca[k], cb[k], k, 'response', f, verbose);
    schemaLines.push(`### \`${k}\`\n`, ...f.map(line), '');
  }
  if (schemaLines.length) md.push('## Component schemas\n', ...schemaLines, '');

  const cl = [];
  if (oldContract && newContract) {
    const [xa, xb] = await Promise.all([load(oldContract), load(newContract)]);
    for (const key of Object.keys({ ...xa, ...xb })) {
      const va = xa[key], vb = xb[key];
      if (same(va, vb)) continue;
      if (Array.isArray(va) || Array.isArray(vb)) {
        const sa = new Set((va ?? []).map(JSON.stringify)), sb = new Set((vb ?? []).map(JSON.stringify));
        const plus = [...sb].filter((v) => !sa.has(v)), minus = [...sa].filter((v) => !sb.has(v));
        if (plus.length) cl.push(`- \`${key}\` added: ${plus.join(', ')}`);
        if (minus.length) cl.push(`- \`${key}\` removed: ${minus.join(', ')}`);
      } else cl.push(`- \`${key}\` changed: ${fmt(va)} → ${fmt(vb)}`);
    }
    if (cl.length) md.push('## Docs contract\n', ...cl, '');
  }

  // The verdict line comes first: it is what decides whether the sync stops.
  const compared = oldContract && newContract ? 'the spec or the contract' : 'the spec (contract NOT compared — pass --old-contract/--new-contract)';
  const nothing = !added.length && !removed.length && !changed.length && !schemaLines.length && !topLines.length && !cl.length;
  const verdict = nothing
    ? `NO SEMANTIC DIFFERENCES — nothing in ${compared} changed.\n`
    : `CHANGES FOUND — ${[changed.length || added.length || removed.length ? 'endpoints' : '', schemaLines.length ? 'schemas' : '',
      topLines.length ? 'top-level' : '', cl.length ? 'contract' : ''].filter(Boolean).join(', ')}.\n`;
  const head = [`# Spec diff\n`, verdict,
    `${added.length} endpoint(s) added, ${removed.length} removed, ${changed.length} changed, ` +
    `${Object.keys(cb).filter((k) => ca[k] && !same(ca[k], cb[k])).length} schema(s) changed.\n`];
  if (breaking.length) {
    head.push('## Breaking-change candidates\n',
      'Heuristic: a removed or narrowed request input, a removed response field, or a new 4xx on an existing route. Confirm each against the route code and its description before calling it breaking. Behaviour changes stated only in prose (e.g. a status that can no longer be requested) are NOT listed here — read the `description` sentence diffs below.\n',
      ...breaking.map((x) => `- ${x}`), '');
  }
  console.log([...head, ...md].join('\n'));
}

main().catch((e) => { console.error(e.message); process.exit(2); });
