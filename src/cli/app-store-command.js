import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { atomicWriteJson, withFileLock } from '../kernel/atomic-store.js';
import { collectAppStoreReviews } from '../app-store-reviews.js';

const usage = 'open-vibecoding app-store reviews --id <App Store ID> --country <storefront> --out <reviews.json>';

export async function runAppStoreCommand(argv) {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) {
    console.log(usage);
    return 0;
  }
  const [action, ...args] = argv;
  try {
    if (action !== 'reviews') throw new Error('Expected reviews');
    const { values } = parseArgs({
      args, options: { id: { type: 'string' }, country: { type: 'string' }, out: { type: 'string' } },
    });
    if (!values.out || path.extname(values.out).toLowerCase() !== '.json') throw new Error('--out must name a JSON file');
    const out = path.resolve(values.out);
    const result = await withFileLock(out + '.app-store.lock', async () => {
      const exists = await fs.lstat(out).catch(error => {
        if (error.code !== 'ENOENT') throw error;
      });
      if (exists) throw new Error('Review snapshot already exists: ' + out);
      const snapshot = await collectAppStoreReviews(values);
      await atomicWriteJson(out, snapshot);
      return snapshot;
    }, { timeoutMs: 15000 });
    const { status, reason, appId, country, reviews } = result;
    console.log(JSON.stringify({ ok: true, action, out, appId, country, status, reason, reviews: reviews.length }, null, 2));
    return 0;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, action, error: { type: 'app-store', message: error.message, usage } }));
    return 1;
  }
}
