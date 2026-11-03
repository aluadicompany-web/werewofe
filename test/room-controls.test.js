import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { room, join, start, advance, configure, view, act, resetToLobby, setParticipation, kick, members, canManage } from '../server/game.js';
import { fillBots, runBots, setGMRole } from '../server/bots.js';
import { CLASSIC_PRESETS, ADVANCED_PRESETS } from '../shared/rules.js';
const action=(r,p,target,ability)=>act(r,p.id,{gameId:r.gameId,phaseId:r.phaseId,actionId:randomUUID(),target:target?.seat||target,...(ability?{ability}:{})});
function setup(n=6,mode='classic'){
 const r=room('CONTROL','Host','owner');setParticipation(r,'owner',false);for(let i=0;i<n;i++)join(r,`p${i}`,`p${i}`);configure(r,'owner','quick',mode);r.players.forEach(p=>p.ready=true);start(r,'owner');
 const preset=mode==='classic'?CLASSIC_PRESETS[n]:ADVANCED_PRESETS[n];r.players.forEach(p=>p.authToken=randomUUID());const deck=Object.entries(preset).flatMap(([id,count])=>Array(count).fill(id));r.players.forEach((p,i)=>p.role=deck[i]);advance(r);return r;
}
const role=(r,id)=>r.players.find(p=>p.role===id);
test('nonplaying Host is excluded from 6–12 deck, ready, targets and victory, keeps identity on lobby toggle',()=>{
 const r=setup();assert.equal(r.players.length,6);assert.equal(members(r).length,7);assert.equal(r.controllers.length,1);const projection=view(r,'owner');assert.equal(projection.controller,true);assert.equal(projection.me.role,null);assert.equal(projection.me.alive,false);assert.equal(projection.canManage,true);assert.equal(projection.players.filter(p=>p.role).length,0);assert.equal(projection.wolfActions.length,0);
 assert.throws(()=>action(r,r.controllers[0],r.players[0]),/ถูกกำจัด/);assert.throws(()=>setParticipation(r,'owner',true),/ห้องรอ/);assert.throws(()=>setParticipation(r,'p0',false),/เจ้าของ/);
 resetToLobby(r);const seat=r.controllers[0].seat;setParticipation(r,'owner',true);assert.equal(r.players.length,7);assert.equal(r.players.find(p=>p.id==='owner').seat,seat);assert.equal(r.controllers.length,0);assert.ok(r.players.every(p=>!p.ready));setParticipation(r,'owner',false);assert.equal(r.players.length,6);
});
test('twelve actual players plus Host, full-seat toggle is rejected atomically, ordinary guest cannot manage',()=>{
 const r=setup(12);resetToLobby(r);assert.throws(()=>join(r,'overflow','overflow'),/เต็ม/);assert.throws(()=>setParticipation(r,'owner',true),/เต็ม/);assert.equal(r.controllers.length,1);assert.equal(r.players.length,12);assert.equal(canManage(r,'p0'),false);assert.throws(()=>kick(r,'p0',r.players[1].seat),/เฉพาะ/);assert.throws(()=>kick(r,'owner','missing'),/ไม่สามารถ/);
 kick(r,'owner',r.players[0].seat);setParticipation(r,'owner',true);assert.equal(r.players.length,12);assert.equal(new Set(r.players.map(p=>p.seatIndex)).size,12);
});
test('GM can control outside game, fill twelve bots, no forced role or vote, complete match and rematch',()=>{
 const r=room('GM','GM','gm',{isTest:true});setGMRole(r,'gm','seer');setParticipation(r,'gm',false);assert.equal(r.gmRole,null);assert.throws(()=>setGMRole(r,'gm','seer'),/กลับเป็นผู้เล่น/);fillBots(r,'gm',12);start(r,'gm');assert.equal(r.players.length,12);assert.ok(r.players.every(p=>p.isBot));let steps=0;while(!r.winner&&steps++<500){runBots(r,{force:true});advance(r);}assert.ok(r.winner);resetToLobby(r);assert.equal(r.players.length,12);assert.equal(view(r,'gm').controller,true);assert.ok(r.players.every(p=>p.ready));
});
test('kick invalidates seat tokens and pending targets, retains match deck, cannot grant Hunter revenge, cleans rematch',()=>{
 const r=setup(9),hunter=role(r,'hunter'),wolf=role(r,'werewolf'),seer=role(r,'seer');action(r,wolf,hunter);action(r,seer,hunter);const token=hunter.authToken;kick(r,'owner',hunter.seat);assert.equal(hunter.authToken,null);assert.equal(hunter.previousToken,null);assert.equal(hunter.alive,false);assert.equal(hunter.kicked,true);assert.equal(r.players.length,9);assert.equal(r.actions[wolf.id],undefined);assert.equal(r.actions[seer.id],undefined);assert.equal(hunter.hunterUsed,false);assert.throws(()=>action(r,hunter,wolf),/ถูกกำจัด/);advance(r);assert.notEqual(r.phase,'hunter_reaction');assert.ok(!JSON.stringify(view(r,'owner')).includes(token));resetToLobby(r);assert.equal(r.players.length,8);assert.ok(!r.players.includes(hunter));
 const s=setup(9),h=role(s,'hunter');advance(s);advance(s);advance(s);action(s,s.players[0],h);advance(s);assert.equal(s.phase,'execution');kick(s,'owner',h.seat);advance(s);assert.notEqual(s.phase,'hunter_reaction');assert.equal(h.hunterUsed,false);
});
test('kicking the active Hunter closes reaction without shot; night/day colors track reaction origin',()=>{
 const r=setup(9),h=role(r,'hunter'),w=role(r,'werewolf');action(r,w,h);advance(r);assert.equal(r.phase,'hunter_reaction');assert.equal(view(r,'owner').timeOfDay,'night');action(r,h,w);kick(r,'owner',h.seat);assert.equal(r.reaction,null);assert.ok(w.alive);assert.equal(view(r,'owner').timeOfDay,'day');
 const s=setup(9),hunter=role(s,'hunter');advance(s);advance(s);advance(s);action(s,s.players[0],hunter);advance(s);advance(s);assert.equal(s.phase,'hunter_reaction');assert.equal(view(s,'owner').timeOfDay,'day');
});
test('kick during locked Witch window cancels affected potion, preserves inventory and resolution safety',()=>{
 const r=setup(12,'advanced'),witch=role(r,'witch'),wolf=role(r,'werewolf'),target=role(r,'villager');action(r,wolf,target);advance(r);assert.equal(r.phase,'witch_decision');action(r,witch,target,'save');kick(r,'owner',target.seat);assert.equal(view(r,witch.id).me.action,null);assert.equal(view(r,witch.id).me.wolfVictim,null);advance(r);assert.equal(witch.potions.save,1);assert.equal(r.pending,null);
 const s=setup(12,'advanced'),witch2=role(s,'witch');advance(s);action(s,witch2,role(s,'werewolf'),'poison');kick(s,'owner',witch2.seat);advance(s);assert.equal(witch2.potions.poison,1);assert.equal(s.pending,null);
});
test('owner and delegated Host rights are checked server side; last wolf kicked by day finishes after complete resolution',()=>{
 const r=setup();advance(r);advance(r);assert.equal(r.phase,'discussion');kick(r,'owner',role(r,'werewolf').seat);assert.equal(r.winner,'village');assert.equal(r.phase,'result');
 const s=room('OWNER','owner','owner');join(s,'guest','guest');s.host='guest';assert.equal(canManage(s,'owner'),true);assert.equal(canManage(s,'guest'),true);assert.throws(()=>kick(s,'guest',s.players[0].seat),/ไม่สามารถ/);s.players[0].connected=false;kick(s,'guest',s.players[0].seat);assert.equal(s.owner,'guest');
});
test('wolf target projection is team-only, changes latest target/skip, and clears at dawn',()=>{
 const r=setup(11,'advanced'),alpha=role(r,'alpha_wolf'),wolf=role(r,'werewolf'),seer=role(r,'seer'),v=role(r,'villager');action(r,alpha,v);assert.ok(view(r,wolf.id).wolfActions.some(a=>a.target===v.seat));assert.deepEqual(view(r,seer.id).wolfActions,[]);assert.deepEqual(view(r,'owner').wolfActions,[]);action(r,alpha,seer);assert.ok(!view(r,wolf.id).wolfActions.some(a=>a.target===v.seat));action(r,alpha,'skip');assert.ok(!view(r,wolf.id).wolfActions.some(a=>a.target===seer.seat));advance(r);assert.deepEqual(view(r,wolf.id).wolfActions,[]);
});

test('room controls bound extra moderator seats without changing the twelve-player limit',()=>{
 const r=room('BOUND','Owner','owner');setParticipation(r,'owner',false);join(r,'one','one');join(r,'two','two');r.host='one';setParticipation(r,'one',false);r.host='two';assert.throws(()=>setParticipation(r,'two',false),/ครบ 2 คน/);assert.equal(r.controllers.length,2);assert.equal(r.players.length,1);
});
