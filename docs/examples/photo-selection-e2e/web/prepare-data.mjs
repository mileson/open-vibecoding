import fs from 'node:fs/promises';
import path from 'node:path';

const fixture = path.join(process.env.OVC_E2E_DATA_DIR, '.fixture');
const source = new URL('../assets/', import.meta.url);
await fs.mkdir(path.join(fixture, 'web'), { recursive: true });
await fs.mkdir(path.join(fixture, 'assets'));
await fs.copyFile(new URL('./picker.html', import.meta.url), path.join(fixture, 'web', 'picker.html'));
const assets = (await fs.readdir(source)).filter(file => /^P\d{2}\.png$/.test(file));
for (const file of assets) {
  // Leave an actual file out to exercise the verifier on a controlled fixture.
  if (file === process.env.PHOTO_FIXTURE_OMIT_ID + '.png') continue;
  await fs.copyFile(new URL(file, source), path.join(fixture, 'assets', file));
}
