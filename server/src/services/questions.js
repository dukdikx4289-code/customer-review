import { z } from 'zod';

// ชนิดคำถามที่รองรับ — เพิ่มชนิดใหม่ = เพิ่มใน QUESTION_TYPES, validateAnswer และ renderer ฝั่งหน้าเว็บ
export const QUESTION_TYPES = ['rating', 'single_choice', 'multi_choice', 'short_text', 'long_text'];

// ช่องทางที่ลูกค้าตอบ: ลิงก์ลูกค้าผูกกับช่องทาง และคำถามแต่ละข้อกำหนดได้ว่าแสดงในช่องทางไหน (ไม่ระบุ = ทั้งสองช่องทาง)
export const CHANNELS = ['store', 'online'];
export const CHANNEL_LABELS = { store: 'หน้าร้าน', online: 'ออนไลน์' };

export const normalizeChannel = (value) => (CHANNELS.includes(value) ? value : null);

// ช่องทางของลิงก์ลูกค้า: ผูกช่องทางไว้ หรือ 'choose' = QR เดียว ให้ลูกค้าเลือกเองตอนสแกน
export const LINK_CHANNELS = [...CHANNELS, 'choose'];

export const inChannel = (q, channel) => !Array.isArray(q.channels) || q.channels.length === 0 || q.channels.includes(channel);

/** ชื่อสั้นของคำถามสำหรับ Dashboard/หน้าคำตอบ: หัวข้อ (เช่น "รสชาติ") ถ้าตั้งไว้ ไม่งั้นใช้ข้อความคำถามเต็ม */
export const shortLabel = (q) => q?.title?.trim() || q?.label;

/** คำถามที่แสดงในช่องทางนี้ (เรียงตามลำดับเดิม) */
export const questionsForChannel = (questions, channel) => questions.filter((q) => inChannel(q, channel));

const KEY_RE = /^[a-z][a-z0-9_]{1,62}$/;

const optionSchema = z.object({
  value: z.string().min(1).max(64),
  label: z.string().min(1).max(120),
});

const questionSchema = z
  .object({
    key: z.string().regex(KEY_RE, 'key ต้องเป็น a-z, 0-9, _ ขึ้นต้นด้วยตัวอักษร'),
    type: z.enum(QUESTION_TYPES),
    // title = หัวข้อสั้นๆ (ไม่บังคับ) แสดงเหนือคำถาม · label = เนื้อเรื่อง/ข้อความคำถามที่ลูกค้าอ่าน
    title: z.string().trim().max(60).optional().transform((t) => t || undefined),
    label: z.string().trim().min(1).max(200),
    required: z.boolean().default(false),
    channels: z
      .array(z.enum(CHANNELS))
      .min(1, 'ต้องเลือกอย่างน้อย 1 ช่องทาง')
      .transform((list) => CHANNELS.filter((c) => list.includes(c)))
      .default([...CHANNELS]),
    config: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((q, ctx) => {
    if (q.type === 'single_choice' || q.type === 'multi_choice') {
      const parsed = z.array(optionSchema).min(2).max(20).safeParse(q.config.options);
      if (!parsed.success) {
        ctx.addIssue({ code: 'custom', path: ['config', 'options'], message: 'ต้องมีตัวเลือกอย่างน้อย 2 ข้อ' });
      }
    }
    if (q.type === 'rating') {
      const { min = 1, max = 5 } = q.config;
      if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max > 10 || min >= max) {
        ctx.addIssue({ code: 'custom', path: ['config'], message: 'ช่วงคะแนนไม่ถูกต้อง' });
      }
    }
  });

/** ตรวจนิยามคำถามที่แอดมินส่งมาก่อนเผยแพร่เป็นเวอร์ชันใหม่ */
export function parseQuestionDefinitions(input) {
  const list = z.array(questionSchema).min(1).max(30).parse(input);
  const keys = new Set();
  for (const q of list) {
    if (keys.has(q.key)) throw new z.ZodError([{ code: 'custom', path: ['key'], message: `key ซ้ำ: ${q.key}` }]);
    keys.add(q.key);
  }
  return list;
}

function ratingRange(q) {
  return { min: q.config?.min ?? 1, max: q.config?.max ?? 5 };
}

function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  // ตัดอักขระควบคุม (เก็บ \n \t) และจำกัดความยาว
  const text = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (!text) return null;
  return text.slice(0, max);
}

/**
 * ตรวจและทำให้คำตอบเป็นรูปแบบมาตรฐานตามนิยามคำถามของเวอร์ชันนั้น
 * คืน { ok, rows, errors } โดย rows พร้อมเขียนลงตาราง answers
 */
export function validateAnswers(questions, raw) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const rows = [];
  const errors = {};

  for (const q of questions) {
    const value = input[q.key];
    const empty = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);

    if (empty) {
      if (q.required) errors[q.key] = 'required';
      continue;
    }

    switch (q.type) {
      case 'rating': {
        const { min, max } = ratingRange(q);
        const n = Number(value);
        if (!Number.isInteger(n) || n < min || n > max) errors[q.key] = 'invalid';
        else rows.push({ question_key: q.key, value_number: n });
        break;
      }
      case 'single_choice': {
        const allowed = new Set((q.config.options ?? []).map((o) => o.value));
        if (typeof value !== 'string' || !allowed.has(value)) errors[q.key] = 'invalid';
        else rows.push({ question_key: q.key, value_text: value });
        break;
      }
      case 'multi_choice': {
        const allowed = new Set((q.config.options ?? []).map((o) => o.value));
        const list = Array.isArray(value) ? [...new Set(value)] : null;
        if (!list || list.some((v) => typeof v !== 'string' || !allowed.has(v))) errors[q.key] = 'invalid';
        else rows.push({ question_key: q.key, value_json: JSON.stringify(list) });
        break;
      }
      case 'short_text':
      case 'long_text': {
        const max = Math.min(Number(q.config.maxLength) || (q.type === 'short_text' ? 200 : 1000), 2000);
        const text = cleanText(value, max);
        if (text === null) {
          if (q.required) errors[q.key] = 'required';
        } else rows.push({ question_key: q.key, value_text: text });
        break;
      }
      default:
        errors[q.key] = 'invalid';
    }
  }

  return { ok: Object.keys(errors).length === 0, rows, errors };
}
