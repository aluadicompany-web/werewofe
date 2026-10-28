import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { room, join, configure, start, act, advance, view, resetToLobby } from './game.js';
import { requireGM, addBot, fillBots, clearBots, runBots, gmProjection, setGMRole } from './bots.js';
import { isWolf } from '../shared/rules.js';
import { createGMGate } from './gm-auth.js';
const authorizeGM = createGMGate(process.env.GM_ADMIN_KEY);
const production = process.env.NODE_ENV === 'production';
const origins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
for (const origin of origins) { const u = new URL(origin); if (u.origin !== origin || !['http:', 'https:'].includes(u.protocol)) throw Error('ALLOWED_ORIGINS must contain exact origins without trailing slashes'); }
if (production && !origins.length) throw Error('Set ALLOWED_ORIGINS to the exact frontend site origin');
function originAllowed(origin) {
  if (!origin) return true; if (origins.includes(origin)) return true;
  try { return !production && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname); } catch { return false; }
}
const timerScale = process.env.NODE_ENV === 'test' ? Number(process.env.GAME_TIMER_SCALE || 1) : 1;
if (!(timerScale > 0 && timerScale <= 1)) throw Error('Invalid test timer scale');
const app = express(), http = createServer(app);
const io = new Server(http, { maxHttpBufferSize: 16384,
  cors: { origin: (origin, callback) => callback(null, originAllowed(origin)), methods: ['GET', 'POST'] },
  allowRequest: (req, callback) => callback(null, originAllowed(req.headers.origin))
});
const rooms = new Map();
app.disable('x-powered-by');
app.use((_, res, next) => { res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer'); next(); });
const local = path => fileURLToPath(new URL(path, import.meta.url));
app.use('/fonts/thai', express.static(local('../node_modules/@fontsource/noto-sans-thai/files')));
app.use('/fonts/latin', express.static(local('../node_modules/@fontsource/space-grotesk/files')));
app.use('/vendor', express.static(local('../node_modules/socket.io/client-dist')));
app.use('/shared', express.static(local('../shared')));
app.use(express.static(local('../public')));
app.get('/health', (_, res) => res.json({ ok: true, mode: 'classic', modes: ['classic', 'advanced'], minPlayers: 6, maxPlayers: 12 }));
const publish = r => { for (const s of io.sockets.sockets.values()) if (s.data.code === r.code) s.emit('state', { ...view(r, s.data.playerId), gmState: gmProjection(r, s.data.playerId) }); };
const nameOf = value => { if (typeof value !== 'string' || !value.trim() || value.trim().length > 20) throw Error('กรอกชื่อ 1–20 ตัวอักษร'); return value.trim(); };
function closeRoom(r) {
  rooms.delete(r.code);
  for (const s of io.sockets.sockets.values()) if (s.data.code === r.code) {
    s.data.code = null; s.data.playerId = null; s.emit('room_closed');
  }
}
function leave(socket) {
  const r = rooms.get(socket.data.code); if (!r) return;
  const p = r.players.find(p => p.id === socket.data.playerId);
  if (r.isTest && p?.id === r.gmId) { closeRoom(r); return; }
  if (r.phase === 'lobby') r.players = r.players.filter(x => x !== p);
  else if (p) { p.connected = false; p.authToken = null; p.previousToken = null; }
  if (r.host === p?.id) r.host = r.players.find(p => p.connected && !p.isBot)?.id || r.players.find(p => !p.isBot)?.id;
  socket.data.code = null; socket.data.playerId = null;
  if (!r.players.length) rooms.delete(r.code); else publish(r);
}
io.on('connection', socket => {
  let rate = { at: Date.now(), count: 0 };
  const handle = (event, fn) => socket.on(event, (data, ack) => {
    try {
      if (Date.now() - rate.at > 10000) rate = { at: Date.now(), count: 0 };
      if (++rate.count > 50) throw Error('ส่งคำสั่งเร็วเกินไป กรุณารอสักครู่');
      if (data != null && (typeof data !== 'object' || Array.isArray(data))) throw Error('รูปแบบคำสั่งไม่ถูกต้อง');
      const result = fn(data ?? {}); if (typeof ack === 'function') ack({ ok: true, ...result });
    } catch (e) { if (typeof ack === 'function') ack({ ok: false, error: e.message }); }
  });
  handle('enter', d => {
    if (socket.data.code) throw Error('คุณอยู่ในห้องแล้ว');
    const name = nameOf(d.name); let r, p;
    if (d.create) {
      if (d.testRoom === true) authorizeGM(d.gmKey, socket.handshake.address);
      if (rooms.size >= 200) throw Error('เซิร์ฟเวอร์เต็ม กรุณาลองใหม่ภายหลัง');
      let code; do { code = randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(code));
      r = room(code, name, randomUUID(), { timerScale, isTest: d.testRoom === true }); rooms.set(code, r); p = r.players[0];
    } else {
      const code = String(d.code || '').trim().toUpperCase(); r = rooms.get(code); if (!r) throw Error('ไม่พบห้องนี้ ตรวจสอบรหัสอีกครั้ง');
      if (d.token) {
        p = r.players.find(p => p.authToken === d.token || (p.previousToken === d.token && p.previousTokenUntil > Date.now()));
        if (!p || p.isBot) throw Error('ที่นั่งเดิมหมดอายุหรือถูกนำออกจากห้อง กรุณาเข้าร่วมใหม่');
        for (const other of io.sockets.sockets.values()) if (other !== socket && other.data.code === code && other.data.playerId === p.id) { other.data.code = null; other.emit('replaced'); other.disconnect(true); }
        p.previousToken = p.authToken; p.previousTokenUntil = Date.now() + 30000; p.authToken = randomUUID(); p.connected = true;
      } else { const id = randomUUID(); join(r, name, id); p = r.players.find(p => p.id === id); }
    }
    if (!r.isTest && !r.players.find(player => player.id === r.host)?.connected) r.host = p.id;
    socket.data.code = r.code; socket.data.playerId = p.id; r.touched = Date.now(); publish(r);
    return { token: p.authToken, code: r.code };
  });
  const current = () => { const r = rooms.get(socket.data.code); if (!r) throw Error('กรุณาเข้าห้องก่อน'); r.touched = Date.now(); return r; };
  handle('remove', d => {
    const r = current(); if (r.host !== socket.data.playerId || r.phase !== 'lobby') throw Error('เฉพาะเจ้าของห้องจัดการที่นั่งในห้องรอได้');
    const target = r.players.find(p => p.seat === d.target); if (!target || target.connected) throw Error('นำออกได้เฉพาะผู้เล่นที่หลุดการเชื่อมต่อ');
    r.players = r.players.filter(p => p !== target); publish(r);
  });
  handle('settings', d => { const r = current(); configure(r, socket.data.playerId, d.timing ?? r.timing, d.mode ?? r.mode); publish(r); });
  handle('ready', () => { const r = current(); if (r.phase !== 'lobby') throw Error('เกมเริ่มแล้ว'); const p = r.players.find(p => p.id === socket.data.playerId); p.ready = !p.ready; publish(r); });
  handle('start', () => { const r = current(); start(r, socket.data.playerId); publish(r); });
  handle('action', d => { const r = current(); act(r, socket.data.playerId, d); publish(r); });
  handle('next', d => { const r = current(); if (d.gameId !== r.gameId || d.phaseId !== r.phaseId || r.host !== socket.data.playerId || r.phase !== 'discussion') throw Error('เจ้าของห้องเปิดโหวตได้เฉพาะช่วงสนทนาปัจจุบัน'); advance(r); publish(r); });
  handle('rematch', () => {
    const r = current(); if (r.host !== socket.data.playerId || r.phase !== 'ended') throw Error('เริ่มใหม่ได้เมื่อจบเกมโดยเจ้าของห้อง');
    resetToLobby(r); publish(r);
  });
  handle('gm_bots', d => {
    const r = current(); requireGM(r, socket.data.playerId);
    if (d.operation === 'add') addBot(r, socket.data.playerId);
    else if (d.operation === 'fill') fillBots(r, socket.data.playerId, d.total);
    else if (d.operation === 'clear') clearBots(r, socket.data.playerId);
    else throw Error('คำสั่งบอทไม่ถูกต้อง');
    publish(r);
  });
  handle('gm_role', d => { const r = current(); setGMRole(r, socket.data.playerId, d.role); publish(r); });
  handle('gm_speed', d => {
    const r = current(); requireGM(r, socket.data.playerId);
    if (r.phase !== 'lobby' || ![1, 5, 20].includes(d.speed)) throw Error('เลือกความเร็ว 1, 5 หรือ 20 เท่าในห้องรอ');
    r.testSpeed = d.speed; r.timerScale = r.baseTimerScale / d.speed; r.players.forEach(p => p.ready = Boolean(p.isBot)); publish(r);
  });
  handle('gm_step', d => {
    const r = current(); requireGM(r, socket.data.playerId);
    if (!r.gameId || d.gameId !== r.gameId || d.phaseId !== r.phaseId || ['lobby', 'ended'].includes(r.phase)) throw Error('ใช้ได้เฉพาะช่วงปัจจุบันที่กำลังเล่น');
    runBots(r, { force: true }); advance(r, d.phaseId); publish(r);
  });
  handle('gm_bots_now', d => {
    const r = current(); requireGM(r, socket.data.playerId);
    if (d.gameId !== r.gameId || d.phaseId !== r.phaseId || !r.deadline) throw Error('ช่วงเกมเปลี่ยนไปแล้ว');
    runBots(r, { force: true }); publish(r);
  });
  handle('gm_reset', () => { const r = current(); requireGM(r, socket.data.playerId); resetToLobby(r); publish(r); });
  handle('chat', d => {
    const r = current(); const p = r.players.find(p => p.id === socket.data.playerId); const text = typeof d.text === 'string' ? d.text.trim() : '';
    if (!text || text.length > 300) throw Error('ข้อความต้องมี 1–300 ตัวอักษร');
    const channel = d.channel === 'wolves' ? 'wolves' : 'village';
    if (!['lobby', 'ended', 'result'].includes(r.phase)) {
      if (!p.alive) throw Error('ผู้ถูกกำจัดอ่านแชตได้ แต่ส่งข้อความไม่ได้');
      const allowed = channel === 'wolves' ? isWolf(p.role) && r.phase === 'night' : ['discussion', 'voting', 'runoff'].includes(r.phase);
      if (!allowed) throw Error('ช่องสนทนานี้ยังใช้ไม่ได้ในช่วงนี้');
    } else if (channel === 'wolves') throw Error('ช่องหมาป่าใช้ได้ตอนกลางคืนเท่านั้น');
    r.messages.push({ id: randomUUID(), name: p.name, text, channel, at: Date.now() }); r.messages = r.messages.slice(-200); publish(r);
  });
  handle('leave', () => { leave(socket); });
  socket.on('disconnect', () => {
    const r = rooms.get(socket.data.code); if (!r) return;
    const p = r.players.find(p => p.id === socket.data.playerId); if (p) { p.connected = false; if (r.phase === 'lobby') p.ready = false; }
    if (!r.isTest && r.host === p?.id) r.host = r.players.find(x => x.connected && !x.isBot)?.id || r.host;
    r.touched = Date.now(); publish(r);
  });
});
setInterval(() => {
  for (const r of rooms.values()) {
    if (r.deadline && Date.now() >= r.deadline) { advance(r, r.phaseId); publish(r); }
    else if (runBots(r)) publish(r);
    if (!r.players.some(p => p.connected && !p.isBot) && Date.now() - (r.touched || 0) > 30 * 60 * 1000) closeRoom(r);
  }
}, 100).unref();
const port = Number(process.env.PORT || 3000); http.listen(port, '0.0.0.0', () => console.log(`Moonfall listening on ${port}`));
