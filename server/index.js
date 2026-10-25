import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { room, join, configure, start, act, advance, view } from './game.js';
const production = process.env.NODE_ENV === 'production';
const origins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
for (const origin of origins) { const u = new URL(origin); if (u.origin !== origin || !['http:', 'https:'].includes(u.protocol)) throw Error('ALLOWED_ORIGINS must contain exact origins without trailing slashes'); }
if (production && !origins.length) throw Error('Set ALLOWED_ORIGINS to the exact Netlify site origin');
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
app.get('/health', (_, res) => res.json({ ok: true, mode: 'classic', minPlayers: 6, maxPlayers: 12 }));
const publish = r => { for (const s of io.sockets.sockets.values()) if (s.data.code === r.code) s.emit('state', view(r, s.data.playerId)); };
const nameOf = value => { if (typeof value !== 'string' || !value.trim() || value.trim().length > 20) throw Error('กรอกชื่อ 1–20 ตัวอักษร'); return value.trim(); };
function leave(socket) {
  const r = rooms.get(socket.data.code); if (!r) return;
  const p = r.players.find(p => p.id === socket.data.playerId);
  if (r.phase === 'lobby') r.players = r.players.filter(x => x !== p);
  else if (p) { p.connected = false; p.authToken = null; p.previousToken = null; }
  if (r.host === p?.id) r.host = r.players.find(p => p.connected)?.id || r.players[0]?.id;
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
      if (rooms.size >= 200) throw Error('เซิร์ฟเวอร์เต็ม กรุณาลองใหม่ภายหลัง');
      let code; do { code = randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(code));
      r = room(code, name, randomUUID(), { timerScale }); rooms.set(code, r); p = r.players[0];
    } else {
      const code = String(d.code || '').trim().toUpperCase(); r = rooms.get(code); if (!r) throw Error('ไม่พบห้องนี้ ตรวจสอบรหัสอีกครั้ง');
      if (d.token) {
        p = r.players.find(p => p.authToken === d.token || (p.previousToken === d.token && p.previousTokenUntil > Date.now()));
        if (!p) throw Error('ที่นั่งเดิมหมดอายุหรือถูกนำออกจากห้อง กรุณาเข้าร่วมใหม่');
        for (const other of io.sockets.sockets.values()) if (other !== socket && other.data.code === code && other.data.playerId === p.id) { other.data.code = null; other.emit('replaced'); other.disconnect(true); }
        p.previousToken = p.authToken; p.previousTokenUntil = Date.now() + 30000; p.authToken = randomUUID(); p.connected = true;
      } else { const id = randomUUID(); join(r, name, id); p = r.players.find(p => p.id === id); }
    }
    if (!r.players.find(player => player.id === r.host)?.connected) r.host = p.id;
    socket.data.code = r.code; socket.data.playerId = p.id; r.touched = Date.now(); publish(r);
    return { token: p.authToken, code: r.code };
  });
  const current = () => { const r = rooms.get(socket.data.code); if (!r) throw Error('กรุณาเข้าห้องก่อน'); r.touched = Date.now(); return r; };
  handle('remove', d => {
    const r = current(); if (r.host !== socket.data.playerId || r.phase !== 'lobby') throw Error('เฉพาะเจ้าของห้องจัดการที่นั่งในห้องรอได้');
    const target = r.players.find(p => p.seat === d.target); if (!target || target.connected) throw Error('นำออกได้เฉพาะผู้เล่นที่หลุดการเชื่อมต่อ');
    r.players = r.players.filter(p => p !== target); publish(r);
  });
  handle('settings', d => { const r = current(); configure(r, socket.data.playerId, d.timing); publish(r); });
  handle('ready', () => { const r = current(); if (r.phase !== 'lobby') throw Error('เกมเริ่มแล้ว'); const p = r.players.find(p => p.id === socket.data.playerId); p.ready = !p.ready; publish(r); });
  handle('start', () => { const r = current(); start(r, socket.data.playerId); publish(r); });
  handle('action', d => { const r = current(); act(r, socket.data.playerId, d); publish(r); });
  handle('next', d => { const r = current(); if (d.gameId !== r.gameId || d.phaseId !== r.phaseId || r.host !== socket.data.playerId || r.phase !== 'discussion') throw Error('เจ้าของห้องเปิดโหวตได้เฉพาะช่วงสนทนาปัจจุบัน'); advance(r); publish(r); });
  handle('rematch', () => {
    const r = current(); if (r.host !== socket.data.playerId || r.phase !== 'ended') throw Error('เริ่มใหม่ได้เมื่อจบเกมโดยเจ้าของห้อง');
    r.players = r.players.filter(p => p.connected); r.phase = 'lobby'; r.phaseId = randomUUID(); r.gameId = null; r.winner = null; r.deadline = null; r.round = 0;
    r.actions = {}; r.votes = {}; r.receipts = {}; r.messages = []; r.log = []; r.events = []; r.pending = null; r.reaction = null; r.runoff = [];
    r.players.forEach(p => { p.ready = false; p.role = null; p.alive = true; p.visions = []; p.lastDoctor = null; p.revealed = false; }); publish(r);
  });
  handle('chat', d => {
    const r = current(); const p = r.players.find(p => p.id === socket.data.playerId); const text = typeof d.text === 'string' ? d.text.trim() : '';
    if (!text || text.length > 300) throw Error('ข้อความต้องมี 1–300 ตัวอักษร');
    const channel = d.channel === 'wolves' ? 'wolves' : 'village';
    if (!['lobby', 'ended', 'result'].includes(r.phase)) {
      if (!p.alive) throw Error('ผู้ถูกกำจัดอ่านแชตได้ แต่ส่งข้อความไม่ได้');
      const allowed = channel === 'wolves' ? p.role === 'werewolf' && r.phase === 'night' : ['discussion', 'voting', 'runoff'].includes(r.phase);
      if (!allowed) throw Error('ช่องสนทนานี้ยังใช้ไม่ได้ในช่วงนี้');
    } else if (channel === 'wolves') throw Error('ช่องหมาป่าใช้ได้ตอนกลางคืนเท่านั้น');
    r.messages.push({ id: randomUUID(), name: p.name, text, channel, at: Date.now() }); r.messages = r.messages.slice(-200); publish(r);
  });
  handle('leave', () => { leave(socket); });
  socket.on('disconnect', () => {
    const r = rooms.get(socket.data.code); if (!r) return;
    const p = r.players.find(p => p.id === socket.data.playerId); if (p) { p.connected = false; if (r.phase === 'lobby') p.ready = false; }
    if (r.host === p?.id) r.host = r.players.find(x => x.connected)?.id || r.host;
    r.touched = Date.now(); publish(r);
  });
});
setInterval(() => {
  for (const r of rooms.values()) {
    if (r.deadline && Date.now() >= r.deadline) { advance(r, r.phaseId); publish(r); }
    if (!r.players.some(p => p.connected) && Date.now() - (r.touched || 0) > 30 * 60 * 1000) rooms.delete(r.code);
  }
}, 100).unref();
const port = Number(process.env.PORT || 3000); http.listen(port, '0.0.0.0', () => console.log(`Moonfall listening on ${port}`));
