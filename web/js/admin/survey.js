import { api } from '../api.js';
import { h, clear, formatDateTime, toast } from '../util.js';

const TYPE_LABELS = {
  rating: 'ให้คะแนน (ดาว 1–5)',
  single_choice: 'เลือกตอบข้อเดียว',
  multi_choice: 'เลือกได้หลายข้อ',
  short_text: 'ข้อความสั้น',
  long_text: 'ข้อความยาว',
};

const CHANNELS = [
  ['store', 'หน้าร้าน'],
  ['online', 'ออนไลน์'],
];
const VIEWS = [['all', 'ทั้งหมด'], ...CHANNELS];

const rand = () => Math.random().toString(36).slice(2, 7);

// ไม่ระบุช่องทาง (คำถามจากเวอร์ชันเก่า) = แสดงทั้งสองช่องทาง
const channelsOf = (q) => (Array.isArray(q.channels) && q.channels.length ? q.channels : CHANNELS.map(([c]) => c));

function newQuestion(type, view) {
  const channels = view === 'all' ? CHANNELS.map(([c]) => c) : [view];
  const base = { key: `q_${rand()}${rand()}`, type, label: '', required: false, channels, config: {}, isNew: true };
  if (type === 'rating') base.config = { min: 1, max: 5, labels: { 1: 'ควรปรับปรุง', 5: 'ดีเยี่ยม' } };
  if (type === 'single_choice' || type === 'multi_choice') base.config = { options: [{ value: `o_${rand()}`, label: 'ตัวเลือก 1' }, { value: `o_${rand()}`, label: 'ตัวเลือก 2' }] };
  if (type === 'long_text') base.config = { maxLength: 1000 };
  return base;
}

export async function surveyView() {
  const data = await api('/admin/survey');
  let questions = structuredClone(data.questions);
  let title = data.title;
  let thankYou = data.settings?.thankYou ?? '';
  let view = 'all'; // ดูชุดคำถามที่ลูกค้าแต่ละช่องทางเห็น
  const holder = h('div', {});
  for (const q of questions) q.channels = channelsOf(q);

  function move(i, d) {
    const j = i + d;
    if (j < 0 || j >= questions.length) return;
    [questions[i], questions[j]] = [questions[j], questions[i]];
    draw();
  }

  function questionCard(q, i) {
    const label = h('input', { type: 'text', value: q.label, maxlength: 200, 'aria-label': 'คำถาม', oninput: (e) => (q.label = e.target.value) });
    const required = h('input', { type: 'checkbox', checked: q.required, onchange: (e) => (q.required = e.target.checked) });
    const channelBoxes = CHANNELS.map(([value, text]) =>
      h(
        'label',
        { class: 'check' },
        h('input', {
          type: 'checkbox',
          checked: q.channels.includes(value),
          onchange: (e) => {
            const next = e.target.checked ? [...new Set([...q.channels, value])] : q.channels.filter((c) => c !== value);
            if (!next.length) {
              e.target.checked = true; // ต้องอยู่อย่างน้อย 1 ช่องทาง
              return toast('คำถามต้องแสดงอย่างน้อย 1 ช่องทาง');
            }
            q.channels = CHANNELS.map(([c]) => c).filter((c) => next.includes(c));
            if (view !== 'all' && !q.channels.includes(view)) draw();
          },
        }),
        text,
      ),
    );
    const extras = [];

    if (q.type === 'rating') {
      const lo = h('input', { type: 'text', value: q.config.labels?.[q.config.min ?? 1] ?? '', maxlength: 30, oninput: (e) => ((q.config.labels ??= {})[q.config.min ?? 1] = e.target.value) });
      const hi = h('input', { type: 'text', value: q.config.labels?.[q.config.max ?? 5] ?? '', maxlength: 30, oninput: (e) => ((q.config.labels ??= {})[q.config.max ?? 5] = e.target.value) });
      extras.push(h('div', { class: 'two' }, h('label', { class: 'field' }, h('span', {}, 'ข้อความปลายต่ำสุด'), lo), h('label', { class: 'field' }, h('span', {}, 'ข้อความปลายสูงสุด'), hi)));
    }
    if (q.type === 'single_choice' || q.type === 'multi_choice') {
      const area = h('textarea', { rows: 4, 'aria-label': 'ตัวเลือก (บรรทัดละ 1 ข้อ)' });
      area.value = q.config.options.map((o) => o.label).join('\n');
      area.addEventListener('input', () => {
        const old = new Map(q.config.options.map((o) => [o.label, o.value]));
        q.config.options = area.value
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((label) => ({ label, value: old.get(label) ?? `o_${rand()}` }));
      });
      extras.push(h('label', { class: 'field' }, h('span', {}, 'ตัวเลือก (บรรทัดละ 1 ข้อ อย่างน้อย 2 ข้อ)'), area));
    }
    if (q.type === 'short_text' || q.type === 'long_text') {
      const max = h('input', { type: 'number', min: 10, max: 2000, value: q.config.maxLength ?? (q.type === 'long_text' ? 1000 : 200), oninput: (e) => (q.config.maxLength = Number(e.target.value) || undefined) });
      extras.push(h('label', { class: 'field' }, h('span', {}, 'ความยาวสูงสุด (ตัวอักษร)'), max));
    }

    return h(
      'article',
      { class: 'card q-edit' },
      h('div', { class: 'head' }, h('div', {}, h('strong', {}, `ข้อ ${i + 1}`), ' ', h('span', { class: 'badge' }, TYPE_LABELS[q.type]), ' ', h('span', { class: 'key', title: 'รหัสภายในของคำถาม คงที่ข้ามเวอร์ชันเพื่อให้เทรนด์ต่อเนื่อง' }, q.key)), h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', disabled: view !== 'all' || i === 0, title: view !== 'all' ? 'จัดลำดับได้ในมุมมอง "ทั้งหมด"' : undefined, 'aria-label': 'เลื่อนขึ้น', onclick: () => move(i, -1) }, '↑'), h('button', { class: 'btn small', type: 'button', disabled: view !== 'all' || i === questions.length - 1, title: view !== 'all' ? 'จัดลำดับได้ในมุมมอง "ทั้งหมด"' : undefined, 'aria-label': 'เลื่อนลง', onclick: () => move(i, 1) }, '↓'), h('button', { class: 'btn small danger', type: 'button', onclick: () => { if (confirm('ลบคำถามนี้ออกจากฟอร์ม?\n(คำตอบที่เก็บไปแล้วยังอยู่ครบ)')) { questions.splice(i, 1); draw(); } } }, 'ลบ'))),
      h('label', { class: 'field' }, h('span', {}, 'ข้อความคำถาม'), label),
      ...extras,
      h('div', { class: 'row q-flags' }, h('span', { class: 'muted small' }, 'แสดงในช่องทาง:'), ...channelBoxes, h('span', { class: 'q-sep', 'aria-hidden': 'true' }), h('label', { class: 'check' }, required, 'บังคับตอบ')),
    );
  }

  function draw() {
    const typeSel = h('select', { 'aria-label': 'ชนิดคำถามที่จะเพิ่ม' }, Object.entries(TYPE_LABELS).map(([v, l]) => h('option', { value: v }, l)));
    const error = h('p', { class: 'alert error hidden', role: 'alert' });
    const publish = h('button', { class: 'btn primary', type: 'button' }, `เผยแพร่เป็นเวอร์ชัน ${data.version + 1}`);
    publish.addEventListener('click', async () => {
      error.classList.add('hidden');
      if (questions.some((q) => !q.label.trim())) {
        error.textContent = 'มีคำถามที่ยังไม่ได้ใส่ข้อความ';
        return error.classList.remove('hidden');
      }
      if (!confirm('เผยแพร่คำถามชุดนี้?\nลูกค้าที่เปิดฟอร์มหลังจากนี้จะเห็นชุดใหม่ทันที (คำตอบเก่าไม่ถูกแก้)')) return;
      publish.disabled = true;
      try {
        const clean = questions.map(({ isNew, ...q }) => ({ ...q, label: q.label.trim() }));
        await api('/admin/survey/publish', { method: 'POST', body: { title, questions: clean, settings: { ...data.settings, thankYou: thankYou.trim() || undefined } } });
        toast('เผยแพร่แล้ว');
        location.reload();
      } catch (err) {
        error.textContent = err.body?.issues?.map((i) => `${i.path}: ${i.message}`).join(' · ') || 'เผยแพร่ไม่สำเร็จ';
        error.classList.remove('hidden');
        publish.disabled = false;
      }
    });

    const count = (c) => questions.filter((q) => q.channels.includes(c)).length;
    const viewSeg = h(
      'div',
      { class: 'seg', role: 'group', 'aria-label': 'ดูคำถามตามช่องทาง' },
      VIEWS.map(([value, text]) => h('button', { type: 'button', 'aria-pressed': String(view === value), onclick: () => ((view = value), draw()) }, value === 'all' ? `${text} (${questions.length})` : `${text} (${count(value)})`)),
    );
    const visible = questions.map((q, i) => [q, i]).filter(([q]) => view === 'all' || q.channels.includes(view));

    clear(holder).append(
      h('section', { class: 'card stack' }, h('label', { class: 'field' }, h('span', {}, 'ชื่อแบบสอบถาม'), h('input', { type: 'text', value: title, maxlength: 200, oninput: (e) => (title = e.target.value) })), h('label', { class: 'field' }, h('span', {}, 'ข้อความขอบคุณหลังส่ง'), h('input', { type: 'text', value: thankYou, maxlength: 200, oninput: (e) => (thankYou = e.target.value) }))),
      h('div', { class: 'row between section' }, viewSeg, h('span', { class: 'muted small' }, view === 'all' ? 'ข้อที่อยู่ทั้งสองช่องทางรวมสถิติกันได้' : `ลำดับที่ลูกค้า${VIEWS.find(([v]) => v === view)[1]}เห็น`)),
      h('div', { class: 'list section' }, visible.length ? visible.map(([q, i]) => questionCard(q, i)) : h('p', { class: 'muted' }, 'ยังไม่มีคำถามในช่องทางนี้')),
      h('div', { class: 'card row section' }, typeSel, h('button', { class: 'btn', type: 'button', onclick: () => { questions.push(newQuestion(typeSel.value, view)); draw(); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); } }, view === 'all' ? '+ เพิ่มคำถาม (ทั้งสองช่องทาง)' : `+ เพิ่มคำถาม (${VIEWS.find(([v]) => v === view)[1]})`)),
      error,
      h('div', { class: 'row section' }, publish, h('span', { class: 'muted small' }, `ปัจจุบันใช้เวอร์ชัน ${data.version}`)),
      h('details', { class: 'table-view section' }, h('summary', {}, 'ประวัติเวอร์ชัน'), h('ul', {}, data.versions.map((v) => h('li', {}, `เวอร์ชัน ${v.version_no} — ${formatDateTime(v.published_at)}`)))),
    );
  }

  draw();
  return h('div', {}, h('div', { class: 'page-head' }, h('h1', {}, 'แก้ไขคำถาม')), h('p', { class: 'muted' }, 'การเผยแพร่จะสร้างเวอร์ชันใหม่ คำตอบเก่ายังอ้างอิงเวอร์ชันเดิมและไม่ถูกแก้ · รหัสภายในของคำถามเดิมคงที่ เพื่อให้เทรนด์ต่อเนื่องแม้เปลี่ยนถ้อยคำ'), holder);
}
