import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';

const sizes = [{ width: 320, height: 568 }, { width: 390, height: 664 }, { width: 390, height: 844 }, { width: 430, height: 932 }];
const screenshots = 'e2e/screenshots/creative-progress';

async function screenshotsAtSizes(page: Page, name: string) {
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.addStyleTag({ content: size.width === 430 ? ':root { --ui-safe-top: 47px; --ui-safe-bottom: 34px; }' : ':root { --ui-safe-top: 0px; --ui-safe-bottom: 0px; }' });
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: `${screenshots}/${name}-${size.width}x${size.height}.png`, fullPage: true });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const note = page.locator('.ui-creation__note');
    if (await note.count()) {
      const noteBox = await note.boundingBox();
      const barBox = await page.locator('.ui-actionbar').boundingBox();
      expect(noteBox!.y + noteBox!.height).toBeLessThanOrEqual(barBox!.y);
    }
    await page.screenshot({ path: `${screenshots}/${name}-${size.width}x${size.height}-bottom.png` });
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

test('故事线和故事板实时等待：真实阶段、可展开要求、失败不自动重发', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('login-name').locator('input').fill('进度体验测试');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('new-project').click();
  const buffer = await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#eeeeee' } }).jpeg().toBuffer();
  await page.getByTestId('upload-PRODUCT').setInputFiles({ name: 'product.jpg', mimeType: 'image/jpeg', buffer });
  await expect(page.getByTestId('fact-confirm')).toBeVisible();
  await page.getByTestId('fact-confirm').first().click();
  const productUrl = page.url();
  await page.getByTestId('to-storylines').click();
  await expect(page.getByTestId('creative-progress')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('正在构思 4 条');
  await page.getByText('查看本次创作要求').click();
  await expect(page.getByTestId('creative-progress')).toContainText('外罩可拆洗');
  await screenshotsAtSizes(page, 'storylines');
  await expect(page.getByTestId('storyline-card')).toHaveCount(4);
  await page.getByTestId('select-storyline').first().click();
  await expect(page.getByRole('status')).toContainText('正在编排分镜');
  await page.getByText('查看生成进展').click();
  await expect(page.locator('.ui-creation__events')).not.toBeVisible();
  await page.getByText('查看生成进展').click();
  await screenshotsAtSizes(page, 'storyboard');
  await expect(page.getByTestId('shot-card')).toHaveCount(3);

  // 浏览器边界：分段/心跳、修正和等待事件；错误必须留在页面而不是只闪 Toast。
  await page.goto(productUrl);
  await page.getByTestId('duration-choice').getByRole('radio', { name: '30 秒' }).click();
  let requests = 0;
  await page.route('**/storylines/stream', async (route) => {
    requests++;
    await route.fulfill({ contentType: 'application/x-ndjson', body: [
      { type: 'progress', progress: { phase: 'generating', attempt: 1 } },
      { type: 'progress', progress: { phase: 'waiting', retryAfterMs: 10000 } },
      { type: 'error', status: 429, code: 'LLM_RATE_LIMITED', message: 'AI 服务当前请求受限或繁忙，请稍后重试' },
    ].map((e) => JSON.stringify(e)).join('\n\n') + '\n' });
  });
  await page.getByTestId('to-storylines').click();
  await expect(page.locator('.ui-notice-wrap')).toContainText('AI 服务当前请求受限');
  expect(requests).toBe(1);
  await screenshotsAtSizes(page, 'error');
  await page.route('**/storylines/stream', async (route) => {
    requests++;
    await route.fulfill({ contentType: 'application/x-ndjson', body: '{"type":"progress","progress":{"phase":"generating"}}\n' });
  });
  await page.getByTestId('to-storylines').click();
  await expect(page.locator('.ui-notice-wrap')).toContainText('进度连接中断');
  expect(requests).toBe(2);
  // 失败后已有 4 条故事线、原故事板仍可查看。
  await page.getByTestId('duration-choice').getByRole('radio', { name: '15 秒' }).click();
  await page.getByTestId('to-storylines').click();
  await expect(page.getByTestId('storyline-card')).toHaveCount(4);
  await expect(page.getByRole('button', { name: '查看故事板', exact: true })).toBeVisible();

  // 离开等待页不会被完成回调拉回，也不会重发；稍后能查看已保存的新方案。
  await page.unroute('**/storylines/stream');
  await page.goto(productUrl);
  await page.getByTestId('duration-choice').getByRole('radio', { name: '30 秒' }).click();
  const pending = page.waitForResponse((response) => response.url().endsWith('/storylines/stream'));
  await page.getByTestId('to-storylines').click();
  await expect(page.getByRole('status')).toContainText('正在构思');
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page.getByTestId('new-project')).toBeVisible();
  await (await pending).finished();
  await expect(page).toHaveURL('http://localhost:5174/');
  await page.goto(productUrl);
  await expect(page.getByTestId('duration-choice').getByRole('radio', { name: '30 秒' })).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('to-storylines').click();
  await expect(page.getByTestId('storyline-card')).toHaveCount(4);
});
