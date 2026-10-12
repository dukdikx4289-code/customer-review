// ชิ้นส่วนเล็กๆ ที่ widget ใช้ร่วมกัน (ไม่ผูกกับข้อมูลชุดใด) — หน้าตาอยู่ที่ css/widgets.css
import { h, formatNumber, svg } from '../util.js';

export { svg }; // widget ใช้ svg() จากที่นี่ได้เหมือนเดิม

/**
 * การ์ดหนึ่งใบ: ขนาด sm | wide | tall | lg
 *  animate  = ให้เลื่อนขึ้น/จางเข้าตอนเลื่อนมาถึง (reveal)   onExpand = ใส่ปุ่ม "ขยาย" เปิดรายละเอียดเต็มในหน้าต่างโมดอล
 */
export function tile({ id, size, title, meta, body, animate = false, onExpand }) {
  const expand = onExpand
    ? h('button', { class: 'w-expand', type: 'button', 'aria-label': `ขยายดู: ${title}`, title: 'ขยาย', onclick: (e) => onExpand(e.currentTarget) }, h('span', { 'aria-hidden': 'true' }, '⤢'))
    : null;
  return h(
    'div',
    { class: 'w', dataset: { widgetId: id, size }, tabindex: 0, 'aria-label': title },
    h(
      'section',
      { class: `w-card${animate ? ' reveal' : ''}` },
      h('header', { class: 'w-head' }, h('h3', {}, title), h('span', { class: 'w-tools' }, meta ? h('span', { class: 'w-meta' }, meta) : null, expand)),
      h('div', { class: 'w-body' }, body),
    ),
  );
}

/**
 * ตัวเลขใหญ่ + หน่วยเล็ก
 *  count = { to, suffix? } → ตัวเลขจะนับขึ้นจาก 0 ตอนแสดงครั้งแรก (ค่าจริงอยู่ใน DOM ตั้งแต่แรก)
 */
export function big(value, unit, count) {
  const num = count ? h('span', { dataset: { countTo: String(count.to), ...(count.suffix ? { countSuffix: count.suffix } : {}) } }, value) : value;
  return h('p', { class: 'big' }, num, unit ? h('small', {}, ` ${unit}`) : null);
}

export const dot = (tone = 'idle') => h('span', { class: `dot ${tone}`, 'aria-hidden': 'true' });

/**
 * ลูกศรเปรียบเทียบกับช่วงก่อนหน้า
 *  mode: 'percent' = เปลี่ยนกี่ % | 'points' = ต่างกันกี่จุด (ใช้กับอัตรา %) | 'abs' = ต่างกันเท่าไร (ใช้กับคะแนนเฉลี่ย)
 *  good: ทิศทางที่ถือว่าดี ('up' | 'down')
 */
export function delta(now, before, { mode = 'percent', good = 'up', suffix = '' } = {}) {
  if (now == null || before == null) return null;
  let diff;
  let text;
  if (mode === 'percent') {
    if (!before) return null;
    diff = ((now - before) / before) * 100;
    text = `${Math.abs(Math.round(diff))}%`;
  } else if (mode === 'points') {
    diff = (now - before) * 100;
    text = `${Math.abs(Math.round(diff))} จุด`;
  } else {
    diff = now - before;
    text = formatNumber(Math.abs(diff), 2);
  }
  const flat = Math.abs(diff) < (mode === 'abs' ? 0.005 : 0.5);
  if (flat) return h('span', { class: 'delta flat' }, 'คงที่', h('span', { class: 'sr-only' }, ' เมื่อเทียบกับช่วงก่อนหน้า'));
  const up = diff > 0;
  return h(
    'span',
    { class: `delta ${up === (good === 'up') ? 'ok' : 'err'}` },
    h('span', { 'aria-hidden': 'true' }, up ? '↑ ' : '↓ '),
    text,
    h('span', { class: 'sr-only' }, ` ${up ? 'เพิ่มขึ้น' : 'ลดลง'}เมื่อเทียบกับช่วงก่อนหน้า`),
    suffix ? h('span', { class: 'delta-suffix', 'aria-hidden': 'true' }, ` ${suffix}`) : null,
  );
}

/** แถวสั้นๆ "ชื่อ ..... ค่า" — items: [{ label, value, tone? }] */
export function rows(items) {
  return h(
    'dl',
    { class: 'rows' },
    items.map((it) => h('div', { class: 'r' }, h('dt', { title: it.label }, it.tone ? dot(it.tone) : null, it.label), h('dd', {}, it.value))),
  );
}

/** แท่งบางๆ ratio = 0..1 */
export function hbar(ratio, hot = false) {
  const fill = h('i');
  fill.style.width = `${Math.max(0, Math.min(1, ratio || 0)) * 100}%`;
  return h('span', { class: `hbar${hot ? ' hot' : ''}`, 'aria-hidden': 'true' }, fill);
}

/** ตาราง 3 คอลัมน์: ชื่อ | แท่ง | ค่า — items: [{ label, ratio, value, hot? }] */
export function bars(items, caption) {
  const grid = h('div', { class: 'bars', role: 'list', 'aria-label': caption });
  for (const it of items) {
    grid.append(h('span', { class: 'n', role: 'listitem', title: it.label }, it.label), h('span', { class: 't' }, hbar(it.ratio, it.hot)), h('span', { class: 'v' }, it.value));
  }
  return grid;
}

/** แท่งรายวัน: values ใช้ความสูงตามสัดส่วนระหว่าง lo..hi, แท่งสุดท้ายเน้นสี */
export function spark(values, { lo, hi, label }) {
  const nums = values.filter((v) => v != null);
  const min = lo ?? Math.min(...nums, 0);
  const max = hi ?? Math.max(...nums, 1);
  const wrap = h('div', { class: 'spark', role: 'img', 'aria-label': label });
  values.forEach((v, i) => {
    const bar = h('i', { class: i === values.length - 1 ? 'hot' : '' });
    bar.style.height = `${v == null ? 6 : Math.max(8, ((v - min) / (max - min || 1)) * 100)}%`;
    wrap.append(bar);
  });
  return wrap;
}

/** ระดับสี heatmap 0..4 */
export function level(value, peak) {
  if (!value) return 0;
  return Math.max(1, Math.ceil((value / peak) * 4));
}
