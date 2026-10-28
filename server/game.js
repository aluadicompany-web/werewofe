import { randomInt, randomUUID } from 'node:crypto';
import { ROLES, MODES, getPreset, TIMINGS, isWolf } from '../shared/rules.js';
export const roles = ROLES;
const fail = message => { throw new Error(message); };
const alive = r => r.players.filter(p => p.alive);
const wolves = p => isWolf(p.role);
export function room(code, name, token, options = {}) {
  const r = { code, host: token, phase: 'lobby', phaseId: randomUUID(), gameId: null, round: 0,
    isTest: Boolean(options.isTest), gmId: options.isTest ? token : null, testSpeed: 1, gmRole: null, baseTimerScale: options.timerScale || 1,
    mode: 'classic', timing: 'standard', timerScale: options.timerScale || 1, players: [], actions: {}, votes: {},
    messages: [], log: [], events: [], receipts: {}, deadline: null, winner: null, runoff: [], pending: null, nightPlan: null, reaction: null };
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
export function configure(r, actor, timing, mode = r.mode) {
  if (r.host !== actor || r.phase !== 'lobby') fail('เฉพาะเจ้าของห้องตั้งค่าในห้องรอได้');
  if (!Object.hasOwn(TIMINGS, timing)) fail('รูปแบบเวลาไม่ถูกต้อง');
  if (!Object.hasOwn(MODES, mode)) fail('โหมดนี้ยังไม่เปิดให้เล่น');
  r.mode = mode; r.timing = timing; r.players.forEach(p => p.ready = Boolean(p.isBot));
}
export function start(r, actor) {
  if (r.host !== actor) fail('เฉพาะเจ้าของห้องเริ่มเกมได้');
  if (r.phase !== 'lobby') fail('เกมเริ่มไปแล้ว');
  if (!Object.hasOwn(MODES, r.mode)) fail('โหมดนี้ยังไม่เปิดให้เล่น');
  const preset = getPreset(r.mode, r.players.length);
  if (!preset) fail(`โหมด ${MODES[r.mode].name} ต้องมีผู้เล่น ${MODES[r.mode].minPlayers}–12 คน`);
  if (!r.players.every(p => p.ready && p.connected)) fail('ทุกคนต้องเชื่อมต่อและกดพร้อมก่อน');
  const forcedRole = r.isTest ? r.gmRole : null;
  if (forcedRole && (typeof forcedRole !== 'string' || !Object.hasOwn(preset, forcedRole))) fail('บทบาท GM ที่เลือกไม่มีในชุดของโหมดและจำนวนคนนี้ กรุณาเลือกใหม่หรือเพิ่มผู้เล่น');
  const deck = Object.entries(preset).flatMap(([role, count]) => Array(count).fill(role));
  if (deck.length !== r.players.length || deck.some(role => !ROLES[role])) fail('ชุดบทบาทไม่ถูกต้อง');
  for (let i = deck.length - 1; i > 0; i--) { const j = randomInt(i + 1); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  if (forcedRole) {
    const ownerIndex = r.players.findIndex(p => p.id === r.gmId);
    const matches = deck.map((role, index) => role === forcedRole ? index : -1).filter(index => index >= 0);
    if (ownerIndex < 0 || !matches.length) fail('ไม่พบที่นั่ง GM หรือบทบาทที่เลือก');
    const roleIndex = matches[randomInt(matches.length)];
    [deck[ownerIndex], deck[roleIndex]] = [deck[roleIndex], deck[ownerIndex]];
  }
  r.players.forEach((p, i) => { p.role = deck[i]; p.alive = true; p.visions = []; p.lastDoctor = null; p.armor = 1; p.hunterUsed = false; p.revealed = false; p.potions = { save: 1, poison: 1 }; });
  r.gameId = randomUUID(); r.round = 1; r.winner = null; r.events = []; r.receipts = {}; r.pending = null; r.nightPlan = null; r.reaction = null;
  r.log = ['แจกบทบาทแล้ว เปิดดูเป็นความลับก่อนเริ่มคืนแรก']; r.messages = [];
  audit(r, 'match_started', { count: r.players.length, preset: `${r.mode}-${r.players.length}`, timing: r.timing }, 'public');
  setPhase(r, 'role_reveal');
}
function setPhase(r, phase) {
  const timing = TIMINGS[r.timing];
  const ms = { ...timing, role_reveal: 5000, announcement: timing.result, execution: timing.result,
    witch_decision: 12000, hunter_reaction: 15000, runoff: 20000, result: timing.result }[phase];
  r.phaseStartedAt = Date.now(); r.phase = phase; r.phaseId = randomUUID(); r.deadline = ms ? Date.now() + Math.max(50, ms * r.timerScale) : null;
  r.actions = {}; r.votes = {};
  audit(r, 'phase_changed', { phase, phaseId: r.phaseId }, 'public');
}
export function winner(r) {
  // Victory must wait until the whole resolution and any Hunter reaction finish.
  if (r.pending || r.reaction || r.nightPlan) return false;
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
function lockNight(r) {
  const live = alive(r), target = wolfTarget(r);
  const doctor = live.find(p => p.role === 'doctor'), guard = live.find(p => p.role === 'guard');
  const protection = doctor ? r.actions[doctor.id] : null;
  if (doctor) doctor.lastDoctor = protection && protection !== 'skip' ? protection : null;
  const seer = live.find(p => p.role === 'seer');
  const inspected = seer && live.find(p => p.seat === r.actions[seer.id]);
  const witch = live.find(p => p.role === 'witch');
  // Snapshot all main-night inputs before setPhase clears them. Never project this plan.
  r.nightPlan = { target: target?.seat || null, protection, guard: guard?.id || null,
    guarded: guard ? r.actions[guard.id] : null, witch: witch?.id || null,
    visions: inspected ? [{ actor: seer.id, targetId: inspected.seat, name: inspected.name, wolf: inspected.role === 'werewolf', round: r.round }] : [] };
  if (witch) setPhase(r, 'witch_decision');
  else resolveNight(r);
}
function resolveNight(r) {
  const plan = r.nightPlan;
  r.pending = { from: 'night', deaths: [], visions: plan.visions };
  const target = r.players.find(p => p.seat === plan.target);
  const witch = r.players.find(p => p.id === plan.witch);
  const decision = witch && r.actions[witch.id];
  let saved = false, poisoned = null;
  if (decision && decision !== 'skip') {
    if (decision.ability === 'save') saved = true;
    else if (decision.ability === 'poison') poisoned = r.players.find(p => p.seat === decision.target);
    witch.potions[decision.ability]--;
    audit(r, 'witch_potion_used', { actor: witch.seat, ability: decision.ability, target: decision.target });
  }
  // Collect simultaneous lethal effects before killing. Poison takes precedence for
  // Hunter eligibility when the same player also receives a lethal wolf attack.
  let wolfVictim = null;
  if (target) {
    if (target.seat === plan.protection) audit(r, 'doctor_saved', { seat: target.seat });
    else if (saved) audit(r, 'witch_saved', { seat: target.seat });
    else if (plan.guarded === target.seat) {
      wolfVictim = r.players.find(p => p.id === plan.guard);
      audit(r, 'guard_intercepted', { guard: wolfVictim.seat, target: target.seat });
    } else if (target.role === 'elder' && target.armor > 0) { target.armor--; audit(r, 'elder_armor_used', { seat: target.seat }); }
    else wolfVictim = target;
  }
  if (poisoned) kill(r, poisoned, 'witch_poison');
  if (wolfVictim && wolfVictim !== poisoned) kill(r, wolfVictim, wolfVictim.role === 'guard' && wolfVictim !== target ? 'guard_sacrifice' : 'wolf_attack');
  r.nightPlan = null;
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
    case 'night': lockNight(r); break;
    case 'witch_decision': resolveNight(r); break;
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
  const { gameId, phaseId, actionId, target, ability } = payload;
  if (gameId !== r.gameId || !gameId) fail('คำสั่งเป็นของเกมเก่า');
  if (typeof actionId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(actionId)) fail('actionId ไม่ถูกต้อง');
  const key = `${actor}:${actionId}`, signature = JSON.stringify([phaseId, target, ability ?? null]);
  if (r.receipts[key]) { if (r.receipts[key] !== signature) fail('actionId ซ้ำแต่ข้อมูลต่างกัน'); return; }
  if (phaseId !== r.phaseId || !r.deadline || Date.now() >= r.deadline) fail('หมดเวลาหรือเป็นคำสั่งจากช่วงก่อนหน้า');
  const p = r.players.find(p => p.id === actor); const t = r.players.find(p => p.seat === target);
  if (!p || (!p.alive && !(r.phase === 'hunter_reaction' && r.reaction === actor))) fail('ผู้ถูกกำจัดไม่สามารถกระทำได้');
  const pass = target === 'skip'; if (!pass && !t?.alive) fail('เลือกผู้เล่นที่ยังมีชีวิต');
  if (r.phase !== 'witch_decision' && ability !== undefined) fail('ช่วงนี้ไม่รับคำสั่งยา');
  if (r.phase === 'night') {
    if (!['werewolf', 'alpha_wolf', 'seer', 'doctor', 'guard'].includes(p.role)) fail('บทบาทนี้ไม่มีการกระทำตอนกลางคืน');
    if (!pass && wolves(p) && wolves(t)) fail('โจมตีหมาป่าด้วยกันไม่ได้');
    if (!pass && p.role === 'seer' && t === p) fail('ตรวจสอบตัวเองไม่ได้');
    if (!pass && p.role === 'doctor' && p.lastDoctor === target) fail('ห้ามปกป้องคนเดิมสองคืนติดกัน');
    if (!pass && p.role === 'guard' && t === p) fail('ผู้พิทักษ์ปกป้องตัวเองไม่ได้');
    r.actions[actor] = target;
  } else if (r.phase === 'witch_decision') {
    if (p.role !== 'witch' || r.nightPlan?.witch !== actor) fail('ช่วงนี้เฉพาะแม่มดเลือกยาได้');
    if (pass) { if (ability !== 'skip') fail('ข้ามต้องไม่เลือกยา'); r.actions[actor] = 'skip'; }
    else {
      if (!['save', 'poison'].includes(ability)) fail('เลือกยาช่วยชีวิตหรือยาพิษเพียงหนึ่งชนิด');
      if (!p.potions[ability]) fail('ใช้ยาชนิดนี้หมดแล้ว');
      if (ability === 'save' && target !== r.nightPlan.target) fail('ยาช่วยชีวิตใช้ได้เฉพาะเหยื่อหมาป่าคืนนี้');
      r.actions[actor] = { ability, target };
    }
  } else if (['voting', 'runoff'].includes(r.phase)) {
    if (!pass && r.phase === 'runoff' && !r.runoff.includes(target)) fail('รอบสองเลือกได้เฉพาะผู้ที่คะแนนเสมอ');
    r.votes[actor] = target;
  } else if (r.phase === 'hunter_reaction' && r.reaction === actor) r.actions[actor] = target;
  else fail('ช่วงนี้ยังเลือกเป้าหมายไม่ได้');
  r.receipts[key] = signature; audit(r, 'action_accepted', { actor: p.seat, phaseId, actionId, target, ...(ability ? { ability } : {}) });
}
export function view(r, actor) {
  const me = r.players.find(p => p.id === actor), finished = ['result', 'ended'].includes(r.phase);
  const roleOf = p => finished || p.revealed || p === me || (wolves(me || {}) && wolves(p)) ? p.role : null;
  return { code: r.code, testRoom: Boolean(r.isTest), gm: Boolean(r.isTest && r.gmId === actor), gameId: r.gameId, phaseId: r.phaseId, phase: r.phase, mode: r.mode, timing: r.timing,
    preset: getPreset(r.mode, r.players.length), round: r.round, deadline: r.deadline, winner: r.winner, host: r.host === actor,
    runoff: r.runoff, hunter: r.players.find(p => p.id === r.reaction)?.seat || null,
    players: r.players.map(p => ({ id: p.seat, seatIndex: p.seatIndex, name: p.name, bot: Boolean(p.isBot), connected: p.connected, ready: p.ready, alive: p.alive,
      me: p === me, host: r.host === p.id, role: roleOf(p) })),
    me: me ? { role: me.role, alive: me.alive, ready: me.ready, visions: me.visions, lastDoctor: me.lastDoctor,
      potions: me.role === 'witch' ? { ...me.potions } : null,
      wolfVictim: me.role === 'witch' && r.phase === 'witch_decision' ? r.nightPlan?.target || null : null,
      armor: me.role === 'elder' ? me.armor : null, canReact: r.reaction === me.id,
      action: r.actions[actor] || r.votes[actor] || null } : null,
    wolfActions: wolves(me || {}) && r.phase === 'night' ? alive(r).filter(wolves).map(p => ({ name: p.name, target: r.actions[p.id] || null })) : [],
    log: r.log.slice(-60), messages: r.messages.filter(m => m.channel === 'village' || (m.channel === 'wolves' && wolves(me || {}))).slice(-100) };
}

export function resetToLobby(r) {
  r.players = r.players.filter(p => p.connected || p.isBot || p.id === r.gmId);
  r.phase = 'lobby'; r.phaseId = randomUUID(); r.gameId = null; r.winner = null; r.deadline = null; r.round = 0;
  r.actions = {}; r.votes = {}; r.receipts = {}; r.messages = []; r.log = []; r.events = []; r.pending = null; r.nightPlan = null; r.reaction = null; r.runoff = [];
  r.players.forEach(p => { p.ready = Boolean(p.isBot); p.role = null; p.alive = true; p.visions = []; p.lastDoctor = null; p.revealed = false; p.hunterUsed = false; p.armor = 1; p.potions = { save: 1, poison: 1 }; });
}
