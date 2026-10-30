import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_NAME: z.string().min(1),
  DB_SSL: bool,
  // จำนวน connection สูงสุดต่อ instance — Vercel Functions ตั้งให้น้อย (เช่น 3) เพราะเปิดได้หลาย instance พร้อมกัน
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET ต้องยาวอย่างน้อย 32 ตัวอักษร'),
  LINK_SIGNING_SECRET: z.string().min(32, 'LINK_SIGNING_SECRET ต้องยาวอย่างน้อย 32 ตัวอักษร'),

  PUBLIC_BASE_URL: z.string().url(),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),

  SHEETS_SYNC_ENABLED: bool,
  SHEETS_SYNC_INTERVAL_SEC: z.coerce.number().int().min(5).default(30),
  GOOGLE_SHEET_ID: z.string().optional().default(''),
  GOOGLE_SERVICE_ACCOUNT_JSON_B64: z.string().optional().default(''),

  // แจ้งเตือนอีเมลรีวิวใหม่ผ่าน Resend (HTTPS API) — production ตั้งบน Vercel · dev/เทสต์ปิดไว้
  // EMAIL_ENABLED=true แต่ไม่มี RESEND_API_KEY = ไม่ส่ง (อีเมลรอในคิว) — ไม่ exit เพราะจะทำให้ฟอร์มลูกค้าบน Vercel ล่ม
  EMAIL_ENABLED: bool,
  RESEND_API_KEY: z.string().optional().default(''),
  EMAIL_FROM: z.string().optional().default('รีวิวเหนียวหมูไส้แตก <noreply@neawmoosaitaek.com>'),

  DASHBOARD_CACHE_TTL_SEC: z.coerce.number().int().min(0).default(60),

  // เสิร์ฟโฟลเดอร์ web/ จากเซิร์ฟเวอร์นี้เลย (ใช้ตอนพัฒนา) — production หน้าบ้านอยู่ที่ Vercel
  SERVE_WEB: z.enum(['true', 'false']).optional(),

  ADMIN_BOOTSTRAP_USER: z.string().optional().default(''),
  ADMIN_BOOTSTRAP_PASSWORD: z.string().optional().default(''),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
  console.error(`ตั้งค่า environment ไม่ถูกต้อง:\n${lines.join('\n')}\nดูตัวอย่างใน server/.env.example`);
  process.exit(1);
}

const env = {
  ...parsed.data,
  SERVE_WEB: parsed.data.SERVE_WEB ? parsed.data.SERVE_WEB === 'true' : parsed.data.NODE_ENV !== 'production',
};

if (env.NODE_ENV === 'production') {
  const weak = [env.SESSION_SECRET, env.LINK_SIGNING_SECRET].some((v) => v.startsWith('change-me'));
  if (weak) {
    console.error('SESSION_SECRET / LINK_SIGNING_SECRET ยังเป็นค่าตัวอย่าง ห้ามใช้ใน production');
    process.exit(1);
  }
  if (env.EMAIL_ENABLED && !env.RESEND_API_KEY) {
    console.warn('เปิด EMAIL_ENABLED แต่ยังไม่ตั้ง RESEND_API_KEY — อีเมลแจ้งเตือนจะรอในคิวจนกว่าจะตั้ง');
  }
  if (env.SHEETS_SYNC_ENABLED && (!env.GOOGLE_SHEET_ID || !env.GOOGLE_SERVICE_ACCOUNT_JSON_B64)) {
    console.error('เปิด SHEETS_SYNC_ENABLED แล้วต้องตั้ง GOOGLE_SHEET_ID และ GOOGLE_SERVICE_ACCOUNT_JSON_B64');
    process.exit(1);
  }
}

export const config = Object.freeze(env);
