import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
const emit = (s,event,data={}) => new Promise((resolve,reject)=>s.timeout(3000).emit(event,data,(e,r)=>e?reject(e):resolve(r)));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check, timeout=5000){const end=Date.now()+timeout;while(!check()){if(Date.now()>end)throw Error('state wait timed out');await delay(15);}}
const action=(s,target,extras={})=>emit(s,'action',{target,gameId:s.state.gameId,phaseId:s.state.phaseId,actionId:randomUUID(),...extras});
function serverAt(port,extra={}){const child=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:String(port),NODE_ENV:'test',GAME_TIMER_SCALE:'0.05',...extra},stdio:['ignore','pipe','pipe']});return {child,ready:new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',()=>reject(Error('server exited')));})};}
test('real 6-player match: roles, deadline changes, private chat, rotated reconnect, win, rematch, host migration', {timeout:20000}, async () => {
 const {child,ready}=serverAt(3101);const sockets=[];
 try{
  await ready;const connect=async()=>{const s=io('http://127.0.0.1:3101',{forceNew:true,reconnection:false});sockets.push(s);await new Promise(r=>s.once('connect',r));s.on('state',state=>s.state=state);return s;};
  const host=await connect();const entry=await emit(host,'enter',{create:true,name:'เจ้าของ'});assert.ok(entry.ok);const creds=[entry];
  for(let i=1;i<6;i++){const s=await connect();creds.push(await emit(s,'enter',{code:entry.code,name:`เพื่อน${i}`}));}
  assert.equal((await emit(host,'start')).ok,false);for(const s of sockets)await emit(s,'ready');assert.equal((await emit(host,'start')).ok,true);
  await until(()=>sockets.every(s=>s.state?.phase==='night'));
  const [wolf,seer,doctor,villager]=['werewolf','seer','doctor','villager'].map(role=>sockets.find(s=>s.state.me.role===role));
  for(const s of sockets){assert.equal(s.state.players.filter(p=>p.role).length,1);for(const c of creds)assert.ok(!JSON.stringify(s.state).includes(c.token));}
  assert.equal((await emit(villager,'chat',{text:'cannot talk at night'})).ok,false);await emit(wolf,'chat',{text:'secret plan',channel:'wolves'});await delay(20);assert.equal(villager.state.messages.length,0);assert.equal(wolf.state.messages.length,1);
  const victim=villager.state.players.find(p=>p.me).id,wolfSeat=wolf.state.players.find(p=>p.me).id;
  await action(wolf,'skip');const packet={target:victim,gameId:wolf.state.gameId,phaseId:wolf.state.phaseId,actionId:randomUUID()};assert.equal((await emit(wolf,'action',packet)).ok,true);assert.equal((await emit(wolf,'action',packet)).ok,true);
  await action(seer,wolfSeat);await action(doctor,victim);await until(()=>host.state.phase==='discussion');assert.ok(host.state.players.every(p=>p.alive));assert.equal(seer.state.me.visions[0].wolf,true);
  assert.equal((await action(villager,wolfSeat,{phaseId:packet.phaseId})).ok,false);
  await emit(villager,'chat',{text:'สวัสดี <script>alert(1)</script>'});await delay(20);assert.ok(host.state.messages.some(m=>m.text.includes('<script>')));
  const old=sockets[5];old.disconnect();await delay(20);const reconnect=await connect();const result=await emit(reconnect,'enter',{code:entry.code,token:creds[5].token,name:'ignored'});assert.equal(result.ok,true);assert.notEqual(result.token,creds[5].token);await until(()=>reconnect.state?.players.length===6);assert.equal(reconnect.state.me.role,old.state.me.role);
  await emit(host,'next',{gameId:host.state.gameId,phaseId:host.state.phaseId});await until(()=>host.state.phase==='voting');for(const s of sockets.filter(s=>s.connected))assert.equal((await action(s,wolfSeat)).ok,true);
  await until(()=>host.state.phase==='ended');assert.equal(host.state.winner,'village');assert.ok(host.state.players.every(p=>p.role));assert.equal((await emit(host,'rematch')).ok,true);await until(()=>host.state.phase==='lobby');assert.ok(host.state.players.every(p=>!p.ready&&!p.role));
  host.disconnect();await until(()=>sockets[1].state.host);const offline=sockets[1].state.players.find(p=>p.name==='เจ้าของ').id;assert.equal((await emit(sockets[1],'remove',{target:offline})).ok,true);
  const bad=await connect();assert.equal((await emit(bad,'enter',{code:entry.code,name:'stranger',token:entry.token})).ok,false);
 }finally{for(const s of sockets)s.disconnect();child.kill();}
});
test('network room capacity 12, 13th denied, rooms isolated', {timeout:10000},async()=>{
 const {child,ready}=serverAt(3103);const sockets=[];
 try{await ready;for(let i=0;i<13;i++){const s=io('http://127.0.0.1:3103',{forceNew:true,reconnection:false});sockets.push(s);await new Promise(r=>s.once('connect',r));s.on('state',v=>s.state=v);}
 const first=await emit(sockets[0],'enter',{create:true,name:'p0'});for(let i=1;i<12;i++)assert.equal((await emit(sockets[i],'enter',{code:first.code,name:`p${i}`})).ok,true);
 const denied=await emit(sockets[12],'enter',{code:first.code,name:'overflow'});assert.equal(denied.ok,false);assert.match(denied.error,/เต็ม/);
 const separate=await emit(sockets[12],'enter',{create:true,name:'separate'});assert.notEqual(separate.code,first.code);await delay(20);assert.equal(sockets[12].state.players.length,1);assert.equal(sockets[0].state.players.length,12);
 }finally{for(const s of sockets)s.disconnect();child.kill();}
});
test('production origin allowlist protects both polling and WebSocket transport', {timeout:10000},async()=>{
 const {child,ready}=serverAt(3104,{NODE_ENV:'production',ALLOWED_ORIGINS:'https://game.example'});const sockets=[];
 try{await ready;for(const transport of ['websocket','polling'])for(const allowed of [true,false]){const s=io('http://127.0.0.1:3104',{forceNew:true,reconnection:false,transports:[transport],extraHeaders:{Origin:allowed?'https://game.example':'https://evil.example'},timeout:1500});sockets.push(s);
  const result=await new Promise(resolve=>{s.once('connect',()=>resolve(true));s.once('connect_error',()=>resolve(false));});assert.equal(result,allowed,`${transport} allowed=${allowed}`);s.disconnect();}
 }finally{for(const s of sockets)s.disconnect();child.kill();}
});
test('AFK and disconnected players do not stop phase deadlines or automatic next night', {timeout:10000},async()=>{
 const {child,ready}=serverAt(3105,{GAME_TIMER_SCALE:'0.02'});const sockets=[];
 try{await ready;for(let i=0;i<6;i++){const s=io('http://127.0.0.1:3105',{forceNew:true,reconnection:false});sockets.push(s);await new Promise(r=>s.once('connect',r));s.on('state',v=>s.state=v);}
 const first=await emit(sockets[0],'enter',{create:true,name:'p0'});for(let i=1;i<6;i++)await emit(sockets[i],'enter',{code:first.code,name:`p${i}`});await emit(sockets[0],'settings',{timing:'quick'});for(const s of sockets)await emit(s,'ready');await emit(sockets[0],'start');
 for(const s of sockets.slice(3))s.disconnect();await until(()=>sockets[0].state.round===2,6000);assert.equal(sockets[0].state.phase,'night');assert.ok(sockets[0].state.players.every(p=>p.alive));assert.equal(sockets[0].state.players.filter(p=>!p.connected).length,3);
 }finally{for(const s of sockets)s.disconnect();child.kill();}
});
