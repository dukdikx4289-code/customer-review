import { rateLimit } from 'express-rate-limit';
import { config } from '../config.js';

const handler = (_req, res) => res.status(429).json({ error: 'rate_limited' });

// ในเทสต์ปิด limit เพื่อไม่ให้เทสต์ชนกันเอง
const skip = () => config.NODE_ENV === 'test';

function make(options) {
  return rateLimit({ standardHeaders: 'draft-7', legacyHeaders: false, handler, skip, ...options });
}

// ลูกค้าหลายคนในร้านเดียวกันอาจใช้ IP (Wi-Fi/เครือข่ายมือถือ) ร่วมกัน จึงตั้งค่าไว้ค่อนข้างสูง ปรับได้ภายหลัง
export const submitLimiter = make({ windowMs: 10 * 60 * 1000, limit: 60 });

// นับเฉพาะคำขอที่ล้มเหลว (token ผิด/เพิกถอน) เพื่อกันการสุ่มเดาลิงก์
export const badTokenLimiter = make({ windowMs: 10 * 60 * 1000, limit: 30, skipSuccessfulRequests: true });

export const loginLimiter = make({ windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true });
