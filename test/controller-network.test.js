import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
const emit=(s,event,data={})=>new Promise((resolve,reject)=>s.timeout(3000).emit(event,data,(e,r)=>e?reject(e):resolve(r)));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<300;i++){if(fn())return;await wait(10);}throw Error('Controller state timeout');}
const meta=s=>({gameId:s.state.gameId,phaseId:s.state.phaseId});
test('Host outside six-player match: private state, reconnect, delegation, guarded phase stepping, kick/disconnect/token revocation', {timeout:15000}, async()=>{
 const game=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:'3237',NODE_ENV:'test'},stdio:['ignore','pipe','pipe']});const clients=[];
 try{
  await new Promise((resolve,reject)=>{game.stdout.once('data',resolve);game.once('error',reject);game.once('exit',()=>reject(Error('Controller server exited')));});
  const connect=async()=>{const s=io('http://127.0.0.1:3237',{forceNew:true,reconnection:false});s.on('state',v=>s.state=v);clients.push(s);await new Promise(r=>s.once('connect',r));return s;};
  const owner=await connect(),entry=await emit(owner,'enter',{create:true,name:'Owner'});assert.ok((await emit(owner,'participation',{playing:false})).ok);await until(()=>owner.state.controller);assert.equal(owner.state.players.length,0);
  const players=[],creds=[];for(let i=0;i<6;i++){const s=await connect();players.push(s);creds.push(await emit(s,'enter',{code:entry.code,name:`p${i}`}));}
  assert.equal((await emit(owner,'ready')).ok,false);assert.equal((await emit(players[1],'participation',{playing:false})).ok,false);assert.equal((await emit(players[1],'kick',{target:players[1].state.players[0].id})).ok,false);
  owner.disconnect();await until(()=>players[0].state.host);assert.equal(players[0].state.canManage,true);
  const restored=await connect();const resume=await emit(restored,'enter',{code:entry.code,token:entry.token,name:'Owner'});assert.ok(resume.ok);await until(()=>restored.state?.controller);assert.notEqual(resume.token,entry.token);assert.equal(restored.state.canManage,true);assert.equal(restored.state.players.length,6);assert.equal(restored.state.me.role,null);
  assert.equal((await emit(players[0],'kick',{target:restored.state.controllers[0].id})).ok,false);
  for(const s of players)assert.ok((await emit(s,'ready')).ok);assert.ok((await emit(restored,'start')).ok);await until(()=>restored.state.phase==='role_reveal');assert.equal(restored.state.players.filter(p=>p.role).length,0);assert.equal(restored.state.gmState,null);assert.equal(restored.state.controllers.length,1);
  const stale=meta(restored);assert.equal((await emit(players[1],'host_step',stale)).ok,false);assert.ok((await emit(restored,'host_step',stale)).ok);assert.equal((await emit(restored,'host_step',stale)).ok,false);await until(()=>restored.state.phase==='night');
  assert.equal((await emit(restored,'action',{...meta(restored),actionId:randomUUID(),target:restored.state.players[0].id})).ok,false);
  const kicked=players.find(s=>s.state.me.role==='villager'),idx=players.indexOf(kicked),seat=kicked.state.players.find(p=>p.me).id;let notification=false;kicked.on('kicked',()=>notification=true);
  assert.ok((await emit(restored,'kick',{target:seat})).ok);await until(()=>notification);assert.equal((await emit(kicked,'ready')).ok,false);assert.equal((await emit(kicked,'action',{...meta(restored),actionId:randomUUID(),target:seat})).ok,false);
  const replay=await connect();assert.equal((await emit(replay,'enter',{code:entry.code,token:creds[idx].token,name:'old'})).ok,false);assert.equal(restored.state.players.length,6);assert.equal(restored.state.players.find(p=>p.id===seat).kicked,true);
  await emit(restored,'host_step',meta(restored));await until(()=>restored.state.phase==='announcement');assert.equal(restored.state.timeOfDay,'day');assert.equal(restored.state.me.role,null);
 }finally{clients.forEach(s=>s.disconnect());game.kill();}
});
