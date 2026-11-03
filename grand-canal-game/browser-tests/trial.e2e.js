import {test,expect} from '@playwright/test';
test('plan, advance, restore a checkpoint and finish the trial',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button',{name:'开工疏浚'}).click();
  await expect(page.locator('#project')).toContainText('工程进度');
  await page.locator('#advance').click();
  await page.locator('#save').click();
  const saved=await page.locator('#date').textContent();
  await page.locator('#step').click();
  await page.locator('#load').click();
  await expect(page.locator('#date')).toHaveText(saved);
  await page.locator('#close').click();
  await expect(page.locator('#status')).toContainText('已临时封航');
  for(let i=0;i<72 && await page.locator('#advance').isEnabled();i++)await page.locator('#advance').click();
  await expect(page.locator('#date')).toHaveText('两年河工实录');
  expect(errors).toEqual([]);
});
