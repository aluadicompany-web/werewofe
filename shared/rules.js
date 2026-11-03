export const ROLES = {
  werewolf: { name: 'มนุษย์หมาป่า', team: 'wolf', countsAsWolf: true, icon: '🐺', description: 'เลือกเหยื่อร่วมกับฝูงทุกคืน ชนะเมื่อจำนวนหมาป่าไม่น้อยกว่าฝ่ายหมู่บ้าน' },
  seer: { name: 'ผู้หยั่งรู้', team: 'village', icon: '🔮', description: 'ตรวจสอบผู้เล่นอื่นหนึ่งคนต่อคืน ผลจะส่งให้คุณเฉพาะเมื่อคุณรอดถึงเช้า' },
  doctor: { name: 'หมอ', team: 'village', icon: '💊', description: 'ป้องกันการโจมตีของหมาป่าให้หนึ่งคน รวมตัวเองได้ ห้ามคนเดิมสองคืนติดกัน' },
  hunter: { name: 'นายพราน', team: 'village', icon: '🏹', description: 'หากถูกหมาป่าฆ่าหรือถูกโหวตประหาร เลือกยิงผู้เล่นที่มีชีวิตได้หนึ่งครั้ง ภายใน 15 วินาที' },
  elder: { name: 'ผู้อาวุโส', team: 'village', icon: '🌳', description: 'รอดจากการโจมตีของหมาป่าที่จะทำให้ตายครั้งแรกหนึ่งครั้ง การโหวตยังทำให้ตายทันที' },
  guard: { name: 'ผู้พิทักษ์', team: 'village', icon: '🛡️', description: 'เลือกปกป้องผู้เล่นอื่นหนึ่งคนต่อคืน หากหมาป่าโจมตีถึงตาย คุณจะเสียสละแทน หมอหรือยาช่วยชีวิตมีผลก่อน ห้ามเลือกตัวเอง' },
  witch: { name: 'แม่มด', team: 'village', icon: '🧪', description: 'หลังหมาป่าล็อกเป้าหมาย มีเวลา 12 วินาทีเลือกยาช่วยชีวิตหรือยาพิษ แต่ละชนิดใช้ได้ครั้งเดียวต่อเกม ใช้ได้หนึ่งชนิดต่อคืน ช่วยตัวเองได้ ยาพิษข้ามทุกการป้องกัน' },
  alpha_wolf: { name: 'จ่าฝูงหมาป่า', team: 'wolf', countsAsWolf: true, icon: '🐺', description: 'อยู่ฝ่ายหมาป่า ร่วมเลือกเหยื่อและใช้แชตฝูงเหมือนหมาป่าปกติ แต่ผู้หยั่งรู้จะตรวจพบว่าไม่ใช่หมาป่า' },
  minion: { name: 'ลูกสมุนหมาป่า', team: 'wolf', countsAsWolf: false, icon: '🗝️', description: 'รู้ว่าใครเป็นหมาป่า แต่หมาป่าไม่รู้จักคุณ ไม่มีพลังฆ่าหรือแชตฝูง ผู้หยั่งรู้ตรวจว่าไม่ใช่หมาป่า ชนะร่วมกับหมาป่าแม้คุณตายแล้ว หากหมาป่าตายหมดคุณแพ้ ไม่นับเป็นหมาป่าในเงื่อนไขจำนวน' },
  villager: { name: 'ชาวบ้าน', team: 'village', icon: '🕯️', description: 'อภิปราย จับพิรุธ และโหวตกำจัดหมาป่าให้หมด ไม่มีความสามารถกลางคืน' }
};
// Fixed decks. Six-player Minion variant follows the human-playtest change; 7–12 unchanged.
export const CLASSIC_PRESETS = {
  6: { werewolf: 1, minion: 1, seer: 1, doctor: 1, villager: 2 },
  7: { werewolf: 2, seer: 1, doctor: 1, villager: 3 },
  8: { werewolf: 2, seer: 1, doctor: 1, villager: 4 },
  9: { werewolf: 2, seer: 1, doctor: 1, hunter: 1, villager: 4 },
  10: { werewolf: 2, seer: 1, doctor: 1, hunter: 1, villager: 5 },
  11: { werewolf: 3, seer: 1, doctor: 1, hunter: 1, villager: 5 },
  12: { werewolf: 3, seer: 1, doctor: 1, hunter: 1, elder: 1, villager: 5 }
};
export const TIMINGS = {
  quick: { name: 'เร็ว', night: 25000, discussion: 60000, voting: 20000, result: 5000 },
  standard: { name: 'มาตรฐาน', night: 40000, discussion: 120000, voting: 30000, result: 8000 },
  relaxed: { name: 'ผ่อนคลาย', night: 60000, discussion: 180000, voting: 45000, result: 10000 }
};
// Experimental Advanced decks from the supplied design. Casual only.
export const ADVANCED_PRESETS = {
  9: { werewolf: 2, seer: 1, doctor: 1, guard: 1, villager: 4 },
  10: { werewolf: 2, seer: 1, doctor: 1, witch: 1, villager: 5 },
  11: { werewolf: 2, alpha_wolf: 1, seer: 1, doctor: 1, hunter: 1, elder: 1, villager: 4 },
  12: { werewolf: 2, alpha_wolf: 1, seer: 1, doctor: 1, hunter: 1, witch: 1, villager: 5 }
};
export const MODES = {
  classic: { name: 'Classic', minPlayers: 6, maxPlayers: 12 },
  advanced: { name: 'Advanced · ทดลอง', minPlayers: 9, maxPlayers: 12 }
};
export function getPreset(mode, count) {
  const presets = mode === 'classic' ? CLASSIC_PRESETS : mode === 'advanced' ? ADVANCED_PRESETS : null;
  return presets && Object.hasOwn(presets, count) ? presets[count] : null;
}
// Winning allegiance does not grant wolf attack, chat, plan access or parity.
export const isWolf = role => ROLES[role]?.countsAsWolf === true;
export const winningTeam = role => ROLES[role]?.team || null;
export const knowsWolves = role => isWolf(role) || role === 'minion';
