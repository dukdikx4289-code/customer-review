/*
 * รายการ widget ของ Dashboard — ไฟล์นี้คือที่เดียวที่ต้องแก้เวลาอยากเพิ่ม/ลบ/ปรับการ์ด
 *
 * เพิ่มการ์ดใหม่ = เพิ่ม object 1 ตัวใน WIDGETS:
 *   { id: 'ชื่อไม่ซ้ำ', size: 'sm' | 'wide' | 'tall' | 'lg', title: 'หัวข้อ',
 *     render: (data, ctx) => ({ meta: <ข้อความมุมขวา (ไม่บังคับ)>, body: <DOM node> }) }
 *
 *   data = ข้อมูลจาก API (/api/d/<token>/stats หรือ /api/admin/stats) ดูรูปแบบใน server/src/services/aggregate.js
 *   ctx  = { rangeLabel }
 *   ขนาด: sm = 1x1, wide = 2x1, tall = 1x2, lg = 2x2 (กริด 4 คอลัมน์บนจอใหญ่ / 2 บนแท็บเล็ต / 1 บนมือถือ)
 *   ลำดับในรายการ = ลำดับเริ่มต้น (ผู้ใช้ลากสลับเองได้ และเบราว์เซอร์จำไว้ให้)
 *   ถ้าแก้ id หรือเพิ่ม/ลบการ์ด ลำดับที่ผู้ใช้จำไว้จะถูกปรับให้อัตโนมัติ
 */
import { h, formatDay, formatDateTime, formatNumber, formatPercent } from '../util.js';
import { big, delta, rows, bars, spark, level, svg } from './ui.js';

const DAY_NAMES = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const dayName = (date) => DAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()];

/** จำนวนรีวิว + minimap ความหนาแน่น 7 วัน x 24 ชั่วโมง */
function reviews(data) {
  const peak = Math.max(1, ...data.activity.flatMap((d) => d.hours));
  const nowHour = new Date(Date.now() + 7 * 3_600_000).getUTCHours();
  const lastIdx = data.activity.length - 1;
  const total = data.activity.reduce((a, d) => a + d.hours.reduce((x, y) => x + y, 0), 0);

  const map = h('div', { class: 'minimap', role: 'img', 'aria-label': `จำนวนรีวิวรายชั่วโมงใน 7 วันล่าสุด รวม ${formatNumber(total, 0)} รีวิว` });
  data.activity.forEach((d, i) => {
    const cells = h('span', { class: 'cells' });
    d.hours.forEach((n, hour) => {
      const isNow = i === lastIdx && hour === nowHour;
      const future = i === lastIdx && hour > nowHour;
      cells.append(h('i', { class: `${future ? 'future' : `l${level(n, peak)}`}${isNow ? ' now' : ''}`, title: future ? undefined : `${formatDay(d.date)} ${String(hour).padStart(2, '0')}:00 · ${n} รีวิว` }));
    });
    map.append(h('span', { class: `day${i === lastIdx ? ' today' : ''}` }, i === lastIdx ? 'วันนี้' : dayName(d.date)), cells);
  });
  map.append(h('span', { class: 'day' }), h('span', { class: 'hours', 'aria-hidden': 'true' }, ['00', '06', '12', '18'].map((t) => h('span', {}, `${t}:00`))));

  return {
    meta: delta(data.totals.responses, data.previous?.responses, { suffix: 'เทียบช่วงก่อนหน้า' }),
    body: [big(formatNumber(data.totals.responses, 0), 'รีวิว', { to: data.totals.responses }), h('div', { class: 'push' }, map)],
  };
}

/** % ความพึงพอใจ + แท่งคะแนนรายวัน 14 วันล่าสุด */
function satisfaction(data) {
  const days = data.trend.slice(-14);
  const lo = data.primary?.min ?? 1;
  const hi = data.primary?.max ?? 5;
  return {
    meta: delta(data.totals.satisfactionRate, data.previous?.satisfactionRate, { mode: 'points', suffix: 'เทียบช่วงก่อนหน้า' }),
    body: [
      big(formatPercent(data.totals.satisfactionRate), '', data.totals.satisfactionRate == null ? undefined : { to: Math.round(data.totals.satisfactionRate * 100), suffix: '%' }),
      h('p', { class: 'hint' }, `ให้ ${hi - 1}–${hi} คะแนน`),
      h('div', { class: 'push' }, spark(days.map((d) => d.avg), { lo, hi, label: `คะแนนเฉลี่ยรายวัน ${days.length} วันล่าสุด` })),
    ],
  };
}

/** คะแนนเฉลี่ยรวม + รายหัวข้อแบบแถวสั้น */
function average(data) {
  const max = data.primary?.max ?? 5;
  return {
    meta: delta(data.totals.primaryAvg, data.previous?.primaryAvg, { mode: 'abs' }),
    body: [big(formatNumber(data.totals.primaryAvg), `/ ${max}`, data.totals.primaryAvg == null ? undefined : { to: data.totals.primaryAvg }), h('div', { class: 'push' }, rows(data.questions.map((q) => ({ label: q.label, value: formatNumber(q.avg) }))))],
  };
}

/** ตารางสาขา x หัวข้อ สีเข้ม = คะแนนสูง, ⚠ = ต่ำกว่าเกณฑ์ */
function branches(data) {
  const grid = h('div', { class: 'bgrid', role: 'table', 'aria-label': 'คะแนนเฉลี่ยรายสาขาและหัวข้อ' });
  grid.style.setProperty('--cols', data.questions.length);
  grid.append(h('span', { class: 'h' }), ...data.questions.map((q) => h('span', { class: 'h', title: q.label }, q.label)));
  for (const b of data.branches) {
    grid.append(h('div', { class: 'name', title: b.name }, h('b', {}, b.name), h('span', {}, `${formatNumber(b.responses, 0)} รีวิว`)));
    for (const q of data.questions) {
      const s = b.scores[q.key];
      if (!s) {
        grid.append(h('span', { class: 'c none' }, '–'));
        continue;
      }
      grid.append(heatCell(h('span'), s));
    }
  }
  return { meta: '⚠ = ต่ำกว่า 3.5', body: grid };
}

/**
 * ใส่สี heatmap ให้ช่องหนึ่ง; s = { avg, n }
 * สีพื้นเป็นโทนอ่อน (ตัวอักษรสีปกติอ่านชัดเสมอ ทั้งโหมดสว่าง/มืด) และมีแถบบางด้านล่างยาวตามคะแนน = ยิ่งยาวยิ่งสูง
 * (ตัวเลขอยู่ในช่องเสมอ + ⚠ เมื่อต่ำกว่าเกณฑ์ จึงไม่พึ่งสีอย่างเดียว) — ความเข้มกำหนดจากตัวแปร --t (0..1) ใน css/widgets.css
 */
function heatCell(el, s, base = 'c') {
  const t = Math.min(1, Math.max(0, (s.avg - 1) / 4));
  el.className = `${base}${s.avg < 3.5 && s.n >= 3 ? ' low' : ''}`;
  el.title = `${formatNumber(s.avg)} จาก ${s.n} รีวิว`;
  el.textContent = formatNumber(s.avg);
  el.style.setProperty('--t', t.toFixed(3));
  return el;
}

/** มุมมองขยาย: ตารางสาขา x หัวข้อ กดหัวคอลัมน์เพื่อเรียงลำดับ */
function branchesExpanded(data) {
  let sortKey = 'name';
  let dir = 1;
  const holder = h('div', {});
  const value = (b, key) => (key === 'name' ? b.name : key === 'responses' ? b.responses : (b.scores[key]?.avg ?? -1));

  function draw() {
    const sorted = [...data.branches].sort((a, b) => {
      const x = value(a, sortKey);
      const y = value(b, sortKey);
      return (typeof x === 'string' ? x.localeCompare(y, 'th') : x - y) * dir;
    });
    const th = (key, label, num) =>
      h('th', { class: num ? 'num' : '', 'aria-sort': sortKey === key ? (dir === 1 ? 'ascending' : 'descending') : 'none' }, h('button', { class: 'sort-btn', type: 'button', onclick: () => ((dir = sortKey === key ? -dir : key === 'name' ? 1 : -1), (sortKey = key), draw()) }, label, sortKey === key ? (dir === 1 ? ' ↑' : ' ↓') : ''));
    const table = h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'heat' },
        h('thead', {}, h('tr', {}, th('name', 'สาขา', false), th('responses', 'รีวิว', true), data.questions.map((q) => th(q.key, q.label, true)))),
        h('tbody', {}, sorted.map((b) => h('tr', {}, h('td', {}, h('b', {}, b.name)), h('td', { class: 'num' }, formatNumber(b.responses, 0)), data.questions.map((q) => (b.scores[q.key] ? heatCell(h('td'), b.scores[q.key], 'cell') : h('td', { class: 'cell none' }, '–')))))),
      ),
    );
    holder.replaceChildren(h('p', { class: 'muted small' }, 'กดหัวคอลัมน์เพื่อเรียงลำดับ · สีเข้ม = คะแนนสูง · ⚠ = ต่ำกว่า 3.5'), table);
  }
  draw();
  return { body: holder };
}

/** มุมมองขยาย: ข้อเสนอแนะทั้งหมด กรองตามคะแนนได้ */
function commentsExpanded(data) {
  const holder = h('div', {});
  const filters = { all: 'ทั้งหมด', low: '1–2 ดาว', mid: '3 ดาว', high: '4–5 ดาว' };
  const match = { all: () => true, low: (s) => s != null && s <= 2, mid: (s) => s === 3, high: (s) => s != null && s >= 4 };
  let current = 'all';
  function draw() {
    const items = data.comments.filter((c) => match[current](c.score));
    const bar = h('div', { class: 'seg', role: 'group', 'aria-label': 'กรองตามคะแนน' }, Object.entries(filters).map(([key, label]) => h('button', { type: 'button', 'aria-pressed': String(key === current), onclick: () => ((current = key), draw()) }, label)));
    const list = h('ul', { class: 'clist full' });
    for (const c of items) list.append(h('li', {}, h('div', { class: 'meta' }, c.branch ? h('b', {}, c.branch) : null, h('span', {}, formatDateTime(c.submittedAt)), c.score != null ? h('span', { class: 'stars-inline', 'aria-label': `${c.score} คะแนน` }, '★'.repeat(Math.round(c.score))) : null), h('p', { class: 'text' }, c.text)));
    holder.replaceChildren(bar, items.length ? list : h('p', { class: 'muted' }, 'ไม่มีข้อเสนอแนะในกลุ่มนี้'));
  }
  draw();
  return { body: holder };
}

/** คะแนนรายหัวข้อ */
function questions(data) {
  const max = data.primary?.max ?? 5;
  const items = data.questions.map((q, i) => ({ label: q.label, ratio: (q.avg ?? 0) / max, value: formatNumber(q.avg), hot: i === 0 }));
  return { meta: `จาก ${max}`, body: h('div', { class: 'push' }, bars(items, 'คะแนนเฉลี่ยรายหัวข้อ')) };
}

/** การกระจายคะแนนของหัวข้อหลัก */
function distribution(data) {
  const total = data.distribution.reduce((a, d) => a + d.count, 0) || 1;
  const peak = Math.max(1, ...data.distribution.map((d) => d.count));
  const items = [...data.distribution].reverse().map((d) => ({ label: `${d.score} ★`, ratio: d.count / peak, value: `${formatNumber(d.count, 0)} (${Math.round((d.count / total) * 100)}%)`, hot: d.score === data.primary?.max }));
  return { meta: data.primary?.label, body: h('div', { class: 'push' }, bars(items, 'การกระจายคะแนน')) };
}

/** จุดที่ต้องแก้ไข (หัวข้อ x สาขาที่เฉลี่ยต่ำกว่าเกณฑ์) */
function attention(data) {
  const top = data.attention.slice(0, 4);
  return {
    meta: 'เฉลี่ย < 3.5 และมี ≥ 3 รีวิว',
    body: [
      big(formatNumber(data.attention.length, 0), 'จุด', { to: data.attention.length }),
      h('div', { class: 'push' }, top.length ? rows(top.map((a) => ({ tone: 'err', label: `${a.branch} · ${a.question}`, value: formatNumber(a.avg) }))) : h('p', { class: 'ok-note' }, '✓ ทุกสาขาอยู่เหนือเกณฑ์')),
    ],
  };
}

/** ข้อเสนอแนะล่าสุด (แสดงด้วย textContent เท่านั้น — ข้อความจากลูกค้าจึงไม่ถูกตีความเป็น HTML) */
function comments(data) {
  const list = h('ul', { class: 'clist', 'aria-label': 'ข้อเสนอแนะล่าสุด' });
  for (const c of data.comments.slice(0, 12)) {
    list.append(h('li', {}, h('div', { class: 'meta' }, c.branch ? h('b', {}, c.branch) : null, h('span', {}, formatDateTime(c.submittedAt)), c.score != null ? h('span', { class: 'stars-inline', 'aria-label': `${c.score} คะแนน` }, '★'.repeat(Math.round(c.score))) : null), h('p', { class: 'text' }, c.text)));
  }
  return { meta: `${data.comments.length} ล่าสุด`, body: data.comments.length ? list : h('p', { class: 'empty-note' }, 'ยังไม่มีข้อเสนอแนะเป็นข้อความ') };
}

/** แนวโน้มคะแนนเฉลี่ยรายวัน + จำนวนรีวิวรายวัน + ตารางข้อมูล */
function trend(data, ctx) {
  const days = data.trend;
  const lo = data.primary?.min ?? 1;
  const hi = data.primary?.max ?? 5;
  const pts = days.map((d, i) => (d.avg == null ? null : [days.length > 1 ? (i / (days.length - 1)) * 100 : 50, 30 - ((d.avg - lo) / (hi - lo)) * 30]));
  const path = pts.filter(Boolean).map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' ');
  const line = svg('svg', { class: 'trend-line', viewBox: '0 0 100 30', preserveAspectRatio: 'none', role: 'img', 'aria-label': `คะแนนเฉลี่ยรายวัน ${days.length} วัน` }, svg('path', { d: path }));

  const table = h(
    'details',
    { class: 'table-view' },
    h('summary', {}, 'ดูเป็นตาราง'),
    h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'วันที่'), h('th', { class: 'num' }, 'รีวิว'), h('th', { class: 'num' }, 'คะแนนเฉลี่ย'))), h('tbody', {}, [...days].reverse().map((d) => h('tr', {}, h('td', {}, formatDay(d.date)), h('td', { class: 'num' }, d.count), h('td', { class: 'num' }, formatNumber(d.avg))))))),
  );

  return {
    meta: ctx.rangeLabel,
    body: [
      big(formatNumber(data.totals.primaryAvg), `/ ${hi} เฉลี่ย`, data.totals.primaryAvg == null ? undefined : { to: data.totals.primaryAvg }),
      h('div', { class: 'push' }, line, h('div', { class: 'trend-axis', 'aria-hidden': 'true' }, h('span', {}, days[0] ? formatDay(days[0].date) : ''), h('span', {}, days.at(-1) ? formatDay(days.at(-1).date) : '')), h('p', { class: 'hint' }, 'จำนวนรีวิวรายวัน'), spark(days.map((d) => d.count), { lo: 0, label: 'จำนวนรีวิวรายวัน' }), table),
    ],
  };
}

/** มุมมองขยายของแนวโน้ม: ตารางรายวันเปิดไว้เลย */
function trendExpanded(data, ctx) {
  const wrap = h('div', { class: 'stack' }, trend(data, ctx).body);
  wrap.querySelector('details')?.setAttribute('open', '');
  return { body: wrap };
}

// expanded (ไม่บังคับ) = มุมมองเต็มในหน้าต่างโมดอลเมื่อกดปุ่ม ⤢ ถ้าไม่ใส่ จะใช้ render เดิมแสดงในกล่องใหญ่
export const WIDGETS = [
  { id: 'reviews', size: 'wide', title: 'จำนวนรีวิว', render: reviews },
  { id: 'satisfaction', size: 'sm', title: 'ความพึงพอใจ', render: satisfaction },
  { id: 'average', size: 'sm', title: 'คะแนนเฉลี่ย', render: average },
  { id: 'branches', size: 'lg', title: 'เปรียบเทียบสาขา', render: branches, expanded: branchesExpanded },
  { id: 'questions', size: 'wide', title: 'คะแนนรายหัวข้อ', render: questions },
  { id: 'distribution', size: 'wide', title: 'การกระจายคะแนน', render: distribution },
  { id: 'comments', size: 'lg', title: 'ข้อเสนอแนะล่าสุด', render: comments, expanded: commentsExpanded },
  { id: 'trend', size: 'wide', title: 'แนวโน้มรายวัน', render: trend, expanded: trendExpanded },
  { id: 'attention', size: 'wide', title: 'จุดที่ต้องแก้ไข', render: attention },
];
