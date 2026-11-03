import { test, expect } from '@playwright/test';

test('React and Worker play through a complete local game', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: '开工疏浚' })).toBeEnabled();
  await page.getByRole('button', { name: '开工疏浚' }).click();
  await expect(page.locator('.reports')).toContainText('运河方案已执行');
  for (let i = 0; i < 80; i += 1) {
    if (await page.locator('.ending').isVisible()) break;
    const advance = page.getByRole('button', { name: '推进到关键节点', exact: true });
    await expect(advance).toBeEnabled();
    await advance.click();
    await expect(page.getByRole('button', { name: '开始剧本' })).toBeEnabled();
  }
  await expect(page.locator('.ending')).toBeVisible();
  await expect(page.locator('.ending')).toContainText('河工实际征役');
  expect(errors).toEqual([]);
});

test('independent late chapter opens with a responsive mobile layout', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '开始剧本' })).toBeEnabled();
  await page.locator('#scenario').selectOption('sui-tang-907');
  await page.getByRole('button', { name: '开始剧本' }).click();
  await expect(page.locator('.timebar')).toContainText('907 年');
  await expect(page.locator('.timebar')).toContainText('多国共水');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
