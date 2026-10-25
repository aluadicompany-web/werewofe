import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { io } from 'socket.io-client';
const fixture = 'test-only-gm-key-not-for-production-12345';
const emit = (s, event, data = {}) => new Promise((resolve, reject) => s.timeout(3000).emit(event, data, (e, result) => e ? reject(e) : resolve(result)));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) { for (let n = 0; n < 200; n++) { if (fn()) return; await wait(15); } throw Error('State timeout'); }
test('GM auth, bots, private inspector, stale commands, reconnect, reset and close are room scoped', { timeout: 15000 }, async () => {
  const server = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: '3231', NODE_ENV: 'test', GM_ADMIN_KEY: fixture }, stdio: ['ignore', 'pipe', 'pipe'] });
  const clients = [];
  try {
    await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('error', reject); server.once('exit', () => reject(Error('GM test server exited'))); });
    const connect = async () => { const s = io('http://127.0.0.1:3231', { forceNew: true, reconnection: false }); clients.push(s); await new Promise(resolve => s.once('connect', resolve)); s.on('state', state => s.state = state); return s; };
    const gm = await connect();
    assert.equal((await emit(gm, 'enter', { create: true, testRoom: true, name: 'GM' })).ok, false);
    assert.equal((await emit(gm, 'enter', { create: true, testRoom: true, name: 'GM', gmKey: 'incorrect' })).ok, false);
    const entry = await emit(gm, 'enter', { create: true, testRoom: true, name: 'GM', gmKey: fixture }); assert.equal(entry.ok, true); await until(() => gm.state?.gm);
    assert.equal(gm.state.testRoom, true); assert.equal(gm.state.players.length, 1); assert.ok(!JSON.stringify(gm.state).includes(fixture));
    const guest = await connect(); await emit(guest, 'enter', { code: entry.code, name: 'Guest', gm: true }); await until(() => guest.state?.players.length === 2);
    assert.equal(guest.state.gm, false); assert.equal(guest.state.gmState, null);
    for (const [event, data] of [['gm_bots', { operation: 'fill', total: 12 }], ['gm_speed', { speed: 20 }], ['gm_reset', {}], ['gm_step', {}], ['gm_bots_now', {}]]) assert.equal((await emit(guest, event, data)).ok, false);
    assert.equal((await emit(gm, 'gm_bots', { operation: 'fill', total: 6 })).ok, true); await until(() => guest.state.players.length === 6); assert.equal(gm.state.players.filter(p => p.bot).length, 4);
    await emit(gm, 'settings', { timing: 'quick' }); assert.ok(gm.state.players.filter(p => p.bot).every(p => p.ready)); await emit(gm, 'ready'); await emit(guest, 'ready'); await emit(gm, 'start'); await until(() => gm.state.phase === 'role_reveal');
    await until(() => guest.state.phase === 'role_reveal'); assert.equal(gm.state.gmState.players.filter(p => p.role).length, 6); assert.equal(guest.state.players.filter(p => p.role).length, 1); assert.equal(guest.state.gmState, null);
    const stale = { gameId: gm.state.gameId, phaseId: gm.state.phaseId }; await emit(gm, 'gm_step', stale); await until(() => gm.state.phase === 'night');
    assert.equal((await emit(gm, 'gm_step', stale)).ok, false); assert.equal((await emit(gm, 'gm_bots', { operation: 'clear' })).ok, false);
    assert.equal((await emit(gm, 'gm_bots_now', { gameId: gm.state.gameId, phaseId: gm.state.phaseId })).ok, true);
    assert.ok(gm.state.gmState.players.filter(p => gm.state.players.find(q => q.id === p.id)?.bot).some(p => p.action)); assert.equal(gm.state.phase, 'night');
    const actions = gm.state.gmState.players.map(p => p.action); await emit(gm, 'gm_bots_now', { gameId: gm.state.gameId, phaseId: gm.state.phaseId }); assert.deepEqual(gm.state.gmState.players.map(p => p.action), actions);
    gm.disconnect(); await until(() => guest.state.players.find(p => p.name === 'GM')?.connected === false); assert.equal(guest.state.host, false); assert.equal(guest.state.gm, false);
    const restored = await connect(); const resumed = await emit(restored, 'enter', { code: entry.code, token: entry.token, name: 'GM' }); assert.equal(resumed.ok, true); await until(() => restored.state?.gm); assert.notEqual(resumed.token, entry.token);
    await emit(restored, 'gm_reset'); await until(() => guest.state.phase === 'lobby'); assert.ok(restored.state.players.filter(p => p.bot).every(p => p.ready));
    await emit(restored, 'gm_speed', { speed: 20 }); assert.equal(restored.state.gmState.speed, 20); assert.equal(guest.state.gmState, null);
    let closed = false; guest.on('room_closed', () => closed = true); await emit(restored, 'leave'); await until(() => closed);
    assert.equal((await emit(guest, 'gm_reset')).ok, false); const normal = await emit(guest, 'enter', { create: true, name: 'Normal' }); assert.equal(normal.ok, true); assert.equal(guest.state.gm, false); assert.equal(guest.state.testRoom, false);
    assert.equal((await emit(guest, 'gm_bots', { operation: 'fill', total: 6, gmKey: fixture })).ok, false);
  } finally { for (const client of clients) client.disconnect(); server.kill(); }
});
