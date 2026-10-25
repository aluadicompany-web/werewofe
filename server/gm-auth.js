import { createHash, timingSafeEqual } from 'node:crypto';
const digest = value => createHash('sha256').update(value).digest();
export function createGMGate(secret) {
  const enabled = typeof secret === 'string' && secret.length >= 24 && secret.length <= 256;
  const expected = enabled ? digest(secret) : null;
  const attempts = new Map();
  return (candidate, peer, now = Date.now()) => {
    if (!enabled) throw Error('โหมด GM ยังไม่เปิด กรุณาตั้ง GM_ADMIN_KEY บน Render อย่างน้อย 24 ตัวอักษร');
    for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
    const entry = attempts.get(peer) || { count: 0, until: now + 60000 };
    if (entry.count >= 5) throw Error('รหัส GM ผิดหลายครั้ง กรุณารอ 1 นาที');
    const valid = typeof candidate === 'string' && candidate.length <= 256 && timingSafeEqual(digest(candidate), expected);
    if (!valid) { entry.count++; if (attempts.size >= 1000 && !attempts.has(peer)) throw Error('กรุณารอสักครู่แล้วลองใหม่'); attempts.set(peer, entry); throw Error('รหัส GM ไม่ถูกต้อง'); }
    attempts.delete(peer);
  };
}
