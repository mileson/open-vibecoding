import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteJson, readJsonIfExists, withFileLock } from './kernel/atomic-store.js';
import { readAppStoreReviews, reviewCoverageLabel } from './app-store-reviews.js';
import { platformLabels } from './social-report.js';

const idsByLabel = new Map(Object.entries(platformLabels).map(([id, label]) => [label, id]));
const sentiments = new Map([['积极', 'positive'], ['中立', 'neutral'], ['消极', 'negative']]);
const statusFromPlan = new Set(['not_selected', 'configuration_required', 'credential_required']);
const sourceStatuses = new Set(['available', 'partial', 'login_required', 'credential_required',
  'configuration_required', 'rate_limited', 'unavailable', 'not_selected']);

function idOf(value, platforms) {
  if (!value) return undefined;
  if (platforms.has(value) || Object.hasOwn(platformLabels, value)) return value;
  return idsByLabel.get(value) ?? [...platforms.values()].find(platform => platform.label === value)?.id;
}

function safeUrl(value) {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
  } catch {
    // Content identifiers stay in the original CSV and evidence files.
  }
  return undefined;
}

async function readSources(directory) {
  const raw = path.join(directory, 'raw');
  const names = await fs.readdir(raw).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  return Promise.all(names.filter(name => name.endsWith('.canonical.json')).sort().map(async name => ({
    id: name.slice(0, -'.canonical.json'.length),
    data: JSON.parse(await fs.readFile(path.join(raw, name), 'utf8')),
  })));
}

function addStatus(platforms, id, status) {
  const platform = platforms.get(id) ?? { id };
  platforms.set(id, { ...platform, status });
}

function evidenceStatuses(platforms, evidence) {
  const statuses = new Map();
  for (const { id: fileId, data } of evidence) {
    const id = idOf(data.platform, platforms) ?? (Object.hasOwn(platformLabels, fileId) ? fileId : undefined);
    if (!id && data.contents?.some(item => item.platform)) {
      for (const item of data.contents) {
        const itemId = idOf(item.platform, platforms);
        if (!itemId) throw new Error(`Unknown platform in canonical data: ${item.platform}`);
        const partial = item.coverage_status === 'partial' || statuses.get(itemId) === 'partial';
        statuses.set(itemId, partial ? 'partial' : 'available');
      }
      continue;
    }
    if (!id) throw new Error(`Unknown canonical source: ${data.platform ?? fileId}`);
    if (!sourceStatuses.has(data.availability)) throw new Error(`Unknown canonical status for ${id}`);
    const partial = data.availability === 'available' &&
      data.contents?.some(item => item.coverage_status === 'partial');
    statuses.set(id, partial ? 'partial' : data.availability);
  }
  return statuses;
}

function convertComments(rows, platforms, statuses) {
  return rows.filter(row => typeof row?.一级评论内容 === 'string' && row.一级评论内容.trim())
    .map(row => {
      const id = idOf(row.平台, platforms);
      if (!id) throw new Error(`Unknown platform in processed comments: ${row.平台}`);
      if (!statuses.has(id)) {
        const partial = row.覆盖状态 === 'partial' || platforms.get(id)?.status === 'partial';
        addStatus(platforms, id, partial ? 'partial' : 'available');
      }
      const url = safeUrl(row.内容地址);
      return {
        platform: id, text: row.一级评论内容,
        ...(row.功能分类 && !['未分析', '待原文聚类'].includes(row.功能分类) ? { topic: row.功能分类 } : {}),
        ...(row.标题 ? { sourceTitle: row.标题 } : {}),
        sentiment: sentiments.get(row.情感分类) ?? 'unclassified',
        ...(url ? { url } : {}),
      };
    });
}

function resolveTerms(words, comments) {
  if (!words?.terms) return words;
  if (!Array.isArray(words.terms)) throw new Error('wordCloud.terms must be an array');
  const bodies = comments.map(comment => comment.text.normalize('NFKC').toLowerCase());
  return { terms: words.terms.map(entry => {
    const { word, ratio, commentRows, aliases = [] } = entry ?? {};
    if (typeof word !== 'string' || !word.trim()) throw new Error('Each word cloud term needs a word');
    if (!Array.isArray(aliases) || aliases.some(value => typeof value !== 'string')) throw new Error(`Invalid aliases for ${word}`);
    const terms = [word, ...aliases].map(value => value.trim().normalize('NFKC').toLowerCase()).filter(Boolean);
    const matches = commentRows ?? bodies.flatMap((body, index) => terms.some(term => body.includes(term)) ? [index + 1] : []);
    if (!Array.isArray(matches) || !matches.length || matches.some(row => !Number.isInteger(row) || row < 1 || row > comments.length)) {
      throw new Error(`Word cloud term has invalid or missing comment evidence: ${word}`);
    }
    return { word, ratio, commentRows: matches };
  }) };
}

function appendStoreReviews(comments, platforms, snapshot, analysis) {
  const id = 'app-store';
  if (comments.some(comment => comment.platform === id)) {
    throw new Error('App Store comments already exist in processed_rows.json. Import each App Store snapshot once.');
  }
  const platform = platforms.get(id) ?? { id };
  const status = snapshot.status === 'empty' ? 'unavailable' : snapshot.status;
  const summary = platform.summary ?? snapshot.country.toUpperCase() + ' · ' + reviewCoverageLabel(snapshot);
  platforms.set(id, { ...platform, status, summary });
  for (const review of snapshot.reviews) {
    const labels = analysis?.[review.id];
    comments.push({
      platform: id, reviewId: review.id, date: review.date, rating: review.rating, text: review.text,
      sentiment: labels?.sentiment ?? 'unclassified', topic: labels?.topic,
      sourceTitle: review.title.trim() || undefined, url: snapshot.url,
    });
  }
}

export async function importSocialReport({ from, analysis, out, appStoreReviews }) {
  const directory = path.resolve(from);
  const outPath = path.resolve(out);
  if (path.extname(outPath).toLowerCase() !== '.json') throw new Error('--out must name a JSON file');
  const [notes, rows, sources, plan, storeReviews] = await Promise.all([
    fs.readFile(analysis, 'utf8').then(JSON.parse),
    readJsonIfExists(path.join(directory, 'processed_rows.json')),
    readSources(directory),
    readJsonIfExists(path.join(directory, 'collection-plan.json')),
    appStoreReviews ? readAppStoreReviews(appStoreReviews) : null,
  ]);
  if (!notes || typeof notes !== 'object' || Array.isArray(notes)) throw new Error('analysis must be an object');
  if (rows !== null && !Array.isArray(rows)) throw new Error('processed_rows.json must be an array');
  if (rows === null && ((!sources.length && !storeReviews) || sources.some(({ data }) => data.contents?.some(item => item.comments?.length)))) {
    throw new Error('Missing processed_rows.json. Finalize the collector output before importing comments.');
  }
  const platformNotes = notes.platforms ?? [];
  if (!Array.isArray(platformNotes) || platformNotes.some(platform => typeof platform?.id !== 'string')) {
    throw new Error('analysis.platforms must be an array of platforms with ids');
  }
  const platforms = new Map(platformNotes.map(platform => [platform.id, platform]));
  const statuses = evidenceStatuses(platforms, sources);
  for (const [id, status] of statuses) addStatus(platforms, id, status);
  const comments = convertComments(rows ?? [], platforms, statuses);
  if (storeReviews) appendStoreReviews(comments, platforms, storeReviews, notes.appStoreReviewAnalysis);
  const commented = new Set(comments.map(comment => comment.platform));
  for (const platform of plan?.platforms ?? []) {
    if (!statuses.has(platform.id) && !commented.has(platform.id) && statusFromPlan.has(platform.status)) {
      addStatus(platforms, platform.id, platform.status);
    }
  }
  const data = {
    product: notes.product ?? plan?.product, queriedAt: notes.queriedAt, summary: notes.summary, productIcon: notes.productIcon,
    platforms: [...platforms.values()], highlights: notes.highlights, concerns: notes.concerns,
    comparison: notes.comparison, comments, wordCloud: resolveTerms(notes.wordCloud, comments),
  };
  if ([data.product, data.queriedAt, data.summary].some(value => typeof value !== 'string' || !value.trim())) {
    throw new Error('analysis requires product, queriedAt and summary (product may come from collection-plan.json)');
  }
  await withFileLock(`${outPath}.social-import.lock`, async () => {
    const exists = await fs.lstat(outPath).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (exists) throw new Error(`Report input already exists: ${outPath}`);
    await atomicWriteJson(outPath, data);
  });
  const csv = path.join(directory, 'product_reviews_detail.csv');
  const hasCsv = await fs.stat(csv).then(stat => stat.isFile(), error => {
    if (error.code !== 'ENOENT') throw error;
    return false;
  });
  return { ok: true, out: outPath, comments: comments.length, sourceFiles: sources.length, ...(hasCsv && !storeReviews ? { csv } : {}) };
}
