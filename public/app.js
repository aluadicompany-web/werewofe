import { ROLES as roles, MODES, getPreset, isWolf } from '/shared/rules.js';
const $ = id => document.getElementById(id);
const serverUrl = window.MOONFALL_CONFIG?.serverUrl || window.location.origin;
const socket = io(serverUrl);
let state, reveal = false, lastPhase = '', busy = false, witchAbility = 'save';
let dismissedOutcome = null; try { dismissedOutcome = sessionStorage.getItem('moonfall-outcome-dismissed'); } catch {}
let session; try { session = JSON.parse(sessionStorage.getItem('moonfall') || 'null'); } catch { session = null; }
const invite = new URL(location.href).searchParams.get('room');
if (invite && /^[A-F0-9]{6}$/i.test(invite)) $('code').value = invite.toUpperCase();
const text = (tag, value, cls) => { const e = document.createElement(tag); e.textContent = value; if (cls) e.className = cls; return e; };
let toastTimer;
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 4500); }
function send(event, data = {}) {
  return new Promise(resolve => {
    if (!socket.connected) { toast('ยังเชื่อมต่อเซิร์ฟเวอร์เกมไม่ได้ กำลังลองเชื่อมต่อใหม่'); resolve(null); return; }
    socket.timeout(8000).emit(event, data, (err, res) => { if (err) { toast('เซิร์ฟเวอร์ไม่ตอบกลับ กรุณาลองอีกครั้ง'); resolve(null); } else if (!res.ok) { toast(res.error); resolve(null); } else resolve(res); });
  });
}
function saveSession(value) { session = value; try { if (value) sessionStorage.setItem('moonfall', JSON.stringify(value)); else sessionStorage.removeItem('moonfall'); } catch { toast('เบราว์เซอร์ไม่อนุญาตให้จำที่นั่งเมื่อรีเฟรช'); } }
function showLanding() { if ($('match-outcome').open) $('match-outcome').close(); state = null; reveal = false; $('game').hidden = true; $('landing').hidden = false; $('gm-open').hidden = false; document.body.dataset.cycle = 'neutral'; }
socket.on('connect', () => {
  $('connection').textContent = 'เชื่อมต่อแล้ว'; $('connection').classList.remove('offline');
  if (session) socket.timeout(8000).emit('enter', session, (err, result) => {
    if (err) { toast('กำลังลองกลับเข้าที่นั่งเดิมอีกครั้ง'); if (socket.connected) { socket.disconnect(); setTimeout(() => socket.connect(), 1000); } return; }
    if (result.ok) saveSession({ ...session, token: result.token });
    else { toast(result.error); saveSession(null); showLanding(); }
  });
});
const offline = () => { $('connection').textContent = 'กำลังเชื่อมต่อเซิร์ฟเวอร์'; $('connection').classList.add('offline'); };
socket.on('disconnect', offline); socket.on('connect_error', offline);
socket.on('room_closed', () => { saveSession(null); showLanding(); toast('GM ปิดห้องทดสอบแล้ว'); });
socket.on('kicked', () => { saveSession(null); showLanding(); toast('คุณถูกนำออกจากห้องโดยผู้ดูแล'); });
socket.on('replaced', () => { saveSession(null); showLanding(); toast('ที่นั่งนี้ถูกเปิดจากอีกหน้าต่าง กรุณาใช้แท็บล่าสุด'); });
socket.on('state', next => { state = next; if (lastPhase !== next.phaseId) { if (next.phase === 'lobby') reveal = false; lastPhase = next.phaseId; if (next.phase === 'witch_decision') witchAbility = typeof next.me.action === 'object' && next.me.action ? next.me.action.ability : next.me.potions?.save && next.me.wolfVictim ? 'save' : next.me.potions?.poison ? 'poison' : 'skip'; } render(); });
async function enter(create) {
  if (busy) return; const name = $('name').value.trim(); if (!name) { $('name').reportValidity(); return; }
  if (!create && !/^[a-f0-9]{6}$/i.test($('code').value.trim())) { toast('กรอกรหัสห้อง 6 ตัวอักษร'); $('code').focus(); return; }
  busy = true; const res = await send('enter', { create, name, code: $('code').value.trim() }); busy = false;
  if (res) saveSession({ name, token: res.token, code: res.code });
}
$('entry-form').addEventListener('submit', e => { e.preventDefault(); enter(true); });
$('join').onclick = () => enter(false);
$('name').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.isComposing && $('code').value.trim()) { e.preventDefault(); enter(false); }
});
$('code').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); enter(false); } });
$('gm-open').onclick = () => { $('gm-name').value = $('name').value.trim() || 'GM'; $('gm-dialog').showModal(); };
$('gm-close').onclick = () => $('gm-dialog').close();
$('gm-dialog').addEventListener('close', () => { $('gm-key').value = ''; });
$('gm-form').onsubmit = async e => {
  e.preventDefault(); if (busy) return;
  busy = true; $('gm-create').disabled = true;
  const name = $('gm-name').value.trim();
  const payload = { create: true, testRoom: true, name, gmKey: $('gm-key').value };
  $('gm-key').value = '';
  const res = await send('enter', payload); payload.gmKey = '';
  busy = false; $('gm-create').disabled = false;
  if (res) { saveSession({ name, token: res.token, code: res.code }); $('gm-dialog').close(); toast('สร้างห้องทดสอบ GM แล้ว'); }
};
$('host-seat').onclick = () => send('participation', { playing: Boolean(state.controller) });
$('host-step').onclick = () => { if (confirm('จบช่วงปัจจุบันและนับคำสั่งที่ส่งแล้วทันที?')) send('host_step', { gameId: state.gameId, phaseId: state.phaseId }); };
$('gm-reveal').onchange = () => render();
function dismissOutcome() {
  if (state?.gameId) { dismissedOutcome = state.gameId; try { sessionStorage.setItem('moonfall-outcome-dismissed', dismissedOutcome); } catch {} }
  $('match-outcome').close();
}
$('match-outcome').addEventListener('click', dismissOutcome);
$('match-outcome').addEventListener('cancel', e => { e.preventDefault(); dismissOutcome(); });
$('help').onclick = () => $('rules').showModal(); $('close-rules').onclick = () => $('rules').close();
document.addEventListener('keydown', e => { if (e.key === '?' && !$('match-outcome').open && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) { e.preventDefault(); if (!$('rules').open) $('rules').showModal(); } });
async function copy(value, success) { try { await navigator.clipboard.writeText(value); toast(success); } catch { toast(value); } }
$('copy').onclick = () => copy(state.code, 'คัดลอกรหัสห้องแล้ว');
$('copy-link').onclick = () => { const url = new URL(location.href); url.search = ''; url.hash = ''; url.searchParams.set('room', state.code); copy(url.href, 'คัดลอกลิงก์เชิญแล้ว เพียงเปิดลิงก์และกรอกชื่อ'); };
$('leave').onclick = async () => { if (!confirm(state?.gm ? 'ปิดห้องทดสอบนี้? ผู้เล่นทุกคนจะออกจากห้อง' : 'ออกจากห้อง? ระหว่างเกมจะเสียสิทธิ์กลับเข้าที่นั่งนี้')) return; if (await send('leave')) { saveSession(null); showLanding(); } };
$('reveal').onclick = () => { reveal = true; render(); };
const settings = () => send('settings', { timing: $('timing').value, mode: $('mode').value });
$('timing').onchange = settings; $('mode').onchange = settings;
$('chat-form').onsubmit = async e => { e.preventDefault(); const input = $('chat-input'); const value = input.value.trim(); if (!value) return; const res = await send('chat', { text: value, channel: state.phase === 'night' ? 'wolves' : 'village' }); if (res && input.value.trim() === value) input.value = ''; };
function button(label, action, cls = '', disabled = false) { const b = text('button', label, cls); b.type = 'button'; b.disabled = disabled; b.onclick = action; return b; }
const isVoting = () => ['voting','runoff'].includes(state?.phase);
const finished = () => ['result','ended'].includes(state.phase);
function canAct() { return !state.controller && state.me && (state.phase === 'hunter_reaction' ? state.me.canReact : state.me.alive && (['voting','runoff'].includes(state.phase) || state.phase === 'night' && ['werewolf','alpha_wolf','seer','doctor','guard'].includes(state.me.role) || state.phase === 'witch_decision' && state.me.role === 'witch')); }
function eligible(p) {
  if (!canAct() || !p.alive) return false;
  if (state.phase === 'runoff') return state.runoff.includes(p.id);
  if (['voting','hunter_reaction'].includes(state.phase)) return true;
  if (state.phase === 'witch_decision') return witchAbility === 'save' ? Boolean(state.me.potions.save && p.id === state.me.wolfVictim) : witchAbility === 'poison' && Boolean(state.me.potions.poison);
  const role = state.me.role;
  return isWolf(role) ? !isWolf(p.role) : ['seer','guard'].includes(role) ? !p.me : role === 'doctor' ? p.id !== state.me.lastDoctor : false;
}
async function submitTarget(target) {
  if (!canAct()) return;
  const { gameId, phaseId } = state;
  const payload = { target, gameId, phaseId, actionId: crypto.randomUUID() };
  if (state.phase === 'witch_decision') payload.ability = target === 'skip' ? 'skip' : witchAbility;
  const res = await send('action', payload);
  if (res && state?.phaseId === phaseId) toast(isVoting() ? 'บันทึกโหวตแล้ว เปลี่ยนได้จนหมดเวลา' : 'ใช้พลังแล้ว เปลี่ยนเป้าหมายได้จนหมดเวลา');
}
function render() {
  if (!state) return; const focusSeat = document.activeElement?.dataset.seat; $('landing').hidden = true; $('game').hidden = false;
  $('game').dataset.phase = state.phase; $('game').dataset.cycle = state.timeOfDay; document.body.dataset.cycle = state.timeOfDay;
  $('cycle-label').textContent = state.timeOfDay === 'day' ? '☀ กลางวัน' : state.timeOfDay === 'night' ? '☾ กลางคืน' : ''; $('game').dataset.phaseId = state.phaseId;
  $('room-code').textContent = state.code;
  $('match-roster').hidden = state.phase === 'lobby' || !state.preset;
  $('match-role-list').replaceChildren(...Object.entries(state.preset || {}).map(([id,count]) => text('span', `${roles[id].icon} ${roles[id].name} × ${count}`, 'role-chip')));
  const live = state.players.filter(p => p.alive).length;
  $('leave').textContent = state.gm ? 'ปิดห้อง GM →' : 'ออกจากห้อง →';
  const mode = MODES[state.mode];
  $('population').textContent = state.phase === 'lobby' ? `${state.players.length} / 12 คน · ขั้นต่ำ ${mode.minPlayers}` : `รอดชีวิต ${live} / ${state.players.length} คน`;
  const victory = state.winner === 'draw' ? 'ไม่มีผู้รอดชีวิต · เสมอ' : state.winner === 'wolf' ? 'ฝูงหมาป่าเป็นฝ่ายชนะ' : 'หมู่บ้านเป็นฝ่ายชนะ';
  if (state.controllers.length) $('population').textContent += ` · ผู้คุม ${state.controllers.length} คน (ไม่นับในเกม)`;
  const labels = { lobby: 'ล้อมวงรอเพื่อน', role_reveal: 'เปิดดูบทบาทลับของคุณ', night: 'ค่ำคืนแห่งความลับ', witch_decision: 'ช่วงตัดสินใจของแม่มด', announcement: 'ข่าวสารยามรุ่งเช้า', discussion: 'รุ่งเช้าแห่งความสงสัย', voting: 'ใครคือมนุษย์หมาป่า?', runoff: 'โหวตรอบสอง · ผู้ที่คะแนนเสมอ', execution: 'คำตัดสินของหมู่บ้าน', hunter_reaction: 'กระสุนนัดสุดท้ายของนายพราน', result: victory, ended: victory };
  $('round-label').textContent = state.phase === 'lobby' ? `${state.mode.toUpperCase()} · ${mode.minPlayers}–12 PLAYERS` : `${state.mode.toUpperCase()} · ROUND ${String(state.round).padStart(2,'0')} · ${state.timeOfDay === 'night' ? 'NIGHT' : 'DAY'}`;
  if (state.testRoom) $('round-label').textContent = 'GM TEST · ' + $('round-label').textContent;
  $('phase-title').textContent = labels[state.phase];
  let hint = {
    lobby: 'แชร์ลิงก์เชิญให้เพื่อน ทุกคนกดพร้อม แล้วเจ้าของห้องเริ่มเกมตามจำนวนขั้นต่ำของโหมด',
    role_reveal: 'บทบาทเป็นความลับของคุณ เมื่อหมดเวลาจะเริ่มคืนแรกโดยอัตโนมัติ',
    night: ['werewolf','alpha_wolf','seer','doctor','guard'].includes(state.me.role) ? 'คลิกผู้เล่นเพื่อใช้พลังทันที เปลี่ยนเป้าหมายได้จนหมดเวลา' : 'หมู่บ้านกำลังหลับใหล รอผลในยามรุ่งเช้า',
    witch_decision: state.me.role === 'witch' ? 'คำสั่งกลางคืนถูกล็อกแล้ว เลือกยาหนึ่งชนิด แล้วคลิกผู้เล่นเพื่อใช้ทันที หรือข้าม' : 'คำสั่งกลางคืนถูกล็อกแล้ว รอแม่มดตัดสินใจ 12 วินาทีก่อนประกาศรุ่งเช้า',
    announcement: 'เปิดเผยผู้เสียชีวิตและบทบาท กำลังเข้าสู่การสนทนา',
    discussion: 'แลกเปลี่ยนเบาะแสในแชต ใครพูดจริง ใครกำลังโกหก?',
    voting: 'คลิกผู้เล่นเพื่อโหวตทันที เปลี่ยนได้ก่อนหมดเวลา ระบบจะนับผลเมื่อหมดเวลา',
    runoff: 'ผู้เข้ารอบ 2: ' + state.players.filter(p => state.runoff.includes(p.id)).map(p => p.name).join(', ') + ' · คลิกการ์ดที่ไฮไลท์เพื่อโหวต นับผลเมื่อหมดเวลา',
    execution: 'รอผลการประหารและปฏิกิริยาของนายพราน ก่อนตรวจเงื่อนไขชนะ',
    hunter_reaction: state.me.canReact ? 'คุณมีโอกาสยิงครั้งสุดท้าย เลือกผู้มีชีวิตหนึ่งคน หรือข้ามภายในเวลา' : 'รอนายพรานตัดสินใจครั้งสุดท้าย เงื่อนไขชนะยังไม่ถูกตรวจระหว่างนี้',
    result: 'เปิดเผยทุกบทบาท รอสรุปผลก่อนเริ่มเกมถัดไป', ended: 'ความลับทั้งหมดถูกเปิดเผยแล้ว พร้อมกลับมาลองอีกครั้งไหม?'
  }[state.phase];
  if (state.controller) hint = 'คุณเป็นผู้คุมเกม ไม่รับบทบาท ไม่ใช้พลังหรือโหวต และไม่นับรวมจำนวนผู้เล่น';
  else if (!state.me.alive && !finished() && !state.me.canReact) hint = 'คุณถูกกำจัดแล้ว อ่านแชตได้ แต่ส่งข้อความ ใช้ความสามารถ หรือโหวตไม่ได้';
  $('phase-hint').textContent = hint;
  $('lobby-settings').hidden = state.phase !== 'lobby'; $('timing').value = state.timing; $('timing').disabled = !state.canManage; $('mode').value = state.mode; $('mode').disabled = !state.canManage;
  const preset = state.preset;
  $('preset-info').textContent = preset ? Object.entries(preset).map(([role,count]) => `${roles[role].name} ${count}`).join(' · ') + (state.players.length < 8 ? ' · Quick/Casual ไม่มีจัดอันดับ' : ' · Casual ไม่มีจัดอันดับ') : `โหมด ${mode.name} ต้องมี ${mode.minPlayers}–12 คน จึงจะแสดงชุดบทบาทและเริ่มเกมได้`;
  const board = $('players'); board.replaceChildren();
  state.players.forEach(p => {
    const runoffCandidate = state.phase === 'runoff' && p.alive && state.runoff.includes(p.id);
    const vision = state.me.role === 'seer' ? [...state.me.visions].reverse().find(v => v.targetId === p.id || (!v.targetId && v.name === p.name)) : null;
    const actionTarget = typeof state.me.action === 'object' && state.me.action ? state.me.action.target : state.me.action;
    const myAbility = ['night','witch_decision','hunter_reaction'].includes(state.phase) && actionTarget === p.id;
    const wolfTargeted = state.phase === 'night' && isWolf(state.me.role) && state.wolfActions.some(a => a.target === p.id);
    const abilityIcon = isWolf(state.me.role) ? '🐾' : state.me.role === 'witch' ? state.me.action?.ability === 'poison' ? '☠️' : '🧪' : roles[state.me.role]?.icon;
    const myVote = ['voting','runoff'].includes(state.phase) && state.me.action === p.id;
    const gmPlayer = state.gm && $('gm-reveal').checked ? state.gmState?.players.find(x => x.id === p.id) : null;
    const shownRole = gmPlayer?.role || p.role;
    const can = eligible(p), roleVisible = Boolean(gmPlayer?.role) || p.role && (!p.me || reveal || finished() || !p.alive);
    const b = button('', () => submitTarget(p.id), `player ${runoffCandidate ? 'runoff-candidate' : state.phase === 'runoff' ? 'runoff-inactive' : ''} ${myVote ? 'my-vote' : ''} ${myAbility ? 'my-ability' : ''} ${wolfTargeted ? 'wolf-target' : ''} ${!p.alive ? 'dead' : ''} ${can ? 'can-select' : ''}`, !can);
    b.dataset.seat = p.id; b.setAttribute('aria-label', `${p.name}${p.me ? ' คุณ' : ''}${p.kicked ? ' ถูกนำออกจากห้อง' : p.alive ? '' : ' ถูกกำจัด'}${runoffCandidate ? ' ผู้เข้ารอบโหวตครั้งที่สอง' : ''}${myVote ? ' คุณโหวตให้ผู้เล่นนี้แล้ว' : ''}`); b.setAttribute('aria-pressed', myAbility || myVote ? 'true' : 'false');
    b.append(text('span', String(p.seatIndex).padStart(2,'0'), 'seat'), text('span', myVote ? '✓' : myAbility ? abilityIcon : wolfTargeted ? '🐾' : roleVisible && state.phase !== 'lobby' ? roles[shownRole].icon : !p.alive ? '✝' : ['☾','✧','♜','❖'][p.seatIndex % 4], myVote ? 'avatar vote-marker' : myAbility ? 'avatar ability-marker' : wolfTargeted ? 'avatar wolf-marker' : 'avatar'), text('b', `${p.bot ? '🤖 ' : ''}${p.name}${p.me ? ' (คุณ)' : ''}`));
    if (myAbility) b.querySelector('.ability-marker').setAttribute('aria-label', 'เป้าหมายพลังล่าสุดของคุณ');
    if (wolfTargeted) { const tag = text('span', '🐾 เป้าหมายของฝูง', 'wolf-target-tag'); tag.setAttribute('aria-label','สมาชิกฝูงเลือกโจมตีคนนี้'); b.append(tag); }
    if (vision) {
      const mark = text('span', vision.wolf ? '👎' : '👍', 'seer-mark');
      const label = `ผลตรวจคืน ${vision.round}: ${vision.wolf ? 'เป็นหมาป่า' : 'ไม่ใช่หมาป่า'} · เห็นเฉพาะคุณ`;
      mark.title = label; mark.setAttribute('aria-label', label); b.querySelector('.seat').append(mark);
    }
    b.append(text('small', p.kicked ? 'ถูกนำออกจากห้อง' : state.phase === 'lobby' ? !p.connected ? 'หลุดการเชื่อมต่อ' : p.ready ? 'พร้อมแล้ว' : 'กำลังเตรียมตัว' : roleVisible ? `${roles[shownRole].name}${p.alive ? '' : ' · เสียชีวิต'}` : !p.alive ? 'ถูกกำจัด' : !p.connected ? 'หลุดการเชื่อมต่อ' : 'ยังมีชีวิต'));
    if (runoffCandidate) b.append(text('span', 'ผู้เข้ารอบ 2', 'runoff-tag'));
    if (myVote) b.querySelector('.vote-marker').setAttribute('aria-label', 'คุณโหวตให้ผู้เล่นนี้แล้ว · เห็นเฉพาะคุณ');
    if (p.host || p.ready && state.phase === 'lobby') b.append(text('span', p.host ? '♔' : '✓', 'check'));
    const wrap = text('div', '', `seat-wrap ${p.canKick ? 'has-kick' : ''}`); wrap.append(b);
    if (p.canKick) { const kick = button('×', () => { if (confirm(`นำ ${p.name} ออกจากห้อง? ระหว่างเกมจะถูกนำออกจากแมตช์และยกเลิกคำสั่งที่เกี่ยวข้อง`)) send('kick', { target: p.id }); }, 'kick-player'); kick.setAttribute('aria-label', `เตะ ${p.name} ออกจากห้อง`); wrap.append(kick); }
    board.append(wrap);
  });
  if (state.phase === 'lobby') for (let i = state.players.length; i < 6; i++) { const e = text('div', '', 'player empty'); e.append(text('span', '+', 'avatar'),text('small','รอเพื่อนเข้าร่วม')); board.append(e); }
  const witchTurn = state.phase === 'witch_decision' && state.me.role === 'witch' && state.me.alive;
  $('board-actions').replaceChildren(); $('witch-actions').replaceChildren(); $('witch-actions').hidden = !witchTurn;
  const actions = witchTurn ? $('witch-actions') : $('board-actions');
  if (state.phase === 'lobby') {
    if (!state.controller) actions.append(button(state.me.ready ? '✓ พร้อมแล้ว · ยกเลิก' : 'ฉันพร้อมแล้ว', () => send('ready'), state.me.ready ? 'secondary' : 'primary'));

    if (state.canManage) actions.append(button('เริ่มคืนแรก →', () => send('start'), 'primary', state.players.length < mode.minPlayers || state.players.length > 12 || !state.players.every(p => p.ready && p.connected) || Boolean(state.gm && state.gmState?.selectedRole && !Object.hasOwn(state.preset || {}, state.gmState.selectedRole))));
  } else if (state.phase === 'discussion' && state.canManage) actions.append(button('เปิดการลงคะแนน →', () => send('next', { gameId: state.gameId, phaseId: state.phaseId }), 'primary'));
  else if (state.phase === 'ended' && state.canManage) actions.append(button('เล่นอีกครั้ง ↻', () => send('rematch'), 'primary'));
  else if (canAct() && isVoting()) {
    actions.append(button('งดออกเสียง', () => submitTarget('skip'), state.me.action === 'skip' ? 'secondary' : 'quiet'));
  } else if (canAct()) {
    if (state.phase === 'witch_decision') {
      for (const [ability, label] of [['save','ยาช่วยชีวิต'], ['poison','ยาพิษ']]) {
        const b = button(`${label} · เหลือ ${state.me.potions[ability]}`, () => { witchAbility = ability; render(); }, witchAbility === ability ? 'secondary potion-active' : 'quiet', !state.me.potions[ability] || ability === 'save' && !state.me.wolfVictim);
        b.id = `witch-${ability}`; b.setAttribute('aria-pressed', String(witchAbility === ability)); actions.append(b);
      }
    }
    actions.append(button('ข้ามความสามารถ', () => submitTarget('skip'), state.me.action === 'skip' ? 'secondary' : 'quiet'));
  }
  const nameOf = id => id === 'skip' ? 'ข้าม / งดออกเสียง' : state.players.find(p => p.id === id)?.name || '';
  const describeAction = a => typeof a === 'object' ? `${a.ability === 'save' ? 'ยาช่วยชีวิต' : 'ยาพิษ'} → ${nameOf(a.target)}` : nameOf(a);
  $('selection').textContent = state.me.action ? `✓ คำสั่งล่าสุด: ${describeAction(state.me.action)} · เปลี่ยนได้ก่อนหมดเวลา` : '';
  if (witchTurn) { const status = text('small', $('selection').textContent || 'เลือกยาแล้วคลิกผู้เล่นเพื่อใช้ทันที · หนึ่งชนิดต่อคืน', 'witch-status'); status.setAttribute('role','status'); actions.append(status); }
  $('log').replaceChildren(...(state.log.length ? state.log : ['คืนที่เงียบสงบ… กำลังรอทุกคนเข้าหมู่บ้าน']).map(line => text('li', line)));
  $('witch-info').hidden = state.phase !== 'witch_decision' || state.me.role !== 'witch';
  $('witch-info').textContent = state.me.wolfVictim ? `เหยื่อหมาป่าคืนนี้: ${nameOf(state.me.wolfVictim)} · เห็นเฉพาะคุณ · ยาช่วยชีวิตป้องกันหมาป่าเท่านั้น ยาพิษข้ามทุกการป้องกัน` : 'คืนนี้หมาป่าไม่ได้เลือกเหยื่อ จึงใช้ยาช่วยชีวิตไม่ได้ คุณยังเลือกยาพิษหรือข้ามได้';
  $('wolf-info').hidden = !state.wolfActions.length;
  $('wolf-info').textContent = 'แผนของฝูง: ' + state.wolfActions.map(a => `${a.name} → ${a.target ? nameOf(a.target) : 'ยังไม่เลือก'}`).join(' · ') + ' | หากคะแนนเสมอ จะโจมตีเป้าหมายที่เลขที่นั่งน้อยที่สุด';
  renderHost(); renderGM(); renderRole(); renderChat(); tick(); renderOutcome();
  if (focusSeat) [...board.querySelectorAll('.player')].find(b => b.dataset.seat === focusSeat && !b.disabled)?.focus({ preventScroll: true });
}
function renderOutcome() {
  const dialog = $('match-outcome');
  if (!finished() || !state.winner || !state.me?.outcome || state.controller) { if (dialog.open) dialog.close(); return; }
  if (dismissedOutcome === state.gameId) return;
  const outcome = state.me.outcome;
  dialog.dataset.outcome = outcome;
  $('outcome-word').textContent = outcome === 'win' ? 'WIN' : outcome === 'lose' ? 'LOSE' : 'DRAW';
  const team = state.winner === 'wolf' ? 'ทีมหมาป่า' : 'ทีมหมู่บ้าน';
  $('outcome-detail').textContent = outcome === 'draw' ? 'ไม่มีผู้รอดชีวิต · เกมเสมอ' : outcome === 'win' ? `${state.me.alive ? '' : 'คุณถูกกำจัดแล้ว แต่'}${team}ของคุณเป็นฝ่ายชนะ` : `${team}เป็นฝ่ายชนะ · ทีมของคุณแพ้ในแมตช์นี้`;
  if (!dialog.open) dialog.showModal();
}
function renderHost() {
  $('controllers').replaceChildren(...state.controllers.map(p => text('div', `${p.gm ? '⚙ GM' : '🎙 Host'} · ${p.name}${p.me ? ' (คุณ)' : ''}${p.connected ? '' : ' · หลุดการเชื่อมต่อ'}`, 'controller-seat')));
  $('host-panel').hidden = !state.controllers.length && !state.canManage;
  $('host-status').textContent = state.controller ? 'ผู้คุมเกมไม่รับบทบาทและไม่นับรวมผู้เล่น พร้อมเริ่มเมื่อผู้เล่นทุกคนพร้อม' : state.canManage ? state.phase === 'lobby' ? 'คุณสามารถร่วมเล่น หรือเปลี่ยนเป็นผู้คุมเกมแยกจากผู้เล่นในห้องรอได้' : 'คุณมีสิทธิ์ดูแลห้องและนำผู้เล่นออกจากห้อง' : '';
  $('host-seat').hidden = !state.canManage || state.phase !== 'lobby';
  $('host-seat').disabled = !state.controller && state.controllers.length >= 2;
  $('host-seat').textContent = state.controller ? 'กลับเป็นผู้เล่น' : `เป็น ${state.gm ? 'GM' : 'Host'} ผู้คุมเกม (ไม่ร่วมเล่น)`;
  $('host-step').hidden = !state.controller || !state.canManage || state.gm || !state.deadline;
}
function renderGM() {
  $('gm-panel').hidden = !state.gm;
  $('gm-open').hidden = Boolean(state);
  if (!state.gm) { $('gm-debug').replaceChildren(); return; }
  $('gm-description').textContent = state.controller ? 'GM ผู้คุมเกมอยู่นอกแมตช์ เติมบอทได้ 6–12 ตัว ไม่นับที่นั่ง GM' : 'GM ร่วมเล่น 1 ที่นั่ง สามารถเปลี่ยนเป็นผู้คุมเกมในห้องรอได้';
  const controls = $('gm-controls'); controls.replaceChildren();
  const command = (event, data = {}) => send(event, data);
  if (state.phase === 'lobby') {
    controls.append(button('+ บอท 1 ตัว', () => command('gm_bots', { operation: 'add' }), 'secondary', state.players.length >= 12));
    for (const total of [6, 9, 12]) controls.append(button(`เติมบอทให้ครบ ${total} คน`, () => command('gm_bots', { operation: 'fill', total }), 'secondary', state.players.length >= total));
    controls.append(button('ลบบอททั้งหมด', () => command('gm_bots', { operation: 'clear' }), 'quiet', !state.players.some(p => p.bot)));
    const roleLabel = text('label', 'บทบาทของ GM '), roleSelect = document.createElement('select'); roleSelect.id = 'gm-role'; roleSelect.setAttribute('aria-label', 'บทบาทของ GM ก่อนเริ่มเกม');
    const available = state.preset || getPreset(state.mode, MODES[state.mode].minPlayers);
    const randomOption = text('option', 'สุ่มตามปกติ'); randomOption.value = 'random'; roleSelect.append(randomOption);
    for (const id of Object.keys(available)) { const option = text('option', `${roles[id].icon} ${roles[id].name}`); option.value = id; roleSelect.append(option); }
    const chosen = state.gmState.selectedRole;
    if (chosen && !Object.hasOwn(available, chosen)) { const option = text('option', `${roles[chosen].name} · ไม่มีในชุดนี้`); option.value = chosen; option.disabled = true; roleSelect.append(option); }
    roleSelect.value = chosen || 'random'; roleSelect.onchange = () => command('gm_role', { role: roleSelect.value }); roleLabel.append(roleSelect); if (!state.controller) controls.append(roleLabel);
    if (chosen && !Object.hasOwn(available, chosen)) controls.append(text('small', 'เพิ่มจำนวนผู้เล่นหรือเลือกบทบาทใหม่ก่อนเริ่มเกม', 'danger'));
    const label = text('label', 'ความเร็วทดสอบ '), speed = document.createElement('select'); speed.id = 'gm-speed'; speed.setAttribute('aria-label', 'ความเร็วห้องทดสอบ');
    for (const n of [1, 5, 20]) { const option = text('option', `${n} เท่า`); option.value = n; speed.append(option); }
    speed.value = state.gmState.speed; speed.onchange = () => command('gm_speed', { speed: Number(speed.value) }); label.append(speed); controls.append(label);
  } else {
    const meta = { gameId: state.gameId, phaseId: state.phaseId };
    controls.append(button('ให้บอทส่งคำสั่งตอนนี้', () => command('gm_bots_now', meta), 'secondary', !state.deadline));
    controls.append(button('จบช่วงนี้ →', () => command('gm_step', meta), 'primary', !state.deadline));
    controls.append(button('รีเซ็ตกลับห้องรอ', () => { if (confirm('หยุดแมตช์ทดสอบและกลับห้องรอ?')) command('gm_reset'); }, 'quiet danger'));
  }
  const debug = $('gm-debug'); debug.hidden = !$('gm-reveal').checked; debug.replaceChildren();
  if (!debug.hidden && state.gmState) {
    const table = document.createElement('table'); const head = document.createElement('tr');
    for (const name of ['ผู้เล่น', 'บทบาท', 'คำสั่งล่าสุด']) head.append(text('th', name)); table.append(head);
    for (const p of state.players) {
      const info = state.gmState.players.find(x => x.id === p.id); const row = document.createElement('tr');
      const targetId = typeof info.action === 'object' && info.action ? info.action.target : info.action;
      const potion = typeof info.action === 'object' && info.action ? (info.action.ability === 'save' ? 'ยาช่วยชีวิต → ' : 'ยาพิษ → ') : '';
      const target = targetId === 'skip' ? 'ข้าม / งดออกเสียง' : potion + (state.players.find(x => x.id === targetId)?.name || 'ยังไม่ส่ง');
      for (const value of [p.name, roles[info.role]?.name || 'ยังไม่แจก', target]) row.append(text('td', value)); table.append(row);
    }
    debug.append(table);
  }
}
function renderRole() {
  const content = $('role-content'); content.replaceChildren(); const lobby = state.phase === 'lobby';
  $('reveal').hidden = state.controller || lobby || reveal || finished(); content.hidden = !state.controller && !lobby && !reveal && !finished();
  if (state.controller) { content.append(text('h3', state.gm ? '⚙ GM ผู้คุมเกม' : '🎙 Host ผู้คุมเกม'), text('p', state.gm ? 'คุณอยู่นอกแมตช์ เปิดดูบทบาทในแผง GM ได้ ไม่มีสิทธิ์โหวตหรือใช้พลัง' : 'คุณอยู่นอกแมตช์ ควบคุมเฟสและดูแลห้องได้ บทบาทลับยังเป็นความลับของผู้เล่น')); return; }
  if (lobby) { content.append(text('h3', '☽ ยังไม่มีบทบาท'), text('p',`สุ่มบทบาท ${MODES[state.mode].name} เมื่อทุกคนพร้อมและเริ่มเกม`)); return; }
  const role = roles[state.me.role]; content.append(text('h3', `${role.icon} ${role.name}`), text('p', role.description));
  if (state.me.role === 'witch') content.append(text('div', `ยาช่วยชีวิตเหลือ ${state.me.potions.save} · ยาพิษเหลือ ${state.me.potions.poison}`, 'vision'));
  if (state.me.role === 'elder') content.append(text('div', `เกราะต้านหมาป่าคงเหลือ ${state.me.armor}`, 'vision'));
  for (const v of state.me.visions) content.append(text('div', `คืน ${v.round} · ${v.name}: ${v.wolf ? 'เป็นหมาป่า 🐺' : 'ไม่ใช่หมาป่า'}`, 'vision'));
  if (!finished()) content.append(button('ซ่อนบทบาท', () => { reveal = false; render(); }, 'quiet'));
}
function renderChat() {
  const wolves = state.phase === 'night' && isWolf(state.me.role);
  $('chat-title').textContent = wolves ? 'ฝูงหมาป่า · แชตลับ' : 'วงสนทนาหมู่บ้าน';
  const enabled = ['lobby','result','ended'].includes(state.phase) || (state.me.alive || state.controller) && (['discussion','voting','runoff'].includes(state.phase) || wolves);
  $('chat-input').disabled = !enabled; $('chat-form').querySelector('button').disabled = !enabled;
  $('chat-hint').textContent = !enabled ? 'อ่านได้อย่างเดียวในช่วงนี้' : wolves ? 'เฉพาะหมาป่าเท่านั้นที่เห็นข้อความนี้' : 'Enter เพื่อส่ง · ทุกคนในหมู่บ้านเห็นข้อความ';
  const box = $('messages'); const nearEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 70;
  const msgs = state.messages.filter(m => m.channel === (wolves ? 'wolves' : 'village'));
  const key = `${wolves}-${msgs.length}-${msgs.at(-1)?.id}`;
  if (box.dataset.key === key) return; box.dataset.key = key; box.replaceChildren();
  if (!msgs.length) box.append(text('p', wolves ? 'ตกลงเลือกเหยื่อกับฝูงในช่องนี้…' : 'เริ่มทักทายเพื่อนร่วมหมู่บ้าน…', 'muted'));
  for (const m of msgs) { const e = text('div', '', 'message'); e.append(text('b',m.name),text('time',new Date(m.at).toLocaleTimeString('th-TH', { hour:'2-digit',minute:'2-digit' })),text('p',m.text)); box.append(e); }
  if (nearEnd) box.scrollTop = box.scrollHeight;
}
function tick() { if (!state) return; const seconds = state.deadline ? Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000)) : null; $('clock').textContent = seconds === null ? '☾' : `${Math.floor(seconds / 60).toString().padStart(2,'0')}:${(seconds % 60).toString().padStart(2,'0')}`; }
setInterval(tick, 250);
