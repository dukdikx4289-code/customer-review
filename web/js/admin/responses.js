import { api, ApiError } from '../api.js';
import { h, clear, formatDateTime, formatNumber, toast } from '../util.js';

const CHANNEL_LABELS = { store: 'หน้าร้าน', online: 'ออนไลน์' };
const CHANNELS = [['', 'ทุกช่องทาง'], ['store', 'หน้าร้าน'], ['online', 'ออนไลน์']];
const TEXT_TYPES = new Set(['short_text', 'long_text']);

// สีระดับคะแนนเดียวกับ Dashboard (คลาส s1..s5 ใน css/widgets.css: 5★ เขียว → 1★ แดง)
const scoreClass = (v, lo = 1, hi = 5) => `s${hi > lo ? Math.min(5, Math.max(1, Math.round(((v - lo) / (hi - lo)) * 4) + 1)) : 5}`;

function answerText(value, q) {
  if (Array.isArray(value)) return value.join(', ');
  return q?.type === 'rating' ? formatNumber(value) : String(value);
}

/** การ์ดคำตอบ 1 รายการ: หัว (เวลา/สาขา/ช่องทาง/ลิงก์) + ดาวรายหัวข้อแบบชิปสี + ข้อเสนอแนะ */
function responseCard(r, questions, { showBranch, selected, onToggle, onDelete }) {
  const ratings = questions.filter((q) => q.type === 'rating' && typeof r.answers[q.key] === 'number');
  const avg = ratings.length ? ratings.reduce((a, q) => a + r.answers[q.key], 0) / ratings.length : null;
  const others = questions.filter((q) => q.type !== 'rating' && !TEXT_TYPES.has(q.type) && r.answers[q.key] != null);
  const texts = questions.filter((q) => TEXT_TYPES.has(q.type) && r.answers[q.key]);

  const check = h('input', { type: 'checkbox', checked: selected, 'aria-label': `เลือกคำตอบ #${r.id}`, onchange: (e) => onToggle(e.target.checked) });
  return h(
    'article',
    { class: `card resp-card${selected ? ' is-selected' : ''}` },
    h(
      'div',
      { class: 'resp-head' },
      h('label', { class: 'resp-check' }, check),
      h(
        'div',
        { class: 'resp-meta' },
        h('b', {}, formatDateTime(r.submittedAt)),
        showBranch && r.branch ? h('span', {}, r.branch) : null,
        CHANNEL_LABELS[r.channel] ? h('span', { class: 'ch-badge' }, CHANNEL_LABELS[r.channel]) : null,
        h('span', { class: 'muted' }, r.link ? `ผ่าน ${r.link}` : 'ลิงก์ถูกลบแล้ว'),
        h('span', { class: 'key' }, `#${r.id}`),
      ),
      avg != null ? h('span', { class: `avg-pill ${scoreClass(avg)}`, title: 'คะแนนเฉลี่ยของรีวิวนี้' }, `★ ${formatNumber(avg, 1)}`) : null,
      h('button', { class: 'btn small danger', type: 'button', onclick: onDelete }, 'ลบ'),
    ),
    ratings.length
      ? h(
          'ul',
          { class: 'resp-chips', 'aria-label': 'คะแนนรายหัวข้อ' },
          ratings.map((q) => {
            const v = r.answers[q.key];
            return h('li', {}, h('span', {}, q.label), h('b', { class: scoreClass(v, q.min, q.max) }, `${v}★`));
          }),
        )
      : null,
    others.length ? h('p', { class: 'resp-others' }, others.map((q, i) => [i ? ' · ' : '', h('span', { class: 'muted' }, `${q.label}: `), answerText(r.answers[q.key], q)])) : null,
    texts.map((q) => h('blockquote', { class: 'resp-comment' }, h('span', { class: 'muted small' }, q.label), h('p', {}, r.answers[q.key]))),
  );
}

/** รายการคำตอบ + ตัวกรอง + ลบ — ใช้ทั้งหน้า "คำตอบ" และแท็บในหน้ารายสาขา */
export async function responsesTable({ branchId = null } = {}) {
  const branches = branchId ? [] : await api('/admin/branches');
  const holder = h('div', {});
  const filter = { branch_id: branchId ?? '', channel: '', from: '', to: '', has_comment: false };
  let page = 1;
  let selected = new Set();
  let last = null;

  const query = () => {
    const q = new URLSearchParams({ page });
    for (const [k, v] of Object.entries(filter)) if (v) q.set(k, v === true ? '1' : v);
    return q;
  };
  const filterBody = () => ({ branchId: filter.branch_id ? Number(filter.branch_id) : null, channel: filter.channel || null, from: filter.from || null, to: filter.to || null, hasComment: filter.has_comment });
  const hasFilter = () => Boolean((!branchId && filter.branch_id) || filter.channel || filter.from || filter.to || filter.has_comment);

  async function remove(body, message) {
    try {
      const res = await api('/admin/responses/delete', { method: 'POST', body });
      toast(`ลบแล้ว ${formatNumber(res.deleted, 0)} รายการ${message ?? ''}`);
      selected = new Set();
      await load();
    } catch (err) {
      toast(err instanceof ApiError ? `ลบไม่สำเร็จ (${err.message})` : 'ลบไม่สำเร็จ');
    }
  }

  const sheetNote = '\nแถวใน Google Sheet จะถูกลบตามให้อัตโนมัติ · ย้อนกลับไม่ได้';

  function toolbar() {
    const onChange = () => ((page = 1), (selected = new Set()), load());
    const branchSel = branchId
      ? null
      : h(
          'select',
          { 'aria-label': 'สาขา', onchange: (e) => ((filter.branch_id = e.target.value), onChange()) },
          h('option', { value: '' }, 'ทุกสาขา'),
          branches.map((b) => h('option', { value: b.id, selected: String(b.id) === String(filter.branch_id) }, b.name)),
        );
    const channelSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'ช่องทาง' }, CHANNELS.map(([value, text]) => h('button', { type: 'button', 'aria-pressed': String(filter.channel === value), onclick: () => ((filter.channel = value), onChange()) }, text)));
    const date = (key, label) => h('label', { class: 'field inline' }, h('span', {}, label), h('input', { type: 'date', value: filter[key], onchange: (e) => ((filter[key] = e.target.value), onChange()) }));
    const comment = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: filter.has_comment, onchange: (e) => ((filter.has_comment = e.target.checked), onChange()) }), 'เฉพาะที่มีข้อเสนอแนะ');
    const reset = hasFilter()
      ? h('button', { class: 'btn small', type: 'button', onclick: () => (Object.assign(filter, { branch_id: branchId ?? '', channel: '', from: '', to: '', has_comment: false }), onChange()) }, 'ล้างตัวกรอง')
      : null;
    return h('section', { class: 'card resp-tools' }, branchSel, channelSeg, date('from', 'ตั้งแต่'), date('to', 'ถึง'), comment, reset);
  }

  function bulkBar(items) {
    const pageIds = items.map((r) => r.id);
    const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
    const selectAll = h('input', {
      type: 'checkbox',
      checked: allOnPage,
      'aria-label': 'เลือกทั้งหน้านี้',
      onchange: (e) => {
        for (const id of pageIds) e.target.checked ? selected.add(id) : selected.delete(id);
        draw();
      },
    });
    const delSelected = h(
      'button',
      {
        class: 'btn small danger',
        type: 'button',
        disabled: !selected.size,
        onclick: () => {
          if (confirm(`ลบคำตอบที่เลือก ${selected.size} รายการ?${sheetNote}`)) remove({ ids: [...selected] });
        },
      },
      `ลบที่เลือก${selected.size ? ` (${selected.size})` : ''}`,
    );
    const delAll = h(
      'button',
      {
        class: 'btn small danger ghost-danger',
        type: 'button',
        disabled: !last.total,
        onclick: () => {
          const scope = hasFilter() ? 'ที่ตรงกับตัวกรองตอนนี้' : branchId ? 'ทั้งหมดของสาขานี้' : 'ทั้งหมดในระบบ';
          const typed = prompt(`ลบคำตอบ${scope} ${formatNumber(last.total, 0)} รายการ?${sheetNote}\n\nพิมพ์คำว่า ลบ เพื่อยืนยัน`);
          if (typed?.trim() === 'ลบ') remove({ all: true, filter: filterBody() });
          else if (typed !== null) toast('ยกเลิก — ต้องพิมพ์คำว่า ลบ');
        },
      },
      hasFilter() ? `ลบทั้งหมดตามตัวกรอง (${formatNumber(last.total, 0)})` : `ลบทั้งหมด (${formatNumber(last.total, 0)})`,
    );
    return h('div', { class: 'resp-bulk' }, h('label', { class: 'check' }, selectAll, 'เลือกทั้งหน้า'), delSelected, h('span', { class: 'grow' }), h('span', { class: 'muted small' }, `พบ ${formatNumber(last.total, 0)} รายการ`), delAll);
  }

  function draw() {
    const { items, questions } = last;
    const pages = Math.max(1, Math.ceil(last.total / last.pageSize));
    const list = items.length
      ? h(
          'div',
          { class: 'list' },
          items.map((r) =>
            responseCard(r, questions, {
              showBranch: !branchId,
              selected: selected.has(r.id),
              onToggle: (on) => (on ? selected.add(r.id) : selected.delete(r.id), draw()),
              onDelete: () => {
                if (confirm(`ลบคำตอบ #${r.id} (${formatDateTime(r.submittedAt)})?${sheetNote}`)) remove({ ids: [r.id] });
              },
            }),
          ),
        )
      : h('div', { class: 'card empty' }, h('p', {}, hasFilter() ? 'ไม่พบคำตอบที่ตรงกับตัวกรอง' : 'ยังไม่มีคำตอบ'));
    const pager = h(
      'div',
      { class: 'pager' },
      h('button', { class: 'btn small', type: 'button', disabled: page <= 1, onclick: () => ((page -= 1), load()) }, '‹ ก่อนหน้า'),
      h('span', { class: 'muted small' }, `หน้า ${page} / ${pages}`),
      h('button', { class: 'btn small', type: 'button', disabled: page >= pages, onclick: () => ((page += 1), load()) }, 'ถัดไป ›'),
    );
    clear(holder).append(toolbar(), bulkBar(items), list, pages > 1 ? pager : null);
  }

  async function load() {
    last = await api(`/admin/responses?${query()}`);
    const pages = Math.max(1, Math.ceil(last.total / last.pageSize));
    if (page > pages) {
      page = pages; // ลบจนหน้าสุดท้ายว่าง → ถอยกลับหน้าที่มีข้อมูล
      last = await api(`/admin/responses?${query()}`);
    }
    draw();
  }

  await load();
  return holder;
}

export async function responsesView() {
  return h('div', {}, h('div', { class: 'page-head' }, h('h1', {}, 'คำตอบทั้งหมด')), h('p', { class: 'muted' }, 'เลือกแล้วกดลบเพื่อล้างข้อมูลทดสอบได้ · ลบแล้ว Dashboard และ Google Sheet อัปเดตตาม'), await responsesTable());
}
