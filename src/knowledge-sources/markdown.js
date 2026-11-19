import fs from 'node:fs/promises';
import path from 'node:path';
import { isWithin } from './config.js';

const MAX_ENTRIES = 4000;
const MAX_FILES = 300;
const MAX_BYTES = 256 * 1024;
const ignoredDirectories = new Set(['node_modules', 'vendor', 'dist', 'build']);
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });

export function queryTerms(query) {
  const phrases = [...segmenter.segment(query.toLowerCase())]
    .filter(item => item.isWordLike && item.segment.length >= 2)
    .map(item => item.segment);
  return [...new Set([query.toLowerCase(), ...phrases])].slice(0, 12);
}

export function matchText(text, terms) {
  const normalized = text.toLowerCase();
  return terms.reduce((score, term, index) => score + (normalized.includes(term) ? index === 0 ? 5 : 1 : 0), 0);
}

export function extractExcerpt(content, title, terms) {
  const lines = content.split(/\r?\n/);
  const titleScore = matchText(title, terms);
  let section = null;
  let best = null;
  for (const [index, line] of lines.entries()) {
    if (/^#{1,6}\s/.test(line)) {
      section = line.replace(/^#{1,6}\s+/, '').trim();
      continue;
    }
    if (!line.trim() || /^\s*<\/?[a-zA-Z]/.test(line)) continue;
    const lineScore = matchText(line, terms);
    const score = 3 * lineScore + matchText(section ?? '', terms) + titleScore;
    if (!score || (best && best.score >= score)) continue;
    const normalized = line.toLowerCase();
    const offset = terms.map(term => normalized.indexOf(term)).find(at => at >= 0) ?? 0;
    const start = Math.max(0, offset - 70);
    best = { excerpt: line.slice(start, start + 360).trim(), section, line: index + 1, score };
  }
  return best;
}

export async function markdownRoot(binding, projectRoot) {
  const root = await fs.realpath(path.resolve(projectRoot, binding.source));
  if (binding.storage === 'shared' && !isWithin(projectRoot, root)) {
    throw new Error('绑定目录指向项目外的位置。');
  }
  if (!(await fs.stat(root)).isDirectory()) throw new Error('绑定路径需要是 Markdown 目录。');
  return root;
}

export async function searchMarkdown(binding, projectRoot, terms) {
  const root = await markdownRoot(binding, projectRoot);
  const directories = [root];
  const matches = [];
  let visited = 0;
  let files = 0;
  let skipped = 0;
  for (let index = 0; index < directories.length; index += 1) {
    const directory = directories[index];
    const actualDirectory = await fs.realpath(directory);
    if (!isWithin(root, actualDirectory)) return { matches, limited: true };
    const entries = await fs.opendir(actualDirectory);
    for await (const entry of entries) {
      if (++visited > MAX_ENTRIES || files >= MAX_FILES) return { matches, limited: true };
      if (entry.name.startsWith('.')) continue;
      const filename = path.join(actualDirectory, entry.name);
      if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) directories.push(filename);
      if (!entry.isFile() || !/\.(md|markdown)$/i.test(entry.name)) continue;
      files += 1;
      try {
        const actual = await fs.realpath(filename);
        if (!isWithin(root, actual)) {
          skipped += 1;
          continue;
        }
        const stat = await fs.stat(actual);
        if (!stat.isFile() || stat.size > MAX_BYTES) {
          skipped += 1;
          continue;
        }
        const relative = path.relative(root, actual);
        const excerpt = extractExcerpt(await fs.readFile(actual, 'utf8'), relative, terms);
        if (excerpt) matches.push({ ...excerpt, title: relative, path: actual });
      } catch {
        skipped += 1;
      }
    }
  }
  return { matches, limited: skipped > 0 };
}
