import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', '.github', 'scripts', 'images', 'logo']);

/**
 * Yields every .mdx/.md page under `root`, with YAML frontmatter blanked out
 * rather than removed — line numbers stay true to the file on disk, so a
 * finding can be opened at the reported line.
 */
export async function* walkDocs(root, dir = root) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walkDocs(root, join(dir, entry.name));
      continue;
    }
    if (!/\.mdx?$/.test(entry.name)) continue;

    const full = join(dir, entry.name);
    const raw = await readFile(full, 'utf8');
    yield {
      path: relative(root, full).replaceAll('\\', '/'),
      lines: stripFrontmatter(raw).map((text, i) => ({ n: i + 1, text })),
    };
  }
}

/** Replaces frontmatter lines with empty strings, preserving line count. */
function stripFrontmatter(raw) {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return lines;

  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end === -1) return lines;

  return lines.map((l, i) => (i <= end ? '' : l));
}
