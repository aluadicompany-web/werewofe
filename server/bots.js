import { randomInt, randomUUID } from 'node:crypto';
import { ROLES, MODES, getPreset, isWolf } from '../shared/rules.js';
import { act, join, view } from './game.js';
export function requireGM(r, actor) {
  if (!r.isTest || r.gmId !== actor) throw Error('คำสั่งนี้ใช้ได้เฉพาะ GM เจ้าของห้องทดสอบ');
}
function lobbyGM(r, actor) { requireGM(r, actor); if (r.phase !== 'lobby') throw Error('เพิ่มหรือลบบอทได้เฉพาะในห้องรอ'); }
export function addBot(r, actor) {
  lobbyGM(r, actor);
  if (r.players.length >= 12) throw Error('ห้องเต็มแล้ว (สูงสุด 12 คนรวมบอท)');
  let index = 1; while (r.players.some(p => p.name === `บอท ${index}`)) index++;
  const id = randomUUID(); join(r, `บอท ${index}`, id);
  const p = r.players.find(p => p.id === id); p.isBot = true; p.authToken = null; p.ready = true;
}
export function fillBots(r, actor, total) {
  lobbyGM(r, actor);
  if (!Number.isInteger(total) || total < 6 || total > 12) throw Error('เลือกจำนวนรวม 6–12 คน');
  if (r.players.length > total) throw Error('จำนวนผู้เล่นปัจจุบันมากกว่าเป้าหมาย กรุณาลบบอทก่อน');
  while (r.players.length < total) addBot(r, actor);
}
export function clearBots(r, actor) { lobbyGM(r, actor); r.players = r.players.filter(p => !p.isBot); }
export function setGMRole(r, actor, role) {
  lobbyGM(r, actor);
  const selected = role === 'random' ? null : role;
  const preset = getPreset(r.mode, r.players.length) || getPreset(r.mode, MODES[r.mode].minPlayers);
  if (selected !== null && (typeof selected !== 'string' || !Object.hasOwn(ROLES, selected) || !Object.hasOwn(preset, selected))) throw Error('บทบาทนี้ไม่มีในชุดของโหมดและจำนวนคนนี้');
  if (r.gmRole !== selected) { r.gmRole = selected; r.players.forEach(p => p.ready = Boolean(p.isBot)); }
}
function choices(r, bot) {
  const live = r.players.filter(p => p.alive);
  if (r.phase === 'night') {
    if (isWolf(bot.role)) return live.filter(p => !isWolf(p.role)).map(p => p.seat);
    if (bot.role === 'guard') return live.filter(p => p !== bot).map(p => p.seat);
    if (bot.role === 'seer') return live.filter(p => p !== bot).map(p => p.seat);
    if (bot.role === 'doctor') return live.filter(p => p.seat !== bot.lastDoctor).map(p => p.seat);
    return null;
  }
  if (r.phase === 'witch_decision' && bot.role === 'witch') {
    const options = [{ target: 'skip', ability: 'skip' }];
    if (bot.potions.save && r.nightPlan.target) options.push({ target: r.nightPlan.target, ability: 'save' });
    if (bot.potions.poison) options.push(...live.map(p => ({ target: p.seat, ability: 'poison' })));
    return options;
  }
  if (r.phase === 'voting' || r.phase === 'runoff') return [...live.filter(p => r.phase !== 'runoff' || r.runoff.includes(p.seat)).map(p => p.seat), 'skip'];
  if (r.phase === 'hunter_reaction' && r.reaction === bot.id) return [...live.map(p => p.seat), 'skip'];
  return null;
}
export function runBots(r, { now = Date.now(), force = false } = {}) {
  if (!r.isTest || !r.deadline || now >= r.deadline) return false;
  let changed = false;
  for (const bot of r.players.filter(p => p.isBot)) {
    if ((!bot.alive && r.reaction !== bot.id) || bot.botSubmittedPhase === r.phaseId) continue;
    const targets = choices(r, bot); if (!targets) continue;
    if (bot.botPlanPhase !== r.phaseId) {
      const duration = r.deadline - r.phaseStartedAt;
      bot.botPlanPhase = r.phaseId;
      bot.botActAt = r.phaseStartedAt + Math.min(1200, duration * .2) + randomInt(Math.max(1, Math.floor(Math.min(1800, duration * .2))));
    }
    if (!force && now < bot.botActAt) continue;
    const target = targets.length ? targets[randomInt(targets.length)] : 'skip';
    try { act(r, bot.id, { gameId: r.gameId, phaseId: r.phaseId, actionId: randomUUID(), ...(typeof target === 'object' ? target : { target }) }); }
    catch (error) { if (Date.now() >= r.deadline) break; throw error; }
    bot.botSubmittedPhase = r.phaseId; changed = true;
  }
  return changed;
}
export function gmProjection(r, actor) {
  if (!r.isTest || r.gmId !== actor) return null;
  return { speed: r.testSpeed || 1, selectedRole: r.gmRole || null, players: r.players.map(p => ({ id: p.seat, role: p.role,
    action: r.actions[p.id] || r.votes[p.id] || null, potions: p.role === 'witch' ? { ...p.potions } : null, visions: view(r, p.id).me?.visions || [], armor: p.role === 'elder' ? p.armor : null })) };
}
