import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { room, join, configure, start, advance, act, view, winner, resetToLobby } from '../server/game.js';
import { fillBots, setGMRole, runBots } from '../server/bots.js';
import { ADVANCED_PRESETS, CLASSIC_PRESETS, getPreset, isWolf } from '../shared/rules.js';
function setup(n = 12) {
 const r = room('ADV', 'p0', '0'); for(let i=1;i<n;i++)join(r, `p${i}`, String(i));
 configure(r,'0','quick','advanced'); r.players.forEach(p=>p.ready=true); start(r,'0');
 const deck=Object.entries(ADVANCED_PRESETS[n]).flatMap(([role,count])=>Array(count).fill(role));r.players.forEach((p,i)=>p.role=deck[i]);advance(r);return r;
}
const role=(r,id)=>r.players.find(p=>p.role===id);
const action=(r,p,target,ability)=>{const d={gameId:r.gameId,phaseId:r.phaseId,actionId:randomUUID(),target:target?.seat||target,...(ability?{ability}:{})};act(r,p.id,d);return d;};
function nextNight(r){while(r.phase!=='night'&&!r.winner)advance(r);assert.equal(r.phase,'night');}
function withRoles(roles){const r=setup();r.players.forEach((p,i)=>p.role=roles[i]||'villager');return r;}
test('Advanced presets are exact 9–12 decks; classic unchanged; settings validate atomically and clear human readiness',()=>{
 for(let n=9;n<=12;n++){
  const r=setup(n),counts={};for(const p of r.players)counts[p.role]=(counts[p.role]||0)+1;assert.deepEqual(counts,ADVANCED_PRESETS[n]);assert.deepEqual(view(r,'0').preset,ADVANCED_PRESETS[n]);
  assert.equal(r.events.find(e=>e.kind==='match_started').payload.preset,`advanced-${n}`);
  assert.equal(r.players.filter(p=>isWolf(p.role)).length,n<11?2:3);
 }
 for(let n=6;n<=8;n++){const r=room('A','h','0');for(let i=1;i<n;i++)join(r,`p${i}`,String(i));configure(r,'0','quick','advanced');r.players.forEach(p=>p.ready=true);assert.throws(()=>start(r,'0'),/9–12/);}
 const r=setup(9);resetToLobby(r);r.players.forEach(p=>p.ready=true);configure(r,'0','standard','classic');assert.ok(r.players.every(p=>!p.ready));assert.equal(r.mode,'classic');assert.deepEqual(view(r,'0').preset,CLASSIC_PRESETS[9]);
 for(const mode of ['chaos','__proto__',null,{}])assert.throws(()=>configure(r,'0','quick',mode),/ยังไม่เปิด/);
 assert.equal(r.timing,'standard');assert.equal(r.mode,'classic');assert.throws(()=>configure(r,'1','quick','advanced'),/เจ้าของ/);
 assert.equal(getPreset('advanced',6),null);
});
test('Guard cannot protect self; intercepts wolf attack before Elder armor, dies once, Doctor prevents sacrifice',()=>{
 const r=setup(9),g=role(r,'guard'),w=role(r,'werewolf'),v=role(r,'villager');
 assert.throws(()=>action(r,g,g),/ตัวเอง/);action(r,w,v);action(r,g,v);advance(r);assert.ok(v.alive);assert.equal(g.alive,false);assert.equal(r.events.filter(e=>e.kind==='death').length,1);
 const s=setup(9),guard=role(s,'guard'),target=role(s,'villager');action(s,role(s,'werewolf'),target);action(s,guard,target);action(s,role(s,'doctor'),target);advance(s);assert.ok(s.players.every(p=>p.alive));
 const t=withRoles(['werewolf','werewolf','guard','elder','witch','seer']);const elder=role(t,'elder');action(t,role(t,'werewolf'),elder);action(t,role(t,'guard'),elder);advance(t);advance(t);assert.ok(elder.alive);assert.equal(elder.armor,1);assert.equal(role(t,'guard').alive,false);
});
test('Witch window locks main inputs; victim and potions private; only Witch may choose one potion; latest valid wins, replay is idempotent',()=>{
 const r=setup(12),w=role(r,'werewolf'),witch=role(r,'witch'),v=role(r,'villager'),s=role(r,'seer');action(r,w,v);action(r,s,w);const oldPhase=r.phaseId;advance(r);
 assert.equal(r.phase,'witch_decision');assert.equal(winner(r),false);assert.equal(v.alive,true);assert.equal(s.visions.length,0);
 assert.equal(view(r,witch.id).me.wolfVictim,v.seat);assert.deepEqual(view(r,witch.id).me.potions,{save:1,poison:1});
 for(const p of r.players.filter(p=>p!==witch)){const projection=view(r,p.id);assert.equal(projection.me.wolfVictim,null);assert.equal(projection.me.potions,null);assert.equal(projection.me.action,null);assert.ok(!('nightPlan' in projection));}
 assert.throws(()=>action(r,w,v),/เฉพาะแม่มด/);assert.throws(()=>act(r,w.id,{gameId:r.gameId,phaseId:oldPhase,actionId:randomUUID(),target:s.seat}),/ช่วงก่อน/);
 assert.throws(()=>action(r,witch,s,'save'),/เฉพาะเหยื่อ/);assert.throws(()=>action(r,witch,v,'both'),/หนึ่งชนิด/);assert.throws(()=>action(r,witch,'skip','save'),/ข้าม/);
 action(r,witch,w,'poison');const d=action(r,witch,v,'save');act(r,witch.id,d);assert.deepEqual(witch.potions,{save:1,poison:1});assert.throws(()=>act(r,witch.id,{...d,ability:'poison'}),/ซ้ำ/);
 const phase=r.phaseId;advance(r,phase);advance(r,phase);assert.ok(v.alive);assert.ok(w.alive);assert.deepEqual(witch.potions,{save:0,poison:1});assert.equal(s.visions.length,1);assert.equal(r.events.filter(e=>e.kind==='witch_potion_used').length,1);
 nextNight(r);action(r,w,v);advance(r);assert.throws(()=>action(r,witch,v,'save'),/หมดแล้ว/);action(r,witch,'skip','skip');advance(r);assert.equal(v.alive,false);assert.equal(witch.potions.poison,1);
});
test('Witch can save herself; no victim means no save; AFK/skip consume nothing; poison can target self and bypass Doctor, Guard and Elder',()=>{
 const self=setup(10),witch=role(self,'witch');action(self,role(self,'werewolf'),witch);advance(self);action(self,witch,witch,'save');advance(self);assert.ok(witch.alive);
 const none=setup(10);advance(none);assert.equal(view(none,role(none,'witch').id).me.wolfVictim,null);assert.throws(()=>action(none,role(none,'witch'),role(none,'villager'),'save'),/เฉพาะเหยื่อ/);advance(none);assert.deepEqual(role(none,'witch').potions,{save:1,poison:1});
 const r=withRoles(['werewolf','werewolf','witch','doctor','guard','elder','seer']);const e=role(r,'elder');action(r,role(r,'doctor'),e);action(r,role(r,'guard'),e);action(r,role(r,'werewolf'),e);advance(r);action(r,role(r,'witch'),e,'poison');advance(r);assert.equal(e.alive,false);assert.equal(e.armor,1);assert.ok(role(r,'guard').alive);assert.equal(r.events.filter(e=>e.kind==='death').length,1);
 const poisonSelf=setup(10),witch2=role(poisonSelf,'witch');advance(poisonSelf);action(poisonSelf,witch2,witch2,'poison');advance(poisonSelf);assert.equal(witch2.alive,false);assert.equal(witch2.potions.poison,0);
});
test('simultaneous wolf/poison deaths deduplicate; poisoned Hunter never fires; wolf-killed Hunter still reacts and Seer delivery waits',()=>{
 const r=setup(),h=role(r,'hunter'),w=role(r,'werewolf');action(r,w,h);advance(r);action(r,role(r,'witch'),h,'poison');advance(r);assert.notEqual(r.phase,'hunter_reaction');assert.equal(r.events.filter(e=>e.kind==='death').length,1);assert.equal(h.hunterUsed,false);
 const s=setup(),hunter=role(s,'hunter'),seer=role(s,'seer');action(s,role(s,'werewolf'),hunter);action(s,seer,role(s,'alpha_wolf'));advance(s);advance(s);assert.equal(s.phase,'hunter_reaction');assert.equal(seer.visions.length,0);action(s,hunter,seer);advance(s);assert.equal(seer.visions.length,0);
 const t=withRoles(['werewolf','werewolf','witch','guard','seer']);const g=role(t,'guard'),v=role(t,'villager');action(t,role(t,'werewolf'),v);action(t,g,v);advance(t);action(t,role(t,'witch'),g,'poison');advance(t);assert.ok(v.alive);assert.equal(g.alive,false);assert.equal(t.events.filter(e=>e.kind==='death').length,1);
});
test('Alpha is a wolf for allies, attack votes and parity, but NOT_WOLF for Seer; no ally attacks or potion leakage',()=>{
 const r=setup(11),a=role(r,'alpha_wolf'),w=role(r,'werewolf'),s=role(r,'seer'),v=role(r,'villager');
 for(const wolf of [a,w]){const projection=view(r,wolf.id);assert.equal(projection.players.filter(p=>isWolf(p.role)).length,3);assert.equal(projection.wolfActions.length,3);assert.throws(()=>action(r,wolf,a),/หมาป่า/);}
 action(r,a,v);action(r,s,a);advance(r);assert.equal(v.alive,false);assert.equal(s.visions[0].wolf,false);
 assert.equal(view(r,v.id).players.find(p=>p.id===a.seat).role,null);
 nextNight(r);action(r,s,w);advance(r);assert.equal(s.visions[1].wolf,true);
 const parity=setup(11);parity.players.forEach(p=>p.alive=p.role==='alpha_wolf'||p===role(parity,'seer'));assert.equal(winner(parity),true);assert.equal(parity.winner,'wolf');
});
test('night victory waits for poison and Hunter; simultaneous elimination draws; spent potion rejects next-night use and resets on rematch',()=>{
 const r=setup(10),w=role(r,'werewolf'),witch=role(r,'witch');r.players.forEach(p=>p.alive=p===w||p===witch);action(r,w,witch);advance(r);assert.equal(winner(r),false);action(r,witch,w,'poison');advance(r);assert.equal(r.winner,'draw');
 const s=setup(10),witch2=role(s,'witch'),v=role(s,'villager');advance(s);action(s,witch2,v,'poison');advance(s);nextNight(s);advance(s);assert.throws(()=>action(s,witch2,role(s,'werewolf'),'poison'),/หมดแล้ว/);resetToLobby(s);assert.equal(s.nightPlan,null);assert.deepEqual(witch2.potions,{save:1,poison:1});assert.equal(s.mode,'advanced');
});
test('Advanced GM role selection and bot simulations cover every deck, potion action and completed match without duplicate deaths',()=>{
 for(let n=9;n<=12;n++)for(const selected of Object.keys(ADVANCED_PRESETS[n])){
  const r=room('GM','GM','owner',{isTest:true});fillBots(r,'owner',n);configure(r,'owner','quick','advanced');setGMRole(r,'owner',selected);r.players[0].ready=true;start(r,'owner');assert.equal(r.players[0].role,selected);const counts={};r.players.forEach(p=>counts[p.role]=(counts[p.role]||0)+1);assert.deepEqual(counts,ADVANCED_PRESETS[n]);
 }
 for(let n=9;n<=12;n++)for(let run=0;run<30;run++){
  const r=room('GM','GM','owner',{isTest:true});fillBots(r,'owner',n);configure(r,'owner','quick','advanced');setGMRole(r,'owner','villager');r.players[0].ready=true;start(r,'owner');let steps=0;
  while(!r.winner&&steps++<500){runBots(r,{force:true});advance(r);}
  assert.ok(r.winner,`stalled Advanced ${n}`);const dead=r.events.filter(e=>e.kind==='death').map(e=>e.payload.seat);assert.equal(new Set(dead).size,dead.length);assert.ok(r.players.every(p=>p.potions.save>=0&&p.potions.poison>=0));
 }
});
