import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
const remote = process.env.PLAYTEST_BASE_URL;
const base = remote || 'http://127.0.0.1:3223';
const server = remote ? null : spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: '3223', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
let browser; const failures = [], errors = [];
let proxy;
if (remote && (process.env.HTTPS_PROXY || process.env.https_proxy)) { const u = new URL(process.env.HTTPS_PROXY || process.env.https_proxy); proxy = { server: u.origin, ...(u.username ? { username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) } : {}) }; }
await mkdir('test-results/lobby-recovery', { recursive: true });
try {
  if (server) await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('error', reject); server.once('exit', () => reject(Error('Server exited'))); });
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'], ...(proxy ? { proxy } : {}) });
  const page = async (name, code) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const p = await context.newPage();
    p.on('pageerror', e => errors.push(e.message)); await p.goto(code ? `${base}/?room=${code}` : base);
    await expect(p.locator('#connection')).toHaveText('เชื่อมต่อแล้ว', { timeout: 90000 }); await p.locator('#name').fill(name); return p;
  };
  const leave = async p => { if (!p.isClosed() && await p.locator('#game').isVisible()) { p.once('dialog', d => d.accept()); await p.locator('#leave').click(); await expect(p.locator('#landing')).toBeVisible(); } };
  const check = async (name, fn) => { try { await fn(); console.log('PASS:', name); } catch (e) { failures.push(`${name}: ${e.message}`); console.log('FAIL:', name, e.message.split('\n')[0]); } };
  await check('Invite link + Enter in name joins the invited room', async () => {
    const owner = await page('QAเจ้าของ'); let guest;
    try {
      await owner.locator('#create').click(); await expect(owner.locator('#game')).toBeVisible(); const code = await owner.locator('#room-code').innerText();
      guest = await page('QAเพื่อน', code); await guest.locator('#name').press('Enter'); await expect(guest.locator('#game')).toBeVisible();
      await expect(guest.locator('#room-code')).toHaveText(code); await expect(owner.locator('.player:not(.empty)')).toHaveCount(2);
    } finally { if (guest) await leave(guest); await leave(owner); }
  });
  await check('Newcomer inherits a lobby whose owner disconnected; old owner can reconnect', async () => {
    const owner = await page('QAเจ้าของหลุด'); let guest, restored;
    try {
      await owner.locator('#create').click(); await expect(owner.locator('#game')).toBeVisible(); const code = await owner.locator('#room-code').innerText();
      const session = await owner.evaluate(() => sessionStorage.getItem('moonfall')); await owner.context().close();
      // A lost browser behind a proxy can take the Engine.IO ping interval + timeout to become offline.
      if (remote) console.log('Waiting for the disconnected owner timeout before joining the empty lobby');
      await new Promise(resolve => setTimeout(resolve, remote ? 50000 : 300));
      guest = await page('QAรับช่วง', code); await guest.locator('#join').click(); await expect(guest.locator('#game')).toBeVisible();
      await expect(guest.locator('.player').first()).toContainText('หลุดการเชื่อมต่อ');
      const inherited = await guest.getByRole('button', { name: 'เริ่มคืนแรก →', exact: true }).count();
      restored = await page('QAกลับมา'); await restored.evaluate(value => sessionStorage.setItem('moonfall', value), session); await restored.reload();
      await expect(restored.locator('#game')).toBeVisible(); await expect(restored.locator('.player:not(.empty)')).toHaveCount(2);
      if (!inherited) throw Error('New player has no host controls while old host is offline');
      await expect(guest.getByRole('button', { name: 'เริ่มคืนแรก →', exact: true })).toBeVisible();
      await expect(restored.getByRole('button', { name: 'เริ่มคืนแรก →', exact: true })).toHaveCount(0);
    } finally { if (guest) await leave(guest); if (restored) await leave(restored); }
  });
  await check('Mobile 320/360/390px layout and toast clear of bottom branding', async () => {
    const p = await page('QAมือถือ');
    try {
      for (const width of [320, 360, 390]) {
        await p.setViewportSize({ width, height: 844 }); await expect(p.locator('#create')).toBeVisible();
        if (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error(`Landing overflows at ${width}px`);
      }
      await p.locator('#code').fill('NOTHEX'); await p.locator('#join').click(); await expect(p.locator('#toast')).toBeVisible();
      const toast = await p.locator('#toast').boundingBox();
      if (!toast || toast.y + toast.height > 844 - 64) throw Error('Mobile toast overlaps the bottom branding area');
      await p.screenshot({ path: 'test-results/lobby-recovery/mobile-toast.png', fullPage: true });
      await p.locator('#create').click(); await expect(p.locator('#game')).toBeVisible();
      for (const width of [320, 360, 390]) {
        await p.setViewportSize({ width, height: 844 }); await p.screenshot({ path: `test-results/lobby-recovery/mobile-${width}.png`, fullPage: true });
        if (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error(`Lobby overflows at ${width}px`);
      }
    } finally { await leave(p); }
  });
  if (errors.length) failures.push(...errors);
  if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
} finally { await browser?.close(); server?.kill(); }
