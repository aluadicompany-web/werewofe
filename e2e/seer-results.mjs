import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
const server = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: '3233', NODE_ENV: 'test', GAME_TIMER_SCALE: '0.3' }, stdio: ['ignore', 'pipe', 'pipe'] });
let browser; const errors = [];
await mkdir('test-results/seer-results', { recursive: true });
try {
  await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('error', reject); server.once('exit', () => reject(Error('Seer test server exited'))); });
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const pages = [];
  for (let i = 0; i < 6; i++) {
    const c = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const p = await c.newPage(); pages.push(p); p.on('pageerror', e => errors.push(e.message));
    await p.goto('http://127.0.0.1:3233'); await expect(p.locator('#connection')).toHaveText('เชื่อมต่อแล้ว'); await p.locator('#name').fill(`QAพยากรณ์${i + 1}`);
    if (!i) { await p.locator('#create').click(); await expect(p.locator('#game')).toBeVisible(); await p.locator('#timing').selectOption('quick'); }
    else { await p.locator('#code').fill(await pages[0].locator('#room-code').innerText()); await p.locator('#join').click(); }
    await expect(p.locator('#game')).toBeVisible();
  }
  for (const p of pages) await p.getByRole('button', { name: 'ฉันพร้อมแล้ว', exact: true }).click(); await pages[0].getByRole('button', { name: 'เริ่มคืนแรก →', exact: true }).click();
  const assigned = []; for (const p of pages) { await p.locator('#reveal').click(); assigned.push(await p.locator('#role-content h3').innerText()); }
  const seer = assigned.findIndex(r => r.includes('ผู้หยั่งรู้')), wolf = assigned.findIndex(r => r.includes('มนุษย์หมาป่า')), village = assigned.findIndex(r => r.includes('ชาวบ้าน'));
  const seats = await pages[0].locator('.player').evaluateAll(cards => cards.map(c => c.dataset.seat));
  const card = (viewer, index) => pages[viewer].locator(`.player[data-seat="${seats[index]}"]`);
  const inspect = async target => { await card(seer, target).click(); await pages[seer].getByRole('button', { name: 'ยืนยันเป้าหมาย →', exact: true }).click(); await expect(pages[seer].locator('#selection')).toContainText('คำสั่งล่าสุด'); };
  await expect(pages[seer].locator('#game')).toHaveAttribute('data-phase', 'night', { timeout: 10000 }); await inspect(village);
  for (const p of pages) await expect(p.locator('.seer-mark')).toHaveCount(0);
  await expect(card(seer, village).locator('.seat .seer-mark')).toHaveText('👍', { timeout: 15000 });
  for (let i = 0; i < 6; i++) if (i !== seer) await expect(pages[i].locator('.seer-mark')).toHaveCount(0);
  await expect(pages[0].locator('#game')).toHaveAttribute('data-phase', 'discussion', { timeout: 10000 }); await pages[0].getByRole('button', { name: 'เปิดการลงคะแนน →', exact: true }).click();
  for (const p of pages) { await p.getByRole('button', { name: 'งดออกเสียง', exact: true }).click(); await expect(p.locator('#selection')).toContainText('งดออกเสียง'); }
  await expect(pages[seer].locator('#game')).toHaveAttribute('data-phase', 'night', { timeout: 15000 }); await expect(card(seer, village).locator('.seer-mark')).toHaveText('👍'); await inspect(wolf); await expect(card(seer, wolf).locator('.seer-mark')).toHaveCount(0);
  await expect(card(seer, wolf).locator('.seat .seer-mark')).toHaveText('👎', { timeout: 15000 }); await expect(pages[seer].locator('.seer-mark')).toHaveCount(2);
  await pages[seer].reload(); await expect(card(seer, village).locator('.seer-mark')).toHaveText('👍'); await expect(card(seer, wolf).locator('.seer-mark')).toHaveText('👎');
  for (let i = 0; i < 6; i++) if (i !== seer) await expect(pages[i].locator('.seer-mark')).toHaveCount(0);
  await pages[seer].screenshot({ path: 'test-results/seer-results/private-desktop.png', fullPage: true });
  await pages[wolf].screenshot({ path: 'test-results/seer-results/other-player-desktop.png', fullPage: true });
  await pages[seer].setViewportSize({ width: 390, height: 844 });
  for (const target of [village, wolf]) {
    const c = await card(seer, target).boundingBox(), m = await card(seer, target).locator('.seer-mark').boundingBox();
    if (!c || !m || m.x - c.x > 60 || m.y - c.y > 30 || m.width > 20 || m.height > 20) throw Error('Seer emoji is not small and beside the top-left seat label');
  }
  if (await pages[seer].evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('Seer view overflows on mobile');
  await pages[seer].screenshot({ path: 'test-results/seer-results/private-mobile.png', fullPage: true });
  if (errors.length) throw Error(errors.join('\n'));
  console.log('PASS: six browser clients; no early Seer markers; morning thumbs-up/down; private to Seer; persisted history and reconnect; small top-left seat markers; desktop/mobile; no page errors');
} finally { await browser?.close(); server.kill(); }
