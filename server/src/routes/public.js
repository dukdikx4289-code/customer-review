import { Router } from 'express';
import { loadForm, submitForm } from '../services/publicForm.js';
import { badTokenLimiter, submitLimiter } from '../middleware/rateLimit.js';

// ฟอร์มลูกค้าบน Render — production ส่วนนี้วิ่งที่ Vercel Functions (api/r/…) เป็นหลัก ตรรกะอยู่ที่ services/publicForm.js
export const publicRouter = Router();

publicRouter.get('/r/:token', badTokenLimiter, async (req, res) => {
  const { status, body } = await loadForm(req.params.token);
  res.status(status).json(body);
});

publicRouter.post('/r/:token/submit', badTokenLimiter, submitLimiter, async (req, res) => {
  const { status, body } = await submitForm(req.params.token, req.body, { userAgent: req.get('user-agent'), language: req.get('accept-language') });
  res.status(status).json(body);
});
