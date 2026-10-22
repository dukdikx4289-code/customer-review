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
import { h, formatDateTime, formatNumber, formatPercent } from '../util.js';
import { big, delta, rows, bars } from './ui.js';

const CHANNEL_LABELS = { store: 'หน้าร้าน', online: 'ออนไลน์' };
const channelTag = (c) => (CHANNEL_LABELS[c.channel] ? h('span', { class: 'ch-tag' }, CHANNEL_LABELS[c.channel]) : null);

/** ตัวเลขสรุป: จำนวนรีวิว (เทียบช่วงก่อนหน้า) */
function reviews(data) {
  return {
    meta: delta(data.totals.responses, data.previous?.responses, { suffix: 'เทียบช่วงก่อนหน้า' }),
    body: big(formatNumber(data.totals.responses, 0), 'รีวิว', { to: data.totals.responses }),
  };
}

/** ตัวเลขสรุป: % ความพึงพอใจ (ให้ 4–5 คะแนน) */
function satisfaction(data) {
  const hi = data.primary?.max ?? 5;
  return {
    meta: delta(data.totals.satisfactionRate, data.previous?.satisfactionRate, { mode: 'points', suffix: 'เทียบช่วงก่อนหน้า' }),
    body: [big(formatPercent(data.totals.satisfactionRate), '', data.totals.satisfactionRate == null ? undefined : { to: Math.round(data.totals.satisfactionRate * 100), suffix: '%' }), h('p', { class: 'hint' }, `ให้ ${hi - 1}–${hi} คะแนน`)],
  };
}

/** ตัวเลขสรุป: คะแนนเฉลี่ย (หัวข้อความพึงพอใจ) */
function average(data) {
  const max = data.primary?.max ?? 5;
  return {
    meta: delta(data.totals.primaryAvg, data.previous?.primaryAvg, { mode: 'abs' }),
    body: [big(formatNumber(data.totals.primaryAvg), `/ ${max}`, data.totals.primaryAvg == null ? undefined : { to: data.totals.primaryAvg }), data.primary ? h('p', { class: 'hint' }, data.primary.label) : null],
  };
}

/** คำถามแบบเลือก เช่น "รู้จักเราจากช่องทางไหน" — แถบเรียงจากมากไปน้อย, % = สัดส่วนของคนที่ตอบข้อนั้น */
function choices(data) {
  const list = h('div', { class: 'choice-groups' });
  for (const q of data.choices ?? []) {
    const top = Math.max(1, ...q.options.map((o) => o.count));
    const items = q.options.map((o, i) => ({ label: o.label, ratio: o.count / top, value: `${formatNumber(o.count, 0)} คน (${q.respondents ? Math.round((o.count / q.respondents) * 100) : 0}%)`, hot: i === 0 && o.count > 0 }));
    list.append(h('section', { class: 'choice-group' }, h('div', { class: 'dist-group-head' }, h('b', {}, q.label), h('span', {}, `ตอบ ${formatNumber(q.respondents, 0)} คน${q.type === 'multi_choice' ? ' · เลือกได้หลายข้อ' : ''}`)), bars(items, q.label)));
  }
  return { body: list };
}

/** รีวิวล่าสุด — กดแต่ละรายการเพื่อดูคำตอบครบทุกข้อ */
function recent(data, ctx) {
  const list = h('ul', { class: 'rlist', 'aria-label': 'รีวิวล่าสุด' });
  for (const r of data.recent ?? []) {
    list.append(
      h(
        'li',
        {},
        h(
          'button',
          { type: 'button', class: 'rlist-item', onclick: (e) => ctx.openResponse?.(r.id, e.currentTarget) },
          h('div', { class: 'meta' }, r.branch ? h('b', {}, r.branch) : null, channelTag(r), h('span', {}, formatDateTime(r.submittedAt)), r.avg != null ? h('span', { class: 'stars-inline', 'aria-label': `เฉลี่ย ${r.avg} ดาว` }, `★ ${formatNumber(r.avg, 1)}`) : null),
          h('p', { class: `text${r.comment ? '' : ' muted'}` }, r.comment ?? 'ไม่มีข้อเสนอแนะ'),
          h('span', { class: 'rlist-go', 'aria-hidden': 'true' }, '›'),
        ),
      ),
    );
  }
  return { meta: 'กดเพื่อดูคำตอบทั้งหมด', body: (data.recent ?? []).length ? list : h('p', { class: 'empty-note' }, 'ยังไม่มีรีวิว') };
}

/** หน้าต่างรายละเอียดคำตอบ 1 รีวิว (ใช้กับ ctx.openResponse ใน dashboard-view.js) */
export function responseDetailBody(d) {
  const item = (it) => {
    let value;
    if (it.value == null) value = h('span', { class: 'muted' }, '— ไม่ได้ตอบ');
    else if (it.type === 'rating') value = h('span', { class: `score-chip s${Math.min(5, Math.max(1, Math.round((Number(it.value) / (it.max || 5)) * 5)))}` }, `${formatNumber(it.value, 0)} / ${it.max || 5} ★`);
    else if (Array.isArray(it.value)) value = h('span', { class: 'chips' }, it.value.map((v) => h('span', { class: 'chip' }, v)));
    else value = h('span', { class: it.type === 'long_text' || it.type === 'short_text' ? 'answer-text' : '' }, String(it.value));
    return h('div', { class: `ans ${it.type}` }, h('dt', {}, it.label), h('dd', {}, value));
  };
  return h(
    'div',
    { class: 'stack' },
    h('p', { class: 'muted small' }, [d.branch, CHANNEL_LABELS[d.channel], formatDateTime(d.submittedAt), d.link ? `ผ่าน ${d.link}` : null, `#${d.id}`].filter(Boolean).join(' · ')),
    h('dl', { class: 'answers' }, d.items.map(item)),
  );
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

/** ดาวแบบเติมสีตามค่าเฉลี่ย (เช่น 4.3 = เต็ม 4 ดวงกับอีก 0.3) — ตัวเลขอยู่ข้างๆ เสมอ ไม่พึ่งสีอย่างเดียว */
function starMeter(avg, max = 5) {
  const fill = h('i', { 'aria-hidden': 'true' }, '★★★★★');
  fill.style.width = `${Math.max(0, Math.min(1, (avg ?? 0) / max)) * 100}%`;
  return h('span', { class: 'star-meter', role: 'img', 'aria-label': avg == null ? 'ยังไม่มีคะแนน' : `${formatNumber(avg, 2)} จาก ${max} ดาว` }, h('span', { 'aria-hidden': 'true' }, '★★★★★'), fill);
}

/**
 * เปรียบเทียบสาขาด้วย "ดาวรวม" (เฉลี่ยทุกคะแนนดาวของสาขา) — ใช้ได้แม้แต่ละสาขาใช้ฟอร์มต่างกัน
 * เรียงจากดาวสูงไปต่ำ · แถบสีเล็กใต้ชื่อ = สัดส่วน 5★→1★ ของสาขานั้น
 */
function branchStars(data, ctx) {
  const rows = data.branchStars ?? [];
  if (!rows.length) return { body: h('p', { class: 'empty-note' }, 'ยังไม่มีสาขา') };
  const list = h('ol', { class: 'bstars', 'aria-label': 'อันดับดาวรวมรายสาขา' });
  rows.forEach((b, i) => {
    const dist = { label: b.name, min: 1, max: 5, distribution: [...b.distribution].reverse() };
    // กดชื่อสาขา → กรอง Dashboard เฉพาะสาขานั้น (เฉพาะหน้าที่มีตัวเลือกสาขา)
    const name = ctx.selectBranch
      ? h('button', { type: 'button', class: 'linkish', title: `ดูเฉพาะ ${b.name}`, onclick: () => ctx.selectBranch(b.id) }, b.name)
      : h('b', { title: b.name }, b.name);
    list.append(
      h(
        'li',
        { class: b.avg != null && b.avg < 3.5 && b.ratings >= 3 ? 'low' : '' },
        h('span', { class: 'rank' }, b.avg == null ? '–' : String(i + 1)),
        h('div', { class: 'who' }, name, h('span', {}, `${formatNumber(b.responses, 0)} รีวิว`)),
        h('div', { class: 'score' }, starMeter(b.avg), h('b', {}, b.avg == null ? '–' : formatNumber(b.avg, 2))),
        b.ratings ? h('div', { class: 'mini' }, distBar(dist)) : h('div', { class: 'mini muted small' }, 'ยังไม่มีรีวิว'),
      ),
    );
  });
  return { meta: ctx.selectBranch ? 'กดชื่อสาขาเพื่อดูเฉพาะสาขา · ⤢ ดูรายหัวข้อ' : 'ดาวรวมทุกหัวข้อ · ⤢ ดูรายหัวข้อ', body: list };
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

/**
 * การกระจายคะแนนรายหัวข้อ: แถบซ้อนต่อหัวข้อ เรียง 5★ (เขียว) → 1★ (แดง) ความยาวแต่ละช่วง = จำนวนคน
 * สีมาจาก --score-1..5 (css/base.css) ผ่านคลาส s1..s5 — จำนวนคน/เปอร์เซ็นต์อยู่ใน title และ aria-label เสมอ ไม่พึ่งสีอย่างเดียว
 */
const scoreClass = (score, lo, hi) => `s${hi > lo ? Math.round(((score - lo) / (hi - lo)) * 4) + 1 : 5}`;
const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);
const distTotal = (q) => q.distribution.reduce((a, d) => a + d.count, 0);

function distLegend(lo = 1, hi = 5) {
  const scores = Array.from({ length: hi - lo + 1 }, (_, i) => hi - i);
  return h('div', { class: 'dist-legend', 'aria-hidden': 'true' }, scores.map((s) => h('span', {}, h('i', { class: scoreClass(s, lo, hi) }), `${s}★`)));
}

function distBar(q) {
  const total = distTotal(q);
  const parts = [...q.distribution].reverse();
  const bar = h('div', { class: 'dist-bar', role: 'img', 'aria-label': `${q.label}: ${parts.map((d) => `${d.score} ดาว ${d.count} คน`).join(', ')}` });
  for (const d of parts) {
    if (!d.count) continue;
    const p = pct(d.count, total);
    const seg = h('span', { class: scoreClass(d.score, q.min, q.max), title: `${d.score} ดาว · ${formatNumber(d.count, 0)} คน (${p}%)` }, p >= 7 ? formatNumber(d.count, 0) : '');
    seg.style.flexGrow = String(d.count);
    bar.append(seg);
  }
  return bar;
}

/** กลุ่มตามช่องทาง (หน้าร้าน / ออนไลน์) — API เก่าที่ยังไม่มี distributionByChannel แสดงเป็นกลุ่มเดียว */
const distGroups = (data) =>
  (data.distributionByChannel ?? [{ channel: 'all', label: '', questions: data.questions }]).map((g) => ({ ...g, questions: g.questions.filter((q) => q.distribution?.length) }));

const groupTotal = (g) => Math.max(0, ...g.questions.map(distTotal));

function distList(g, { brief = true } = {}) {
  const list = h('div', { class: 'dist', role: 'list', 'aria-label': `การกระจายคะแนน ${g.label}`.trim() });
  for (const q of g.questions) {
    list.append(h('div', { role: 'listitem' }, h('div', { class: 'dist-head' }, h('span', { class: 'n', title: q.label }, q.label), h('span', { class: 'v' }, brief ? `เฉลี่ย ${formatNumber(q.avg)}` : `เฉลี่ย ${formatNumber(q.avg)} · ${formatNumber(distTotal(q), 0)} คน`)), distBar(q)));
  }
  return list;
}

function distGroup(g, opts) {
  const head = g.label ? h('div', { class: 'dist-group-head' }, h('b', {}, g.label), h('span', {}, `${formatNumber(groupTotal(g), 0)} คน`)) : null;
  const body = groupTotal(g) ? distList(g, opts) : h('p', { class: 'empty-note' }, 'ยังไม่มีรีวิวจากช่องทางนี้');
  return h('section', { class: 'dist-group' }, head, body);
}

function distribution(data) {
  const groups = distGroups(data);
  return { meta: distLegend(data.primary?.min, data.primary?.max), body: h('div', { class: 'dist-groups' }, groups.map((g) => distGroup(g))) };
}

/** มุมมองขยาย: แถบสี + ตารางจำนวนคนต่อดาว (ตัวเลขจริง + %) แยกตามช่องทาง */
function distributionExpanded(data) {
  const lo = data.primary?.min ?? 1;
  const hi = data.primary?.max ?? 5;
  const scores = Array.from({ length: hi - lo + 1 }, (_, i) => hi - i);
  const table = (g) =>
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'dist-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'หัวข้อ'), scores.map((s) => h('th', { class: 'num' }, h('span', { class: `dist-chip ${scoreClass(s, lo, hi)}`, 'aria-hidden': 'true' }), `${s}★`)), h('th', { class: 'num' }, 'รวม'), h('th', { class: 'num' }, 'เฉลี่ย'))),
        h(
          'tbody',
          {},
          g.questions.map((q) => {
            const total = distTotal(q);
            const count = (s) => q.distribution.find((d) => d.score === s)?.count ?? 0;
            return h('tr', {}, h('td', {}, h('b', {}, q.label)), scores.map((s) => h('td', { class: 'num' }, formatNumber(count(s), 0), h('small', {}, `${pct(count(s), total)}%`))), h('td', { class: 'num' }, formatNumber(total, 0)), h('td', { class: 'num' }, formatNumber(q.avg)));
          }),
        ),
      ),
    );
  return { body: h('div', { class: 'stack' }, distLegend(lo, hi), distGroups(data).map((g) => h('div', { class: 'stack' }, distGroup(g, { brief: false }), groupTotal(g) ? table(g) : null))) };
}

/** จุดที่ต้องแก้ไข (หัวข้อ x สาขาที่เฉลี่ยต่ำกว่าเกณฑ์) — การ์ดเล็กเท่าการ์ดตัวเลข: จำนวน + จุดที่แย่สุด, ⤢ ดูทั้งหมด */
const ATTENTION_RULE = 'เฉลี่ย < 3.5 และมี ≥ 3 รีวิว';
function attention(data) {
  const worst = data.attention[0];
  return {
    body: [
      big(formatNumber(data.attention.length, 0), 'จุด', { to: data.attention.length }),
      worst
        ? h('p', { class: 'hint worst', title: `${worst.branch} · ${worst.question}` }, h('span', { class: 'dot err' }), h('span', { class: 't' }, `แย่สุด ${worst.branch} · ${worst.question}`), h('b', {}, formatNumber(worst.avg)))
        : h('p', { class: 'ok-note' }, '✓ ทุกสาขาอยู่เหนือเกณฑ์'),
      h('p', { class: 'hint' }, data.attention.length > 1 ? `${ATTENTION_RULE} · ⤢ ดูทั้งหมด` : ATTENTION_RULE),
    ],
  };
}

function attentionExpanded(data) {
  return {
    meta: ATTENTION_RULE,
    body: data.attention.length ? rows(data.attention.map((a) => ({ tone: 'err', label: `${a.branch} · ${a.question}`, value: formatNumber(a.avg) }))) : h('p', { class: 'ok-note' }, '✓ ทุกสาขาอยู่เหนือเกณฑ์'),
  };
}

// expanded (ไม่บังคับ) = มุมมองเต็มในหน้าต่างโมดอลเมื่อกดปุ่ม ⤢ ถ้าไม่ใส่ จะใช้ render เดิมแสดงในกล่องใหญ่
// when (ไม่บังคับ) = แสดงการ์ดเฉพาะเมื่อมีข้อมูล (เช่น ฟอร์มไม่มีคำถามแบบเลือก ก็ไม่ต้องมีการ์ด "รู้จักเราจาก")
export const WIDGETS = [
  { id: 'reviews', size: 'sm', title: 'จำนวนรีวิว', render: reviews },
  { id: 'satisfaction', size: 'sm', title: 'ความพึงพอใจ', render: satisfaction },
  { id: 'average', size: 'sm', title: 'คะแนนเฉลี่ย', render: average },
  { id: 'attention', size: 'sm', title: 'จุดที่ต้องแก้ไข', render: attention, expanded: attentionExpanded },
  { id: 'branches', size: 'wide', title: 'เปรียบเทียบสาขา (ดาวรวม)', render: branchStars, expanded: branchesExpanded },
  { id: 'recent', size: 'wide', title: 'รีวิวล่าสุด', render: recent },
  { id: 'distribution', size: 'wide', title: 'การกระจายคะแนนรายหัวข้อ', render: distribution, expanded: distributionExpanded },
  { id: 'choices', size: 'wide', title: 'รู้จักเรา / ตัวเลือกที่ลูกค้าตอบ', render: choices, when: (data) => (data.choices ?? []).length > 0 },
];
