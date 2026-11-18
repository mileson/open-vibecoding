import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';
import { pickerUrl } from './data-fixture.mjs';

const require = createRequire(import.meta.url);
const ids = Array.from({ length: 9 }, (_, index) => 'P0' + (index + 1));
test.beforeEach(async ({ page }) => {
  await page.goto(pickerUrl());
  await expect(page.getByLabel('已选数量')).toHaveText('0');
  for (const id of ids) await page.getByRole('button', { name: id, exact: true }).click();
  await page.getByRole('button', { name: '搜索入口' }).click();
  await page.getByRole('button', { name: 'P10', exact: true }).click();
});

async function observe(browser, info, actual) {
  await info.attach('ovc-observation', { contentType: 'application/json', body: JSON.stringify({
    actual,
    environment: {
      browserVersion: browser.version(),
      runnerVersion: require('@playwright/test/package.json').version,
    },
  }) });
}

test('count', async ({ page, browser }, info) => {
  const count = Number(await page.getByLabel('已选数量').textContent());
  await observe(browser, info, count);
  expect(count).toBe(9);
});

test('blocked', async ({ page, browser }, info) => {
  const notice = await page.getByRole('status').filter({ hasText: /最多选择/ }).count();
  const actual = { notice: Boolean(notice), tenthSelected: await page.getByRole('button', { name: 'P10', exact: true }).getAttribute('aria-pressed') === 'true' };
  await observe(browser, info, actual);
  expect(actual).toEqual({ notice: true, tenthSelected: false });
});

test('selection', async ({ page, browser }, info) => {
  const actual = (await page.getByLabel('已选照片').textContent()).split(' ');
  await observe(browser, info, actual);
  expect(actual).toEqual(ids);
});

test('returned', async ({ page, browser }, info) => {
  await page.getByRole('button', { name: '完成' }).click();
  await expect(page.getByRole('heading', { name: '已选照片' })).toBeVisible();
  const actual = (await page.getByLabel('收到的照片').textContent()).split(' ');
  await observe(browser, info, actual);
  expect(actual).toEqual(ids);
});
