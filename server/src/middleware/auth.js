import session from 'express-session';
import { config } from '../config.js';
import { db } from '../db/knex.js';
import { KnexSessionStore } from '../services/sessionStore.js';

const isProd = config.NODE_ENV === 'production';

export function sessionMiddleware() {
  return session({
    name: 'rv.sid',
    secret: config.SESSION_SECRET,
    store: new KnexSessionStore(db),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000,
    },
  });
}

export function requireAdmin(req, res, next) {
  if (req.session?.adminId) return next();
  res.status(401).json({ error: 'unauthorized' });
}

// กัน CSRF เพิ่มจาก SameSite: คำขอที่เปลี่ยนข้อมูลต้องมี Origin ตรงกับโดเมนที่ใช้งานจริง
// (ผ่าน Vercel rewrite เบราว์เซอร์ส่ง Origin เป็นโดเมน Vercel = PUBLIC_BASE_URL)
const allowedOrigin = new URL(config.PUBLIC_BASE_URL).origin;
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export function requireSameOrigin(req, res, next) {
  if (SAFE.has(req.method)) return next();
  const origin = req.get('origin');
  if (origin && origin !== allowedOrigin && config.NODE_ENV !== 'test') {
    return res.status(403).json({ error: 'bad_origin' });
  }
  if (!origin && config.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'bad_origin' });
  }
  next();
}
