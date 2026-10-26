# ย้ายหน้าเว็บไป Cloudflare Pages + Render

หน้าเว็บใช้ Cloudflare Pages ส่วน Node.js/Socket.IO และห้องเกมยังอยู่ที่ Render เดิม ไม่ต้องย้าย backend ไป Pages Functions รหัส GM_ADMIN_KEY ยังอยู่บน Render เท่านั้น

## สร้าง Pages จาก GitHub

1. เข้า Cloudflare Dashboard → Workers & Pages → Create application → Pages → เชื่อม Git repository (ชื่อเมนูอาจต่างตามหน้าบัญชี) เลือก `aluadicompany-web/werewofe`
2. เลือก production branch `main` และ Framework preset `None`
3. Root directory: ราก repository (เว้นว่าง) / Build command: `npm run build` / Build output directory: `dist`
4. Environment variables สำหรับ Production:

   | ชื่อ | ค่า |
   | --- | --- |
   | NODE_VERSION | 24 |
   | PUBLIC_GAME_SERVER_URL | https://moonfall-realtime.onrender.com |

   ไม่ต้องใส่ GM_ADMIN_KEY หรือ Render access token ลง Cloudflare บริการ Pages กำหนด CF_PAGES=1 อัตโนมัติ; build จะปฏิเสธ backend URL ที่ขาดหรือไม่ใช่ HTTPS
5. กด Save and Deploy รอ build สำเร็จ จด production URL จริง เช่น `https://YOUR-PROJECT.pages.dev` อย่าใช้ URL ตัวอย่างนี้เป็นค่าจริง
6. Render → moonfall-realtime → Environment → แก้ `ALLOWED_ORIGINS` ให้มี URL ใหม่ **ไม่มี / ท้าย** โดยเก็บ URL เก่าไว้ระหว่างย้าย เช่น:

   ```text
   https://effulgent-alfajores-8367b8.netlify.app,https://YOUR-PROJECT.pages.dev
   ```

   เปลี่ยน YOUR-PROJECT เป็นชื่อจริงของคุณ ใช้ comma คั่น ไม่ใช้ wildcard จากนั้น Save/redeploy และรอ Live การ restart backend จะทำให้ห้องเดิมหาย ควรทำตอนที่ไม่มีแมตช์เล่นอยู่ ไม่ต้องเปลี่ยน GM_ADMIN_KEY
7. เปิด production URL ของ Pages จากนั้นแชร์ลิงก์ใหม่นี้ให้ผู้เล่น การ push main ครั้งถัดไปจะสั่ง Pages build อัตโนมัติเมื่อเชื่อม Git สำเร็จ

## ตรวจหลังย้าย

- หน้าเกมโหลดโดยไม่มี error และเชื่อมต่อเซิร์ฟเวอร์สำเร็จ
- สร้างห้องจาก Pages แล้วส่งลิงก์เชิญให้เพื่อน: ลิงก์ต้องเป็นโดเมน Pages พร้อม `?room=...` เพื่อนเข้าห้องเดียวกันได้
- ทดสอบ 6–12 ผู้เล่น หรือเข้าห้อง GM ด้วยรหัสเดิมแล้วเติมบอต ทดลองเลือกโรลและเริ่มเกม
- ตรวจโหวตปกติ/รอบสอง เครื่องหมายผู้หยั่งรู้ และ reconnect
- ถ้าหน้าเกมเปิดได้แต่เชื่อมไม่ติด ตรวจ runtime-config.js มี Render URL ถูกต้อง และ ALLOWED_ORIGINS มี Pages production origin ตรงตัว

ไฟล์ public/_headers ถูกคัดลอกลง dist เพื่อคง security headers และไม่ cache runtime-config.js ไม่มีการใส่ข้อมูลห้องหรือบทบาทลับลง build ลิงก์เก่าไม่ย้ายหรือ redirect เอง ลิงก์ใหม่ยังใช้ backend เดียวกัน แต่ sessionStorage แยกตามโดเมน จึงควรเริ่มห้องใหม่สำหรับทดสอบการย้าย

## หลังตรวจสำเร็จ

หยุด automatic builds ของ Netlify ผ่านการตั้งค่า continuous deployment ในบัญชีเดิม หากไม่ใช้แล้ว เพื่อไม่ให้ push ครั้งใหม่ใช้เครดิต Netlify ต่อ การย้ายไป Pages อย่างเดียวไม่ได้ปิด Netlify อัตโนมัติ ยังไม่ต้องลบโปรเจกต์เก่าระหว่างตรวจ

Pages และ Render ต่างมีโควตาตามแผนบัญชี ตรวจหน้าการใช้งานของแต่ละบริการ Render Free ยังอาจพัก/รีสตาร์ตและห้องยังเก็บใน memory เหมือนเดิม Preview deployment ใช้ origin ต่างจาก production จึงไม่เชื่อม backend จนกว่าจะอนุญาต origin นั้นแยกเอง
