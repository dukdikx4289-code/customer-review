# คู่มือ Deploy (TiDB Cloud + Render + Vercel + Google Sheets)

โค้ดและไฟล์ตั้งค่าเตรียมไว้ครบแล้ว ([render.yaml](../render.yaml), [web/vercel.json](../web/vercel.json), [db-backup.yml](../.github/workflows/db-backup.yml)) ที่เหลือคือขั้นตอนที่ต้องใช้บัญชีของคุณ **ทำตามลำดับด้านล่าง**

> ค่าใช้จ่ายโดยประมาณ: Render Starter $7/เดือน + TiDB Starter ฟรี + Vercel Hobby ฟรี (ถ้าใช้เชิงธุรกิจจริงต้อง Vercel Pro $20/เดือน) — รายละเอียดในแผนงานข้อ 9

## 0. ก่อนเริ่ม

> ⚠️ **repo นี้อยู่บน GitHub แบบ public** — ในโค้ดไม่มีความลับ (ค่าทั้งหมดอยู่ใน env) แต่ **อย่า commit `.env`/ไฟล์ key ของ Google เด็ดขาด** และงานสำรองข้อมูล (`db-backup.yml`) จะถูกข้ามอัตโนมัติจนกว่าจะเปลี่ยน repo เป็น private (ไฟล์สำรองมีความคิดเห็นของลูกค้า ห้ามให้คนนอกดาวน์โหลดได้) — แนะนำให้เปลี่ยนเป็น private ก่อนใช้งานจริง (Settings → General → Danger Zone → Change visibility)

- [ ] ตัดสินใจ **โดเมน** ที่ลูกค้าจะเห็นใน QR (เช่น `review.yourshop.com`) — QR ที่พิมพ์แล้วเปลี่ยนปลายทางยาก ถ้ายังไม่มีโดเมน ใช้ `xxx.vercel.app` ไปก่อนได้ แต่ต้องรู้ว่าเปลี่ยนภายหลัง = ต้องพิมพ์ QR ใหม่
- [ ] push โค้ดขึ้น **GitHub (private repo)** (โฟลเดอร์ `customer-review/` เป็น root ของ repo)
- [ ] สร้าง secret: `cd server && npm run secrets` แล้ว **เก็บ `LINK_SIGNING_SECRET` ใน password manager**

## 1. TiDB Cloud (ฐานข้อมูล)

1. สมัคร [tidbcloud.com](https://tidbcloud.com) → สร้างคลัสเตอร์ **Starter** ชื่อ `review-prod` เลือก region **AWS Singapore (ap-southeast-1)**
2. กด **Connect** → Connection type: Public → สร้าง/คัดลอก **Host, Port (4000), User, Password** และตั้ง database ชื่อ `customer_review` (สร้างผ่าน SQL Editor: `CREATE DATABASE customer_review CHARACTER SET utf8mb4;`)
3. (แนะนำ) สร้างคลัสเตอร์ที่สองชื่อ `review-dev` ไว้ทดสอบ migration ก่อนขึ้นจริง
4. **ตั้ง Spending Limit** (ถ้าผูกบัตร) และดูหน้า Usage — ถ้าโควตา RU ฟรีหมด ลูกค้าจะส่งฟอร์มไม่ได้
5. ทดสอบ migration กับ `review-dev` จากเครื่องคุณ: ตั้ง `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME/DB_SSL=true` ใน `server/.env` แล้วรัน `npm run db:migrate && npm run db:seed`
   *(ชุดเทสต์ปฏิเสธการรันกับ DB ที่ไม่ใช่ localhost โดยตั้งใจ)*

## 2. Google Sheets

ทำตาม **[docs/google-sheets.md](google-sheets.md)** (ประมาณ 10 นาที) แล้วใช้คำสั่งช่วยตั้งค่า/ตรวจสอบ:

```bash
cd server
npm run sheets:setup -- --key "<ไฟล์ key.json นอกโฟลเดอร์โปรเจกต์>" --sheet "<URL ชีท>" --copy   # --copy = คัดลอกค่า base64 ไปวางใน Render
npm run sheets:check -- --init                                                                  # ตรวจการเชื่อมต่อ + สร้างแท็บ/หัวตาราง
```

ใช้ key/ชีท **คนละชุด** กับตอนพัฒนา แล้วนำ `GOOGLE_SHEET_ID` กับ `GOOGLE_SERVICE_ACCOUNT_JSON_B64` ไปตั้งใน Render (ขั้น 3)

## 3. Render (API)

1. [render.com](https://render.com) → New → **Blueprint** → เลือก repo → Render อ่าน [render.yaml](../render.yaml)
2. กรอกค่า `sync: false` ใน Dashboard → Environment:

| ตัวแปร | ค่า |
|---|---|
| `DB_HOST` `DB_USER` `DB_PASSWORD` `DB_NAME` | จาก TiDB Cloud (ข้อ 1) |
| `LINK_SIGNING_SECRET` | จาก `npm run secrets` (เก็บสำรองไว้!) |
| `PUBLIC_BASE_URL` | โดเมนที่ลูกค้าเปิดจริง เช่น `https://review.yourshop.com` (ไม่มี `/` ท้าย) |
| `GOOGLE_SHEET_ID` `GOOGLE_SERVICE_ACCOUNT_JSON_B64` | จากข้อ 2 (ถ้ายังไม่พร้อม ตั้ง `SHEETS_SYNC_ENABLED=false` ก่อน) |

3. Deploy → ดู Logs ต้องเห็น `server listening` และ migration ผ่าน → เปิด `https://<service>.onrender.com/healthz` ต้องได้ `{"ok":true}`
4. สร้างแอดมินคนแรก: Render → Shell (หรือรันจากเครื่องคุณชี้ไปที่ TiDB prod) ด้วย
   `ADMIN_BOOTSTRAP_USER=<ชื่อ> ADMIN_BOOTSTRAP_PASSWORD=<รหัสผ่านยาว ≥10> npm run db:seed` แล้ว **ลบตัวแปรนี้ทิ้ง** และเปลี่ยนรหัสผ่านที่หน้า "บัญชี"
   *(seed ใส่สาขาและแบบสอบถามตัวอย่างด้วย — ลบ/แก้ที่หน้าแอดมินได้)*

## 4. Vercel (หน้าบ้าน + ฟอร์มลูกค้า)

Vercel เสิร์ฟ `web/` และรัน **Vercel Functions ของฟอร์มลูกค้า** (`api/form-load.js` / `api/form-submit.js`: เปิดคำถาม + ส่งคำตอบ — rewrite จาก `/api/r/…` ใน vercel.json) เอง ลูกค้าที่สแกน QR จึงไม่ต้องรอ Render ตื่น · `/api` อื่น (แอดมิน, Dashboard) rewrite ไป Render ตาม [vercel.json](../vercel.json)

1. [vercel.com](https://vercel.com) → Add New → Project → เลือก repo → **Root Directory = โฟลเดอร์หลักของ repo (ว่าง / `./`)**, Framework = Other — config อยู่ที่ [vercel.json](../vercel.json) (`outputDirectory: web`, Functions รันที่สิงคโปร์ `sin1` ใกล้ TiDB)
2. Project → Settings → **Environment Variables** (Production) — คัดลอกค่าเดียวกับ Render:
   `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` `DB_SSL=true` `SESSION_SECRET` `LINK_SIGNING_SECRET` `PUBLIC_BASE_URL` และตั้ง `NODE_ENV=production` `DB_POOL_MAX=3`
3. แก้ `destination` ของ `/api/:path*` ใน [vercel.json](../vercel.json) ให้ชี้ URL Render จริง แล้ว push
4. ตั้งโดเมน (ถ้ามี): Project → Settings → Domains
5. ให้ `PUBLIC_BASE_URL` (ทั้ง Render และ Vercel) **ตรงกับโดเมนนี้เป๊ะ** (ใช้ตรวจ Origin ของแอดมินและสร้างลิงก์) — ถ้าเปลี่ยนโดเมนต้องแก้ค่านี้แล้วลิงก์ที่คัดลอกจากหน้าแอดมินจะเป็นโดเมนใหม่โดยอัตโนมัติ (QR ที่พิมพ์ไปแล้วต้องพิมพ์ใหม่)
6. ตรวจว่าฟอร์มวิ่งที่ Vercel: `curl -sI https://<โดเมน>/api/r/x` ต้องได้ `404` และ**ไม่มี** header `rndr-id` (มี = ยังวิ่งไป Render)

> `web/vercel.json` = config เดิมตอน Root Directory = `web` (ไม่มีฟอร์มบน Vercel) — ลบได้เมื่อย้าย Root Directory แล้ว
> Google Sheets: คำตอบเข้าคิว `sheet_outbox` แล้ว worker บน Render ส่งขึ้นชีท — Render ฟรีหลับได้ จึงมี workflow `wake-render` ปลุกทุก 30 นาที (แถวในชีทช้าได้ถึง ~30 นาที; ใช้ Render Starter แล้วลบ workflow นี้ได้)

## 5. GitHub Actions (สำรองข้อมูล)

Repo → Settings → Secrets → ตั้ง `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` → Actions → db-backup → **Run workflow** 1 ครั้งเพื่อทดสอบ และลอง restore ไฟล์ลง DB ทดสอบก่อนพึ่งพา

## 6. ตรวจหลัง Deploy (ก่อนพิมพ์ QR)

- [ ] `/healthz` ตอบ ok · เข้า `https://<โดเมน>/admin/` ล็อกอินได้ · เปลี่ยนรหัสผ่านแล้ว
- [ ] สร้างสาขาจริง + ลิงก์ลูกค้า → สแกน QR ด้วยมือถือจริง (iPhone + Android) → ส่งฟอร์ม → เห็นใน "คำตอบ"
- [ ] แถวขึ้น Google Sheet ภายใน ~1 นาที
- [ ] สร้างลิงก์ผู้บริหาร → เปิดบน iPad/PC → เห็นข้อมูล → ลอง "หมุนเวียนลิงก์" แล้วลิงก์เดิมต้อง 404
- [ ] เปิด Developer Tools ตรวจว่าไม่มี error สีแดง และ response ของ `/d/...` มี `Referrer-Policy: no-referrer`
- [ ] ดู TiDB Usage: RU ที่ใช้หลังทดสอบ → ประเมินว่าโควตา 50M/เดือนพอไหม
- [ ] `git ls-files | grep -E "\.env$|service-account"` ต้องไม่พบไฟล์ความลับ

## ปัญหาที่พบบ่อย

| อาการ | สาเหตุ/วิธีแก้ |
|---|---|
| แอดมินล็อกอินแล้วโดนเด้งออก / 403 `bad_origin` | `PUBLIC_BASE_URL` ไม่ตรงกับโดเมนที่เปิดอยู่ |
| ทุก API ตอบ 502/504 | Vercel rewrite ชี้ URL Render ผิด หรือ Render service ยังไม่ขึ้น |
| ลูกค้าเปิดฟอร์มได้ 500 `internal_error` | Vercel → Logs: ส่วนใหญ่ลืมตั้ง Environment Variables บน Vercel (ข้อ 4.2) หรือ TiDB ปฏิเสธ connection |
| ล็อกอินไม่ติด (cookie ไม่เก็บ) | ต้องเข้าผ่าน HTTPS และผ่าน Vercel (ไม่ใช่ `onrender.com` ตรงๆ) |
| ส่งฟอร์มไม่ได้ทั้งที่ลิงก์ถูก | โควตา TiDB ฟรีหมด (ดู Usage) หรือ DB ล่ม — ดู Render Logs |
| ชีทไม่อัปเดต | ดู Logs หา `Sheets sync`; ตรวจว่าแชร์ชีทให้ service account แล้ว; แถวค้างอยู่ในตาราง `sheet_outbox` (retry อัตโนมัติ) |
| `ECONNRESET` ต่อ TiDB | idle ถูกตัด — pool ตั้งปิด connection ว่างก่อนครบ 340 วินาทีแล้ว; ถ้ายังเกิดบ่อยให้ลด `idleTimeoutMillis` ใน `server/src/db/knex.js` |
