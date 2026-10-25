export const ROLES = {
  werewolf: { name: 'มนุษย์หมาป่า', team: 'wolf', icon: '🐺', description: 'เลือกเหยื่อร่วมกับฝูงทุกคืน ชนะเมื่อจำนวนหมาป่าไม่น้อยกว่าฝ่ายหมู่บ้าน' },
  seer: { name: 'ผู้หยั่งรู้', team: 'village', icon: '🔮', description: 'ตรวจสอบผู้เล่นอื่นหนึ่งคนต่อคืน ผลจะส่งให้คุณเฉพาะเมื่อคุณรอดถึงเช้า' },
  doctor: { name: 'หมอ', team: 'village', icon: '💊', description: 'ป้องกันการโจมตีของหมาป่าให้หนึ่งคน รวมตัวเองได้ ห้ามคนเดิมสองคืนติดกัน' },
  hunter: { name: 'นายพราน', team: 'village', icon: '🏹', description: 'หากถูกหมาป่าฆ่าหรือถูกโหวตประหาร เลือกยิงผู้เล่นที่มีชีวิตได้หนึ่งครั้ง ภายใน 15 วินาที' },
  elder: { name: 'ผู้อาวุโส', team: 'village', icon: '🌳', description: 'รอดจากการโจมตีของหมาป่าที่จะทำให้ตายครั้งแรกหนึ่งครั้ง การโหวตยังทำให้ตายทันที' },
  villager: { name: 'ชาวบ้าน', team: 'village', icon: '🕯️', description: 'อภิปราย จับพิรุธ และโหวตกำจัดหมาป่าให้หมด ไม่มีความสามารถกลางคืน' }
};
// Fixed Classic decks from the supplied design, never a shuffled role-to-player mapping.
export const CLASSIC_PRESETS = {
  6: { werewolf: 1, seer: 1, doctor: 1, villager: 3 },
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
