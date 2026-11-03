import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
test('six-player Minion realtime privacy, capability, reconnect and losing outcome with actual wolf eliminated', {timeout:15000},async()=>{
const child=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:'3251',NODE_ENV:'test'},stdio:['ignore','pipe','pipe']});const clients=[];
const emit=(s,event,data={})=>new Promise((resolve,reject)=>s.timeout(3000).emit(event,data,(err,res)=>err?reject(err):resolve(res)));
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Prototype state timeout');}
const seat=s=>s.state.players.find(p=>p.me).id;
const action=(s,target)=>emit(s,'action',{gameId:s.state.gameId,phaseId:s.state.phaseId,actionId:randomUUID(),target});
try{
 await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',()=>reject(Error('Prototype network server exited')));});
 const connect=async()=>{const s=io('http://127.0.0.1:3251',{forceNew:true,reconnection:false});s.on('state',v=>s.state=v);clients.push(s);await new Promise(r=>s.once('connect',r));return s;};
 const owner=await connect(),entry=await emit(owner,'enter',{create:true,name:'Host'});await emit(owner,'participation',{playing:false});const players=[],creds=[];
 for(let i=0;i<6;i++){const s=await connect();players.push(s);creds.push(await emit(s,'enter',{code:entry.code,name:`P${i}`}));await emit(s,'ready');}await emit(owner,'start');
 const step=()=>emit(owner,'host_step',{gameId:owner.state.gameId,phaseId:owner.state.phaseId});await step();await until(()=>players.every(s=>s.state.phase==='night'));
 let minion=players.find(s=>s.state.me.role==='minion');const wolf=players.find(s=>s.state.me.role==='werewolf'),seer=players.find(s=>s.state.me.role==='seer'),doctor=players.find(s=>s.state.me.role==='doctor'),villager=players.find(s=>s.state.me.role==='villager');
 assert.equal(minion.state.players.find(p=>p.id===seat(wolf)).role,'werewolf');assert.equal(wolf.state.players.find(p=>p.id===seat(minion)).role,null);assert.equal(villager.state.players.find(p=>p.id===seat(minion)).role,null);assert.equal(minion.state.wolfActions.length,0);
 assert.equal((await emit(minion,'chat',{channel:'wolves',text:'should be rejected'})).ok,false);assert.equal((await action(minion,seat(villager))).ok,false);assert.ok((await action(wolf,seat(minion))).ok);
 assert.equal(minion.state.wolfActions.length,0);assert.ok((await emit(wolf,'chat',{channel:'wolves',text:'wolf secret target'})).ok);assert.equal(minion.state.messages.length,0);
 const index=players.indexOf(minion);minion.disconnect();const restored=await connect();const resumed=await emit(restored,'enter',{code:entry.code,name:'Minion resume',token:creds[index].token});assert.ok(resumed.ok);assert.notEqual(resumed.token,creds[index].token);await until(()=>restored.state?.me.role==='minion');minion=restored;players[index]=minion;assert.equal(minion.state.players.find(p=>p.id===seat(wolf)).role,'werewolf');assert.equal(wolf.state.players.find(p=>p.id===seat(minion)).role,null);
 await action(doctor,seat(minion));await action(seer,seat(minion));await step();await until(()=>seer.state.phase==='announcement');assert.equal(minion.state.me.alive,true);assert.equal(seer.state.me.visions[0].wolf,false);assert.equal(wolf.state.me.visions.length,0);await step();await step();
 for(const s of players)await action(s,s===wolf||s===minion?seat(villager):seat(wolf));await step();await step();await until(()=>owner.state.phase==='result');assert.equal(owner.state.winner,'village');assert.equal(minion.state.me.alive,true);assert.equal(wolf.state.me.alive,false);
 assert.equal(minion.state.me.outcome,'lose');assert.equal(wolf.state.me.outcome,'lose');assert.equal(seer.state.me.outcome,'win');assert.equal(owner.state.me.outcome,null);
}finally{clients.forEach(s=>s.disconnect());child.kill();}

});
