import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
const emit=(s,event,data={})=>new Promise((resolve,reject)=>s.timeout(3000).emit(event,data,(error,res)=>error?reject(error):resolve(res)));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn){for(let i=0;i<500;i++){if(fn())return;await wait(10);}throw Error('Advanced state timeout');}
const seat=s=>s.state.players.find(p=>p.me).id;
const action=(s,target,ability)=>emit(s,'action',{gameId:s.state.gameId,phaseId:s.state.phaseId,actionId:randomUUID(),target,...(ability?{ability}:{})});
const meta=s=>({gameId:s.state.gameId,phaseId:s.state.phaseId});
test('12 real clients: Advanced settings, Alpha team chat, locked Witch inputs, private save, reconnect and AFK decision deadline', {timeout:20000},async()=>{
 const fixture='advanced-network-test-key-not-real-1234';
 const server=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:'3234',NODE_ENV:'test',GAME_TIMER_SCALE:'0.2',GM_ADMIN_KEY:fixture},stdio:['ignore','pipe','pipe']});const clients=[];
 try{
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',()=>reject(Error('Advanced test server exited')));});
  const connect=async()=>{const s=io('http://127.0.0.1:3234',{forceNew:true,reconnection:false});clients.push(s);s.on('state',v=>s.state=v);await new Promise(resolve=>s.once('connect',resolve));return s;};
  const gm=await connect();const entry=await emit(gm,'enter',{create:true,testRoom:true,name:'GM',gmKey:fixture});assert.ok(entry.ok);
  assert.ok((await emit(gm,'settings',{timing:'quick',mode:'advanced'})).ok);
  for(let i=1;i<12;i++){const s=await connect();assert.ok((await emit(s,'enter',{code:entry.code,name:`p${i}`})).ok);}
  assert.ok((await emit(gm,'gm_role',{role:'witch'})).ok);
  const guest=clients[1];assert.equal((await emit(guest,'settings',{mode:'classic'})).ok,false);assert.equal((await emit(gm,'settings',{mode:'chaos'})).ok,false);
  for(const s of clients)await emit(s,'ready');assert.ok((await emit(gm,'start')).ok);await until(()=>clients.every(s=>s.state.phase==='role_reveal'));
  assert.equal((await emit(gm,'settings',{mode:'classic'})).ok,false);await emit(gm,'gm_step',meta(gm));await until(()=>clients.every(s=>s.state.phase==='night'));
  const alpha=clients.find(s=>s.state.me.role==='alpha_wolf'),wolf=clients.find(s=>s.state.me.role==='werewolf'),seer=clients.find(s=>s.state.me.role==='seer'),victim=clients.find(s=>s.state.me.role==='villager');
  assert.ok((await emit(alpha,'chat',{channel:'wolves',text:'Alpha private plan'})).ok);await until(()=>wolf.state.messages.length===1);assert.equal(victim.state.messages.length,0);
  assert.equal(alpha.state.players.filter(p=>['werewolf','alpha_wolf'].includes(p.role)).length,3);
  await action(alpha,seat(victim));await action(wolf,seat(victim));await action(seer,seat(alpha));const old=meta(alpha);await emit(gm,'gm_step',meta(gm));await until(()=>clients.every(s=>s.state.phase==='witch_decision'));
  assert.equal(gm.state.me.wolfVictim,seat(victim));assert.equal(gm.state.me.potions.save,1);
  for(const s of clients.filter(s=>s!==gm)){assert.equal(s.state.me.wolfVictim,null);assert.equal(s.state.me.potions,null);assert.equal(s.state.me.action,null);assert.equal(s.state.gmState,null);}
  assert.equal((await emit(alpha,'action',{...old,actionId:randomUUID(),target:seat(seer)})).ok,false);assert.equal((await action(wolf,seat(seer))).ok,false);
  assert.ok((await action(gm,seat(victim),'save')).ok);gm.disconnect();
  const restored=await connect();const resume=await emit(restored,'enter',{code:entry.code,name:'GM',token:entry.token});assert.ok(resume.ok);await until(()=>restored.state?.phase==='witch_decision');assert.notEqual(resume.token,entry.token);assert.equal(restored.state.me.action.ability,'save');assert.equal(restored.state.me.wolfVictim,seat(victim));assert.equal(restored.state.me.potions.save,1);
  await emit(restored,'gm_step',meta(restored));await until(()=>seer.state.phase==='announcement');assert.equal(victim.state.me.alive,true);assert.equal(restored.state.me.potions.save,0);assert.equal(seer.state.me.visions[0].wolf,false);
  for(let i=0;i<3;i++)await emit(restored,'gm_step',meta(restored));await until(()=>restored.state.phase==='night');
  await emit(restored,'gm_step',meta(restored));await until(()=>restored.state.phase==='witch_decision');assert.equal(restored.state.me.wolfVictim,null);assert.equal((await action(restored,seat(victim),'save')).ok,false);
  // A missing Witch does not block the deadline, and does not spend a potion.
  restored.disconnect();await until(()=>victim.state.phase==='announcement');assert.equal(victim.state.me.alive,true);
 }finally{for(const s of clients)s.disconnect();server.kill();}
});
