import { chromium, expect } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import express from 'express';
import { io } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
const remote=process.env.PLAYTEST_BASE_URL;
const frontend=remote||'http://127.0.0.1:3254',backend='http://127.0.0.1:3255';
let web,server,browser;const errors=[],contexts=[],sockets=[];
await mkdir('test-results/minion-outcome',{recursive:true});
if(!remote){
 const build=spawnSync(process.execPath,['scripts/build.mjs'],{env:{...process.env,NETLIFY:'false',CF_PAGES:'0',PUBLIC_GAME_SERVER_URL:backend},stdio:'inherit'});if(build.status!==0)throw Error('Minion build failed');
 const app=express();app.use(express.static('dist'));web=await new Promise(resolve=>{const s=app.listen(3254,'127.0.0.1',()=>resolve(s));});
 server=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:'3255',NODE_ENV:'test',ALLOWED_ORIGINS:frontend},stdio:['ignore','pipe','pipe']});
}
let proxy;if(remote&&(process.env.HTTPS_PROXY||process.env.https_proxy)){const u=new URL(process.env.HTTPS_PROXY||process.env.https_proxy);proxy={server:u.origin,...(u.username?{username:decodeURIComponent(u.username),password:decodeURIComponent(u.password)}:{})};}
try{
 if(server)await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',()=>reject(Error('Minion server exited')));});
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox'],...(proxy?{proxy}:{})});
 const open=async()=>{const c=await browser.newContext({viewport:{width:1280,height:900},hasTouch:true});contexts.push(c);const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});await p.goto(frontend);await expect(p.locator('#connection')).toHaveText('เชื่อมต่อแล้ว',{timeout:remote?90000:10000});return p;};
 const host=await open();await host.locator('#name').fill('QA-Outcome-Host');await host.locator('#create').click();await host.locator('#host-seat').click();const code=await host.locator('#room-code').innerText();const pages=[];
 for(let i=0;i<6;i++){const p=await open();pages.push(p);await p.locator('#name').fill(`QA-Outcome-${i+1}`);await p.locator('#code').fill(code);await p.locator('#join').click();await expect(p.locator('#game')).toBeVisible();}
 const step=async()=>{const before=await host.locator('#game').getAttribute('data-phase-id');host.once('dialog',d=>d.accept());await host.locator('#host-step').click();await expect.poll(()=>host.locator('#game').getAttribute('data-phase-id')).not.toBe(before);await host.waitForTimeout(250);};
 const seats=await host.locator('.player:not(.empty)').evaluateAll(cards=>cards.map(c=>c.dataset.seat));const card=(actor,target)=>pages[actor].locator(`.player[data-seat="${seats[target]}"]`);
 const start=async()=>{for(const p of pages)await p.getByRole('button',{name:'ฉันพร้อมแล้ว',exact:true}).click();await host.getByRole('button',{name:'เริ่มคืนแรก →',exact:true}).click();const assigned=[];for(const p of pages){await p.locator('#reveal').click();assigned.push(await p.locator('#role-content h3').innerText());}await step();return {m:assigned.findIndex(r=>r.includes('ลูกสมุน')),w:assigned.findIndex(r=>r.includes('มนุษย์หมาป่า')),s:assigned.findIndex(r=>r.includes('ผู้หยั่งรู้')),d:assigned.findIndex(r=>r.includes('หมอ'))};};
 const use=async(actor,target)=>{await card(actor,target).click();await expect(pages[actor].locator('#selection')).toContainText('คำสั่งล่าสุด');};
 let role=await start();if(Object.values(role).some(i=>i<0))throw Error('Six-player deck missing a required role');
 for(const p of [host,...pages]){
  await expect(p.locator('#match-roster')).toBeVisible();await expect(p.locator('#match-role-list .role-chip')).toHaveCount(5);await expect(p.locator('#match-role-list')).toContainText('ลูกสมุนหมาป่า × 1');await expect(p.locator('#match-role-list')).toContainText('ชาวบ้าน × 2');await expect(p.locator('#match-roster')).not.toContainText('QA-Outcome-');await expect(p.locator('#match-outcome')).toBeHidden();
 }
 const roster=await host.locator('#match-role-list .role-chip').allTextContents();
 await expect(card(role.m,role.w).locator('small')).toHaveText('มนุษย์หมาป่า');await expect(card(role.w,role.m).locator('small')).toHaveText('ยังมีชีวิต');await expect(pages[role.m].locator('#chat-input')).toBeDisabled();await expect(pages[role.m].locator('.player.can-select')).toHaveCount(0);
 await use(role.w,role.m);await use(role.d,role.m);await use(role.s,role.m);await expect(pages[role.m].locator('.wolf-target')).toHaveCount(0);await pages[role.m].screenshot({path:'test-results/minion-outcome/roster-private-desktop.png',fullPage:true});await pages[role.m].reload();await expect(card(role.m,role.w).locator('small')).toHaveText('มนุษย์หมาป่า');await step();await expect(card(role.s,role.m).locator('.seer-mark')).toHaveText('👍');await step();await step();
 for(let i=0;i<6;i++)await card(i,i===role.w||i===role.m?(role.w+1)%6:role.w).click();await step();await step();await expect(host.locator('#phase-title')).toHaveText('หมู่บ้านเป็นฝ่ายชนะ');await expect(host.locator('#match-outcome')).toBeHidden();
 for(let i=0;i<6;i++)await expect(pages[i].locator('#outcome-word')).toHaveText(i===role.w||i===role.m?'LOSE':'WIN');
 const winner=pages[role.s],loser=pages[role.m];await winner.screenshot({path:'test-results/minion-outcome/win-desktop.png'});await loser.setViewportSize({width:390,height:844});await loser.screenshot({path:'test-results/minion-outcome/lose-mobile.png'});
 const word=await loser.locator('#outcome-word').boundingBox();if(!word||Math.abs(word.x+word.width/2-195)>15||Math.abs(word.y+word.height/2-422)>170)throw Error('LOSE is not centered in the mobile viewport');if(await loser.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Outcome overflows mobile');
 await winner.locator('#close-outcome').click();await expect(winner.locator('#match-outcome')).toBeHidden();await loser.locator('#match-outcome').tap({position:{x:12,y:12}});await expect(loser.locator('#match-outcome')).toBeHidden();await pages[role.w].keyboard.press('Escape');await expect(pages[role.w].locator('#match-outcome')).toBeHidden();await step();await expect(winner.locator('#match-outcome')).toBeHidden();await loser.reload();await expect(loser.locator('#game')).toHaveAttribute('data-phase','ended');await expect(loser.locator('#match-outcome')).toBeHidden();
 await host.getByRole('button',{name:'เล่นอีกครั้ง ↻',exact:true}).click();await expect(host.locator('#game')).toHaveAttribute('data-phase','lobby');for(const p of pages)await expect(p.locator('#match-outcome')).toBeHidden();await expect(host.locator('#match-roster')).toBeHidden();
 // Second game: a dead Minion shares the wolf team's WIN; dead/alive village players LOSE.
 role=await start();await use(role.w,role.m);await step();await expect(card(role.m,role.m)).toHaveClass(/dead/);await expect(host.locator('#match-role-list .role-chip')).toHaveText(roster);await expect(pages[role.m].locator('#match-outcome')).toBeHidden();
 for(let n=0;n<40;n++){
  const phase=await host.locator('#game').getAttribute('data-phase');if(phase==='result'||phase==='ended')break;
  const alive=[];for(let i=0;i<6;i++)if(!/dead/.test(await card(role.w,i).getAttribute('class')))alive.push(i);
  const target=alive.find(i=>i!==role.w);
  if(phase==='night')await use(role.w,target);
  if(['voting','runoff'].includes(phase))for(const i of alive)if(await card(i,target).isEnabled())await card(i,target).click();
  await step();
 }
 await expect(host.locator('#phase-title')).toHaveText('ฝูงหมาป่าเป็นฝ่ายชนะ');for(let i=0;i<6;i++)await expect(pages[i].locator('#outcome-word')).toHaveText(i===role.w||i===role.m?'WIN':'LOSE');await expect(pages[role.m].locator('#outcome-detail')).toContainText('คุณถูกกำจัดแล้ว');await pages[role.m].setViewportSize({width:390,height:844});await pages[role.m].screenshot({path:'test-results/minion-outcome/dead-minion-win-mobile.png'});
 for(const p of pages)if(await p.locator('#match-outcome').isVisible())await p.locator('#close-outcome').click();
 if(await host.locator('#game').getAttribute('data-phase')==='result')await step();await host.getByRole('button',{name:'เล่นอีกครั้ง ↻',exact:true}).click();await expect(host.locator('#game')).toHaveAttribute('data-phase','lobby');
 for(const p of pages){p.once('dialog',d=>d.accept());await p.locator('#leave').click();}host.once('dialog',d=>d.accept());await host.locator('#leave').click();
 // An actual simultaneous poison/wolf hit resolves DRAW through the real server.
 // Local QA uses only public owner/action/kick APIs; no fixture result injection.
 if(!remote){
  const emit=(s,event,data={})=>new Promise((resolve,reject)=>s.timeout(3000).emit(event,data,(e,r)=>e||!r.ok?reject(e||Error(r.error)):resolve(r)));
  const connect=async()=>{const s=io(backend,{forceNew:true,reconnection:false});s.on('state',v=>s.state=v);sockets.push(s);await new Promise(r=>s.once('connect',r));return s;};
  const owner=await connect(),entry=await emit(owner,'enter',{create:true,name:'DrawHost'});await emit(owner,'participation',{playing:false});await emit(owner,'settings',{mode:'advanced'});const peers=[],tokens=[];
  for(let i=0;i<12;i++){const s=await connect();peers.push(s);tokens.push(await emit(s,'enter',{code:entry.code,name:`Draw${i}`}));await emit(s,'ready');}await emit(owner,'start');const meta=s=>({gameId:s.state.gameId,phaseId:s.state.phaseId});await emit(owner,'host_step',meta(owner));
  const wi=peers.findIndex(s=>s.state.me.role==='witch'),wo=peers.findIndex(s=>s.state.me.role==='werewolf');const witchSeat=peers[wi].state.players.find(p=>p.me).id,wolfSeat=peers[wo].state.players.find(p=>p.me).id;
  await emit(peers[wo],'action',{...meta(peers[wo]),actionId:randomUUID(),target:witchSeat});
  for(let i=0;i<12;i++)if(i!==wi&&i!==wo)await emit(owner,'kick',{target:peers[i].state.players.find(p=>p.me).id});
  const witch=await open();await witch.evaluate(sess=>sessionStorage.setItem('moonfall',JSON.stringify(sess)),{name:`Draw${wi}`,code:entry.code,token:tokens[wi].token});await witch.reload();await expect(witch.locator('#game')).toHaveAttribute('data-phase','night');await emit(owner,'host_step',meta(owner));await expect(witch.locator('#game')).toHaveAttribute('data-phase','witch_decision');await expect(witch.locator('#match-outcome')).toBeHidden();await witch.locator('#witch-poison').click();await witch.locator(`.player[data-seat="${wolfSeat}"]`).click();await expect(witch.locator('#selection')).toContainText('ยาพิษ');await emit(owner,'host_step',meta(owner));await expect(witch.locator('#outcome-word')).toHaveText('DRAW');await expect(witch.locator('#match-outcome')).toHaveAttribute('data-outcome','draw');await witch.screenshot({path:'test-results/minion-outcome/draw-desktop.png'});await witch.locator('#close-outcome').click();
 }
 if(errors.length)throw Error(errors.join('\n'));console.log(`PASS: ${remote?'deployed frontend':'static frontend + separate backend'}; Minion asymmetric knowledge/save/Seer/reconnect; public role-only roster; living Minion LOSE and dead Minion WIN; private team result; close button/background tap/Escape; stays dismissed through phase update/reload; rematch opens next result; Host no false outcome; ${remote?'':'atomic DRAW; '}desktop/mobile; no page/HTTP errors`);
}finally{sockets.forEach(s=>s.disconnect());await browser?.close();server?.kill();if(web)await new Promise(resolve=>web.close(resolve));}
