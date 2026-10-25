import { test } from 'node:test';
import assert from 'node:assert/strict';
import { room, start, advance, configure, view, resetToLobby, act } from '../server/game.js';
import { fillBots, addBot, clearBots, runBots, gmProjection, setGMRole } from '../server/bots.js';
import { CLASSIC_PRESETS } from '../shared/rules.js';
import { createGMGate } from '../server/gm-auth.js';
const setup = (n = 6) => { const r = room('GMTEST', 'GM', 'owner', { isTest: true }); fillBots(r, 'owner', n); r.players[0].ready = true; start(r, 'owner'); advance(r); return r; };
test('GM key is required, disabled by default, exact, and failures are limited across connections', () => {
  const fixture = 'unit-test-gm-key-123456789-not-real'; const gate = createGMGate(fixture);
  assert.throws(() => createGMGate(undefined)(fixture, 'peer'), /ยังไม่เปิด/);
  assert.throws(() => createGMGate('short')('short', 'peer'), /ยังไม่เปิด/);
  assert.throws(() => gate(undefined, 'peer', 0), /ไม่ถูกต้อง/); assert.throws(() => gate(fixture + 'x', 'peer', 0), /ไม่ถูกต้อง/);
  gate(fixture, 'peer', 0);
  for (let i = 0; i < 5; i++) assert.throws(() => gate('bad', 'peer', 0), /ไม่ถูกต้อง/);
  assert.throws(() => gate(fixture, 'peer', 0), /รอ 1 นาที/); gate(fixture, 'peer', 60001);
});
test('only room GM can manage bots; normal rooms cannot; enforce total 6–12 and no mid-game changes', () => {
  const normal = room('NORMAL', 'host', 'owner'); assert.throws(() => fillBots(normal, 'owner', 6), /เฉพาะ GM/);
  const r = room('GMTEST', 'GM', 'owner', { isTest: true }); assert.throws(() => fillBots(r, 'guest', 6), /เฉพาะ GM/);
  for (const invalid of [5, 13, 6.5, '6']) assert.throws(() => fillBots(r, 'owner', invalid), /6–12/);
  fillBots(r, 'owner', 12); assert.equal(r.players.length, 12); assert.equal(r.players.filter(p => p.isBot).length, 11);
  assert.ok(r.players.filter(p => p.isBot).every(p => p.ready && !p.authToken)); assert.throws(() => addBot(r, 'owner'), /เต็ม/);
  configure(r, 'owner', 'quick'); assert.ok(r.players.filter(p => p.isBot).every(p => p.ready)); clearBots(r, 'owner'); assert.equal(r.players.length, 1);
  fillBots(r, 'owner', 6); r.players[0].ready = true; start(r, 'owner'); assert.throws(() => clearBots(r, 'owner'), /ห้องรอ/);
});
test('bots submit valid random actions once per phase, respect doctor restriction and runoff', () => {
  const r = setup(12); r.players.forEach((p, i) => p.role = i === 0 ? 'villager' : i < 4 ? 'werewolf' : i === 4 ? 'seer' : i === 5 ? 'doctor' : 'villager');
  const doctor = r.players[5]; doctor.lastDoctor = r.players[6].seat;
  assert.equal(runBots(r, { force: true }), true); const snapshot = { ...r.actions }; assert.equal(runBots(r, { force: true }), false); assert.deepEqual(r.actions, snapshot);
  for (const p of r.players.filter(p => p.isBot && p.role === 'werewolf')) assert.notEqual(r.players.find(t => t.seat === r.actions[p.id]).role, 'werewolf');
  assert.notEqual(r.actions[doctor.id], doctor.lastDoctor); advance(r); advance(r); advance(r); assert.equal(r.phase, 'voting');
  const targets = r.players.filter(p => p.alive).slice(0, 2); const live = r.players.filter(p => p.alive);
  for (const p of live.slice(0, 2)) act(r, p.id, { gameId: r.gameId, phaseId: r.phaseId, actionId: `tie-vote-${p.seat}`, target: targets[live.indexOf(p)].seat });
  advance(r); assert.equal(r.phase, 'runoff'); runBots(r, { force: true }); assert.ok(Object.values(r.votes).every(id => id === 'skip' || r.runoff.includes(id)));
});
test('only GM receives debugger projection; no player tokens are exposed; reset retains bot readiness', () => {
  const r = setup(); const bot = r.players.find(p => p.isBot);
  assert.equal(gmProjection(r, bot.id), null); assert.equal(gmProjection(room('N', 'normal', 'owner'), 'owner'), null);
  const debug = gmProjection(r, 'owner'); assert.equal(debug.players.length, 6); assert.ok(debug.players.every(p => p.role));
  for (const p of debug.players) { assert.ok(!('authToken' in p)); assert.ok(!('previousToken' in p)); assert.notEqual(p.id, 'owner'); }
  const guest = view(r, bot.id); assert.equal(guest.gm, false); assert.equal(guest.testRoom, true);
  resetToLobby(r); assert.equal(r.gmId, 'owner'); assert.equal(r.players.length, 6); assert.ok(r.players.filter(p => p.isBot).every(p => p.ready && !p.role));
});
test('random bot matches for every 6–12 preset finish through real resolver and Hunter reactions', () => {
  for (let n = 6; n <= 12; n++) for (let iteration = 0; iteration < 12; iteration++) {
    const r = setup(n); let steps = 0;
    while (!r.winner && steps++ < 500) { runBots(r, { force: true }); advance(r); }
    assert.ok(r.winner, `bot match stalled at ${n}`);
    const dead = r.events.filter(e => e.kind === 'death').map(e => e.payload.seat); assert.equal(new Set(dead).size, dead.length);
  }
});
test('automatic bot scheduler waits for its turn, then submits before the phase deadline', () => {
  const r = setup(); assert.equal(runBots(r, { now: r.phaseStartedAt }), false); assert.equal(Object.keys(r.actions).length, 0);
  assert.equal(runBots(r, { now: r.deadline - 1 }), true); assert.ok(Object.keys(r.actions).length >= 2); assert.equal(r.phase, 'night');
});

test('GM may choose any role in the current preset without changing deck counts for every 6–12 size', () => {
  for (let n = 6; n <= 12; n++) for (const role of Object.keys(CLASSIC_PRESETS[n])) {
    const r = room('GM', 'Owner', 'owner', { isTest: true }); fillBots(r, 'owner', n);
    r.players[0].ready = true; setGMRole(r, 'owner', role); assert.equal(r.players[0].ready, false);
    r.players[0].ready = true; start(r, 'owner'); assert.equal(r.players[0].role, role);
    const counts = {}; for (const p of r.players) counts[p.role] = (counts[p.role] || 0) + 1;
    assert.deepEqual(counts, CLASSIC_PRESETS[n]); assert.throws(() => setGMRole(r, 'owner', 'villager'), /ห้องรอ/);
    resetToLobby(r); assert.equal(gmProjection(r, 'owner').selectedRole, role);
  }
});
test('GM role selection rejects guests, ordinary rooms, invalid roles and incompatible player counts', () => {
  const normal = room('NORMAL', 'Host', 'owner'); assert.throws(() => setGMRole(normal, 'owner', 'seer'), /เฉพาะ GM/);
  const r = room('GM', 'Owner', 'owner', { isTest: true }); fillBots(r, 'owner', 6);
  assert.throws(() => setGMRole(r, 'guest', 'seer'), /เฉพาะ GM/);
  for (const role of ['hunter', 'elder', 'alpha_wolf', '__proto__', {}, undefined]) assert.throws(() => setGMRole(r, 'owner', role), /ไม่มีในชุด/);
  fillBots(r, 'owner', 12); setGMRole(r, 'owner', 'elder'); clearBots(r, 'owner'); fillBots(r, 'owner', 6); r.players[0].ready = true;
  assert.throws(() => start(r, 'owner'), /บทบาท GM/);
  setGMRole(r, 'owner', 'random'); assert.equal(gmProjection(r, 'owner').selectedRole, null); r.players[0].ready = true; start(r, 'owner');
});
