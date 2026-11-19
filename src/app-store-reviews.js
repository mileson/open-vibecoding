import fs from 'node:fs/promises';

const store = 'https://apps.apple.com';
const source = 'app-store-public-reviews';
const statuses = new Set(['partial', 'empty', 'unavailable', 'rate_limited']);
const appIdPattern = /^[1-9]\d*$/;
const countryPattern = /^[a-z]{2}$/;

function isReview(record) {
  return typeof record?.id === 'string' && record.id &&
    typeof record.title === 'string' && typeof record.text === 'string' && record.text.trim() &&
    Number.isInteger(record.rating) && record.rating >= 1 && record.rating <= 5 &&
    typeof record.date === 'string' && Number.isFinite(Date.parse(record.date));
}

function reviewFromItem(item) {
  const review = item?.review;
  const details = review?.moreAction?.pageData?.shelves?.flatMap(shelf => shelf.items ?? []);
  const full = details?.find(entry => entry.id === review.id && typeof entry.contents === 'string' && entry.contents.trim());
  return {
    id: review?.id,
    rating: review?.rating,
    title: review?.title,
    text: full?.contents ?? review?.contents,
    date: review?.date,
  };
}

function sameReviewPage(url, id, country) {
  if (typeof url !== 'string' || !url.startsWith(store + '/')) return false;
  const page = new URL(url);
  const segments = page.pathname.split('/').filter(Boolean);
  return segments[0] === country && segments[1] === 'app' && segments.at(-1) === 'id' + id &&
    page.searchParams.get('see-all') === 'reviews';
}

export async function collectAppStoreReviews({ id, country, fetchPage = fetch }) {
  if (typeof id !== 'string' || !appIdPattern.test(id)) throw new Error('--id must be a numeric App Store ID');
  country = country?.toLowerCase();
  if (!countryPattern.test(country ?? '')) throw new Error('--country must be a two-letter storefront code');
  const requestedUrl = store + '/' + country + '/app/id' + id + '?platform=iphone&see-all=reviews';
  const base = { schemaVersion: 1, source, appId: id, country, fetchedAt: new Date().toISOString(), url: requestedUrl };
  const failed = (reason, status = 'unavailable') => ({ ...base, status, reason, reviews: [] });
  let response;
  let html;
  try {
    response = await fetchPage(requestedUrl, {
      headers: { accept: 'text/html' },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return failed('http_' + response.status, response.status === 429 ? 'rate_limited' : 'unavailable');
    if (!sameReviewPage(response.url, id, country)) return failed('storefront_or_app_mismatch');
    html = await response.text();
  } catch (error) {
    return failed(['AbortError', 'TimeoutError'].includes(error.name) ? 'timeout' : 'network_error');
  }
  const serialized = html.match(/<script\b[^>]*\bid=["']serialized-server-data["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  let items;
  let parsed;
  try {
    parsed = JSON.parse(serialized);
    items = parsed.data.find(entry => Array.isArray(entry?.data?.shelfMapping?.allProductReviews?.items))
      ?.data.shelfMapping.allProductReviews.items;
  } catch {
    return failed('review_schema_changed');
  }
  if (!items) return failed('review_schema_changed');
  const reviews = new Map();
  for (const item of items) {
    let review;
    try {
      review = reviewFromItem(item);
    } catch {
      return failed('review_schema_changed');
    }
    if (!isReview(review)) return failed('review_schema_changed');
    if (!reviews.has(review.id)) reviews.set(review.id, review);
  }
  return { ...base, url: response.url, status: reviews.size ? 'partial' : 'empty', reviews: [...reviews.values()] };
}

export async function readAppStoreReviews(file) {
  const result = JSON.parse(await fs.readFile(file, 'utf8'));
  if (result?.schemaVersion !== 1 || result.source !== source || typeof result.appId !== 'string' ||
    !appIdPattern.test(result.appId) || typeof result.country !== 'string' || !countryPattern.test(result.country) ||
    !sameReviewPage(result.url, result.appId, result.country) || !Number.isFinite(Date.parse(result.fetchedAt)) ||
    !statuses.has(result.status) || !Array.isArray(result.reviews) || !result.reviews.every(isReview) ||
    (result.status === 'partial') !== (result.reviews.length > 0) ||
    new Set(result.reviews.map(review => review.id)).size !== result.reviews.length) {
    throw new Error('Invalid App Store review snapshot. Use the output of app-store reviews.');
  }
  return result;
}

export function reviewCoverageLabel({ status, reason }) {
  if (status === 'partial') return '公开可见样本';
  if (status === 'empty') return '公开页未展示评论';
  if (status === 'rate_limited') return '采集受限';
  if (reason === 'storefront_or_app_mismatch') return '未打开指定地区的应用评论页';
  return '未取到评论';
}
