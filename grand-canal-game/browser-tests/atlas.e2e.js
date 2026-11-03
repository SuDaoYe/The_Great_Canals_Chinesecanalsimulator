import {test,expect} from '@playwright/test';

test('atlas map dispatch, real art, event facts and keyboard return',async({page})=>{
  await page.goto('/atlas.html');
  const pin=page.getByRole('button',{name:'展开临水祈粮'});
  await pin.click();
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByRole('heading')).toHaveText('临水祈粮');
  await expect(dialog.locator('img')).toHaveJSProperty('complete',true);
  expect(await dialog.locator('img').evaluate(image=>image.naturalWidth)).toBeGreaterThan(400);
  await expect(dialog).toContainText('当地仓粮');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button',{name:'封航三旬'}).click();
  await page.getByRole('button',{name:'展开闭河候船'}).click();
  await expect(page.getByRole('dialog').locator('img')).toHaveAttribute('src','/cg/close.jpg');
  await page.getByRole('button',{name:'返回河图'}).click();
  await page.getByRole('button',{name:'水情',exact:true}).click();
  await expect(page.getByRole('button',{name:'水情',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('svg')).toContainText('蓄水');
});

test('long-lived dispatches keep original facts and endings use their own paintings',async({page})=>{
  await page.setViewportSize({width:760,height:900});
  await page.goto('/atlas.html');
  for(let i=0;i<80;i++){
    if(await page.locator('.ending').isVisible())break;
    const advance=page.getByRole('button',{name:'推进到关键节点',exact:true});
    await expect(advance).toBeEnabled();
    await advance.click();
    await expect(page.getByRole('button',{name:'开始剧本'})).toBeEnabled();
  }
  await expect(page.locator('.ending')).toContainText('民生凋敝');
  await page.locator('.reports').getByRole('button',{name:'民生凋敝',exact:true}).click();
  await expect(page.getByRole('dialog').locator('img')).toHaveAttribute('src','/cg/collapse.jpg');
  await page.getByRole('button',{name:'返回河图'}).click();
  await page.locator('.field-album summary').click();
  await page.getByRole('button',{name:'翻阅画录：临水祈粮'}).click();
  await expect(page.locator('.dispatch-facts')).toContainText('120');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
