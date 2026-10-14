// ประกอบหน้า Dashboard: ส่วนหัว + ตัวกรอง + กริด widget  (ใช้ทั้งหน้าผู้บริหาร /d และหน้าแอดมิน)
// - เพิ่ม/แก้การ์ด:  js/dashboard/widgets.js      - ชิ้นส่วนเล็กๆ: js/dashboard/ui.js     - ลากจัดวาง: js/dashboard/grid.js
// - ลูกเล่น:         js/ui/motion.js, css/effects.css   - โมดอล: js/ui/modal.js        - หน้าตา: css/widgets.css, css/dashboard.css
import { h, clear, formatDateTime } from './util.js';
import { createBoard } from './dashboard/grid.js';
import { tile } from './dashboard/ui.js';
import { WIDGETS } from './dashboard/widgets.js';
import { reveal, countAll } from './ui/motion.js';
import { openModal } from './ui/modal.js';

const RANGES = [
  ['7d', '7 วัน'],
  ['30d', '30 วัน'],
  ['90d', '90 วัน'],
  ['all', 'ทั้งหมด'],
];

const CHANNELS = [
  ['', 'ทุกช่องทาง'],
  ['store', 'หน้าร้าน'],
  ['online', 'ออนไลน์'],
];

/**
 * วาด Dashboard ลงใน container
 * opts: { range, branchId, channel, onChange({range?, branchId?, channel?}), showBranchFilter, layoutKey }
 */
export function renderDashboard(container, data, opts) {
  const { range, branchId, onChange } = opts;
  const channel = opts.channel ?? '';
  const firstRender = !container.dataset.rendered;
  container.dataset.rendered = '1';

  const rangeSeg = h(
    'div',
    { class: 'seg', role: 'group', 'aria-label': 'ช่วงเวลา' },
    RANGES.map(([value, label]) => h('button', { type: 'button', 'aria-pressed': String(range === value), onclick: () => onChange({ range: value, branchId, channel }) }, label)),
  );

  let branchSelect = null;
  if (opts.showBranchFilter && data.branchOptions?.length > 1) {
    branchSelect = h(
      'select',
      { 'aria-label': 'สาขา', onchange: (e) => onChange({ range, channel, branchId: e.target.value ? Number(e.target.value) : null }) },
      h('option', { value: '' }, 'ทุกสาขา'),
      data.branchOptions.map((b) => h('option', { value: b.id, selected: branchId === b.id }, b.name)),
    );
  }

  const channelSeg = h(
    'div',
    { class: 'seg', role: 'group', 'aria-label': 'ช่องทาง' },
    CHANNELS.map(([value, label]) => h('button', { type: 'button', 'aria-pressed': String(channel === value), onclick: () => onChange({ range, branchId, channel: value }) }, label)),
  );

  const rangeLabel = RANGES.find(([v]) => v === data.range)?.[1] ?? '';
  const channelLabel = CHANNELS.find(([v]) => v === (data.channel ?? ''))?.[1];
  const head = h(
    'div',
    { class: 'dash-head' },
    h('div', {}, h('p', { class: 'eyebrow' }, `ผลฟีดแบ็คลูกค้า · ${channelLabel} · ${rangeLabel === 'ทั้งหมด' ? 'ทุกช่วงเวลา' : `${rangeLabel}ล่าสุด`}`), h('h1', { class: 'grad-text' }, data.title || 'ผลฟีดแบ็คลูกค้า'), h('p', { class: 'scope' }, data.scope || '')),
    h('div', { class: 'filters' }, branchSelect, channelSeg, rangeSeg),
  );
  const root = h('div', {}, head);

  if (!data.totals.responses) {
    root.append(h('div', { class: 'card empty' }, h('p', {}, 'ยังไม่มีรีวิวในช่วงเวลานี้'), h('p', { class: 'small' }, 'ลองเลือกช่วงเวลาที่กว้างขึ้น')));
    clear(container).append(root);
    return;
  }

  const ctx = { rangeLabel };
  const tiles = WIDGETS.map((w) => ({
    id: w.id,
    el: tile({
      id: w.id,
      size: w.size,
      title: w.title,
      animate: firstRender,
      ...w.render(data, ctx),
      onExpand: (opener) => {
        const { body } = (w.expanded ?? w.render)(data, ctx);
        openModal({ title: w.title, eyebrow: data.scope || undefined, body: h('div', { class: 'xcard w-body' }, body), opener });
      },
    }),
  }));

  const board = createBoard({ tiles, storageKey: `rv.layout.${opts.layoutKey ?? 'default'}` });
  const hintId = 'board-hint';
  const reset = h('button', { class: 'btn small', type: 'button', onclick: () => board.reset() }, 'รีเซ็ตการจัดวาง');
  root.append(
    h('div', { class: 'board-bar' }, h('p', { id: hintId, class: 'hint-line' }, h('span', { class: 'hint-mouse' }, 'ลากการ์ดเพื่อจัดวางใหม่ได้ตามต้องการ'), h('span', { class: 'hint-touch' }, 'กดการ์ดค้างไว้แล้วลากเพื่อจัดวางใหม่'), ' · Alt + ลูกศรเมื่อใช้คีย์บอร์ด · ปุ่ม ⤢ เปิดดูแบบเต็ม'), reset),
    board.el,
    h('p', { class: 'updated' }, `อัปเดตล่าสุด ${formatDateTime(data.generatedAt)}`),
  );
  board.el.setAttribute('aria-describedby', hintId);
  clear(container).append(root);

  reveal(board.el); // การ์ดเลื่อนขึ้นทีละใบ (เฉพาะครั้งแรก)
  countAll(board.el); // ตัวเลขใหญ่นับขึ้นจาก 0
}
