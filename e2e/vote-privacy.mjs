import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
const server = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: '3221', NODE_ENV: 'test', GAME_TIMER_SCALE: '0.4' }, stdio: ['ignore', 'pipe', 'pipe'] });
let browser;
try {
  await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('error', reject); server.once('exit', () => reject(Error('Test server exited'))); });
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const pages = [], errors = [];
  for (let i = 0; i < 6; i++) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: true });
    const page = await context.newPage(); pages.push(page); page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:3221'); await expect(page.locator('#connection')).toHaveText('เชื่อมต่อแล้ว');
    await page.locator('#name').fill(`ผู้ทดสอบ${i + 1}`);
    if (i === 0) { await page.locator('#create').click(); await expect(page.locator('#game')).toBeVisible(); await page.locator('#timing').selectOption('quick'); }
    else { await page.locator('#code').fill(await pages[0].locator('#room-code').innerText()); await page.locator('#join').click(); }
    await expect(page.locator('#game')).toBeVisible();
  }
  for (const p of pages) await p.getByRole('button', { name: 'ฉันพร้อมแล้ว', exact: true }).click();
  await pages[0].getByRole('button', { name: 'เริ่มคืนแรก →', exact: true }).click();
  const assigned = [];
  for (const p of pages) { await p.locator('#reveal').click(); assigned.push(await p.locator('#role-content h3').innerText()); }
  const seer = assigned.findIndex(role => role.includes('ผู้หยั่งรู้'));
  await expect(pages[seer].locator('#phase-title')).toHaveText('ค่ำคืนแห่งความลับ', { timeout: 10000 });
  const nightTarget = seer === 0 ? 1 : 0;
  await pages[seer].locator('.player').nth(nightTarget).click();
  await expect(pages[seer].getByRole('button', { name: 'ยืนยันเป้าหมาย →', exact: true })).toBeEnabled();
  await expect(pages[seer].locator('#selection')).toContainText('กดยืนยันเพื่อส่ง');
  await expect(pages[0].locator('#phase-title')).toHaveText('รุ่งเช้าแห่งความสงสัย', { timeout: 20000 });
  await pages[0].getByRole('button', { name: 'เปิดการลงคะแนน →', exact: true }).click();
  const seats = await pages[0].locator('.player').evaluateAll(cards => cards.map(c => c.dataset.seat));
  const card = (actor, target) => pages[actor].locator(`.player[data-seat="${seats[target]}"]`);
  const vote = async (actor, target) => { await card(actor, target).click(); await expect(card(actor, target).locator('.vote-marker')).toBeVisible(); };
  await expect(pages[0].getByRole('button', { name: 'ยืนยันเป้าหมาย →', exact: true })).toHaveCount(0);
  await card(0, 2).focus(); await card(0, 2).press('Enter'); await expect(card(0, 2).locator('.vote-marker')).toBeVisible();
  for (const p of pages.slice(1)) await expect(p.locator('.vote-marker')).toHaveCount(0);
  await vote(0, 3); await expect(card(0, 2).locator('.vote-marker')).toHaveCount(0);
  await vote(1, 4); await expect(card(0, 3).locator('.vote-marker')).toBeVisible(); await expect(card(1, 3).locator('.vote-marker')).toHaveCount(0);
  await pages[0].getByRole('button', { name: 'งดออกเสียง', exact: true }).click(); await expect(pages[0].locator('.vote-marker')).toHaveCount(0);
  // Rapid clicks must retain the latest target while earlier acknowledgements are pending.
  await card(0, 3).evaluate(e => e.click()); await card(0, 2).evaluate(e => e.click()); await expect(card(0, 2).locator('.vote-marker')).toBeVisible();
  await vote(1, 3);
  for (const p of pages.slice(2)) { await p.getByRole('button', { name: 'งดออกเสียง', exact: true }).click(); await expect(p.locator('#selection')).toContainText('ข้าม / งดออกเสียง'); }
  await expect(pages[0].locator('#phase-title')).toHaveText('ใครคือมนุษย์หมาป่า?');
  await pages[0].reload(); await expect(card(0, 2).locator('.vote-marker')).toBeVisible();
  await mkdir('test-results/vote-privacy', { recursive: true });
  await pages[0].screenshot({ path: 'test-results/vote-privacy/voter-desktop.png', fullPage: true });
  await pages[2].screenshot({ path: 'test-results/vote-privacy/other-player-desktop.png', fullPage: true });
  await pages[0].setViewportSize({ width: 390, height: 844 }); await pages[0].screenshot({ path: 'test-results/vote-privacy/voter-mobile.png', fullPage: true });
  await expect(pages[0].locator('#phase-title')).toHaveText('โหวตรอบสอง · ผู้ที่คะแนนเสมอ', { timeout: 15000 });
  for (const p of pages) {
    await expect(p.locator('.vote-marker')).toHaveCount(0);
    await expect(p.locator('.runoff-candidate')).toHaveCount(2);
    await expect(p.locator('.runoff-candidate .runoff-tag')).toHaveCount(2);
    await expect(p.locator('.runoff-inactive.can-select')).toHaveCount(0);
    await expect(p.locator('#phase-hint')).toContainText('ผู้เข้ารอบ 2');
  }
  await pages[0].screenshot({ path: 'test-results/vote-privacy/runoff-mobile.png', fullPage: true });
  await card(0, 2).tap(); await expect(card(0, 2).locator('.vote-marker')).toBeVisible();
  await expect(pages[0].getByRole('button', { name: 'ยืนยันเป้าหมาย →', exact: true })).toHaveCount(0);
  for (const p of pages.slice(1)) await expect(p.locator('.vote-marker')).toHaveCount(0);
  await expect(pages[0].locator('#phase-title')).toHaveText('คำตัดสินของหมู่บ้าน', { timeout: 15000 });
  for (const p of pages) await expect(p.locator('.vote-marker')).toHaveCount(0);
  for (const p of pages) await expect(p.locator('.runoff-candidate')).toHaveCount(0);
  if (errors.length) throw Error(errors.join('\n'));
  console.log('PASS: six browser clients; night ability still requires confirmation; one-click/keyboard/touch votes; no confirmation; private marker; latest rapid click; tally waits for deadline; change target; abstain; reconnect; independent voters; runoff reset; marker removed after voting; desktop/mobile screenshots; no page errors.');
} finally { await browser?.close(); server.kill(); }
