// helper เล็กๆ ที่ใช้ร่วมกันทุกหน้า — สร้าง DOM ด้วย textContent เสมอ (ไม่ใช้ innerHTML กับข้อมูลจากผู้ใช้)

/** h('div', { class: 'x', onclick }, 'text', childNode) */
export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  append(node, children);
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** สร้าง element SVG: svg('path', { d: '...' }) */
export function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  for (const c of children.flat()) node.append(c);
  return node;
}

export function append(node, children) {
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

const th = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' });
const thDay = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export const formatDateTime = (iso) => (iso ? th.format(new Date(iso)) : '–');
/** date = 'YYYY-MM-DD' (วันตามเวลาไทยที่เซิร์ฟเวอร์คำนวณให้แล้ว) */
export const formatDay = (date) => thDay.format(new Date(`${date}T00:00:00Z`));
export const formatNumber = (n, digits = 2) => (n == null ? '–' : Number(n).toLocaleString('th-TH', { maximumFractionDigits: digits, minimumFractionDigits: 0 }));
export const formatPercent = (ratio) => (ratio == null ? '–' : `${Math.round(ratio * 100)}%`);

export function toast(message) {
  const node = h('div', { class: 'toast', role: 'status' }, message);
  document.body.append(node);
  setTimeout(() => node.remove(), 3500);
}

/** ดึง token จากท้าย path เช่น /r/<token> หรือ /d/<token> */
export function tokenFromPath() {
  return decodeURIComponent(location.pathname.split('/').filter(Boolean).at(-1) ?? '');
}
