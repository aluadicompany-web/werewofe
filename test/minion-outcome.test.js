import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { room, join, start, advance, act, view, winner, resetToLobby, setParticipation } from '../server/game.js';
import { setGMRole } from '../server/bots.js';
import { ROLES, CLASSIC_PRESETS, getPreset, isWolf, winningTeam } from '../shared/rules.js';
function setup(n=6,outside=false){const r=room('MINION','owner','owner',{isTest:true});if(outside)setParticipation(r,'owner',false);while(r.players.length<n)join(r,`p${r.players.length}`,randomUUID());r.players.forEach(p=>p.ready=true);start(r,'owner');const deck=Object.entries(CLASSIC_PRESETS[n]).flatMap(([id,count])=>Array(count).fill(id));r.players.forEach((p,i)=>p.role=deck[i]);advance(r);return r;}
const role=(r,id)=>r.players.find(p=>p.role===id);
const action=(r,p,t)=>act(r,p.id,{gameId:r.gameId,phaseId:r.phaseId,actionId:randomUUID(),target:t?.seat||t});
const living=(r,roles)=>r.players.forEach(p=>p.alive=roles.includes(p.role));
test('only Classic 6 uses Minion; GM can choose it there; victory allegiance is not wolf capability',()=>{
 assert.deepEqual(CLASSIC_PRESETS[6],{werewolf:1,minion:1,seer:1,doctor:1,villager:2});for(let n=7;n<=12;n++)assert.ok(!CLASSIC_PRESETS[n].minion);for(let n=9;n<=12;n++)assert.ok(!getPreset('advanced',n).minion);
 assert.equal(winningTeam('minion'),'wolf');assert.equal(isWolf('minion'),false);assert.equal(isWolf('alpha_wolf'),true);
 const r=setup();resetToLobby(r);setGMRole(r,'owner','minion');r.players.forEach(p=>p.ready=true);start(r,'owner');assert.equal(r.players.find(p=>p.id==='owner').role,'minion');
});
test('Minion knows wolves one way, no shared attack plan, no private wolf chat projection, no night power',()=>{
 const r=setup(),m=role(r,'minion'),w=role(r,'werewolf'),v=role(r,'villager');action(r,w,v);r.messages.push({channel:'wolves',text:'secret'});
 assert.equal(view(r,m.id).players.find(p=>p.id===w.seat).role,'werewolf');assert.equal(view(r,w.id).players.find(p=>p.id===m.seat).role,null);assert.equal(view(r,v.id).players.find(p=>p.id===m.seat).role,null);assert.deepEqual(view(r,m.id).wolfActions,[]);assert.deepEqual(view(r,m.id).messages,[]);assert.throws(()=>action(r,m,v),/ไม่มีการกระทำ/);
});
test('Minion may be attacked and healed; Seer result is NOT_WOLF while actual wolf result stays WOLF',()=>{
 const r=setup(),m=role(r,'minion'),w=role(r,'werewolf'),s=role(r,'seer');action(r,w,m);action(r,s,m);action(r,role(r,'doctor'),m);advance(r);assert.equal(m.alive,true);assert.equal(s.visions[0].wolf,false);
 while(r.phase!=='night')advance(r);action(r,w,m);action(r,s,w);advance(r);assert.equal(m.alive,false);assert.equal(s.visions[1].wolf,true);assert.equal(m.revealed,true);
});
test('Minion does not count as wolf for parity, and no actual wolf means village wins even with Minion alive',()=>{
 for(const ids of [['werewolf','minion','seer','doctor'],['werewolf','minion','seer']]){const r=setup();living(r,ids);assert.equal(winner(r),false);assert.equal(view(r,role(r,'minion').id).me.outcome,null);}
 const r=setup();living(r,['werewolf','minion']);winner(r);assert.equal(r.winner,'wolf');assert.equal(view(r,role(r,'minion').id).me.outcome,'win');
 const s=setup();living(s,['minion']);winner(s);assert.equal(s.winner,'village');assert.equal(view(s,role(s,'minion').id).me.outcome,'lose');
});
test('personal win/lose follows winning team for both alive and dead players, including dead Minion and Alpha',()=>{
 const r=setup();living(r,['werewolf','seer']);winner(r);assert.equal(r.winner,'wolf');assert.equal(view(r,role(r,'minion').id).me.outcome,'win');assert.equal(view(r,role(r,'seer').id).me.outcome,'lose');assert.equal(view(r,role(r,'doctor').id).me.outcome,'lose');
 const s=setup();role(s,'werewolf').alive=false;winner(s);assert.equal(view(s,role(s,'minion').id).me.outcome,'lose');assert.equal(view(s,role(s,'werewolf').id).me.outcome,'lose');assert.equal(view(s,role(s,'seer').id).me.outcome,'win');
 const a=setup(12);a.players[0].role='alpha_wolf';living(a,['alpha_wolf','seer']);winner(a);assert.equal(view(a,a.players[0].id).me.outcome,'win');
});
test('DRAW is personal draw for all players, outside Host/GM get no fake WIN/LOSE, rematch clears outcome and visions',()=>{
 const r=setup(6,true);r.players.forEach(p=>p.alive=false);winner(r);assert.equal(r.winner,'draw');for(const p of r.players)assert.equal(view(r,p.id).me.outcome,'draw');assert.equal(view(r,'owner').me.outcome,null);
 const gameId=r.gameId;resetToLobby(r);for(const p of r.players){assert.equal(view(r,p.id).me.outcome,null);assert.deepEqual(p.visions,[]);}r.players.forEach(p=>p.ready=true);start(r,'owner');assert.notEqual(r.gameId,gameId);assert.ok(r.players.every(p=>view(r,p.id).me.outcome===null));
});
test('no outcome leaks before complete Hunter reaction and the result changes only after resolution',()=>{
 const r=setup(9),h=role(r,'hunter'),w=role(r,'werewolf');living(r,['hunter']);w.alive=true;action(r,w,h);advance(r);assert.equal(r.phase,'hunter_reaction');assert.equal(r.winner,null);for(const p of r.players)assert.equal(view(r,p.id).me.outcome,null);action(r,h,w);advance(r);assert.equal(r.winner,'draw');for(const p of r.players)assert.equal(view(r,p.id).me.outcome,'draw');
});
