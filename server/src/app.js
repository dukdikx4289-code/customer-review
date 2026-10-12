import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { publicRouter } from './routes/public.js';
import { dashboardRouter } from './routes/dashboard.js';
import { adminRouter } from './routes/admin.js';
import { requireSameOrigin, sessionMiddleware } from './middleware/auth.js';

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web');

// ซ่อน token ใน log: /r/<id>.<signature> -> /r/<id>.***
const redact = (url) => url.replace(/(\/[rd]\/[0-9A-Za-z]{12})\.[^/?#]+/g, '$1.***');

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY_HOPS);

  if (config.NODE_ENV !== 'test') {
    app.use((req, res, next) => {
      const started = Date.now();
      res.on('finish', () => console.log(`${req.method} ${redact(req.originalUrl)} ${res.statusCode} ${Date.now() - started}ms`));
      next();
    });
  }

  app.use(helmet());
  app.use(express.json({ limit: '32kb' }));

  // health check สำหรับ Render — ไม่แตะฐานข้อมูล เพื่อไม่ให้ DB ช้าทำให้เซิร์ฟเวอร์ถูกรีสตาร์ท
  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, env: config.NODE_ENV });
  });

  // API ทั้งหมดห้ามแคช
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.use('/api', publicRouter);
  app.use('/api', dashboardRouter);
  app.use('/api/admin', sessionMiddleware(), requireSameOrigin, adminRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  if (config.SERVE_WEB) {
    // หน้าที่มี token ใน URL: ห้ามส่ง Referer ออกไป, ห้ามเข้า search index, ห้ามแคช
    const sensitive = (_req, res, next) => {
      res.set({ 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' });
      next();
    };
    app.get('/r/:token', sensitive, (_req, res) => res.sendFile(path.join(webDir, 'r/index.html')));
    app.get('/d/:token', sensitive, (_req, res) => res.sendFile(path.join(webDir, 'd/index.html')));
    app.use(express.static(webDir, { extensions: ['html'] }));
  }

  app.use((err, req, res, _next) => {
    console.error(`${req.method} ${redact(req.originalUrl)}`, err);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
