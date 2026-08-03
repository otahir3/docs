/**
 * Shared path-shape normaliser, extracted from paths.mjs (task 7) so
 * examples.mjs (task 11b) can resolve a curl/fetch URL against
 * openapi.json's `paths` keys without re-deriving the same rules.
 *
 * Any segment that is a placeholder — `{param}`, a TS template literal
 * (`${projectId}`), a `$SCREAMING_CASE` shell variable, SCREAMING_CASE on its
 * own, or a real prefixed id (`prj_...`, `sup_...`) — collapses to `{}`, so
 * `/v1/projects/{projectId}/bookings`, `` /v1/projects/${projectId}/bookings ``,
 * `/v1/projects/$PROJECT_ID/bookings` and `/v1/projects/prj_01h2.../bookings`
 * all normalise to the same shape and can be compared for equality.
 *
 * See paths.mjs's own header comment for the two bug-fix rounds that shaped
 * this function — both preserved here since examples.mjs depends on the same
 * fixes (template-literal `$` handling in particular).
 */
export function normalisePath(path, idPrefixes) {
  return path
    .replace(/\/+$/, '')
    .split('/')
    .map((seg) => {
      if (seg === '') return seg;
      if (/^\{.+\}$/.test(seg)) return '{}';
      if (/^\$\{.+\}$/.test(seg)) return '{}'; // TS template literal: ${projectId}
      if (/^\$?[A-Z][A-Z0-9_]*$/.test(seg)) return '{}'; // PROJECT_ID or $PROJECT_ID
      const [prefix] = seg.split('_');
      if (seg.includes('_') && idPrefixes.has(prefix)) return '{}';
      return seg;
    })
    .join('/');
}
