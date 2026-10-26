# CLAUDE.md

ระบบเก็บฟีดแบ็คลูกค้า: ลูกค้าสแกน QR/กดลิงก์ → ให้คะแนน (ไม่ล็อกอิน) | แอดมินจัดการสาขา/คำถาม/ลิงก์ | ผู้บริหารดู Dashboard ผ่านลิงก์ลับ | ซิงก์ไป Google Sheets

## โครงสร้าง

- `web/` — HTML/CSS/vanilla JS (ES modules, ไม่มี build, ไม่มีไลบรารีภายนอก) deploy ที่ Vercel; `/r/<token>` ฟอร์มลูกค้า, `/d/<token>` Dashboard, `/admin/` แอดมิน
  - Dashboard bento: **เพิ่ม/แก้การ์ดที่ `js/dashboard/widgets.js`** (`WIDGETS` + render ต่อใบ, `when(data)` = แสดงเมื่อมีข้อมูล, `ctx.openResponse(id)` = หน้าต่างรายละเอียดรีวิว, `ctx.selectBranch(id)` = กรองสาขา); การ์ดปัจจุบัน: ตัวเลขสรุป 3 ใบ, จุดที่ต้องแก้ไข, เปรียบเทียบสาขา (ดาวรวม), รีวิวล่าสุด, การกระจายคะแนน, คำถามแบบเลือก (`choices` เช่น รู้จักเราจากไหน — รวมจากฟอร์มทุกสาขา); รายละเอียดรีวิว `GET /api/d/:token/responses/:id` และ `/api/admin/responses/:id` (`services/responses.js`); UI `dashboard/ui.js`, ลากจัดวาง `dashboard/grid.js`, ประกอบหน้า `dashboard-view.js`, สไตล์ `css/widgets.css` (ขนาด sm/wide/tall/lg ที่ `size`)
  - แอดมิน: `js/admin/main.js` เป็น hash router (`#/branches`, `#/branch/<id>`) หน้าละไฟล์ใน `js/admin/`; เพิ่มหน้า = เพิ่มใน `routes` + nav `data-route`; 401 เด้งไป `login.html`
- `server/` — Node 24 + Express 5 (ESM), mysql2 + Knex, deploy ที่ Render. `src/routes/` (public, dashboard, admin), `src/services/` (tokens, questions, links, aggregate, sheetsSync, sheetsSetup, sessionStore), `src/db/migrations|seeds`, `scripts/`
- DB: MySQL 8 (Docker) ตอน dev, **TiDB Cloud Starter** ตอน production (ใช้ไวยากรณ์ MySQL มาตรฐานเท่านั้น)
- `docs/` คู่มือ deploy/แอดมิน/Google Sheets | `render.yaml`, `vercel.json` (+ `web/vercel.json` ของเดิม ลบได้หลังย้าย Root Directory), `.github/workflows/ci.yml` (MySQL 8.4 → migrate → seed → test), `db-backup.yml`

## สถาปัตยกรรมคำขอ

- Production: เบราว์เซอร์เรียก `/api/*` บนโดเมน Vercel (`web/js/api.js`) ⇒ same-origin ไม่มี CORS; config/CSP อยู่ที่ `vercel.json` (root; Vercel Root Directory = root, `outputDirectory: web`)
  - **ฟอร์มลูกค้า `/api/r/:token` + `/submit` = Vercel Functions** (`api/r/…` → `api/_lib/form.js`) ไม่ต้องรอ Render หลับ/ตื่น; ตรรกะร่วมกับ Express ที่ `services/publicForm.js` (แก้ที่เดียว); rate limit ต่อ instance; retry 1 ครั้งเมื่อ connection หลุด; dependency ของ Functions อยู่ที่ `package.json` (root) ต้องตรงกับ `server/package.json`; env บน Vercel ต้องมีชุด DB + secret เหมือน Render (`DB_POOL_MAX=3`)
  - `/api` อื่น (แอดมิน, Dashboard) → rewrite ไป Render; worker ชีทอยู่ Render — `.github/workflows/wake-render.yml` ปลุกทุก 30 นาที
- Dev: `SERVE_WEB` (เปิดเองเมื่อไม่ใช่ production) ให้ Express เสิร์ฟ `web/` ที่ :3000 — ใช้ `localhost` ไม่ใช่ `127.0.0.1` (ไม่งั้นโดน `bad_origin`)
- `src/app.js`: `/healthz` (ห้ามแตะ DB) → `/api` (no-store) → public/dashboard → `/api/admin` (session + `requireSameOrigin`); log ซ่อน token ด้วย `redact()`
- แอดมิน: session เก็บใน DB (`sessionStore.js`), กัน CSRF ด้วย SameSite + `Origin` ต้องตรง `PUBLIC_BASE_URL`; route ที่ต้องล็อกอินใช้ `requireAdmin`
- `src/index.js` เริ่ม HTTP + Sheets worker และปิดทั้งคู่เมื่อ SIGTERM

## คำสั่ง (รันใน `server/`)

```
docker compose up -d                       # (ที่ root) MySQL ในเครื่อง
npm run db:migrate && npm run db:seed      # seed สร้างแอดมินแรกจาก ADMIN_BOOTSTRAP_USER/PASSWORD
npm run db:rollback
PORT=3000 npm run dev                      # shell เครื่องนี้มี PORT=5000 (dotenv ไม่ทับ env เดิม)
npm test                                   # ต้องมี MySQL; รันทีละไฟล์; ปฏิเสธ DB ที่ไม่ใช่ localhost
node --test tests/unit.test.js             # ไฟล์เดียว (+ --test-name-pattern="...")
npm run demo:data                          # ข้อมูลตัวอย่าง (-- --clear เพื่อลบ)
npm run secrets                            # สร้าง SESSION_SECRET / LINK_SIGNING_SECRET
npm run sheets:setup -- --key <key.json> --sheet <URL>
npm run sheets:check [-- --init]           # --init = สร้างแท็บ/หัวตาราง
npm run sheets:backfill -- --yes           # ส่งคำตอบทั้งหมดใหม่ (ชีทว่างเท่านั้น ไม่งั้นแถวซ้ำ)
```

เทสต์ที่แตะ DB ต้อง import `tests/helpers/localOnly.js`; ไม่มี linter/formatter

## ดีไซน์ (โทนขาวสะอาด + เขียวจากโลโก้แบรนด์)

- **โทเคนกลางที่ `web/css/base.css` (`:root`)** — แก้สี/ฟอนต์/มุมโค้งที่เดียว; โหมดสว่างอย่างเดียว (ไม่มีโหมดมืด); orb พื้นหลังปิดเป็นค่าเริ่มต้น; โลโก้ `web/img/logo.png`; ฟอนต์ self-host `css/fonts.css` + `web/fonts/` (OFL): หัวข้อ Fraunces + Noto Serif Thai, เนื้อหา Inter + Noto Sans Thai, ป้าย JetBrains Mono
- **ลูกเล่นอยู่ที่ `css/effects.css` + `js/ui/motion.js`**: `.grad-text`, eyebrow + จุดกระพริบ, `.glass`, `.reveal`, `.lift`, orb พื้นหลัง, `data-count-to`, หมูให้คะแนนเด้ง (ไอคอน `pigIcon()` ใน `js/form.js`, สี `--pig*` ใน base.css)/เครื่องหมายถูก; โมดอล `js/ui/modal.js` (`<dialog>`)
- **ปิดลูกเล่น:** `class="no-fx"` ที่ `<html>` (ปิดเองเมื่อตั้ง "ลดการเคลื่อนไหว"); CSS ผูกกับ `html.fx` ที่ motion.js เติมให้ จึงไม่ซ่อนเนื้อหาถ้า JS ไม่ทำงาน; animate เฉพาะ transform/opacity
- สี: ข้อความเล็กใช้ `--accent-ink`/`--text-2`/`--text-3` (ผ่าน 4.5:1 บนพื้นขาว); `--accent` ใช้กับตัวใหญ่/ไอคอน/เส้นเท่านั้น; heatmap = พื้นอ่อน + แถบยาวตามคะแนน; ระดับดาว 5→1 ใช้ `--score-5..1` (เขียว→แดง)
- ปุ่ม ⤢ มุมมองเต็ม: ใส่ `expanded` ใน widget (ดู `branchesExpanded`); ไม่ใส่ = ใช้ `render` เดิมในกล่องใหญ่

## ข้อตกลงสำคัญ (อย่าทำพัง)

- **Config**: env ตรวจด้วย zod ใน `src/config.js` (ผิด = exit; production ปฏิเสธ secret `change-me*`). เพิ่ม env ต้องแก้ `config.js`, `.env.example`, `render.yaml`; โค้ดอ่านจาก `config` ไม่อ่าน `process.env` ตรง
- **API error**: `{ error: '<snake_case>' }`; token ผิดทุกกรณีตอบ 404 เหมือนกัน
- **ลิงก์/QR** (`services/tokens.js`): token = `<public_id 12 ตัว>.<signature>`
  - **ลูกค้า (QR) คงที่ตลอดอายุลิงก์**: signature = รหัสสุ่ม 128 บิตใน `share_links.static_sig` — ไม่ขึ้นกับ secret/deploy/การแก้คำถามหรือสาขา; ไม่มีการหมุนเวียน (API ตอบ 409) ต้องการ QR ใหม่ = ลบลิงก์แล้วสร้างใหม่ — **ห้ามเขียนโค้ดที่ทำให้ QR ลูกค้าเดิมใช้ไม่ได้** (อย่าแก้ `static_sig`/`public_id`, อย่าเปลี่ยน path `/r/`)
  - ผู้บริหาร: HMAC-SHA256(LINK_SIGNING_SECRET, kind:public_id:token_version) 256 บิต ไม่เก็บ token เต็มใน DB; หมุนลิงก์ = เพิ่ม `token_version`; เปลี่ยน `LINK_SIGNING_SECRET` = ลิงก์ผู้บริหารทั้งหมดตาย (QR ลูกค้าไม่กระทบ)
- **ช่องทาง หน้าร้าน/ออนไลน์** (`store`/`online`): `share_links.channel` ของลิงก์ลูกค้า = `choose` (ค่าเริ่มต้น: QR เดียว ลูกค้าเลือกช่องทางเองที่หน้าแรกของฟอร์ม แล้วส่ง `channel` ตอน submit) หรือผูก `store`/`online` (เช่น ดอนเมืองมีแต่ออนไลน์); แอดมินเปลี่ยนช่องทางของ QR เดิมได้ (`PATCH /links/:id` — รหัสใน QR ไม่เปลี่ยน); `GET /api/r/:token` แบบ choose ยังส่ง `questions` ชุดหน้าร้านไว้ให้หน้าเว็บเก่า; คำถามมี `channels` (ไม่ระบุ = ทั้งสอง) กรองด้วย `questionsForChannel()` ใน `services/questions.js`; รีวิวเก็บ `responses.channel` เอง (ลิงก์ถูกลบได้); Dashboard/คำตอบ/สถิติรับ `?channel=`; ชีทมีคอลัมน์ `channel`
- **คำถาม: หัวข้อ + เนื้อเรื่อง**: `title` (ไม่บังคับ ≤60 เช่น "รสชาติ") แสดงเหนือ `label` (เนื้อเรื่องที่ลูกค้าอ่าน); Dashboard/หน้าคำตอบ/รายละเอียดใช้ `shortLabel(q)` (= title ถ้ามี ไม่งั้น label) — ชีทใช้รหัสคำถาม ไม่กระทบ
- **ข้อความหลังส่ง** อยู่ใน `survey_versions.settings` ต่อฟอร์ม: `sentTitle` (หน้าส่งสำเร็จ ~1.8 วิ) → `thanksTitle` + `thankYou` (หน้าขอบคุณ); แก้ได้ที่หน้าแก้ไขคำถาม; ค่าเริ่มต้นซ้ำกันใน `js/form.js` (`DONE_DEFAULTS`) และ `js/admin/survey.js` (`DONE_FIELDS`) ต้องแก้คู่กัน
- **ฟอร์มแยกสาขา (แก้แยกกันทุกสาขา)**: ทุกสาขามีฟอร์มของตัวเอง (`branches.custom_form = true`, `survey_versions.branch_id`); ฟอร์มที่ `branch_id IS NULL` = **แม่แบบสำหรับสาขาใหม่** + fallback เท่านั้น — สร้างสาขาใหม่ต้องคัดลอกแม่แบบให้ (`POST /branches`, seed ทำให้แล้ว); ดึงฟอร์มด้วย `getLatestVersion(surveyId, { branchId })` เสมอ (ห้าม query เวอร์ชันล่าสุดโดยไม่กรอง `branch_id`); เผยแพร่ผ่าน `publishVersion()` ใน `routes/admin.js` (`version_no` นับรวมทั้งแบบสอบถาม); คัดลอกฟอร์มข้ามสาขา `POST /survey/copy`; Dashboard รายสาขาใช้ฟอร์มสาขา, Dashboard รวมเทียบสาขาด้วย `branchStars` (เฉลี่ยทุกคะแนนดาว)
- **คำถาม = JSON + versioning**: เผยแพร่ = เพิ่มแถว `survey_versions` ห้ามแก้ของเก่า; `question_key` คงที่ข้ามเวอร์ชัน. เพิ่มชนิดคำถามแก้ 3 ที่: `services/questions.js` (QUESTION_TYPES + validateAnswers), `web/js/form.js`, และ `services/aggregate.js` ถ้าต้องการสถิติ
- **บันทึกคำตอบ**: `responses` + `answers` + `sheet_outbox` ใน transaction เดียว (`services/publicForm.js`); honeypot `website` ตอบสำเร็จหลอกโดยไม่บันทึก
- **ข้อความผู้ใช้**: ใช้ `textContent` (`h()` ใน `web/js/util.js`) ห้าม `innerHTML`; CSP ห้าม inline script/style (ห้าม `style="..."` ใน HTML — ใช้ `el.style.x` หรือ class)
- **Google Sheets** (`docs/google-sheets.md`): key Service Account ห้ามอยู่ในโปรเจกต์ (repo public; `sheets:setup` ปฏิเสธ); worker ห้ามทำ API ล่มเมื่อ key เสีย; `valueInputOption=RAW` เสมอ (กัน formula injection); คอลัมน์เพิ่มต่อท้ายเท่านั้น ห้ามลบ/สลับ (`mergeHeader`); ส่งผ่าน `sheet_outbox` + worker ตัวเดียว (Render `numInstances: 1`); แอดมินลบคำตอบ (`POST /api/admin/responses/delete`) → เข้าคิว `sheet_deletions` แล้ว worker ลบแถวในชีทตาม response_id (คอลัมน์ A); **เครื่อง dev ต้องไม่ซิงก์เข้าชีท production** (`SHEETS_SYNC_ENABLED=false` หรือใช้ชีทแยก) เพราะ response_id ของ dev ชนกับของจริงได้
- **TiDB**: เก็บเวลา UTC, Dashboard แปลงเป็น UTC+7 ด้วย `CONVERT_TZ(..., '+00:00', '+07:00')`; เรียงด้วย `submitted_at` ไม่ใช่ id; pool ปิด connection ว่างก่อน 340 วินาที (`db/knex.js`); TLS (`DB_SSL=true`)
- ไม่เก็บ IP ลูกค้า (PDPA); ห้าม commit `.env`; แยกค่า dev/prod

## สถานะ

Phase 0–5 เสร็จและทดสอบแล้ว. Phase 6: เตรียมไฟล์ deploy แล้ว ยังไม่ deploy จริง และยังไม่เคยรัน migration กับ TiDB Cloud — ดู `docs/deploy.md`
