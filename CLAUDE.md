# CLAUDE.md

ระบบเก็บฟีดแบ็คลูกค้า: ลูกค้าสแกน QR/กดลิงก์ → ให้คะแนน (ไม่ล็อกอิน) | แอดมินส่วนกลางจัดการสาขา/คำถาม/ลิงก์ | ผู้บริหารดู Dashboard ผ่านลิงก์ลับ | ซิงก์ไป Google Sheets

## โครงสร้าง

- `web/` — หน้าบ้าน HTML/CSS/vanilla JS (ES modules, ไม่มี build, ไม่มีไลบรารีภายนอก) deploy ที่ Vercel; `/r/<token>` ฟอร์มลูกค้า, `/d/<token>` Dashboard, `/admin/` แอดมิน
  - Dashboard แบบ bento ลากจัดวางได้: **เพิ่ม/แก้การ์ดที่ `web/js/dashboard/widgets.js`** (รายการ `WIDGETS` + ฟังก์ชัน render ต่อใบ), ชิ้นส่วน UI `dashboard/ui.js`, ตัวลากจัดวาง `dashboard/grid.js`, ประกอบหน้า `dashboard-view.js`, หน้าตา `css/widgets.css` (ขนาดการ์ด sm/wide/tall/lg กำหนดที่ `size`)
- `server/` — Node 24 + Express 5 (ESM), mysql2 + Knex; deploy ที่ Render. `src/routes/` (public, dashboard, admin), `src/services/` (tokens, questions, links, aggregate, sheetsSync, sessionStore), `src/db/migrations|seeds`
- ฐานข้อมูล: MySQL 8 (Docker) ตอนพัฒนา, **TiDB Cloud Starter** ตอน production (ไวยากรณ์ MySQL มาตรฐานเท่านั้น)
- `docs/` คู่มือ deploy และแอดมิน | `render.yaml`, `web/vercel.json`, `.github/workflows/db-backup.yml`

## คำสั่งที่ใช้บ่อย (รันใน `server/`)

```
docker compose up -d        # (ที่ root) MySQL ในเครื่อง
npm run db:migrate && npm run db:seed
PORT=3000 npm run dev       # เครื่องนี้มี PORT=5000 ใน shell จึงต้องระบุเอง (dotenv ไม่ทับ env ที่มีอยู่)
npm test                    # ต้องมี MySQL; รันทีละไฟล์ (--test-concurrency=1) และปฏิเสธ DB ที่ไม่ใช่ localhost
npm run demo:data           # ข้อมูลตัวอย่างสำหรับดู Dashboard  (-- --clear เพื่อลบ)
npm run secrets             # สร้าง SESSION_SECRET / LINK_SIGNING_SECRET
```

## ดีไซน์และลูกเล่น (สไตล์ editorial อบอุ่น: กระดาษ + เขียวหมึก + terracotta)

- **โทเคนกลางอยู่ที่ `web/css/base.css` (`:root` + โหมดมืด)** — แก้สี/ฟอนต์/มุมโค้งที่นี่ที่เดียว; ฟอนต์ self-host ที่ `css/fonts.css` + `web/fonts/` (OFL) หัวข้อ Fraunces + Noto Serif Thai, เนื้อหา Inter + Noto Sans Thai, ป้ายเล็ก JetBrains Mono
- **ลูกเล่นทั้งหมดอยู่ที่ `css/effects.css` + `js/ui/motion.js`**: หัวเรื่องไล่สี (`.grad-text`), ป้าย eyebrow + จุดกระพริบ, nav กระจกเบลอ (`.glass`), reveal ตอนเลื่อน (`.reveal`), hover ยกการ์ด (`.lift`), orb ลอยพื้นหลัง, ตัวเลขนับขึ้น (`data-count-to`), ดาวเด้ง/เครื่องหมายถูกวาดเส้น; โมดอลใช้ `js/ui/modal.js` (`<dialog>` เนทีฟ)
- **ปิดลูกเล่นทั้งหมด:** ใส่ `class="no-fx"` ที่ `<html>` (ระบบปิดเองเมื่อผู้ใช้ตั้ง "ลดการเคลื่อนไหว") — CSS ผูกกับ `html.fx` ที่ motion.js เติมให้เมื่ออนุญาตเท่านั้น จึงไม่ซ่อนเนื้อหาถ้า JS ไม่ทำงาน; animation ใช้เฉพาะ transform/opacity
- สี: ข้อความเล็กใช้ `--accent-ink`/`--text-2`/`--text-3` (ผ่าน 4.5:1 ตรวจแล้วทั้งสว่าง/มืด); `--accent` ใช้กับตัวใหญ่/ไอคอน/เส้นเท่านั้น; heatmap ใช้พื้นอ่อน + แถบความยาวตามคะแนน เพื่อให้ตัวอักษรอ่านชัดเสมอ
- การ์ด Dashboard เพิ่มปุ่ม ⤢ เปิดมุมมองเต็ม: ใส่ `expanded` ใน widget (ดู `branchesExpanded` ใน `widgets.js`); ถ้าไม่ใส่ จะแสดง `render` เดิมในกล่องใหญ่

## ข้อตกลงสำคัญ (อย่าทำพัง)

- **ลิงก์ลับ**: token = `<public_id 12 ตัว>.<HMAC-SHA256(LINK_SIGNING_SECRET, kind:public_id:token_version)>` ไม่เก็บ token เต็มใน DB; ลูกค้า 128 บิต, ผู้บริหาร 256 บิต; ทุกความล้มเหลวตอบ 404 เหมือนกัน. เปลี่ยน `LINK_SIGNING_SECRET` = ลิงก์/QR ทั้งหมดตาย
- **คำถามเป็นข้อมูล (JSON) + versioning**: เผยแพร่ = เพิ่ม `survey_versions` แถวใหม่ ห้ามแก้ของเก่า; `question_key` ต้องคงที่ข้ามเวอร์ชัน. เพิ่มชนิดคำถามต้องแก้ 3 ที่: `services/questions.js` (QUESTION_TYPES + validateAnswers), `web/js/form.js` (renderer), และถ้าต้องการสถิติ `services/aggregate.js`
- **ข้อความจากผู้ใช้**: แสดงผลด้วย `textContent` (helper `h()` ใน `web/js/util.js`) ห้ามใช้ `innerHTML` กับข้อมูลจากผู้ใช้; CSP ของ Vercel ไม่อนุญาต inline script/style (ห้ามใส่ `style="..."` ใน HTML — ตั้งสีผ่าน `el.style.x` ใน JS หรือ class ได้)
- **Google Sheets**: ใช้ `valueInputOption=RAW` เสมอ (กัน formula injection); ส่งผ่าน `sheet_outbox` + worker ตัวเดียว (Render `numInstances: 1`)
- **TiDB**: เวลาเก็บเป็น UTC, วันใน Dashboard แปลงเป็น UTC+7 ด้วย `CONVERT_TZ(..., '+00:00', '+07:00')`; เรียงด้วย `submitted_at` ไม่ใช่ id; pool ปิด connection ว่างก่อน 340 วินาที; ต่อ TLS (`DB_SSL=true`)
- ไม่เก็บ IP ลูกค้า (PDPA); `.env` ห้าม commit; ค่า dev/prod แยกกัน

## สถานะ

Phase 0–5 เสร็จและทดสอบแล้ว (เทสต์ 32 รายการผ่าน; Dashboard ใช้ดีไซน์ bento ลากจัดวางได้). Phase 6: ไฟล์ deploy เตรียมไว้แล้ว ยังไม่ได้ deploy จริงและยังไม่เคยรัน migration กับ TiDB Cloud จริง — ดู `docs/deploy.md`
