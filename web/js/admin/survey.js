import { api, ApiError } from '../api.js';
import { h, clear, formatDateTime, toast } from '../util.js';
import { openModal } from '../ui/modal.js';

const TYPE_LABELS = {
  rating: 'ให้คะแนน (หมู 1–5)',
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

// ข้อความหลังส่ง — ต้องตรงกับค่าเริ่มต้นใน js/form.js (ฟอร์มที่ยังไม่ได้ตั้งจะเห็นข้อความนี้)
const DONE_FIELDS = [
  ['sentTitle', 'หน้าส่งสำเร็จ (ขึ้นสั้นๆ ก่อนเด้งไปหน้าขอบคุณ)', 'ส่งความคิดเห็นเรียบร้อยแล้ว 💚', 120],
  ['thanksTitle', 'หน้าขอบคุณ: หัวข้อ', 'ขอบคุณที่ให้เหนียวหมูไส้แตกดูแลมื้อนี้ของคุณ', 200],
  ['thankYou', 'หน้าขอบคุณ: ข้อความ', 'ความคิดเห็นของคุณจะช่วยให้เราปรับปรุงอาหารและบริการให้ดียิ่งขึ้น หวังว่าจะได้ดูแลคุณอีกครั้งในมื้อถัดไปนะคะ', 600],
];

const rand = () => Math.random().toString(36).slice(2, 7);

// ไม่ระบุช่องทาง (คำถามจากเวอร์ชันเก่า) = แสดงทั้งสองช่องทาง
const channelsOf = (q) => (Array.isArray(q.channels) && q.channels.length ? q.channels : CHANNELS.map(([c]) => c));

function newQuestion(type, view) {
  const channels = view === 'all' ? CHANNELS.map(([c]) => c) : [view];
  const base = { key: `q_${rand()}${rand()}`, type, title: '', label: '', required: false, channels, config: {}, isNew: true };
  if (type === 'rating') base.config = { min: 1, max: 5, labels: { 1: 'ควรปรับปรุง', 5: 'ดีเยี่ยม' } };
  if (type === 'single_choice' || type === 'multi_choice') base.config = { options: [{ value: `o_${rand()}`, label: 'ตัวเลือก 1' }, { value: `o_${rand()}`, label: 'ตัวเลือก 2' }] };
  if (type === 'long_text') base.config = { maxLength: 1000 };
  return base;
}

// ทุกสาขามีฟอร์มของตัวเอง แก้แยกกัน: #/survey/<branchId> = ฟอร์มสาขา, #/survey/template = แม่แบบสำหรับสาขาใหม่
// ไม่ระบุ → เปิดฟอร์มของสาขาแรก
export async function surveyView({ param } = {}) {
  const branches = await api('/admin/branches');
  const branchId = param === 'template' ? null : Number(param) || branches[0]?.id || null;
  if (!param && branchId) history.replaceState(null, '', `#/survey/${branchId}`);
  const data = await api(`/admin/survey${branchId ? `?branch_id=${branchId}` : ''}`);
  let questions = structuredClone(data.questions);
  let title = data.title;
  // ข้อความหลังส่ง: ยังไม่ได้ตั้ง → ใส่ค่าเริ่มต้นให้แก้ต่อได้เลย
  const doneTexts = Object.fromEntries(DONE_FIELDS.map(([k, , def]) => [k, data.settings?.[k] ?? def]));
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
    const qTitle = h('input', { type: 'text', value: q.title ?? '', maxlength: 60, placeholder: 'เช่น รสชาติ', oninput: (e) => (q.title = e.target.value) });
    const label = h('input', { type: 'text', value: q.label, maxlength: 200, placeholder: 'เช่น คุณพึงพอใจกับรสชาติอาหารครั้งนี้เพียงใด', oninput: (e) => (q.label = e.target.value) });
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
      h('div', { class: 'q-texts' }, h('label', { class: 'field' }, h('span', {}, 'หัวข้อ (ไม่บังคับ · ใช้เป็นชื่อใน Dashboard)'), qTitle), h('label', { class: 'field' }, h('span', {}, 'เนื้อเรื่อง (คำถามที่ลูกค้าเห็น)'), label)),
      ...extras,
      h('div', { class: 'row q-flags' }, h('span', { class: 'muted small' }, 'แสดงในช่องทาง:'), ...channelBoxes, h('span', { class: 'q-sep', 'aria-hidden': 'true' }), h('label', { class: 'check' }, required, 'บังคับตอบ')),
    );
  }

  function draw() {
    const typeSel = h('select', { 'aria-label': 'ชนิดคำถามที่จะเพิ่ม' }, Object.entries(TYPE_LABELS).map(([v, l]) => h('option', { value: v }, l)));
    const error = h('p', { class: 'alert error hidden', role: 'alert' });
    const publish = h('button', { class: 'btn primary', type: 'button' }, data.branch ? `เผยแพร่ฟอร์มของ ${data.branch.name}` : 'บันทึกแม่แบบ');
    publish.addEventListener('click', async () => {
      error.classList.add('hidden');
      if (questions.some((q) => !q.label.trim())) {
        error.textContent = 'มีคำถามที่ยังไม่ได้ใส่เนื้อเรื่อง';
        return error.classList.remove('hidden');
      }
      const msg = data.branch
        ? `เผยแพร่ฟอร์มของ ${data.branch.name}?\nลูกค้าสาขานี้ที่สแกนหลังจากนี้จะเห็นชุดใหม่ทันที · สาขาอื่นไม่เปลี่ยน (คำตอบเก่าไม่ถูกแก้ · QR เดิมใช้ได้เหมือนเดิม)`
        : 'บันทึกแม่แบบสำหรับสาขาใหม่?\nใช้เป็นจุดเริ่มต้นตอนเพิ่มสาขาใหม่เท่านั้น · สาขาที่มีอยู่ไม่เปลี่ยน';
      if (!confirm(msg)) return;
      publish.disabled = true;
      try {
        const clean = questions.map(({ isNew, ...q }) => ({ ...q, title: q.title?.trim() || undefined, label: q.label.trim() }));
        const texts = Object.fromEntries(DONE_FIELDS.map(([k]) => [k, doneTexts[k].trim() || undefined]));
        await api('/admin/survey/publish', { method: 'POST', body: { title: data.branch ? undefined : title, branchId: data.branch?.id ?? null, questions: clean, settings: { ...data.settings, ...texts } } });
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

    const titleField = data.branch
      ? h('p', { class: 'muted small' }, `ชื่อแบบสอบถาม "${title}" ใช้ร่วมกันทุกสาขา (แก้ได้ที่ "แม่แบบสำหรับสาขาใหม่")`)
      : h('label', { class: 'field' }, h('span', {}, 'ชื่อแบบสอบถาม'), h('input', { type: 'text', value: title, maxlength: 200, oninput: (e) => (title = e.target.value) }));
    clear(holder).append(
      h('section', { class: 'card stack' }, titleField),
      h('div', { class: 'row between section' }, viewSeg, h('span', { class: 'muted small' }, view === 'all' ? 'ข้อที่อยู่ทั้งสองช่องทางรวมสถิติกันได้' : `ลำดับที่ลูกค้า${VIEWS.find(([v]) => v === view)[1]}เห็น`)),
      h('div', { class: 'list section' }, visible.length ? visible.map(([q, i]) => questionCard(q, i)) : h('p', { class: 'muted' }, 'ยังไม่มีคำถามในช่องทางนี้')),
      h('div', { class: 'card row section' }, typeSel, h('button', { class: 'btn', type: 'button', onclick: () => { questions.push(newQuestion(typeSel.value, view)); draw(); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); } }, view === 'all' ? '+ เพิ่มคำถาม (ทั้งสองช่องทาง)' : `+ เพิ่มคำถาม (${VIEWS.find(([v]) => v === view)[1]})`)),
      h(
        'section',
        { class: 'card stack section' },
        h('h2', {}, 'ข้อความหลังลูกค้าส่ง'),
        h('p', { class: 'muted small' }, `ขึ้น "หน้าส่งสำเร็จ" ประมาณ 2 วินาที แล้วเด้งไปหน้าขอบคุณ · เว้นว่าง = ใช้ข้อความเริ่มต้น`),
        DONE_FIELDS.map(([k, text, def, max]) => {
          const input = h(k === 'thankYou' ? 'textarea' : 'input', { maxlength: max, placeholder: def, ...(k === 'thankYou' ? { rows: 3 } : { type: 'text' }), oninput: (e) => (doneTexts[k] = e.target.value) });
          input.value = doneTexts[k];
          return h('label', { class: 'field' }, h('span', {}, text), input);
        }),
      ),
      error,
      h('div', { class: 'row section' }, publish, h('span', { class: 'muted small' }, `ปัจจุบันใช้เวอร์ชัน ${data.version}`)),
      h('details', { class: 'table-view section' }, h('summary', {}, 'ประวัติเวอร์ชัน'), h('ul', {}, data.versions.map((v) => h('li', {}, `เวอร์ชัน ${v.version_no} — ${formatDateTime(v.published_at)}`)))),
    );
  }

  // เลือกฟอร์มที่จะแก้: ฟอร์มของแต่ละสาขา (แยกกันทั้งหมด) หรือแม่แบบสำหรับสาขาใหม่
  const branchSel = h(
    'select',
    { 'aria-label': 'แก้ไขฟอร์มของ', onchange: (e) => (location.hash = `#/survey/${e.target.value}`) },
    branches.map((b) => h('option', { value: b.id, selected: b.id === data.branch?.id }, b.isActive ? b.name : `${b.name} (ปิดอยู่)`)),
    h('option', { value: 'template', selected: !data.branch }, '— แม่แบบสำหรับสาขาใหม่ —'),
  );
  const sourceName = data.branch ? data.branch.name : 'แม่แบบ';
  const scopeCard = h(
    'section',
    { class: 'card stack form-scope' },
    h('label', { class: 'field' }, h('span', {}, 'แก้ไขฟอร์มของ'), branchSel),
    h(
      'div',
      { class: 'row between' },
      h('span', { class: 'muted small' }, data.branch ? 'แก้แล้วเผยแพร่ มีผลเฉพาะสาขานี้ · สาขาอื่นไม่เปลี่ยน' : 'ใช้เป็นจุดเริ่มต้นตอนเพิ่มสาขาใหม่เท่านั้น · สาขาที่มีอยู่ไม่เปลี่ยน'),
      branches.length > (data.branch ? 1 : 0) ? h('button', { class: 'btn small', type: 'button', onclick: (e) => copyDialog(e.currentTarget) }, `คัดลอกฟอร์ม${data.branch ? 'นี้' : 'แม่แบบ'}ไปยังสาขาอื่น…`) : null,
    ),
  );

  // คัดลอกฟอร์มที่เผยแพร่แล้ว (ไม่รวมที่แก้ค้างอยู่) ไปหลายสาขา — แต่ละสาขาได้เวอร์ชันใหม่ของตัวเอง แก้ต่อแยกกันได้
  function copyDialog(opener) {
    const targets = branches.filter((b) => b.id !== data.branch?.id);
    const boxes = targets.map((b) => h('input', { type: 'checkbox', value: b.id }));
    const error = h('p', { class: 'alert error hidden', role: 'alert' });
    const go = h('button', { class: 'btn primary', type: 'button' }, 'คัดลอก');
    const dialog = openModal({
      title: `คัดลอกฟอร์มของ ${sourceName}`,
      opener,
      body: h(
        'div',
        { class: 'stack' },
        h('p', { class: 'muted small' }, 'ใช้ฟอร์มที่เผยแพร่ล่าสุด (ถ้าแก้ค้างอยู่ให้เผยแพร่ก่อน) · สาขาที่เลือกจะถูกแทนที่ด้วยฟอร์มนี้ทันที · QR เดิมใช้ได้เหมือนเดิม'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => boxes.forEach((b) => (b.checked = e.target.checked)) }), 'เลือกทุกสาขา'),
        h('div', { class: 'copy-list' }, targets.map((b, i) => h('label', { class: 'check' }, boxes[i], b.name))),
        error,
        h('div', { class: 'row' }, go),
      ),
    });
    go.addEventListener('click', async () => {
      const toBranchIds = boxes.filter((b) => b.checked).map((b) => Number(b.value));
      if (!toBranchIds.length) {
        error.textContent = 'เลือกอย่างน้อย 1 สาขา';
        return error.classList.remove('hidden');
      }
      if (!confirm(`แทนที่ฟอร์มของ ${toBranchIds.length} สาขา ด้วยฟอร์มของ ${sourceName}?\nลูกค้าสาขาเหล่านั้นที่สแกนหลังจากนี้จะเห็นฟอร์มใหม่ทันที (คำตอบเก่าไม่ถูกแก้)`)) return;
      go.disabled = true;
      try {
        const res = await api('/admin/survey/copy', { method: 'POST', body: { fromBranchId: data.branch?.id ?? null, toBranchIds } });
        dialog.close();
        toast(`คัดลอกไป ${res.copied} สาขาแล้ว`);
      } catch (err) {
        error.textContent = err instanceof ApiError ? `ไม่สำเร็จ (${err.message})` : 'ไม่สำเร็จ';
        error.classList.remove('hidden');
        go.disabled = false;
      }
    });
  }

  if (data.mode === 'inherit') {
    // กรณีพิเศษ: สาขาที่ยังไม่มีฟอร์มของตัวเอง (เช่น ข้อมูลเก่าก่อนแยกฟอร์ม) — สร้างจากแม่แบบได้ในคลิกเดียว
    clear(holder).append(
      h(
        'section',
        { class: 'card stack' },
        h('h2', {}, `สาขา ${data.branch.name} ยังไม่มีฟอร์มของตัวเอง`),
        h('p', { class: 'muted small' }, 'ตอนนี้ลูกค้าสาขานี้เห็นแม่แบบ'),
        h(
          'button',
          {
            class: 'btn primary',
            type: 'button',
            onclick: async () => {
              await api('/admin/survey/branch-mode', { method: 'POST', body: { branchId: data.branch.id, custom: true } });
              location.reload();
            },
          },
          'สร้างฟอร์มของสาขานี้จากแม่แบบ',
        ),
      ),
    );
  } else {
    draw();
  }
  const intro = 'แต่ละสาขามีฟอร์มของตัวเอง แก้แยกกัน · การเผยแพร่สร้างเวอร์ชันใหม่ คำตอบเก่าไม่ถูกแก้ · ข้อที่รหัสภายในเดียวกันยังเทียบสถิติข้ามสาขาได้';
  return h('div', {}, h('div', { class: 'page-head' }, h('h1', {}, 'แก้ไขคำถาม')), h('p', { class: 'muted' }, intro), scopeCard, holder);
}
