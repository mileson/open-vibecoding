import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { pickerUrl } from './data-fixture.mjs';

const browser = await chromium.launch({ executablePath: process.env.PHOTO_CHROMIUM_EXECUTABLE });
try {
  const page = await browser.newPage();
  await page.goto(pickerUrl());
  const selectedIds = (await page.getByLabel('已选照片').textContent()).trim().split(/\s+/).filter(Boolean);
  const photoIdsOnPage = () => page.locator('#photos button').evaluateAll(async buttons => {
    const loaded = await Promise.all(buttons.map(async button => {
      const image = button.querySelector('img');
      if (!image) return null;
      const decoded = await image.decode().then(() => true, () => false);
      return decoded && image.naturalWidth > 0 ? button.textContent.trim() : null;
    }));
    return loaded.filter(Boolean);
  });
  const album = await photoIdsOnPage();
  await page.getByRole('button', { name: '搜索入口' }).click();
  const search = await photoIdsOnPage();
  await page.screenshot({ path: path.join(process.env.OVC_E2E_DATA_DIR, 'initial-state.png') });
  await fs.writeFile(process.env.OVC_E2E_DATA_OBSERVATIONS, JSON.stringify({
    'photo-ids': [...album, ...search],
    'selected-ids': selectedIds,
  }, null, 2) + '\n');
} finally {
  await browser.close();
}
