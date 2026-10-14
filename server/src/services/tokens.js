import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { customAlphabet } from 'nanoid';
import { config } from '../config.js';

// token = <public_id>.<signature>
// - ลิงก์ลูกค้า (QR): signature = รหัสสุ่ม 128 บิตที่เก็บใน share_links.static_sig — คงที่ตลอดอายุลิงก์
//   ไม่ขึ้นกับ LINK_SIGNING_SECRET / การ deploy / การแก้คำถามหรือสาขา → QR ที่พิมพ์แล้วใช้ได้จนกว่าแอดมินจะลบลิงก์
//   (QR ติดในที่สาธารณะอยู่แล้ว การเก็บรหัสนี้ใน DB จึงไม่เพิ่มความเสี่ยง)
// - ลิงก์ผู้บริหาร: signature = HMAC-SHA256(LINK_SIGNING_SECRET, kind:public_id:token_version) — DB ไม่เก็บ token เต็ม
// - ลิงก์ลูกค้าเก่าที่ไม่มี static_sig ใช้ HMAC เหมือนเดิม (migration เติม static_sig ให้แล้ว)
const idAlphabet = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', 12);

// ลายเซ็นของลิงก์ผู้บริหารยาวเต็ม 256 บิต, ลิงก์ลูกค้า 128 บิต (ให้ QR ไม่แน่นเกินไป)
const SIGNATURE_BYTES = { customer: 16, dashboard: 32 };

const PUBLIC_ID_RE = /^[0-9A-Za-z]{12}$/;
const SIGNATURE_RE = /^[A-Za-z0-9_-]{20,64}$/;

export function newPublicId() {
  return idAlphabet();
}

export function sign(kind, publicId, tokenVersion, secret = config.LINK_SIGNING_SECRET) {
  const bytes = SIGNATURE_BYTES[kind];
  if (!bytes) throw new Error(`unknown link kind: ${kind}`);
  return createHmac('sha256', secret)
    .update(`${kind}:${publicId}:${tokenVersion}`)
    .digest()
    .subarray(0, bytes)
    .toString('base64url');
}

/** รหัสสุ่มประจำลิงก์ลูกค้า (ยาวเท่าลายเซ็น HMAC ของลูกค้า: 22 ตัว base64url) */
export function newStaticSig() {
  return randomBytes(SIGNATURE_BYTES.customer).toString('base64url');
}

function signatureOf(link, secret) {
  if (link.kind === 'customer' && link.static_sig) return link.static_sig;
  return sign(link.kind, link.public_id, link.token_version, secret);
}

export function buildToken(link, secret) {
  return `${link.public_id}.${signatureOf(link, secret)}`;
}

export function parseToken(token) {
  if (typeof token !== 'string' || token.length > 100) return null;
  const [publicId, signature, ...rest] = token.split('.');
  if (rest.length || !PUBLIC_ID_RE.test(publicId ?? '') || !SIGNATURE_RE.test(signature ?? '')) return null;
  return { publicId, signature };
}

export function verifySignature(link, signature, secret) {
  const expected = Buffer.from(signatureOf(link, secret));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function linkUrl(link) {
  const base = config.PUBLIC_BASE_URL.replace(/\/+$/, '');
  const prefix = link.kind === 'dashboard' ? 'd' : 'r';
  return `${base}/${prefix}/${buildToken(link)}`;
}
