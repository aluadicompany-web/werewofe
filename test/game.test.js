import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { room, join, configure, start, act, advance, view, winner, wolfTarget } from '../server/game.js';
import { CLASSIC_PRESETS, TIMINGS } from '../shared/rules.js';
function setup(n = 6) { const r = room('TEST', 'player0', '0'); for (let i = 1; i < n; i++) join(r, `player${i}`, String(i)); r.players.forEach(p => p.ready = true); start(r, '0'); advance(r); return r; }
function fixed(n = 6) { const r = setup(n); const deck = Object.entries(CLASSIC_PRESETS[n]).flatMap(([role,count])=>Array(count).fill(role));r.players.forEach((p,i)=>p.role=deck[i]);return r; }
const role = (r, id) => r.players.find(p=>p.role===id);
const action = (r,p,target,extra={}) => { const d={gameId:r.gameId,phaseId:r.phaseId,actionId:randomUUID(),target:target?.seat || target,...extra};act(r,p.id,d);return d; };
const toDiscussion = r => { advance(r); if(r.phase==='announcement')advance(r);assert.equal(r.phase,'discussion'); };
const toVote = r => { toDiscussion(r);advance(r);assert.equal(r.phase,'voting'); };
function execute(r,target) { for(const p of r.players.filter(p=>p.alive))action(r,p,target);advance(r);assert.equal(r.phase,'execution');advance(r); }
test('start requires 6–12, all ready/connected and host; lobby capacity and unique names enforced',()=>{
 const r=room('T','a','0');assert.throws(()=>start(r,'0'),/6–12/);assert.throws(()=>join(r,'A','1'),/ใช้แล้ว/);
 for(let i=1;i<12;i++)join(r,`p${i}`,String(i));assert.throws(()=>join(r,'overflow','12'),/เต็ม/);
 assert.throws(()=>start(r,'1'),/เจ้าของ/);assert.throws(()=>start(r,'0'),/พร้อม/);r.players.forEach(p=>p.ready=true);r.players[1].connected=false;assert.throws(()=>start(r,'0'),/เชื่อมต่อ/);
 r.players[1].connected=true;start(r,'0');assert.equal(r.phase,'role_reveal');assert.throws(()=>join(r,'late','late'),/เริ่ม/);
});
test('every exact Classic preset 6–12, secure assignment, and role maxima',()=>{
 for(let n=6;n<=12;n++){const r=setup(n);const counts={};for(const p of r.players)counts[p.role]=(counts[p.role]||0)+1;assert.deepEqual(counts,CLASSIC_PRESETS[n]);assert.equal(r.players.length,n);assert.equal(new Set(r.players.map(p=>p.seat)).size,n);assert.equal(counts.seer,1);assert.equal(counts.doctor,1);assert.ok((counts.hunter||0)<=1);assert.ok((counts.elder||0)<=1);}
});
test('only Classic allowed; timing presets configurable by host, readiness resets',()=>{
 const r=room('T','a','0');r.players[0].ready=true;configure(r,'0','quick');assert.equal(r.timing,'quick');assert.equal(r.players[0].ready,false);assert.throws(()=>configure(r,'other','quick'),/เจ้าของ/);assert.throws(()=>configure(r,'0','chaos'),/ไม่ถูก/);
 const full=setup();full.phase='lobby';full.mode='advanced';assert.throws(()=>start(full,'0'),/Classic/);
 for(const key of Object.keys(TIMINGS)){const s=room('T','a','0');configure(s,'0',key);assert.equal(s.timing,key);}
});
test('views hide tokens, roles, night actions, audit and wolf chat from unauthorized players',()=>{
 const r=fixed(12);r.messages=[{channel:'wolves',text:'secret'},{channel:'village',text:'public'}];const wolf=role(r,'werewolf'),v=role(r,'villager');action(r,wolf,v);
 const projected=view(r,v.id);assert.equal(projected.players.filter(p=>p.role).length,1);assert.equal(projected.messages.length,1);assert.equal(projected.wolfActions.length,0);assert.ok(!('events'in projected));assert.ok(!('receipts'in projected));assert.ok(projected.players.every(p=>!('authToken'in p)&&!('visions'in p)));
 assert.equal(view(r,wolf.id).players.filter(p=>p.role==='werewolf').length,3);
});
test('actions latest-valid-wins until deadline; identical replay idempotent; stale/mutated packets rejected',()=>{
 const r=fixed(),wolf=role(r,'werewolf'),v=role(r,'villager');const a=action(r,wolf,v);const count=r.events.length;act(r,wolf.id,a);assert.equal(r.events.length,count);
 assert.throws(()=>act(r,wolf.id,{...a,target:'skip'}),/ซ้ำ/);action(r,wolf,'skip');assert.equal(r.actions[wolf.id],'skip');action(r,wolf,v);assert.equal(r.phase,'night');
 assert.throws(()=>action(r,wolf,v,{phaseId:'old'}),/ช่วงก่อน/);assert.throws(()=>action(r,wolf,v,{gameId:'old'}),/เกมเก่า/);r.deadline=Date.now()-1;assert.throws(()=>action(r,wolf,v),/หมดเวลา/);
});
test('rejects wrong phase, dead actors, invalid targets and wolf teammates',()=>{
 const r=fixed(12),w=role(r,'werewolf'),s=role(r,'seer'),v=role(r,'villager');assert.throws(()=>action(r,w,w),/หมาป่า/);assert.throws(()=>action(r,s,s),/ตัวเอง/);assert.throws(()=>action(r,v,w),/ไม่มี/);assert.throws(()=>action(r,w,'missing'),/ยังมีชีวิต/);
 toDiscussion(r);assert.throws(()=>action(r,v,w),/ช่วงนี้/);advance(r);v.alive=false;assert.throws(()=>action(r,v,w),/ถูกกำจัด/);
});
test('wolf tie resolves deterministically by stable seat index; no votes means no kill',()=>{
 const r=fixed(8),ws=r.players.filter(p=>p.role==='werewolf'),vs=r.players.filter(p=>p.role==='villager');action(r,ws[0],vs[1]);action(r,ws[1],vs[0]);assert.equal(wolfTarget(r),vs[0]);advance(r);assert.equal(vs[0].alive,false);assert.equal(vs[1].alive,true);
 const empty=fixed();advance(empty);assert.ok(empty.players.every(p=>p.alive));assert.match(empty.log.at(-1),/ไม่มีผู้เสียชีวิต/);
});
test('doctor self protection, last target even if no attack, skips reset consecutive limit',()=>{
 const r=fixed(),w=role(r,'werewolf'),d=role(r,'doctor');action(r,w,d);action(r,d,d);advance(r);assert.ok(d.alive);assert.equal(d.lastDoctor,d.seat);
 advance(r);advance(r);advance(r);assert.equal(r.phase,'night');assert.throws(()=>action(r,d,d),/สองคืน/);action(r,d,'skip');advance(r);advance(r);advance(r);advance(r);action(r,d,d);
});
test('seer results private and delivered only if alive after complete night including Hunter shot',()=>{
 const r=fixed(),w=role(r,'werewolf'),s=role(r,'seer');action(r,s,w);action(r,w,s);advance(r);assert.equal(s.alive,false);assert.equal(s.visions.length,0);assert.equal(view(r,w.id).me.visions.length,0);
 const second=fixed(9),hunter=role(second,'hunter'),seer=role(second,'seer');action(second,role(second,'werewolf'),hunter);action(second,seer,role(second,'werewolf'));advance(second);assert.equal(seer.visions.length,0);action(second,hunter,seer);advance(second);assert.equal(seer.visions.length,0);
 const third=fixed();action(third,role(third,'seer'),role(third,'werewolf'));advance(third);assert.equal(role(third,'seer').visions[0].wolf,true);
});
test('elder armor only consumed on otherwise lethal wolf attack; protection takes precedence',()=>{
 const r=fixed(12),w=role(r,'werewolf'),e=role(r,'elder'),d=role(r,'doctor');action(r,w,e);action(r,d,e);advance(r);assert.equal(e.armor,1);assert.ok(e.alive);
 advance(r);advance(r);advance(r);action(r,w,e);advance(r);assert.equal(e.armor,0);assert.ok(e.alive);
 advance(r);advance(r);advance(r);action(r,w,e);advance(r);assert.equal(e.alive,false);
 const voted=fixed(12);toVote(voted);execute(voted,role(voted,'elder'));assert.equal(role(voted,'elder').alive,false);
});
test('day abstentions do not defeat unique candidate; all-abstain has no execution',()=>{
 const r=fixed();toVote(r);action(r,r.players[0],r.players[1]);for(const p of r.players.slice(1))action(r,p,'skip');advance(r);assert.equal(r.phase,'execution');assert.equal(r.players[1].alive,false);
 const skipped=fixed();toVote(skipped);for(const p of skipped.players)action(skipped,p,'skip');advance(skipped);assert.equal(skipped.phase,'night');assert.ok(skipped.players.every(p=>p.alive));
});
test('runoff restricts targets to tied candidates; second tie means no execution',()=>{
 const r=fixed();toVote(r);action(r,r.players[0],r.players[1]);action(r,r.players[1],r.players[0]);advance(r);assert.equal(r.phase,'runoff');assert.deepEqual(new Set(r.runoff),new Set([r.players[0].seat,r.players[1].seat]));assert.throws(()=>action(r,r.players[2],r.players[3]),/เฉพาะ/);
 action(r,r.players[2],r.players[0]);action(r,r.players[3],r.players[1]);advance(r);assert.equal(r.phase,'night');assert.ok(r.players.every(p=>p.alive));
});
test('Hunter wolf death queues 15s reaction, timeout no shot, no victory mid-resolution',()=>{
 const r=fixed(9),h=role(r,'hunter');action(r,role(r,'werewolf'),h);advance(r);assert.equal(r.phase,'hunter_reaction');assert.equal(view(r,h.id).me.canReact,true);assert.equal(winner(r),false);const count=r.players.filter(p=>p.alive).length;advance(r);assert.equal(r.players.filter(p=>p.alive).length,count);assert.equal(h.hunterUsed,true);assert.equal(h.revealed,true);
});
test('executed Hunter can shoot last wolf before parity check; reaction packets cannot repeat kills',()=>{
 const r=fixed(9),h=role(r,'hunter'),w=role(r,'werewolf');for(const p of r.players.filter(p=>p.role==='werewolf'&&p!==w))p.alive=false;
 toVote(r);for(const p of r.players.filter(p=>p.alive))action(r,p,h);advance(r);assert.equal(r.phase,'execution');assert.equal(winner(r),false);advance(r);assert.equal(r.phase,'hunter_reaction');
 const data=action(r,h,w);act(r,h.id,data);const phase=r.phaseId;advance(r,phase);const events=r.events.filter(e=>e.kind==='death').length;advance(r,phase);assert.equal(r.events.filter(e=>e.kind==='death').length,events);assert.equal(r.winner,'village');assert.equal(r.phase,'result');advance(r);assert.equal(r.phase,'ended');
});
test('atomic Hunter resolution can produce draw; village and wolf conditions verified',()=>{
 const r=fixed(9),h=role(r,'hunter'),w=role(r,'werewolf');for(const p of r.players)p.alive=p===h||p===w;action(r,w,h);advance(r);assert.equal(r.phase,'hunter_reaction');assert.equal(r.winner,null);action(r,h,w);advance(r);assert.equal(r.winner,'draw');
 const parity=fixed();parity.players.slice(2).forEach(p=>p.alive=false);assert.equal(winner(parity),true);assert.equal(parity.winner,'wolf');
 const village=fixed();role(village,'werewolf').alive=false;assert.equal(winner(village),true);assert.equal(village.winner,'village');assert.ok(view(village,'3').players.every(p=>p.role));
});
test('seeded headless regressions finish games for every preset without duplicate deaths or stalled reactions',()=>{
 let seed=123456;const rand=n=>{seed=(1664525*seed+1013904223)>>>0;return seed%n;};
 for(let n=6;n<=12;n++)for(let run=0;run<12;run++){
  const r=setup(n);let steps=0;
  while(!r.winner&&steps++<500){const participants=r.phase==='hunter_reaction'?r.players.filter(p=>p.id===r.reaction):r.players.filter(p=>p.alive);
   for(const p of participants){const opts=r.players.filter(t=>{ if(!t.alive)return false; if(r.phase==='runoff')return r.runoff.includes(t.seat); if(r.phase!=='night')return true; if(p.role==='werewolf')return t.role!=='werewolf'; if(p.role==='seer')return t!==p; if(p.role==='doctor')return t.seat!==p.lastDoctor; return true; });
    if((r.phase==='night'&&['werewolf','seer','doctor'].includes(p.role))||['voting','runoff','hunter_reaction'].includes(r.phase)){const t=opts.length?opts[rand(opts.length)]:'skip';action(r,p,t);}
   }advance(r);
  }
  assert.ok(r.winner,`stalled preset ${n}`);const deaths=r.events.filter(e=>e.kind==='death').map(e=>e.payload.seat);assert.equal(new Set(deaths).size,deaths.length);
 }
});

test('day vote target is private to voter, updates on change/abstain, and resets for runoff',()=>{
 const r=fixed();toVote(r);const [voter,other,target]=r.players;
 action(r,voter,target);assert.equal(view(r,voter.id).me.action,target.seat);assert.equal(view(r,other.id).me.action,null);
 assert.ok(view(r,other.id).players.every(p=>!('voted'in p)));assert.ok(!('votes'in view(r,other.id)));
 action(r,voter,other);assert.equal(view(r,voter.id).me.action,other.seat);action(r,voter,'skip');assert.equal(view(r,voter.id).me.action,'skip');
 action(r,voter,target);action(r,other,voter);advance(r);assert.equal(r.phase,'runoff');assert.equal(view(r,voter.id).me.action,null);
 action(r,voter,target);assert.equal(view(r,voter.id).me.action,target.seat);assert.equal(view(r,other.id).me.action,null);
});
