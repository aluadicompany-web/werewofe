import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import express from 'express';
const frontend = 'http://127.0.0.1:3210', backend = 'http://127.0.0.1:3211';
const build = spawnSync(process.execPath, ['scripts/build.mjs'], { env: { ...process.env, NETLIFY: 'false', PUBLIC_GAME_SERVER_URL: backend }, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status || 1);
const app = express(); app.use(express.static('dist'));
const web = await new Promise(resolve => { const server = app.listen(3210, '127.0.0.1', () => resolve(server)); });
const game = spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:'3211',NODE_ENV:'test',GAME_TIMER_SCALE:'0.3',ALLOWED_ORIGINS:frontend},stdio:['ignore','pipe','pipe']});
let browser;const errors=[];
await mkdir('test-results',{recursive:true});
try {
 await new Promise((resolve,reject)=>{game.stdout.once('data',resolve);game.once('error',reject);game.once('exit',()=>reject(Error('game server exited')));});
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 for(const count of [6,12]){
  const pages=[],contexts=[],names=Array.from({length:count},(_,i)=>`ผู้เล่น${String(i+1).padStart(2,'0')}`);
  const page=async url=>{const c=await browser.newContext({viewport:{width:1440,height:1000}});contexts.push(c);const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});await p.goto(url);await expect(p.locator('#connection')).toHaveText('เชื่อมต่อแล้ว');return p;};
  pages.push(await page(frontend));
  if(count===6){await pages[0].screenshot({path:'test-results/landing-desktop.png',fullPage:true});await pages[0].getByRole('button',{name:'วิธีเล่น'}).click();await expect(pages[0].locator('#rules')).toBeVisible();await pages[0].keyboard.press('Escape');}
  await pages[0].locator('#name').fill(names[0]);await pages[0].locator('#create').click();await expect(pages[0].locator('#game')).toBeVisible();await expect(pages[0].getByRole('button',{name:'เริ่มคืนแรก →',exact:true})).toBeDisabled();
  const code=await pages[0].locator('#room-code').innerText();await pages[0].locator('#timing').selectOption('quick');
  for(let i=1;i<count;i++){const p=await page(`${frontend}/?room=${code}`);pages.push(p);await expect(p.locator('#code')).toHaveValue(code);await p.locator('#name').fill(names[i]);await p.locator('#code').press('Enter');await expect(p.locator('#game')).toBeVisible();}
  if(count===12){const extra=await page(`${frontend}/?room=${code}`);await extra.locator('#name').fill('ผู้เล่นเกิน');await extra.locator('#join').click();await expect(extra.locator('#toast')).toContainText('ห้องเต็ม');await expect(extra.locator('#game')).toBeHidden();await extra.close();}
  for(const p of pages)await p.getByRole('button',{name:'ฉันพร้อมแล้ว',exact:true}).click();
  await expect(pages[0].getByRole('button',{name:'เริ่มคืนแรก →',exact:true})).toBeEnabled();await pages[0].screenshot({path:`test-results/lobby-${count}-desktop.png`,fullPage:true});
  await pages[0].getByRole('button',{name:'เริ่มคืนแรก →',exact:true}).click();
  const assigned=[];for(const p of pages){await p.locator('#reveal').click();assigned.push(await p.locator('#role-content h3').innerText());}
  const wolfIndices=assigned.map((r,i)=>r.includes('มนุษย์หมาป่า')?i:-1).filter(i=>i>=0),seer=assigned.findIndex(r=>r.includes('ผู้หยั่งรู้')),doctor=assigned.findIndex(r=>r.includes('หมอ')),villagers=assigned.map((r,i)=>r.includes('ชาวบ้าน')?i:-1).filter(i=>i>=0);
  if(count===12){if(!assigned.some(r=>r.includes('นายพราน'))||!assigned.some(r=>r.includes('ผู้อาวุโส')))throw Error('12-player roles missing');}
  const seats=await pages[0].locator('.player').evaluateAll(bs=>bs.map(b=>b.dataset.seat));
  const choose=async(actor,target)=>{await pages[actor].locator(`.player[data-seat="${seats[target]}"]`).click();await pages[actor].getByRole('button',{name:'ยืนยันเป้าหมาย →',exact:true}).focus();await pages[actor].keyboard.press('Enter');await expect(pages[actor].locator('#selection')).toContainText('คำสั่งล่าสุด');};
  for(let round=0;round<wolfIndices.length;round++){
   await expect(pages[0].locator('#phase-title')).toHaveText('ค่ำคืนแห่งความลับ',{timeout:15000});
   const target=villagers[round%villagers.length];
   if(round===0){await pages[wolfIndices[0]].locator('#chat-input').fill('คืนนี้ปกปิดตัวตน');await pages[wolfIndices[0]].locator('#chat-input').press('Enter');await expect(pages[target].locator('#messages')).not.toContainText('คืนนี้ปกปิดตัวตน');}
   for(const w of wolfIndices.slice(round))await choose(w,target);
   await choose(seer,wolfIndices[round]);await choose(doctor,target);
   if(round===0)await pages[seer].screenshot({path:`test-results/night-${count}-desktop.png`,fullPage:true});
   await expect(pages[0].locator('#phase-title')).toHaveText('รุ่งเช้าแห่งความสงสัย',{timeout:15000});await expect(pages[seer].locator('#role-content')).toContainText('เป็นหมาป่า');
   if(round===0){await pages[0].locator('#chat-input').fill('<img src=x onerror=alert(1)> สวัสดี');await pages[0].locator('#chat-input').press('Enter');await expect(pages[1].locator('#messages')).toContainText('<img src=x');await expect(pages[1].locator('#messages img')).toHaveCount(0);
    await pages[0].screenshot({path:`test-results/day-${count}-desktop.png`,fullPage:true});await pages.at(-1).reload();await expect(pages.at(-1).locator('#phase-title')).toHaveText('รุ่งเช้าแห่งความสงสัย');await expect(pages.at(-1).locator('.player')).toHaveCount(count);
   }
   await pages[0].getByRole('button',{name:'เปิดการลงคะแนน →',exact:true}).click();
   for(let i=0;i<count;i++){if(wolfIndices.slice(0,round).includes(i))continue;await expect(pages[i].locator('#phase-title')).toHaveText('ใครคือมนุษย์หมาป่า?');await choose(i,wolfIndices[round]);}
  }
  await expect(pages[0].getByRole('button',{name:'เล่นอีกครั้ง ↻',exact:true})).toBeVisible({timeout:15000});await expect(pages[0].locator('#phase-title')).toHaveText('หมู่บ้านเป็นฝ่ายชนะ');await pages[0].screenshot({path:`test-results/victory-${count}-desktop.png`,fullPage:true});
  await pages[0].getByRole('button',{name:'เล่นอีกครั้ง ↻',exact:true}).click();await expect(pages[0].locator('#phase-title')).toHaveText('ล้อมวงรอเพื่อน');
  await pages[0].setViewportSize({width:390,height:844});await pages[0].screenshot({path:`test-results/lobby-${count}-mobile.png`,fullPage:true});if(await pages[0].evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('mobile board horizontal overflow');
  console.log(`PASS: ${count}-player browser match on static frontend + separate realtime origin; shared invite, roles, abilities, private chat, voting, victory, reconnect, rematch, mobile.`);
  for(const c of contexts)await c.close();
 }
 const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true});const mp=await mobile.newPage();await mp.goto(frontend);await mp.screenshot({path:'test-results/landing-mobile.png',fullPage:true});if(await mp.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('mobile landing horizontal overflow');
 if(errors.length)throw Error(errors.join('\n'));console.log('PASS: no browser page errors or failed HTTP responses. Browser timers accelerated only by test-server configuration.');
} finally {await browser?.close();game.kill();await new Promise(resolve=>web.close(resolve));}
