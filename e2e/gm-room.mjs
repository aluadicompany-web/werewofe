import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
const fixture = 'browser-test-gm-key-not-production-12345';
const server = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: '3232', NODE_ENV: 'test', GM_ADMIN_KEY: fixture }, stdio: ['ignore', 'pipe', 'pipe'] });
let browser; const errors = [];
await mkdir('test-results/gm-room', { recursive: true });
try {
  await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('error', reject); server.once('exit', () => reject(Error('GM browser server exited'))); });
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const page = async () => { const c = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); const p = await c.newPage(); p.on('pageerror', e => errors.push(e.message)); await p.goto('http://127.0.0.1:3232'); await expect(p.locator('#connection')).toHaveText('เชื่อมต่อแล้ว'); return p; };
  const gm = await page(); await gm.locator('#gm-open').click(); await gm.locator('#gm-name').fill('QA GM');
  await gm.locator('#gm-key').fill(fixture + '-bad'); await gm.locator('#gm-create').click(); await expect(gm.locator('#toast')).toHaveText('รหัส GM ไม่ถูกต้อง'); await expect(gm.locator('#gm-dialog')).toBeVisible(); await expect(gm.locator('#gm-key')).toHaveValue('');
  await gm.locator('#gm-key').fill(fixture); await gm.locator('#gm-create').click(); await expect(gm.locator('#gm-panel')).toBeVisible(); await expect(gm.locator('#gm-dialog')).toBeHidden();
  const code = await gm.locator('#room-code').innerText();
  if (await gm.evaluate(key => JSON.stringify({ ...sessionStorage, ...localStorage }).includes(key), fixture)) throw Error('GM master key persisted in browser storage');
  await gm.getByRole('button', { name: 'เติมบอทให้ครบ 6 คน', exact: true }).click(); await expect(gm.locator('.player:not(.empty)')).toHaveCount(6);
  await gm.getByRole('button', { name: 'เติมบอทให้ครบ 12 คน', exact: true }).click(); await expect(gm.locator('.player:not(.empty)')).toHaveCount(12); await expect(gm.getByRole('button', { name: '+ บอท 1 ตัว', exact: true })).toBeDisabled();
  await gm.screenshot({ path: 'test-results/gm-room/lobby-12-desktop.png', fullPage: true });
  await gm.locator('#gm-speed').selectOption('20'); await expect(gm.locator('#gm-speed')).toHaveValue('20'); await gm.locator('#gm-speed').selectOption('1');
  await gm.getByRole('button', { name: 'ลบบอททั้งหมด', exact: true }).click(); await expect(gm.locator('.player:not(.empty)')).toHaveCount(1);
  const guest = await page(); await guest.locator('#name').fill('QA Guest'); await guest.locator('#code').fill(code); await guest.locator('#join').click(); await expect(guest.locator('#game')).toBeVisible(); await expect(guest.locator('#gm-panel')).toBeHidden(); await expect(guest.locator('#round-label')).toContainText('GM TEST');
  await gm.getByRole('button', { name: 'เติมบอทให้ครบ 6 คน', exact: true }).click(); await expect(guest.locator('.player:not(.empty)')).toHaveCount(6);
  await gm.locator('#timing').selectOption('quick'); await gm.getByRole('button', { name: 'ฉันพร้อมแล้ว', exact: true }).click(); await guest.getByRole('button', { name: 'ฉันพร้อมแล้ว', exact: true }).click(); await gm.getByRole('button', { name: 'เริ่มคืนแรก →', exact: true }).click();
  const step = async () => { const before = await gm.locator('#game').getAttribute('data-phase-id'); await gm.getByRole('button', { name: 'จบช่วงนี้ →', exact: true }).click(); await expect.poll(() => gm.locator('#game').getAttribute('data-phase-id')).not.toBe(before); };
  await step(); await expect(gm.locator('#game')).toHaveAttribute('data-phase', 'night');
  await gm.locator('#gm-reveal').check(); await expect(gm.locator('#gm-debug tr')).toHaveCount(7); await expect(guest.locator('#gm-debug tr')).toHaveCount(0);
  await expect.poll(async () => {
    const rows = await gm.locator('#gm-debug tr').allTextContents(); return rows.some(row => row.startsWith('บอท ') && !row.endsWith('ยังไม่ส่ง'));
  }, { timeout: 6000 }).toBe(true);
  const phase = await gm.locator('#game').getAttribute('data-phase-id'); await gm.getByRole('button', { name: 'ให้บอทส่งคำสั่งตอนนี้', exact: true }).click(); await expect(gm.locator('#game')).toHaveAttribute('data-phase-id', phase);
  await gm.reload(); await expect(gm.locator('#gm-panel')).toBeVisible(); await expect(gm.locator('#gm-key')).toHaveValue(''); await gm.locator('#gm-reveal').check();
  await gm.setViewportSize({ width: 390, height: 844 }); await gm.screenshot({ path: 'test-results/gm-room/inspector-mobile.png', fullPage: true }); if (await gm.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('GM mobile horizontal overflow');
  gm.once('dialog', d => d.accept()); await gm.getByRole('button', { name: 'รีเซ็ตกลับห้องรอ', exact: true }).click(); await expect(gm.locator('#game')).toHaveAttribute('data-phase', 'lobby');
  guest.once('dialog', d => d.accept()); await guest.locator('#leave').click(); await expect(guest.locator('#landing')).toBeVisible();
  await gm.setViewportSize({ width: 1440, height: 1000 }); await gm.getByRole('button', { name: 'เติมบอทให้ครบ 6 คน', exact: true }).click(); await gm.getByRole('button', { name: 'ฉันพร้อมแล้ว', exact: true }).click(); await gm.getByRole('button', { name: 'เริ่มคืนแรก →', exact: true }).click();
  for (let n = 0; n < 200; n++) {
    const phase = await gm.locator('#game').getAttribute('data-phase'); if (phase === 'ended') break;
    if (['night', 'voting', 'runoff', 'hunter_reaction'].includes(phase)) {
      const target = gm.locator('.player.can-select').first(); if (await target.count()) {
        await target.click(); const confirm = gm.getByRole('button', { name: 'ยืนยันเป้าหมาย →', exact: true }); if (await confirm.count()) await confirm.click(); await expect(gm.locator('#selection')).toContainText('คำสั่งล่าสุด');
      }
    }
    await step(); await gm.waitForTimeout(350);
  }
  await expect(gm.locator('#game')).toHaveAttribute('data-phase', 'ended'); await expect(gm.locator('#phase-title')).toHaveText(/เป็นฝ่ายชนะ|เสมอ/);
  await gm.screenshot({ path: 'test-results/gm-room/finished-desktop.png', fullPage: true });
  await gm.getByRole('button', { name: 'เล่นอีกครั้ง ↻', exact: true }).click(); await guest.locator('#join').click(); await expect(guest.locator('#game')).toBeVisible();
  gm.once('dialog', d => d.accept()); await gm.locator('#leave').click(); await expect(gm.locator('#landing')).toBeVisible(); await expect(guest.locator('#landing')).toBeVisible(); await expect(guest.locator('#toast')).toHaveText('GM ปิดห้องทดสอบแล้ว');
  if (errors.length) throw Error(errors.join('\n'));
  console.log('PASS: password-gated GM room; 6/12 capacity; bot readiness/actions; private inspector; no stored master key; reconnect; speed control; reset; complete bot match; close/guest notification; desktop/mobile; no page errors');
} finally { await browser?.close(); server.kill(); }
