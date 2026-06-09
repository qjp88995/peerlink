import { expect, test } from '@playwright/test';

test('sends a single file peer-to-peer and the receiver downloads identical bytes', async ({
  browser,
}) => {
  const sender = await browser.newContext();
  const receiver = await browser.newContext();
  const sPage = await sender.newPage();
  const rPage = await receiver.newPage();

  await sPage.goto('/');

  // 选择一个内容已知的文件
  const content = 'hello-peerlink-'.repeat(1000);
  await sPage.setInputFiles('[data-testid=file-input]', {
    name: 'hello.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(content),
  });
  await sPage.click('[data-testid=start-send]');

  const code = await sPage.locator('[data-testid=room-code]').textContent();
  expect(code).toBeTruthy();

  await rPage.goto(`/r/${encodeURIComponent(code!.trim())}`);
  await rPage.waitForSelector('[data-testid=manifest]');

  const downloadPromise = rPage.waitForEvent('download');
  await rPage.click('[data-testid=accept]');
  const download = await downloadPromise;

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  expect(Buffer.concat(chunks).toString()).toBe(content);

  await sPage.waitForSelector('[data-testid=send-done]');
  await sender.close();
  await receiver.close();
});

test('receiver can reject a transfer', async ({ browser }) => {
  const sender = await browser.newContext();
  const receiver = await browser.newContext();
  const sPage = await sender.newPage();
  const rPage = await receiver.newPage();

  await sPage.goto('/');
  await sPage.setInputFiles('[data-testid=file-input]', {
    name: 'x.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('abc'),
  });
  await sPage.click('[data-testid=start-send]');
  const code = (await sPage
    .locator('[data-testid=room-code]')
    .textContent())!.trim();

  await rPage.goto(`/r/${encodeURIComponent(code)}`);
  await rPage.waitForSelector('[data-testid=manifest]');
  await rPage.click('[data-testid=reject]');

  // 发送端应收到拒绝提示（sonner toast 文本）
  await expect(sPage.getByText('对方已拒绝')).toBeVisible();
  await sender.close();
  await receiver.close();
});
