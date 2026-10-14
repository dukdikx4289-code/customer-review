# คู่มือตั้งค่า Google Sheets

ทุกรีวิวที่ลูกค้าส่งจะถูกคัดลอกขึ้นชีทอัตโนมัติ (ฐานข้อมูลคือแหล่งข้อมูลจริง — ชีทเป็นสำเนาให้ทีมเปิดดู/ทำ pivot) ใช้เวลาตั้งค่าครั้งแรกประมาณ 10 นาที

```
ลูกค้าส่งฟอร์ม → บันทึกฐานข้อมูล (ทันที) → คิว sheet_outbox → worker ทุก 30 วินาที → ต่อท้ายชีท (แท็บ "responses")
```

ถ้าชีทล่ม/ตั้งค่าผิด **ลูกค้าส่งฟอร์มได้ตามปกติ** แถวจะค้างในคิวและส่งซ้ำเองเมื่อแก้เสร็จ

## ขั้นตอน (ทำครั้งเดียวต่อสภาพแวดล้อม)

> แนะนำให้ทำ **สองชุดแยกกัน**: ชีท/โปรเจกต์สำหรับทดสอบ (dev) และสำหรับใช้จริง (production) — จะได้ไม่เอาข้อมูลทดสอบไปปนกับข้อมูลจริง

### 1. สร้างโปรเจกต์และเปิด Sheets API
1. เข้า [console.cloud.google.com](https://console.cloud.google.com) ด้วยบัญชี Google ของคุณ → แถบบนซ้าย **Select a project → New Project** ตั้งชื่อเช่น `review-sheets` → Create
2. เปิดลิงก์ [Google Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com) (เช็กว่าโปรเจกต์ด้านบนคือ `review-sheets`) → กด **Enable**

### 2. สร้าง Service Account (บัญชีสำหรับระบบ ไม่ใช่คน)
1. เมนู **IAM & Admin → Service Accounts → Create service account**
2. ชื่อเช่น `review-sync` → **Create and continue** → ข้ามขั้น "Grant access" (ไม่ต้องให้ Role ใดๆ) → **Done**
3. คลิกชื่อบัญชีที่สร้าง → คัดลอก **อีเมล** (หน้าตาแบบ `review-sync@review-sheets.iam.gserviceaccount.com`) ไว้ใช้ขั้น 4

### 3. สร้าง key (ไฟล์ JSON)
1. ในหน้าบัญชีเดียวกัน แท็บ **Keys → Add key → Create new key → JSON → Create** — ไฟล์จะดาวน์โหลดลงเครื่อง
2. **ย้ายไฟล์ไปไว้นอกโฟลเดอร์โปรเจกต์** (เช่น `Documents\keys\`) — ไฟล์นี้เท่ากับรหัสผ่านของชีท; repo นี้เป็น public ถ้าหลุดขึ้น GitHub คนอื่นแก้ชีทได้ (สคริปต์ตั้งค่าจะไม่ยอมรับไฟล์ที่อยู่ในโฟลเดอร์โปรเจกต์)
3. ถ้าสร้าง key ไม่ได้ (ขึ้น *"Service account key creation is disabled"*) แปลว่าองค์กร Google Workspace บล็อกไว้ → สร้างโปรเจกต์ด้วย Gmail ส่วนตัว หรือขอแอดมินองค์กรปลดนโยบายนี้

### 4. สร้างชีทและแชร์ให้ Service Account
1. สร้าง [Google Sheet](https://sheets.new) เปล่า ตั้งชื่อเช่น `รีวิวลูกค้า (ใช้จริง)`
2. กด **Share** → ใส่อีเมล Service Account จากขั้น 2 → สิทธิ์ **Editor** → ติ๊ก **ปิด** "Notify people" → Share
3. คัดลอก **URL ของชีท** (ในแถบที่อยู่เบราว์เซอร์)

### 5. ตั้งค่าในโปรเจกต์ (คำสั่งเดียว)
```bash
cd server
npm run sheets:setup -- --key "C:\Users\<ชื่อคุณ>\Documents\keys\review-sync.json" --sheet "https://docs.google.com/spreadsheets/d/<ID>/edit" --copy
```
สคริปต์จะ: ตรวจว่าเป็นไฟล์ key จริง → เขียน `GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON_B64`, `SHEETS_SYNC_ENABLED=true` ลง `server/.env` (ไม่พิมพ์ key ออกหน้าจอ) → ตรวจการเชื่อมต่อให้ทันที
`--copy` = คัดลอกค่า base64 ไปคลิปบอร์ด (Windows) เพื่อวางใน Render ภายหลัง

### 6. สร้างแท็บและหัวตาราง
```bash
npm run sheets:check -- --init
```
สร้างแท็บ `responses` พร้อมหัวตาราง (ตัวหนา พื้นอุ่น ตรึงแถวแรก) — ถ้าไม่รัน ระบบจะสร้างให้เองตอนมีรีวิวแรก

### 7. ทดสอบจริง
เปิดเซิร์ฟเวอร์ (`PORT=3000 npm run dev`) → ส่งรีวิวผ่านลิงก์ลูกค้า → ภายใน ~30 วินาทีแถวใหม่ควรขึ้นในแท็บ `responses`
ตรวจสถานะได้ทุกเมื่อด้วย `npm run sheets:check` (บอกด้วยว่ามีกี่แถวค้างรอส่ง)

## ใช้บน production (Render)
ตั้งใน Render → Environment: `GOOGLE_SHEET_ID` (ID ของชีท **ใช้จริง**), `GOOGLE_SERVICE_ACCOUNT_JSON_B64` (วางค่าที่ `--copy` ไว้ หรือเปิด `.env` คัดลอก), `SHEETS_SYNC_ENABLED=true` — ใช้ key/ชีทคนละชุดกับ dev ได้โดยรัน `sheets:setup` ซ้ำพร้อม `--env` ชี้ไฟล์อื่น
ถ้าตั้ง `SHEETS_SYNC_ENABLED=true` แต่ไม่ใส่ค่าให้ครบ เซิร์ฟเวอร์ production จะไม่ยอมสตาร์ท (กันลืม)

## โครงสร้างชีท (แท็บ `responses`)
| คอลัมน์ | ความหมาย |
|---|---|
| `response_id` | เลขรีวิวในฐานข้อมูล |
| `submitted_at (เวลาไทย)` | เวลาที่ส่ง รูปแบบ `2026-10-12 14:30:05` (ข้อความ) |
| `branch_code` / `branch_name` | สาขา |
| `link_label` | ลิงก์/QR ที่ลูกค้าใช้ (เช่น "QR หน้าร้าน") |
| `taste`, `food_quality`, `delivery_on_time`, `overall_satisfaction`, `comment` | คำตอบตามคำถาม (ชื่อคอลัมน์ = รหัสคำถาม) |

- **เพิ่มคำถามใหม่** → ระบบเพิ่มคอลัมน์ต่อท้ายให้เอง; **ลบคำถาม** → คอลัมน์เดิมยังอยู่ (ช่องว่างสำหรับรีวิวใหม่)
- ค่าถูกเขียนแบบ "ข้อความ/ตัวเลขตรงๆ" ไม่ถูกตีความเป็นสูตร (กันคนพิมพ์ `=...` ในช่องข้อเสนอแนะ)

## ใช้งานชีทอย่างปลอดภัย
- **อย่าแก้หัวตาราง (แถวแรก) อย่าลบ/สลับคอลัมน์ในแท็บ `responses`** — ระบบเขียนตามหัวตาราง ถ้าสลับคอลัมน์ข้อมูลใหม่จะเข้าผิดช่อง
- ทำรายงาน/กราฟ/pivot ใน **แท็บอื่น** ของชีทเดียวกัน (Insert → Pivot table ชี้ไปที่ `responses!A:Z`) ข้อมูลใหม่จะไหลเข้าอัตโนมัติ
- อยากได้ Dashboard เพิ่มโดยไม่เขียนโค้ด: [Looker Studio](https://lookerstudio.google.com) → เพิ่มแหล่งข้อมูล Google Sheets → เลือกแท็บ `responses`
- ชีทมี **ข้อเสนอแนะของลูกค้า** — แชร์เฉพาะคนที่จำเป็น และหลีกเลี่ยงการตั้ง "Anyone with the link"
- ระบบ **ไม่ย้อนอ่านจากชีท**: แก้/ลบแถวในชีทไม่กระทบฐานข้อมูลและ Dashboard

## ส่งข้อมูลย้อนหลัง / ส่งซ้ำ
```bash
npm run sheets:backfill -- --yes     # ตั้งคิวส่งรีวิวทั้งหมดใหม่ — ใช้กับ "ชีทเปล่า" เท่านั้น (ถ้ามีข้อมูลเดิมจะซ้ำ)
```
ถ้ามีแถวที่ล้มเหลวถาวร (พยายามครบ 12 รอบ) หลังแก้ต้นเหตุแล้วให้ส่งใหม่ด้วย SQL: `UPDATE sheet_outbox SET status='pending', attempts=0, next_attempt_at=NOW() WHERE status='failed';`

## หมุนเวียน key (ทำเมื่อสงสัยว่า key หลุด หรือทุก ~6–12 เดือน)
1. Google Cloud → Service Account → Keys → สร้าง key ใหม่ (JSON)
2. `npm run sheets:setup -- --key <ไฟล์ใหม่> --sheet <URL> --copy` แล้ววางค่าใหม่ใน Render
3. กลับไป **ลบ key เก่า** ในหน้า Keys แล้วลบไฟล์ key เก่าในเครื่อง

## แก้ปัญหา (`npm run sheets:check` จะบอกสาเหตุให้เป็นภาษาไทย)
| อาการ | สาเหตุ → วิธีแก้ |
|---|---|
| `ยังไม่ได้เปิด Google Sheets API` | ขั้น 1.2 ยังไม่ได้ Enable (หรือเปิดคนละโปรเจกต์กับที่สร้าง key) → Enable แล้วรอ 1–2 นาที |
| `ไม่มีสิทธิ์เข้าชีท` (403) | ยังไม่ได้ Share ชีทให้อีเมล Service Account เป็น Editor (ขั้น 4.2) |
| `ไม่พบชีท` (404) | `GOOGLE_SHEET_ID` ผิด — ใช้ข้อความยาวระหว่าง `/d/` กับ `/edit` ใน URL |
| `key ... ใช้ไม่ได้` / `invalid_grant` | key ถูกลบ/คัดลอกมาไม่ครบ หรือนาฬิกาเครื่องเพี้ยน → สร้าง key ใหม่แล้วรัน `sheets:setup` |
| `เกินโควตา` (429) | Google จำกัดเขียน 60 ครั้ง/นาที — ระบบส่งเป็นชุดและลองใหม่เองอยู่แล้ว โดยปกติไม่เจอ |
| แถวไม่ขึ้นแต่ `sheets:check` ผ่านทั้งหมด | เซิร์ฟเวอร์ที่รันอยู่ตั้ง `SHEETS_SYNC_ENABLED=false` หรือยังไม่ได้รีสตาร์ทหลังแก้ `.env`; ดู log บรรทัด `Google Sheets sync:` |
| เซิร์ฟเวอร์ log ว่า `ปิดการทำงาน เพราะอ่าน ... ไม่ได้` | ค่า `GOOGLE_SERVICE_ACCOUNT_JSON_B64` เสีย (คัดลอกไม่ครบ/มีช่องว่างแทรก) → `sheets:setup` ใหม่; API ยังทำงานปกติ รีวิวสะสมในคิวรอส่ง |
