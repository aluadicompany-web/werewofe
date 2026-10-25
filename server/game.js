import { randomInt, randomUUID } from 'node:crypto';
import { ROLES, CLASSIC_PRESETS, TIMINGS } from '../shared/rules.js';
export const roles = ROLES;
const fail = message => { throw new Error(message); };
const alive = r => r.players.filter(p => p.alive);
const wolves = p => ROLES[p.role]?.team === 'wolf';
export function room(code, name, token, options = {}) {
  const r = { code, host: token, phase: 'lobby', phaseId: randomUUID(), gameId: null, round: 0,
    mode: 'classic', timing: 'standard', timerScale: options.timerScale || 1, players: [], actions: {}, votes: {},
    messages: [], log: [], events: [], receipts: {}, deadline: null, winner: null, runoff: [], pending: null, reaction: null };
  join(r, name, token); return r;
}
export function join(r, name, token) {
  if (r.players.some(p => p.id === token)) return;
  if (r.phase !== 'lobby') fail('เกมเริ่มแล้ว กรุณารอเกมถัดไป');
  if (r.players.length >= 12) fail('ห้องเต็มแล้ว (สูงสุด 12 คน)');
  if (r.players.some(p => p.name.toLowerCase() === name.toLowerCase())) fail('ชื่อนี้ถูกใช้แล้วในห้อง');
  const seatIndex = r.players.reduce((max, p) => Math.max(max, p.seatIndex), 0) + 1;
  r.players.push({ id: token, authToken: token, previousToken: null, previousTokenUntil: 0, seat: randomUUID(), seatIndex, name, connected: true, ready: false, alive: true,
    role: null, lastDoctor: null, armor: 1, hunterUsed: false, revealed: false, visions: [] });
}
function audit(r, kind, payload, visibility = 'server') {
  r.events.push(Object.freeze({ id: randomUUID(), gameId: r.gameId, kind, at: Date.now(), payload: Object.freeze({ ...payload }), visibility }));
}
export function configure(r, actor, timing) {
  if (r.host !== actor || r.phase !== 'lobby') fail('เฉพาะเจ้าของห้องตั้งค่าในห้องรอได้');
  if (!Object.hasOwn(TIMINGS, timing)) fail('รูปแบบเวลาไม่ถูกต้อง');
  r.timing = timing; r.players.forEach(p => p.ready = false);
}
export function start(r, actor) {
  if (r.host !== actor) fail('เฉพาะเจ้าของห้องเริ่มเกมได้');
  if (r.phase !== 'lobby') fail('เกมเริ่มไปแล้ว');
  const preset = CLASSIC_PRESETS[r.players.length]; if (!preset) fail('ต้องมีผู้เล่น 6–12 คน');
  if (r.mode !== 'classic') fail('เปิดให้เล่นเฉพาะ Classic');
  if (!r.players.every(p => p.ready && p.connected)) fail('ทุกคนต้องเชื่อมต่อและกดพร้อมก่อน');
  const deck = Object.entries(preset).flatMap(([role, count]) => Array(count).fill(role));
  if (deck.length !== r.players.length || deck.some(role => !ROLES[role])) fail('ชุดบทบาทไม่ถูกต้อง');
  for (let i = deck.length - 1; i > 0; i--) { const j = randomInt(i + 1); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  r.players.forEach((p, i) => { p.role = deck[i]; p.alive = true; p.visions = []; p.lastDoctor = null; p.armor = 1; p.hunterUsed = false; p.revealed = false; });
  r.gameId = randomUUID(); r.round = 1; r.winner = null; r.events = []; r.receipts = {}; r.pending = null; r.reaction = null;
  r.log = ['แจกบทบาทแล้ว เปิดดูเป็นความลับก่อนเริ่มคืนแรก']; r.messages = [];
  audit(r, 'match_started', { count: r.players.length, preset: `classic-${r.players.length}`, timing: r.timing }, 'public');
  setPhase(r, 'role_reveal');
}
function setPhase(r, phase) {
  const timing = TIMINGS[r.timing];
  const ms = { ...timing, role_reveal: 5000, announcement: timing.result, execution: timing.result,
    hunter_reaction: 15000, runoff: 20000, result: timing.result }[phase];
  r.phase = phase; r.phaseId = randomUUID(); r.deadline = ms ? Date.now() + Math.max(50, ms * r.timerScale) : null;
  r.actions = {}; r.votes = {};
  audit(r, 'phase_changed', { phase, phaseId: r.phaseId }, 'public');
}
export function winner(r) {
  // Victory must wait until the whole resolution and any Hunter reaction finish.
  if (r.pending || r.reaction) return false;
  const live = alive(r), w = live.filter(wolves).length;
  r.winner = live.length === 0 ? 'draw' : !w ? 'village' : w >= live.length - w ? 'wolf' : null;
  if (!r.winner) return false;
  r.log.push(r.winner === 'draw' ? 'ไม่มีผู้รอดชีวิต เกมเสมอ' : r.winner === 'wolf' ? 'ฝูงหมาป่ายึดครองหมู่บ้านแล้ว' : 'หมู่บ้านปลอดภัย หมาป่าถูกกำจัดทั้งหมด');
  audit(r, 'match_finished', { winner: r.winner, days: r.round }, 'public'); setPhase(r, 'result'); return true;
}
function topCandidates(values) {
  const counts = new Map(); for (const v of values) if (v !== 'skip') counts.set(v, (counts.get(v) || 0) + 1);
  const max = Math.max(0, ...counts.values()); return [...counts.keys()].filter(k => counts.get(k) === max);
}
export function wolfTarget(r) {
  const targets = topCandidates(alive(r).filter(wolves).map(p => r.actions[p.id]).filter(Boolean));
  return r.players.filter(p => targets.includes(p.seat)).sort((a, b) => a.seatIndex - b.seatIndex)[0] || null;
}
function kill(r, p, cause) {
  if (!p?.alive) return; p.alive = false; r.pending.deaths.push({ seat: p.seat, cause });
  audit(r, 'death', { seat: p.seat, role: p.role, cause });
}
function resolveNight(r) {
  const live = alive(r), target = wolfTarget(r);
  r.pending = { from: 'night', deaths: [], visions: [] };
  const doctor = live.find(p => p.role === 'doctor');
  const protection = doctor ? r.actions[doctor.id] : null;
  if (doctor) doctor.lastDoctor = protection && protection !== 'skip' ? protection : null;
  const seer = live.find(p => p.role === 'seer');
  const inspected = seer && live.find(p => p.seat === r.actions[seer.id]);
  if (inspected) r.pending.visions.push({ actor: seer.id, name: inspected.name, wolf: inspected.role === 'werewolf', round: r.round });
  if (target) {
    if (target.seat === protection) audit(r, 'doctor_saved', { seat: target.seat });
    else if (target.role === 'elder' && target.armor > 0) { target.armor--; audit(r, 'elder_armor_used', { seat: target.seat }); }
    else kill(r, target, 'wolf_attack');
  }
  queueReaction(r);
}
function queueReaction(r) {
  const hunter = r.pending.deaths.map(d => ({ p: r.players.find(p => p.seat === d.seat), cause: d.cause }))
    .find(({ p, cause }) => p.role === 'hunter' && !p.hunterUsed && ['wolf_attack', 'execution'].includes(cause));
  if (hunter) { hunter.p.hunterUsed = true; r.reaction = hunter.p.id; setPhase(r, 'hunter_reaction'); }
  else finishResolution(r);
}
function finishResolution(r) {
  const pending = r.pending; r.reaction = null;
  for (const d of pending.deaths) { const p = r.players.find(p => p.seat === d.seat); p.revealed = true; }
  for (const v of pending.visions) { const p = r.players.find(p => p.id === v.actor); if (p.alive) { const { actor, ...vision } = v; p.visions.push(vision); } }
  if (pending.from === 'night') {
    r.log.push(pending.deaths.length ? `เช้าวันที่ ${r.round}: ` + pending.deaths.map(d => { const p = r.players.find(p => p.seat === d.seat); return `${p.name} (${ROLES[p.role].name})`; }).join(', ') + ' เสียชีวิต' : `เช้าวันที่ ${r.round}: เมื่อคืนไม่มีผู้เสียชีวิต`);
  } else if (pending.deaths.length) {
    r.log.push(pending.deaths.map(d => { const p = r.players.find(p => p.seat === d.seat); return `${p.name} (${ROLES[p.role].name})`; }).join(', ') + ' ออกจากเกม');
  }
  audit(r, 'resolution_complete', { from: pending.from, victims: pending.deaths.map(d => d.seat) }, 'public');
  r.pending = null;
  if (winner(r)) return;
  if (pending.from === 'night') setPhase(r, 'announcement');
  else { r.round++; setPhase(r, 'night'); r.log.push(`คืนที่ ${r.round} เริ่มขึ้น`); }
}
function resolveVote(r) {
  const top = topCandidates(Object.values(r.votes));
  if (top.length > 1 && r.phase === 'voting') { r.runoff = top; r.log.push('คะแนนสูงสุดเสมอ เปิดโหวตรอบสองเฉพาะผู้ที่เสมอกัน (20 วินาที)'); setPhase(r, 'runoff'); return; }
  r.pending = { from: 'day', deaths: [], visions: [] };
  if (top.length === 1) {
    const target = alive(r).find(p => p.seat === top[0]); kill(r, target, 'execution');
    target.revealed = true; r.log.push(`${target.name} (${ROLES[target.role].name}) ถูกลงมติประหาร`);
    setPhase(r, 'execution');
  } else { r.log.push('ไม่มีการประหาร: งดออกเสียงทั้งหมด หรือคะแนนรอบสองยังเสมอ'); finishResolution(r); }
}
export function advance(r, expectedPhaseId = r.phaseId) {
  if (r.phaseId !== expectedPhaseId) return false;
  switch (r.phase) {
    case 'role_reveal': setPhase(r, 'night'); r.log.push('คืนแรกเริ่มขึ้น ทุกคนหลับตา…'); break;
    case 'night': resolveNight(r); break;
    case 'announcement': setPhase(r, 'discussion'); break;
    case 'discussion': setPhase(r, 'voting'); r.runoff = []; r.log.push('เปิดลงคะแนน เลือกผู้เล่นที่มีชีวิตหรืองดออกเสียง'); break;
    case 'voting': case 'runoff': resolveVote(r); break;
    case 'execution': queueReaction(r); break;
    case 'hunter_reaction': {
      const target = r.players.find(p => p.seat === r.actions[r.reaction] && p.alive);
      if (target) kill(r, target, 'hunter_shot');
      audit(r, 'hunter_reaction', { target: target?.seat || null }); finishResolution(r); break;
    }
    case 'result': setPhase(r, 'ended'); break;
    default: return false;
  }
  return true;
}
export function act(r, actor, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('คำสั่งไม่ถูกต้อง');
  const { gameId, phaseId, actionId, target } = payload;
  if (gameId !== r.gameId || !gameId) fail('คำสั่งเป็นของเกมเก่า');
  if (typeof actionId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(actionId)) fail('actionId ไม่ถูกต้อง');
  const key = `${actor}:${actionId}`, signature = JSON.stringify([phaseId, target]);
  if (r.receipts[key]) { if (r.receipts[key] !== signature) fail('actionId ซ้ำแต่ข้อมูลต่างกัน'); return; }
  if (phaseId !== r.phaseId || !r.deadline || Date.now() >= r.deadline) fail('หมดเวลาหรือเป็นคำสั่งจากช่วงก่อนหน้า');
  const p = r.players.find(p => p.id === actor); const t = r.players.find(p => p.seat === target);
  if (!p || (!p.alive && !(r.phase === 'hunter_reaction' && r.reaction === actor))) fail('ผู้ถูกกำจัดไม่สามารถกระทำได้');
  const pass = target === 'skip'; if (!pass && !t?.alive) fail('เลือกผู้เล่นที่ยังมีชีวิต');
  if (r.phase === 'night') {
    if (!['werewolf', 'seer', 'doctor'].includes(p.role)) fail('บทบาทนี้ไม่มีการกระทำตอนกลางคืน');
    if (!pass && wolves(p) && wolves(t)) fail('โจมตีหมาป่าด้วยกันไม่ได้');
    if (!pass && p.role === 'seer' && t === p) fail('ตรวจสอบตัวเองไม่ได้');
    if (!pass && p.role === 'doctor' && p.lastDoctor === target) fail('ห้ามปกป้องคนเดิมสองคืนติดกัน');
    r.actions[actor] = target;
  } else if (['voting', 'runoff'].includes(r.phase)) {
    if (!pass && r.phase === 'runoff' && !r.runoff.includes(target)) fail('รอบสองเลือกได้เฉพาะผู้ที่คะแนนเสมอ');
    r.votes[actor] = target;
  } else if (r.phase === 'hunter_reaction' && r.reaction === actor) r.actions[actor] = target;
  else fail('ช่วงนี้ยังเลือกเป้าหมายไม่ได้');
  r.receipts[key] = signature; audit(r, 'action_accepted', { actor: p.seat, phaseId, actionId, target });
}
export function view(r, actor) {
  const me = r.players.find(p => p.id === actor), finished = ['result', 'ended'].includes(r.phase);
  const roleOf = p => finished || p.revealed || p === me || (wolves(me || {}) && wolves(p)) ? p.role : null;
  return { code: r.code, gameId: r.gameId, phaseId: r.phaseId, phase: r.phase, mode: r.mode, timing: r.timing,
    preset: CLASSIC_PRESETS[r.players.length] || null, round: r.round, deadline: r.deadline, winner: r.winner, host: r.host === actor,
    runoff: r.runoff, hunter: r.players.find(p => p.id === r.reaction)?.seat || null,
    players: r.players.map(p => ({ id: p.seat, seatIndex: p.seatIndex, name: p.name, connected: p.connected, ready: p.ready, alive: p.alive,
      me: p === me, host: r.host === p.id, role: roleOf(p), voted: Boolean(r.votes[p.id]) })),
    me: me ? { role: me.role, alive: me.alive, ready: me.ready, visions: me.visions, lastDoctor: me.lastDoctor,
      armor: me.role === 'elder' ? me.armor : null, canReact: r.reaction === me.id,
      action: r.actions[actor] || r.votes[actor] || null } : null,
    wolfActions: wolves(me || {}) && r.phase === 'night' ? alive(r).filter(wolves).map(p => ({ name: p.name, target: r.actions[p.id] || null })) : [],
    log: r.log.slice(-60), messages: r.messages.filter(m => m.channel === 'village' || (m.channel === 'wolves' && wolves(me || {}))).slice(-100) };
}
