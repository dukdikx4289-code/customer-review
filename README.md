# Customer Review Collection

ระบบเก็บฟีดแบ็คลูกค้า: ลูกค้าสแกน QR/กดลิงก์ → ให้คะแนน → ส่ง (ไม่ล็อกอิน) | แอดมินส่วนกลางจัดการสาขา/คำถาม/ลิงก์ | ผู้บริหารดู Dashboard รวมผ่านลิงก์ลับ | ข้อมูลซิงก์ไป Google Sheets

## โครงสร้าง

| โฟลเดอร์ | หน้าที่ | Deploy |
|---|---|---|
| `web/` | หน้าบ้าน HTML/CSS/JS (ฟอร์มลูกค้า, Dashboard, แอดมิน) | Vercel |
| `server/` | Node.js + Express API, worker ซิงก์ Google Sheets | Render |
| `database/` | เอกสาร/สคริปต์ที่เกี่ยวกับฐานข้อมูล | – |
| `docs/` | requirement, คู่มือ | – |
| `docker-compose.yml` | MySQL 8 สำหรับพัฒนาในเครื่อง (production ใช้ TiDB Cloud) | – |

## เริ่มพัฒนาในเครื่อง

ต้องมี Node.js 22+ และ Docker Desktop (เปิดโปรแกรมให้รันอยู่)

```bash
docker compose up -d
cd server
cp .env.example .env
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

- เปิด http://localhost:3000/admin/ (เสิร์ฟหน้าบ้านจากเซิร์ฟเวอร์ตัวเดียวตอนพัฒนา) — ใช้ `localhost` ให้ตรงกับ `PUBLIC_BASE_URL` ไม่ใช่ `127.0.0.1` ไม่งั้นแอดมินจะโดน `bad_origin`
- ตั้ง `ADMIN_BOOTSTRAP_USER/PASSWORD` ใน `.env` ก่อนรัน `db:seed` เพื่อสร้างแอดมินคนแรก
- ถ้า shell ของคุณมีตัวแปร `PORT` อยู่แล้ว ให้รัน `PORT=3000 npm run dev`
- `npm run demo:data` สร้างข้อมูลตัวอย่าง + ลิงก์ตัวอย่างให้ดู Dashboard (`-- --clear` เพื่อลบ)

```bash
npm test
```

## Environment variables

ดูรายการและคำอธิบายทั้งหมดใน `server/.env.example` — ห้าม commit ไฟล์ `.env`
`LINK_SIGNING_SECRET` เปลี่ยนภายหลัง = ลิงก์/QR ที่แจกไปแล้วทั้งหมดใช้ไม่ได้

## เอกสาร

- [คู่มือ Deploy](docs/deploy.md) — TiDB Cloud + Render + Vercel + Google Sheets (ไฟล์ตั้งค่าเตรียมไว้แล้ว)
- [คู่มือแอดมิน](docs/admin-guide.md)
- [CLAUDE.md](CLAUDE.md) — ข้อตกลงของโค้ดสำหรับผู้พัฒนา

## สถานะ

- [x] Phase 0: โครงโปรเจกต์, config + zod, `/healthz`
- [x] Phase 1: migration + seed
- [x] Phase 2: ฟอร์มลูกค้า (responsive) + ลิงก์ลายเซ็น + rate limit/honeypot
- [x] Phase 3: Google Sheets sync (outbox + worker + backfill) — ทดสอบด้วย client จำลอง ยังไม่เคยต่อ Google จริง
- [x] Phase 4: แอดมิน (สาขา, คำถาม+เวอร์ชัน, ลิงก์/QR/หมุนเวียน, คำตอบ)
- [x] Phase 5: Dashboard ผู้บริหาร
- [ ] Phase 6: Deploy จริง (เตรียมไฟล์ไว้แล้ว) — ยังไม่เคยรัน migration กับ TiDB Cloud จริง
