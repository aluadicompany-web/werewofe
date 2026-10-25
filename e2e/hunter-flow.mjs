import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
const remote = process.env.PLAYTEST_BASE_URL, base = remote || 'http://127.0.0.1:3225';
const server = remote ? null : spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: '3225', NODE_ENV: 'test', GAME_TIMER_SCALE: '0.4' }, stdio: ['ignore', 'pipe', 'pipe'] });
let browser, proxy; const errors = [];
if (remote && (process.env.HTTPS_PROXY || process.env.https_proxy)) { const u = new URL(process.env.HTTPS_PROXY || process.env.https_proxy); proxy = { server: u.origin, ...(u.username ? { username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) } : {}) }; }
await mkdir('test-results/hunter-flow', { recursive: true });
try {
  if (server) await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('error', reject); server.once('exit', () => reject(Error('Server exited'))); });
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'], ...(proxy ? { proxy } : {}) });
  const pages = [];
  for (let i = 0; i < 9; i++) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: true }); const p = await context.newPage(); pages.push(p); p.on('pageerror', e => errors.push(e.message));
    await p.goto(base); await expect(p.locator('#connection')).toHaveText('เชื่อมต่อแล้ว', { timeout: 90000 }); await p.locator('#name').fill(`QAนายพราน${i + 1}`);
    if (!i) { await p.locator('#create').click(); await expect(p.locator('#game')).toBeVisible(); await p.locator('#timing').selectOption('quick'); }
    else { await p.locator('#code').fill(await pages[0].locator('#room-code').innerText()); await p.locator('#join').click(); }
    await expect(p.locator('#game')).toBeVisible();
  }
  for (const p of pages) await p.getByRole('button', { name: 'ฉันพร้อมแล้ว', exact: true }).click(); await pages[0].getByRole('button', { name: 'เริ่มคืนแรก →', exact: true }).click();
  const assigned = []; for (const p of pages) { await p.locator('#reveal').click(); assigned.push(await p.locator('#role-content h3').innerText()); }
  const hunter = assigned.findIndex(r => r.includes('นายพราน')), seer = assigned.findIndex(r => r.includes('ผู้หยั่งรู้')), doctor = assigned.findIndex(r => r.includes('หมอ'));
  const wolves = assigned.map((r, i) => r.includes('มนุษย์หมาป่า') ? i : -1).filter(i => i >= 0); if (wolves.length !== 2 || hunter < 0) throw Error('Invalid 9-player assignment');
  const seats = await pages[0].locator('.player').evaluateAll(cards => cards.map(c => c.dataset.seat));
  const act = async (actor, target, touch = false) => {
    const card = pages[actor].locator(`.player[data-seat="${seats[target]}"]`), confirm = pages[actor].getByRole('button', { name: 'ยืนยันเป้าหมาย →', exact: true });
    if (touch) { await card.tap(); if (await confirm.count()) await confirm.tap(); } else { await card.click(); if (await confirm.count()) await confirm.click(); }
    await expect(pages[actor].locator('#selection')).toContainText('คำสั่งล่าสุด');
  };
  await expect(pages[0].locator('#phase-title')).toHaveText('รุ่งเช้าแห่งความสงสัย', { timeout: 60000 }); console.log('PASS: first night advances with all actions AFK');
  await pages[0].getByRole('button', { name: 'เปิดการลงคะแนน →', exact: true }).click();
  for (let i = 0; i < pages.length; i++) { await act(i, wolves[0]); await expect(pages[i].locator('.vote-marker')).toHaveCount(1); }
  await expect(pages[0].locator('#phase-title')).toHaveText('ค่ำคืนแห่งความลับ', { timeout: 60000 });
  await expect(pages[wolves[0]].locator('#chat-input')).toBeDisabled(); await expect(pages[wolves[0]].locator('.player.can-select')).toHaveCount(0);
  await act(wolves[1], hunter); await act(seer, wolves[1]); await act(doctor, doctor);
  await expect(pages[hunter].locator('#phase-title')).toHaveText('กระสุนนัดสุดท้ายของนายพราน', { timeout: 60000 });
  await expect(pages[hunter].locator('#chat-input')).toBeDisabled(); await expect(pages[seer].locator('#role-content .vision')).toHaveCount(0);
  await pages[hunter].setViewportSize({ width: 390, height: 844 }); await act(hunter, wolves[1], true);
  await expect(pages[hunter].locator('#phase-title')).toHaveText('กระสุนนัดสุดท้ายของนายพราน');
  if (await pages[hunter].evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('Hunter screen overflows on mobile');
  await pages[hunter].screenshot({ path: 'test-results/hunter-flow/reaction-mobile.png', fullPage: true }); console.log('PASS: dead Hunter can shoot by touch; dead chat disabled; victory waits for reaction');
  await expect(pages[0].getByRole('button', { name: 'เล่นอีกครั้ง ↻', exact: true })).toBeVisible({ timeout: 60000 });
  for (const p of pages) await expect(p.locator('#phase-title')).toHaveText('หมู่บ้านเป็นฝ่ายชนะ');
  await expect(pages[seer].locator('#role-content .vision')).toContainText('เป็นหมาป่า');
  await pages[0].screenshot({ path: 'test-results/hunter-flow/victory-desktop.png', fullPage: true });
  await pages[0].getByRole('button', { name: 'เล่นอีกครั้ง ↻', exact: true }).click();
  for (const p of pages) { p.once('dialog', d => d.accept()); await p.locator('#leave').click(); await expect(p.locator('#landing')).toBeVisible(); }
  if (errors.length) throw Error(errors.join('\n'));
  console.log(`PASS: ${remote ? 'public' : 'local'} 9-player match; AFK night, private votes, dead restrictions, Hunter reaction, deferred seer result, village victory, rematch, cleanup; no page errors`);
} finally { await browser?.close(); server?.kill(); }
