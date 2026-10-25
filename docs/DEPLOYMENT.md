# เผยแพร่ MOONFALL ด้วย Netlify + Render

ผู้ใช้สร้างบริการ Netlify และ Render แล้ว: หน้าเว็บ `https://effulgent-alfajores-8367b8.netlify.app`, backend `https://moonfall-realtime.onrender.com` ตรวจ backend health และการอนุญาต Netlify origin นี้สำเร็จแล้ว ต้องตรวจสถานะ production deploy ของหน้าเว็บหลัง push ล่าสุดอีกครั้ง ไม่มีการสร้างทรัพยากรหรือเรียกเก็บเงินผ่านเครื่องมือในงานนี้

## สถาปัตยกรรม

```text
ผู้เล่น 6–12 คนเปิดลิงก์ Netlify
             │
       หน้าเว็บ static (dist)
             │ HTTPS / WSS (Socket.IO)
       Render Node Web Service
       กติกา + บทบาทลับ + timer + ห้อง
```

Netlify โฮสต์ HTML, CSS, JS, ฟอนต์ และ Socket.IO client หน้าเว็บเชื่อมต่อกับ Render โดยตรง ไม่ได้ส่ง WebSocket ผ่าน Netlify Functions และไม่พยายามเก็บห้องใน serverless function แต่ละ request เซิร์ฟเวอร์เป็นผู้ตัดสินเสมอ ไม่มีข้อมูลบทบาทลับอยู่ใน Netlify build

## ขั้นตอนสร้างลิงก์จริง

1. ส่ง source ของโปรเจกต์นี้ไปยัง branch `main` ใน GitHub repository `aluadicompany-web/werewofe` ก่อน บริการทั้งสองต้องอ่านไฟล์ชุดเดียวกันได้ ตรวจว่า branch `main` มี source และไฟล์ deploy ชุดล่าสุดก่อนเชื่อมบริการ
2. ที่ Render เลือกสร้าง Blueprint จาก repository นี้ ใช้ `render.yaml` (หรือ Web Service แบบ Node ตามค่าด้านล่าง) ไฟล์ตั้ง `plan: free`, `numInstances: 1` เพื่อทดลองใช้งาน ไม่ได้สั่งเปิดบริการจริงจาก workspace
3. Render จะให้กรอก `ALLOWED_ORIGINS` ระหว่างสร้าง Blueprint หากยังไม่มี URL Netlify ให้ตั้งชั่วคราวเป็น `https://not-configured.invalid` เพื่อไม่อนุญาตเบราว์เซอร์ใดจนกว่าจะรู้ URL จริง เมื่อ service พร้อม จด URL HTTPS เช่น `https://your-service.onrender.com` และตรวจ `/health` ต้องได้ `ok: true`, `minPlayers: 6`, `maxPlayers: 12`
4. ที่ Netlify เลือก Import from Git แล้วเชื่อม repository เดียวกัน Base directory เป็นราก repository, Build command `npm run build`, Publish directory `dist` (อยู่ใน `netlify.toml` แล้ว)
5. สำหรับบริการปัจจุบัน `netlify.toml` กำหนด **`PUBLIC_GAME_SERVER_URL`** เป็น `https://moonfall-realtime.onrender.com` ไว้แล้ว Netlify จะใช้ค่านี้เมื่อ build หากนำไป deploy เป็นชุดใหม่ ให้แก้ค่านี้หรือตั้ง Environment variable ใน Netlify เป็น HTTPS origin ของ Render ของคุณ ไม่มี path, token หรือ credentials หากไม่มีค่า build จะหยุดพร้อมข้อความชัดเจน
6. เมื่อ Netlify ให้ URL จริง เช่น `https://your-site.netlify.app` ให้กลับไป Render แทนค่า **`ALLOWED_ORIGINS`** ด้วย URL นี้แบบตรงตัว ไม่มี `/` ท้าย แล้ว redeploy Render สามารถระบุหลาย origin ที่เชื่อถือได้คั่นด้วย comma ไม่รองรับ wildcard หากเปลี่ยนชื่อเว็บหรือเพิ่ม custom domain ต้องอัปเดตค่านี้ด้วย
7. เปิด URL Netlify สร้างห้อง กด “ลิงก์เชิญ” ส่งให้เพื่อน ผู้รับเปิดลิงก์ กรอกชื่อและเข้าร่วม ทุกคนเชื่อมเซิร์ฟเวอร์เดียวกัน ต้องมี 6–12 คนและพร้อมทุกคนจึงเริ่มได้

สองค่านี้เป็น URL สาธารณะ ไม่ใช่รหัสลับ ไม่ต้องใส่ Netlify/Render access token ใน frontend หรือส่ง token ผ่านแชต

### Render Web Service หากตั้งค่าด้วยมือ

| ค่า | ใช้ |
| --- | --- |
| Runtime | Node |
| Build | `npm ci --omit=dev` |
| Start | `npm start` |
| Health check | `/health` |
| Node | 24 (ขั้นต่ำ 22) |
| NODE_ENV | `production` |
| ALLOWED_ORIGINS | Netlify origin แบบตรงตัว |
| Instances | 1 |

Render กำหนด `PORT` ให้เอง เซิร์ฟเวอร์ฟัง `0.0.0.0` แล้ว ห้ามรันหลาย instance ขณะที่ห้องยังอยู่ในหน่วยความจำ ไม่มีฐานข้อมูล Redis หรือ sticky-session adapter ในขั้นตอนนี้

## ข้อจำกัดของโฮสต์และเกม

Render Free เหมาะกับการทดลอง บริการอาจพักหรือรีสตาร์ตทำให้ต้องรอเชื่อมต่อและห้องหาย หากต้องการให้บริการต่อเนื่อง ให้เลือกแผนที่เหมาะสมในบัญชีของคุณเอง ห้องเกมในขั้นตอนนี้ยังไม่คงอยู่ข้ามการรีสตาร์ตแม้เปลี่ยนแผนแล้ว จึงควร deploy ตอนที่ไม่มีแมตช์กำลังเล่น

Netlify deploy preview มี origin คนละตัวกับเว็บหลัก จะเชื่อม backend ไม่ได้จนกว่าเพิ่ม origin ที่ต้องการใน Render อย่างชัดเจน Origin allowlist จำกัดเบราว์เซอร์ที่เรียกบริการ ไม่ใช่ระบบบัญชีผู้ใช้หรือการป้องกันบอตเต็มรูปแบบ

ยังไม่ได้ทดสอบอินเทอร์เน็ตจริง เน็ตมือถือหลายเครือข่าย โหลดจำนวนมาก หรือความสมดุลจากผู้เล่นจริง การทดสอบอัตโนมัติไม่ได้พิสูจน์ว่าโฮสต์จริงพร้อมใช้งาน

## ตรวจรับหลัง deploy

- เปิดเว็บบนสองเครื่องหรือสองเครือข่าย สถานะต้องเป็น “เชื่อมต่อแล้ว”
- ลิงก์เชิญต้องกรอกรหัสห้องให้เอง และเข้าร่วมได้เมื่อกรอกชื่อ
- น้อยกว่า 6 คนเริ่มไม่ได้ คนที่ 13 เข้าห้องไม่ได้
- ลองแมตช์ 6 และ 12 คนจนจบ ตรวจแชตลับและบทบาทที่ไม่ควรเห็น
- รีเฟรชแท็บเดิมเพื่อกลับที่นั่งเดิม และปล่อยผู้เล่น AFK ให้ timer เดินต่อ
- ตรวจ HTTPS และ WebSocket ใน browser network; หากไม่เชื่อมให้ตรวจ `PUBLIC_GAME_SERVER_URL`, `ALLOWED_ORIGINS`, service health และ Render logs
