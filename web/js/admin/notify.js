import { api, ApiError } from '../api.js';
import { h, clear, toast, formatDateTime, formatNumber } from '../util.js';

// แจ้งเตือนอีเมลรีวิวใหม่: ผู้รับ (ทุกสาขา/รายสาขา), โหมดส่ง, สถานะคิว, ส่งทดสอบ
// ส่งจริงผ่าน Resend จาก Vercel (/api/notify-flush) — Render เข้าคิวอย่างเดียว
const DAILY_QUOTA = 100; // Resend ฟรี: 100 ฉบับ/วัน (ใช้ร่วมกับเว็บร้านถ้าใช้บัญชีเดียวกัน)
const MODES = [
  ['all', 'ทุกรีวิว', 'ได้อีเมลทันทีทุกครั้งที่ลูกค้าส่งแบบสอบถาม'],
  ['important', 'เฉพาะรีวิวที่ต้องดู', 'คะแนนต่ำ (มีข้อที่ได้ 1–2 หรือเฉลี่ยต่ำกว่า 3) หรือมีข้อเสนอแนะ · ช่วยประหยัดโควตาเมื่อรีวิวเยอะ'],
];

const errorText = (err) =>
  err instanceof ApiError && err.status === 422 && err.body?.error === 'too_many_recipients'
    ? `ผู้รับรวมได้ไม่เกิน ${err.body.max} รายการ`
    : err.body?.issues?.map((i) => i.message).join(', ') || 'บันทึกไม่สำเร็จ';

export async function notifyView() {
  const branches = await api('/admin/branches');
  const holder = h('div', { class: 'stack' });
  let data = await api('/admin/notify');

  const reload = async (next) => {
    data = next ?? (await api('/admin/notify'));
    draw();
  };

  function statusCard() {
    const s = data.stats;
    const stat = (label, value, hint) => h('div', { class: 'notify-stat' }, h('span', { class: 'muted small' }, label), h('b', {}, value), hint ? h('span', { class: 'muted small' }, hint) : null);
    return h(
      'section',
      { class: 'card stack' },
      h('h2', {}, 'สถานะ'),
      h(
        'div',
        { class: 'notify-stats' },
        stat('ส่งวันนี้ (นับต่อผู้รับ)', `${formatNumber(s.sentToday, 0)} / ${DAILY_QUOTA}`, 'โควตา Resend ฟรีต่อวัน'),
        stat('รอส่ง', formatNumber(s.pending, 0), s.pending ? 'จะลองส่งใหม่อัตโนมัติ' : null),
        stat('ส่งไม่สำเร็จ (7 วัน)', formatNumber(s.failed, 0)),
      ),
      s.lastError ? h('p', { class: 'alert error' }, `ข้อผิดพลาดล่าสุด (${formatDateTime(s.lastError.at)} · ลอง ${s.lastError.attempts} ครั้ง): `, h('code', {}, s.lastError.message)) : null,
    );
  }

  function modeCard() {
    return h(
      'section',
      { class: 'card stack' },
      h('h2', {}, 'ส่งเมื่อไหร่'),
      MODES.map(([value, title, hint]) =>
        h(
          'label',
          { class: 'check notify-mode' },
          h('input', {
            type: 'radio',
            name: 'notify-mode',
            value,
            checked: data.settings.mode === value,
            onchange: async () => {
              try {
                await reload(await api('/admin/notify/settings', { method: 'PUT', body: { mode: value } }));
                toast('บันทึกแล้ว');
              } catch (err) {
                toast(errorText(err));
              }
            },
          }),
          h('span', {}, h('b', {}, title), h('br'), h('span', { class: 'muted small' }, hint)),
        ),
      ),
    );
  }

  function addCard() {
    const email = h('input', { type: 'email', placeholder: 'เช่น manager@gmail.com', maxlength: 254, required: true, autocomplete: 'off', 'aria-label': 'อีเมลผู้รับ' });
    const allBranches = h('input', { type: 'radio', name: 'scope', value: 'all', checked: true });
    const someBranches = h('input', { type: 'radio', name: 'scope', value: 'some' });
    const boxes = branches.map((b) => h('input', { type: 'checkbox', value: b.id }));
    const picker = h('div', { class: 'copy-list hidden' }, branches.map((b, i) => h('label', { class: 'check' }, boxes[i], b.isActive ? b.name : `${b.name} (ปิดอยู่)`)));
    const sync = () => picker.classList.toggle('hidden', !someBranches.checked);
    allBranches.addEventListener('change', sync);
    someBranches.addEventListener('change', sync);
    const error = h('p', { class: 'alert error hidden', role: 'alert' });

    const form = h(
      'form',
      { class: 'card stack', novalidate: true },
      h('h2', {}, 'เพิ่มผู้รับ'),
      h('label', { class: 'field' }, h('span', {}, 'อีเมล'), email),
      h('div', { class: 'row' }, h('label', { class: 'check' }, allBranches, 'รับทุกสาขา'), h('label', { class: 'check' }, someBranches, 'เฉพาะบางสาขา')),
      picker,
      error,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, 'เพิ่มผู้รับ')),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.classList.add('hidden');
      const branchIds = someBranches.checked ? boxes.filter((b) => b.checked).map((b) => Number(b.value)) : [];
      if (someBranches.checked && !branchIds.length) {
        error.textContent = 'เลือกอย่างน้อย 1 สาขา';
        return error.classList.remove('hidden');
      }
      try {
        await reload(await api('/admin/notify/recipients', { method: 'POST', body: { email: email.value, branchIds } }));
        toast('เพิ่มผู้รับแล้ว');
      } catch (err) {
        error.textContent = errorText(err);
        error.classList.remove('hidden');
      }
    });
    return form;
  }

  function recipientsCard() {
    // รวมแถวตามอีเมล: 1 อีเมลอาจรับหลายสาขา (1 แถวต่อสาขา)
    const byEmail = new Map();
    for (const r of data.recipients) byEmail.set(r.email, [...(byEmail.get(r.email) ?? []), r]);
    const remove = async (r) => {
      if (!confirm(`เลิกส่งอีเมล${r.branch ? `ของ ${r.branch}` : 'ทุกสาขา'} ถึง ${r.email}?`)) return;
      await reload(await api(`/admin/notify/recipients/${r.id}`, { method: 'DELETE' }));
    };
    const test = h('button', { class: 'btn', type: 'button', disabled: !byEmail.size }, 'ส่งอีเมลทดสอบ');
    test.addEventListener('click', async () => {
      test.disabled = true;
      try {
        await api('/admin/notify/test', { method: 'POST' });
        const result = await api('/notify-flush', { method: 'POST' }).catch(() => null);
        if (result?.disabled) toast('ยังไม่ได้เปิดการส่งอีเมล (ตั้ง EMAIL_ENABLED + RESEND_API_KEY บน Vercel) — อีเมลทดสอบรออยู่ในคิว');
        else if (result?.failed) toast('ส่งไม่สำเร็จ — ดูข้อผิดพลาดในกล่องสถานะ');
        else toast('ส่งแล้ว — ตรวจกล่องจดหมาย (และโฟลเดอร์สแปม)');
      } catch (err) {
        toast(errorText(err));
      }
      await reload();
    });

    return h(
      'section',
      { class: 'card stack' },
      h('div', { class: 'row between' }, h('h2', {}, `ผู้รับ (${byEmail.size})`), test),
      byEmail.size
        ? h(
            'ul',
            { class: 'notify-list' },
            [...byEmail].map(([email, rows]) =>
              h(
                'li',
                {},
                h('b', {}, email),
                h(
                  'span',
                  { class: 'chips' },
                  rows.map((r) => h('span', { class: 'chip' }, r.branch ?? 'ทุกสาขา', h('button', { type: 'button', class: 'chip-x', 'aria-label': `ลบ ${r.branch ?? 'ทุกสาขา'} ของ ${email}`, onclick: () => remove(r) }, '×'))),
                ),
              ),
            ),
          )
        : h('p', { class: 'muted' }, 'ยังไม่มีผู้รับ — รีวิวใหม่จะยังไม่ส่งอีเมลถึงใคร'),
    );
  }

  function draw() {
    clear(holder).append(statusCard(), recipientsCard(), addCard(), modeCard());
  }

  draw();
  const intro = 'ส่งอีเมลถึงผู้รับทุกครั้งที่มีรีวิวใหม่: ผู้รับ "ทุกสาขา" ได้ทุกรีวิว ผู้รับรายสาขาได้เฉพาะสาขานั้น · ผู้ส่ง noreply@neawmoosaitaek.com ผ่าน Resend (ฟรี 100 ฉบับต่อวัน นับต่อผู้รับ)';
  return h('div', {}, h('div', { class: 'page-head' }, h('h1', {}, 'แจ้งเตือนอีเมล')), h('p', { class: 'muted' }, intro), holder);
}
