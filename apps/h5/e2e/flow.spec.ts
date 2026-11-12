import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';

const SHOTS = 'e2e/screenshots';
let step = 0;
async function shot(page: Page, name: string) {
  step += 1;
  await page.screenshot({ path: `${SHOTS}/${String(step).padStart(2, '0')}-${name}.png`, fullPage: true });
}

const image = (color: string) =>
  sharp({ create: { width: 900, height: 1200, channels: 3, background: color } })
    .jpeg()
    .toBuffer();

test('完整创作流程：素材 → 故事线 → 故事板 → 生成 → 改字幕 → 重做第 3 镜头 → 回退 → 分享', async ({ page, context }) => {
  // 登录
  await page.goto('/login');
  await page.getByTestId('login-name').locator('input').fill('测试商家');
  await shot(page, 'login');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('new-project')).toBeVisible();
  await shot(page, 'home');

  // 底部五个入口；广场这一版是占位页
  await page.getByTestId('tab-plaza').click();
  await expect(page.getByTestId('plaza-empty')).toBeVisible();
  await shot(page, 'plaza');
  await page.getByTestId('tab-home').click();

  // 发布：直接进入发布表单，不填商品名称
  await page.getByTestId('nav-publish').click();
  await expect(page).toHaveURL(/\/publish$/);
  await expect(page.getByTestId('publish-name')).toBeVisible();
  await shot(page, 'publish-form');
  // 返回主页不会留下空草稿
  await page.getByRole('button', { name: '返回' }).click();
  await expect(page.getByTestId('new-project')).toBeVisible();
  await expect(page.getByText('我的创作')).toHaveCount(0);

  // 选第一张商品图时才创建项目，随后自动素材理解：AI 填好商品名称并给出卖点建议
  await page.getByTestId('new-project').click();
  await page.getByTestId('upload-PRODUCT').setInputFiles({ name: 'product.jpg', mimeType: 'image/jpeg', buffer: await image('#9aa5b1') });
  await expect(page).toHaveURL(/\/p\/[^/]+\/product$/);
  await expect(page.getByTestId('product-name').locator('input')).toHaveValue('灰色可拆洗猫窝');
  await expect(page.getByText('AI 填写')).toBeVisible();
  await expect(page.getByTestId('fact-suggested')).toBeVisible();

  // 上传人物图（会被识别为含真人脸）
  await page.getByTestId('upload-CHARACTER').setInputFiles({ name: 'person.jpg', mimeType: 'image/jpeg', buffer: await image('#e0b090') });
  await expect(page.getByText('有真人脸，需要处理')).toBeVisible();
  await page.getByTestId('product-desc').locator('textarea:not([aria-hidden])').fill('猫窝外罩可以拆下来洗，尺寸 50×40 厘米');
  await page.getByTestId('product-audience').locator('input').fill('25-35 岁养猫的上班族');
  await shot(page, 'product-uploaded-face-warning');

  // 处理真人脸：AI 生成相似人物
  await page.getByTestId('face-resolve').click();
  await shot(page, 'face-options');
  await page.getByText('AI 按照片风格生成相似人物').click();
  await expect(page.getByText('已换成 AI 相似人物')).toBeVisible();

  // 补充信息后再做一次素材理解 → 确认 AI 建议的卖点
  await page.getByTestId('analyze').click();
  await expect(page.getByText('素材理解完成，请确认 AI 建议的卖点')).toBeVisible();
  await expect(page.getByTestId('fact-suggested')).toBeVisible();
  await shot(page, 'analysis');
  await page.getByTestId('fact-confirm').click();
  await expect(page.getByTestId('fact-confirmed')).toBeVisible();

  // 故事线
  await page.getByTestId('to-storylines').click();
  await expect(page.getByTestId('storyline-card')).toHaveCount(4);
  await shot(page, 'storylines');
  await page.getByTestId('select-storyline').first().click();

  // 故事板：人物图、场景图由 AI 生成
  await expect(page.getByTestId('shot-card')).toHaveCount(3);
  await expect(page.getByText('AI 生成中')).toHaveCount(0);
  await shot(page, 'storyboard');

  // 对话修改：先看对比，再应用
  await page.getByTestId('chat-input').locator('textarea:not([aria-hidden])').fill('第二个镜头口播太长了，改短一点');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-proposal')).toBeVisible();
  await shot(page, 'chat-proposal');
  await page.getByTestId('chat-apply').click();
  await expect(page.getByText('口播：外罩一拉就能洗')).toBeVisible();

  // 生成确认
  await page.getByTestId('to-confirm').click();
  await page.getByText('480p 标清').click();
  await expect(page.getByTestId('confirm-generate')).toBeEnabled();
  await shot(page, 'confirm');
  await page.getByTestId('confirm-generate').click();

  // 生成进度
  await expect(page.getByTestId('job-clip')).toHaveCount(3);
  await shot(page, 'job-progress');
  await expect(page.getByTestId('to-work')).toBeVisible({ timeout: 4 * 60_000 });
  await shot(page, 'job-done');
  await page.getByTestId('to-work').click();

  // 作品
  await expect(page.getByTestId('output-video')).toBeVisible({ timeout: 4 * 60_000 });
  await expect(page.getByText('AI生成').first()).toBeVisible();
  await shot(page, 'work');

  // 改字幕：只重新合成
  await page.getByTestId('caption-0').locator('input').fill('猫咪的专属角落');
  await page.getByTestId('caption-preview').click();
  await expect(page.getByTestId('caption-player')).toBeVisible();
  // Remotion Player 里的片段视频要能真正加载出画面
  await expect
    .poll(() => page.locator('[data-testid=caption-player] video').first().evaluate((v) => (v as HTMLVideoElement).readyState), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(500);
  await shot(page, 'caption-preview');
  await page.getByTestId('save-captions').click();
  await expect(page.getByText('v2 · 修改字幕')).toBeVisible();
  await expect(page.getByText('当前版本 v2')).toBeVisible({ timeout: 4 * 60_000 });
  await expect(page.getByTestId('output-video')).toBeVisible({ timeout: 4 * 60_000 });
  await shot(page, 'captions-recomposed');

  // 对话：第三个镜头重新生成 → 跳到确认页
  await page.getByTestId('chat-input').locator('textarea:not([aria-hidden])').fill('第三个镜头商品变形了，重新生成');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-proposal')).toBeVisible();
  await shot(page, 'reshoot-proposal');
  await page.getByTestId('chat-apply').click();
  await expect(page.getByText('要生成的镜头（1 个')).toBeVisible();
  await shot(page, 'reshoot-confirm');
  await page.getByTestId('confirm-generate').click();
  await expect(page.getByTestId('job-clip')).toHaveCount(1);
  await expect(page.getByTestId('to-work')).toBeVisible({ timeout: 4 * 60_000 });
  await page.getByTestId('to-work').click();
  await expect(page.getByText('当前版本 v3')).toBeVisible({ timeout: 4 * 60_000 });
  await expect(page.getByTestId('version-2-2')).toBeVisible();
  await expect(page.getByTestId('output-video')).toBeVisible({ timeout: 4 * 60_000 });
  await shot(page, 'reshoot-done');

  // 回退：第 3 个镜头换回版本 1
  await page.getByTestId('use-version-2-1').click();
  await expect(page.getByText('镜头 3 换成版本 1')).toBeVisible();
  await expect(page.getByText('当前版本 v4')).toBeVisible({ timeout: 4 * 60_000 });
  await expect(page.getByTestId('output-video')).toBeVisible({ timeout: 4 * 60_000 });
  await shot(page, 'reverted');

  // 分享
  await page.getByTestId('share').click();
  const link = await page.getByTestId('share-link').locator('input').inputValue();
  await shot(page, 'share-dialog');
  const sharePage = await context.newPage();
  await sharePage.goto(link.replace(/^https?:\/\/[^/]+/, 'http://localhost:5174'));
  await expect(sharePage.getByTestId('share-video')).toBeVisible();
  await expect(sharePage.getByText('AI生成')).toBeVisible();
  step += 1;
  await sharePage.screenshot({ path: `${SHOTS}/${String(step).padStart(2, '0')}-share-page.png`, fullPage: true });
});
