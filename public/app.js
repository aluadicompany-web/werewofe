import { ROLES as roles, TIMINGS } from '/shared/rules.js';
const $ = id => document.getElementById(id);
const serverUrl = window.MOONFALL_CONFIG?.serverUrl || window.location.origin;
const socket = io(serverUrl);
let state, selected = null, reveal = false, lastPhase = '', busy = false;
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
function showLanding() { state = null; selected = null; reveal = false; $('game').hidden = true; $('landing').hidden = false; }
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
socket.on('replaced', () => { saveSession(null); showLanding(); toast('ที่นั่งนี้ถูกเปิดจากอีกหน้าต่าง กรุณาใช้แท็บล่าสุด'); });
socket.on('state', next => { state = next; if (lastPhase !== next.phaseId) { selected = null; if (next.phase === 'lobby') reveal = false; lastPhase = next.phaseId; } render(); });
async function enter(create) {
  if (busy) return; const name = $('name').value.trim(); if (!name) { $('name').reportValidity(); return; }
  if (!create && !/^[a-f0-9]{6}$/i.test($('code').value.trim())) { toast('กรอกรหัสห้อง 6 ตัวอักษร'); $('code').focus(); return; }
  busy = true; const res = await send('enter', { create, name, code: $('code').value.trim() }); busy = false;
  if (res) saveSession({ name, token: res.token, code: res.code });
}
$('entry-form').addEventListener('submit', e => { e.preventDefault(); enter(true); });
$('join').onclick = () => enter(false);
$('code').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); enter(false); } });
$('help').onclick = () => $('rules').showModal(); $('close-rules').onclick = () => $('rules').close();
document.addEventListener('keydown', e => { if (e.key === '?' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) { e.preventDefault(); if (!$('rules').open) $('rules').showModal(); } });
async function copy(value, success) { try { await navigator.clipboard.writeText(value); toast(success); } catch { toast(value); } }
$('copy').onclick = () => copy(state.code, 'คัดลอกรหัสห้องแล้ว');
$('copy-link').onclick = () => { const url = new URL(location.href); url.search = ''; url.hash = ''; url.searchParams.set('room', state.code); copy(url.href, 'คัดลอกลิงก์เชิญแล้ว เพียงเปิดลิงก์และกรอกชื่อ'); };
$('leave').onclick = async () => { if (!confirm('ออกจากห้อง? ระหว่างเกมจะเสียสิทธิ์กลับเข้าที่นั่งนี้')) return; if (await send('leave')) { saveSession(null); showLanding(); } };
$('reveal').onclick = () => { reveal = true; render(); };
$('timing').onchange = () => send('settings', { timing: $('timing').value });
$('chat-form').onsubmit = async e => { e.preventDefault(); const input = $('chat-input'); const value = input.value.trim(); if (!value) return; const res = await send('chat', { text: value, channel: state.phase === 'night' ? 'wolves' : 'village' }); if (res && input.value.trim() === value) input.value = ''; };
function button(label, action, cls = '', disabled = false) { const b = text('button', label, cls); b.type = 'button'; b.disabled = disabled; b.onclick = action; return b; }
const finished = () => ['result','ended'].includes(state.phase);
function canAct() { return state.me && (state.phase === 'hunter_reaction' ? state.me.canReact : state.me.alive && (['voting','runoff'].includes(state.phase) || state.phase === 'night' && ['werewolf','seer','doctor'].includes(state.me.role))); }
function eligible(p) {
  if (!canAct() || !p.alive) return false;
  if (state.phase === 'runoff') return state.runoff.includes(p.id);
  if (['voting','hunter_reaction'].includes(state.phase)) return true;
  const role = state.me.role;
  return role === 'werewolf' ? p.role !== 'werewolf' : role === 'seer' ? !p.me : role === 'doctor' ? p.id !== state.me.lastDoctor : false;
}
async function submit() {
  if (busy || !selected) return; busy = true;
  const payload = { target: selected, gameId: state.gameId, phaseId: state.phaseId, actionId: crypto.randomUUID() };
  const res = await send('action', payload); busy = false;
  if (res) { selected = null; render(); toast('บันทึกแล้ว เปลี่ยนคำสั่งได้จนหมดเวลา'); }
}
function render() {
  if (!state) return; const focusSeat = document.activeElement?.dataset.seat; $('landing').hidden = true; $('game').hidden = false;
  $('room-code').textContent = state.code;
  const live = state.players.filter(p => p.alive).length;
  $('population').textContent = state.phase === 'lobby' ? `${state.players.length} / 12 คน · ขั้นต่ำ 6` : `รอดชีวิต ${live} / ${state.players.length} คน`;
  const victory = state.winner === 'draw' ? 'ไม่มีผู้รอดชีวิต · เสมอ' : state.winner === 'wolf' ? 'ฝูงหมาป่าเป็นฝ่ายชนะ' : 'หมู่บ้านเป็นฝ่ายชนะ';
  const labels = { lobby: 'ล้อมวงรอเพื่อน', role_reveal: 'เปิดดูบทบาทลับของคุณ', night: 'ค่ำคืนแห่งความลับ', announcement: 'ข่าวสารยามรุ่งเช้า', discussion: 'รุ่งเช้าแห่งความสงสัย', voting: 'ใครคือมนุษย์หมาป่า?', runoff: 'โหวตรอบสอง · ผู้ที่คะแนนเสมอ', execution: 'คำตัดสินของหมู่บ้าน', hunter_reaction: 'กระสุนนัดสุดท้ายของนายพราน', result: victory, ended: victory };
  $('round-label').textContent = state.phase === 'lobby' ? 'CLASSIC · 6–12 PLAYERS' : `CLASSIC · ROUND ${String(state.round).padStart(2,'0')} · ${state.phase === 'night' ? 'NIGHT' : 'DAY'}`;
  $('phase-title').textContent = labels[state.phase];
  let hint = {
    lobby: 'แชร์ลิงก์เชิญให้เพื่อน ทุกคนกดพร้อม แล้วเจ้าของห้องเริ่มเกม (6–12 คน)',
    role_reveal: 'บทบาทเป็นความลับของคุณ เมื่อหมดเวลาจะเริ่มคืนแรกโดยอัตโนมัติ',
    night: ['werewolf','seer','doctor'].includes(state.me.role) ? 'เลือกเป้าหมายแล้วกดยืนยัน เปลี่ยนคำสั่งได้จนหมดเวลา' : 'หมู่บ้านกำลังหลับใหล รอผลในยามรุ่งเช้า',
    announcement: 'เปิดเผยผู้เสียชีวิตและบทบาท กำลังเข้าสู่การสนทนา',
    discussion: 'แลกเปลี่ยนเบาะแสในแชต ใครพูดจริง ใครกำลังโกหก?',
    voting: 'โหวตผู้เล่นที่ยังมีชีวิตหรืองดออกเสียง งดออกเสียงไม่นับเป็นคะแนนของผู้ต้องสงสัย',
    runoff: 'เลือกได้เฉพาะผู้ที่คะแนนสูงสุดเสมอ หากยังเสมอจะไม่มีการประหาร',
    execution: 'รอผลการประหารและปฏิกิริยาของนายพราน ก่อนตรวจเงื่อนไขชนะ',
    hunter_reaction: state.me.canReact ? 'คุณมีโอกาสยิงครั้งสุดท้าย เลือกผู้มีชีวิตหนึ่งคน หรือข้ามภายในเวลา' : 'รอนายพรานตัดสินใจครั้งสุดท้าย เงื่อนไขชนะยังไม่ถูกตรวจระหว่างนี้',
    result: 'เปิดเผยทุกบทบาท รอสรุปผลก่อนเริ่มเกมถัดไป', ended: 'ความลับทั้งหมดถูกเปิดเผยแล้ว พร้อมกลับมาลองอีกครั้งไหม?'
  }[state.phase];
  if (!state.me.alive && !finished() && !state.me.canReact) hint = 'คุณถูกกำจัดแล้ว อ่านแชตได้ แต่ส่งข้อความ ใช้ความสามารถ หรือโหวตไม่ได้';
  $('phase-hint').textContent = hint;
  $('lobby-settings').hidden = state.phase !== 'lobby'; $('timing').value = state.timing; $('timing').disabled = !state.host;
  const preset = state.preset;
  $('preset-info').textContent = preset ? Object.entries(preset).map(([role,count]) => `${roles[role].name} ${count}`).join(' · ') + (state.players.length < 8 ? ' · Quick/Casual ไม่มีจัดอันดับ' : ' · Casual ไม่มีจัดอันดับ') : 'เมื่อครบ 6–12 คน จะแสดงชุดบทบาท Classic ตามจำนวนผู้เล่น';
  const board = $('players'); board.replaceChildren();
  state.players.forEach(p => {
    const can = eligible(p), roleVisible = p.role && (!p.me || reveal || finished() || !p.alive);
    const b = button('', () => { selected = p.id; render(); }, `player ${!p.alive ? 'dead' : ''} ${can ? 'can-select' : ''} ${selected === p.id ? 'selected' : ''}`, !can);
    b.dataset.seat = p.id; b.setAttribute('aria-label', `${p.name}${p.me ? ' คุณ' : ''}${p.alive ? '' : ' ถูกกำจัด'}`); b.setAttribute('aria-pressed', selected === p.id ? 'true' : 'false');
    b.append(text('span', String(p.seatIndex).padStart(2,'0'), 'seat'), text('span', roleVisible && state.phase !== 'lobby' ? roles[p.role].icon : !p.alive ? '✝' : ['☾','✧','♜','❖'][p.seatIndex % 4], 'avatar'), text('b', `${p.name}${p.me ? ' (คุณ)' : ''}`));
    b.append(text('small', state.phase === 'lobby' ? !p.connected ? 'หลุดการเชื่อมต่อ' : p.ready ? 'พร้อมแล้ว' : 'กำลังเตรียมตัว' : roleVisible ? `${roles[p.role].name}${p.alive ? '' : ' · เสียชีวิต'}` : !p.alive ? 'ถูกกำจัด' : !p.connected ? 'หลุดการเชื่อมต่อ' : 'ยังมีชีวิต'));
    if (p.host || p.ready && state.phase === 'lobby' || p.voted) b.append(text('span', p.voted ? '✓ โหวต' : p.host ? '♔' : '✓', 'check'));
    board.append(b);
  });
  if (state.phase === 'lobby') for (let i = state.players.length; i < 6; i++) { const e = text('div', '', 'player empty'); e.append(text('span', '+', 'avatar'),text('small','รอเพื่อนเข้าร่วม')); board.append(e); }
  const actions = $('board-actions'); actions.replaceChildren();
  if (state.phase === 'lobby') {
    actions.append(button(state.me.ready ? '✓ พร้อมแล้ว · ยกเลิก' : 'ฉันพร้อมแล้ว', () => send('ready'), state.me.ready ? 'secondary' : 'primary'));
    if (state.host) for (const p of state.players.filter(p => !p.connected)) actions.append(button(`นำ ${p.name} ออกจากห้อง`, () => send('remove', { target: p.id }), 'quiet danger'));
    if (state.host) actions.append(button('เริ่มคืนแรก →', () => send('start'), 'primary', state.players.length < 6 || state.players.length > 12 || !state.players.every(p => p.ready && p.connected)));
  } else if (state.phase === 'discussion' && state.host) actions.append(button('เปิดการลงคะแนน →', () => send('next', { gameId: state.gameId, phaseId: state.phaseId }), 'primary'));
  else if (state.phase === 'ended' && state.host) actions.append(button('เล่นอีกครั้ง ↻', () => send('rematch'), 'primary'));
  else if (canAct()) {
    actions.append(button('ยืนยันเป้าหมาย →', submit, 'primary', !selected));
    actions.append(button(['voting','runoff'].includes(state.phase) ? 'งดออกเสียง' : 'ข้ามความสามารถ', () => { selected = 'skip'; render(); }, selected === 'skip' ? 'secondary' : 'quiet'));
  }
  const nameOf = id => id === 'skip' ? 'ข้าม / งดออกเสียง' : state.players.find(p => p.id === id)?.name || '';
  $('selection').textContent = selected ? `เป้าหมาย: ${nameOf(selected)} · กดยืนยันเพื่อส่ง` : state.me.action ? `✓ คำสั่งล่าสุด: ${nameOf(state.me.action)} · เปลี่ยนได้ก่อนหมดเวลา` : '';
  $('log').replaceChildren(...(state.log.length ? state.log : ['คืนที่เงียบสงบ… กำลังรอทุกคนเข้าหมู่บ้าน']).map(line => text('li', line)));
  $('wolf-info').hidden = !state.wolfActions.length;
  $('wolf-info').textContent = 'แผนของฝูง: ' + state.wolfActions.map(a => `${a.name} → ${a.target ? nameOf(a.target) : 'ยังไม่เลือก'}`).join(' · ') + ' | หากคะแนนเสมอ จะโจมตีเป้าหมายที่เลขที่นั่งน้อยที่สุด';
  renderRole(); renderChat(); tick();
  if (focusSeat) [...board.children].find(b => b.dataset.seat === focusSeat && !b.disabled)?.focus({ preventScroll: true });
}
function renderRole() {
  const content = $('role-content'); content.replaceChildren(); const lobby = state.phase === 'lobby';
  $('reveal').hidden = lobby || reveal || finished(); content.hidden = !lobby && !reveal && !finished();
  if (lobby) { content.append(text('h3', '☽ ยังไม่มีบทบาท'), text('p','สุ่มบทบาท Classic เมื่อทุกคนพร้อมและเริ่มเกม')); return; }
  const role = roles[state.me.role]; content.append(text('h3', `${role.icon} ${role.name}`), text('p', role.description));
  if (state.me.role === 'elder') content.append(text('div', `เกราะต้านหมาป่าคงเหลือ ${state.me.armor}`, 'vision'));
  for (const v of state.me.visions) content.append(text('div', `คืน ${v.round} · ${v.name}: ${v.wolf ? 'เป็นหมาป่า 🐺' : 'ไม่ใช่หมาป่า'}`, 'vision'));
  if (!finished()) content.append(button('ซ่อนบทบาท', () => { reveal = false; render(); }, 'quiet'));
}
function renderChat() {
  const wolves = state.phase === 'night' && state.me.role === 'werewolf';
  $('chat-title').textContent = wolves ? 'ฝูงหมาป่า · แชตลับ' : 'วงสนทนาหมู่บ้าน';
  const enabled = ['lobby','result','ended'].includes(state.phase) || state.me.alive && (['discussion','voting','runoff'].includes(state.phase) || wolves);
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
