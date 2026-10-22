import { api, ApiError } from '../api.js';
import { h, clear, formatDateTime, toast } from '../util.js';

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('คัดลอกลิงก์แล้ว');
  } catch {
    const input = h('input', { value: text });
    document.body.append(input);
    input.select();
    document.execCommand('copy');
    input.remove();
    toast('คัดลอกลิงก์แล้ว');
  }
}

const CHANNEL_LABELS = { choose: 'เลือกเอง', store: 'หน้าร้าน', online: 'ออนไลน์' };
// ตัวเลือกช่องทางของลิงก์ลูกค้า ("เลือกเอง" = QR เดียว ลูกค้าเลือกหน้าร้าน/ออนไลน์ตอนสแกน)
const CHANNEL_OPTIONS = [
  ['choose', 'ให้ลูกค้าเลือกเอง (QR เดียว)'],
  ['store', 'หน้าร้านเท่านั้น'],
  ['online', 'ออนไลน์เท่านั้น'],
];

function statusBadge(l) {
  if (!l.isActive) return h('span', { class: 'badge off' }, 'ปิดใช้งาน');
  if (l.expiresAt && new Date(l.expiresAt) <= new Date()) return h('span', { class: 'badge off' }, 'หมดอายุ');
  return h('span', { class: 'badge good' }, 'ใช้งานอยู่');
}

/** เปลี่ยนช่องทางของ QR เดิม (รหัสใน QR ไม่เปลี่ยน ไม่ต้องพิมพ์ใหม่) */
function channelPicker(l, act) {
  const current = l.channel ?? 'store';
  const select = h('select', { 'aria-label': `ช่องทางของ ${l.label}` }, CHANNEL_OPTIONS.map(([value, text]) => h('option', { value, selected: value === current }, text)));
  select.addEventListener('change', () => {
    const next = select.value;
    const what = next === 'choose' ? 'ลูกค้าจะเห็นหน้า "ครั้งนี้สั่งแบบไหน?" ก่อนตอบ' : `ลูกค้าจะเข้าคำถามชุด${CHANNEL_LABELS[next]}ทันที`;
    if (!confirm(`เปลี่ยนช่องทางของ "${l.label}"?\n${what}\nQR เดิมใช้ได้เหมือนเดิม ไม่ต้องพิมพ์ใหม่`)) {
      select.value = current;
      return;
    }
    act(() => api(`/admin/links/${l.id}`, { method: 'PATCH', body: { channel: next } }))();
  });
  return h('label', { class: 'field inline channel-pick' }, h('span', {}, 'ช่องทาง'), select);
}

function linkCard(l, reload) {
  const isCustomer = l.kind === 'customer';
  const urlInput = h('input', { type: 'text', readonly: true, value: l.url, 'aria-label': 'ลิงก์', onfocus: (e) => e.target.select() });

  const act = (fn) => async () => {
    try {
      await fn();
      await reload();
    } catch (err) {
      toast(err instanceof ApiError ? `ไม่สำเร็จ (${err.message})` : 'ไม่สำเร็จ');
    }
  };

  const details = h(
    'div',
    {},
    h('div', { class: 'row' }, h('h3', {}, l.label), h('span', { class: 'badge' }, isCustomer ? `ลูกค้า · ${CHANNEL_LABELS[l.channel] ?? 'หน้าร้าน'}` : 'ผู้บริหาร'), statusBadge(l)),
    h('p', { class: 'muted small' }, isCustomer ? `สาขา: ${l.branchName ?? '–'}` : `ขอบเขต: ${l.branchName ?? 'ทุกสาขา'}`, ` · สร้างเมื่อ ${formatDateTime(l.createdAt)}`, l.expiresAt ? ` · หมดอายุ ${formatDateTime(l.expiresAt)}` : '', !isCustomer ? ` · เปิดดู ${l.hitCount} ครั้ง${l.lastUsedAt ? ` (ล่าสุด ${formatDateTime(l.lastUsedAt)})` : ''}` : ''),
    h('div', { class: 'url-row' }, urlInput, h('button', { class: 'btn', type: 'button', onclick: () => copy(l.url) }, 'คัดลอก')),
    isCustomer ? h('p', { class: 'muted small' }, '🔒 QR นี้คงที่ — แก้คำถาม สาขา ช่องทาง หรืออัปเดตระบบแล้วยังใช้ได้เหมือนเดิม จนกว่าจะกด "ลบลิงก์"') : null,
    isCustomer ? channelPicker(l, act) : null,
    h(
      'div',
      { class: 'actions' },
      h('a', { class: 'btn small', href: l.url, target: '_blank', rel: 'noopener noreferrer' }, 'เปิดลิงก์'),
      isCustomer ? h('a', { class: 'btn small', href: `/api/admin/links/${l.id}/qr?format=svg&download=1` }, 'ดาวน์โหลด QR (SVG)') : null,
      isCustomer ? h('a', { class: 'btn small', href: `/api/admin/links/${l.id}/qr?format=png&download=1` }, 'ดาวน์โหลด QR (PNG)') : null,
      h('button', { class: 'btn small', type: 'button', onclick: act(() => api(`/admin/links/${l.id}`, { method: 'PATCH', body: { isActive: !l.isActive } })) }, l.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'),
      // QR ลูกค้าคงที่ตลอดอายุลิงก์ (ไม่มีปุ่มหมุนเวียน) — ต้องการ QR ใหม่ = ลบแล้วสร้างใหม่
      isCustomer
        ? null
        : h(
            'button',
            {
              class: 'btn small danger',
              type: 'button',
              onclick: () => {
                if (confirm(`หมุนเวียนลิงก์ "${l.label}"?\nลิงก์เดิมที่ส่งให้ผู้บริหารจะใช้ไม่ได้ทันที ต้องส่งลิงก์ใหม่ให้`)) act(() => api(`/admin/links/${l.id}/rotate`, { method: 'POST' }))();
              },
            },
            'หมุนเวียนลิงก์ (ออกใหม่)',
          ),
      h(
        'button',
        {
          class: 'btn small danger',
          type: 'button',
          onclick: () => {
            const warn = isCustomer ? 'QR ที่แจกหรือพิมพ์ไปแล้วจะใช้ไม่ได้ถาวร ต้องสร้างลิงก์และพิมพ์ QR ใหม่' : 'ผู้บริหารที่มีลิงก์นี้จะเปิด Dashboard ไม่ได้ทันที';
            if (confirm(`ลบลิงก์ "${l.label}" ถาวร?\n${warn}\nรีวิวที่ส่งผ่านลิงก์นี้ยังอยู่ครบ · ย้อนกลับไม่ได้`)) {
              act(async () => {
                await api(`/admin/links/${l.id}`, { method: 'DELETE' });
                toast('ลบลิงก์แล้ว');
              })();
            }
          },
        },
        'ลบลิงก์',
      ),
    ),
  );

  const card = h('article', { class: `card link-card${isCustomer ? ' has-qr' : ''}` }, details);
  if (isCustomer && l.isActive) card.append(h('img', { class: 'qr', src: `/api/admin/links/${l.id}/qr`, alt: `QR code ของ ${l.label}`, width: 168, height: 168, loading: 'lazy' }));
  return card;
}

/** รายการลิงก์ + ฟอร์มสร้าง ใช้ทั้งหน้า "ลิงก์และ QR" และหน้ารายสาขา */
export async function linksPanel({ branchId = null, branches }) {
  const holder = h('div', {});

  async function reload() {
    const q = branchId ? `?branch_id=${branchId}` : '';
    const links = await api(`/admin/links${q}`);
    const customer = (channel) => links.filter((l) => l.kind === 'customer' && (l.channel ?? 'store') === channel);
    const dash = links.filter((l) => l.kind === 'dashboard');
    const section = (channel, title, hint) => [
      h('h2', {}, title),
      h('p', { class: 'muted small' }, hint),
      customer(channel).length ? h('div', { class: 'list' }, customer(channel).map((l) => linkCard(l, reload))) : h('p', { class: 'muted' }, 'ยังไม่มีลิงก์ — สร้างด้านบนได้เลย'),
    ];
    clear(holder).append(
      createForm(),
      ...section('choose', 'QR ลูกค้าเลือกเอง (แนะนำ)', 'QR เดียวใช้ได้ทุกที่ — สแกนแล้วลูกค้าเลือก "หน้าร้าน" หรือ "ออนไลน์" ก่อนตอบ'),
      ...(customer('store').length ? section('store', 'QR หน้าร้านเท่านั้น', 'ลูกค้าเข้าคำถามชุดหน้าร้านทันที') : []),
      ...(customer('online').length ? section('online', 'QR ออนไลน์เท่านั้น', 'ลูกค้าเข้าคำถามชุดออนไลน์ทันที (เช่น สาขาที่มีแต่สั่งออนไลน์)') : []),
      branchId ? null : h('h2', { style: undefined }, 'ลิงก์สำหรับผู้บริหาร (Dashboard รวม)'),
      branchId ? null : dash.length ? h('div', { class: 'list' }, dash.map((l) => linkCard(l, reload))) : h('p', { class: 'muted' }, 'ยังไม่มีลิงก์ผู้บริหาร'),
    );
  }

  function createForm() {
    const kind = h('select', { name: 'kind', 'aria-label': 'ชนิดลิงก์' }, h('option', { value: 'customer' }, 'ลิงก์ลูกค้า (QR)'), branchId ? null : h('option', { value: 'dashboard' }, 'ลิงก์ผู้บริหาร (Dashboard)'));
    const branchSel = h('select', { name: 'branch', 'aria-label': 'สาขา' }, branchId ? null : h('option', { value: '' }, 'ทุกสาขา (เฉพาะลิงก์ผู้บริหาร)'), branches.filter((b) => b.isActive && (!branchId || b.id === branchId)).map((b) => h('option', { value: b.id, selected: b.id === branchId }, b.name)));
    const channel = h('select', { name: 'channel', 'aria-label': 'ช่องทาง' }, CHANNEL_OPTIONS.map(([value, text]) => h('option', { value }, text)));
    const channelField = h('label', { class: 'field' }, h('span', {}, 'ช่องทาง'), channel);
    const label = h('input', { type: 'text', name: 'label', maxlength: 200, placeholder: 'ชื่อลิงก์ เช่น “QR หน้าร้าน” / “ผู้บริหาร ไตรมาส 4”', 'aria-label': 'ชื่อลิงก์', required: true });
    const expires = h('input', { type: 'datetime-local', name: 'expires', 'aria-label': 'วันหมดอายุ (ไม่บังคับ)' });
    const error = h('p', { class: 'alert error hidden', role: 'alert' });

    kind.addEventListener('change', () => {
      const dash = kind.value === 'dashboard';
      branchSel.querySelector('option[value=""]')?.toggleAttribute('hidden', !dash);
      if (!dash && !branchSel.value) branchSel.selectedIndex = 1;
      channelField.classList.toggle('hidden', dash); // ลิงก์ผู้บริหารไม่ผูกช่องทาง (กรองใน Dashboard แทน)
    });
    if (!branchId) branchSel.selectedIndex = 1; // เริ่มต้นเป็นสาขาแรก (ลิงก์ลูกค้าต้องมีสาขา)

    const form = h(
      'form',
      { class: 'card stack', novalidate: true },
      h('h2', {}, 'สร้างลิงก์ใหม่'),
      h('div', { class: 'grid-cards' }, h('label', { class: 'field' }, h('span', {}, 'ชนิด'), kind), channelField, h('label', { class: 'field' }, h('span', {}, 'สาขา'), branchSel), h('label', { class: 'field' }, h('span', {}, 'ชื่อลิงก์'), label), h('label', { class: 'field' }, h('span', {}, 'หมดอายุ (ไม่บังคับ)'), expires)),
      error,
      h('button', { class: 'btn primary', type: 'submit' }, 'สร้างลิงก์'),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.classList.add('hidden');
      try {
        await api('/admin/links', {
          method: 'POST',
          body: { kind: kind.value, channel: kind.value === 'customer' ? channel.value : null, branchId: branchSel.value ? Number(branchSel.value) : null, label: label.value, expiresAt: expires.value ? new Date(expires.value).toISOString() : null },
        });
        toast('สร้างลิงก์แล้ว');
        await reload();
      } catch (err) {
        error.textContent = err.body?.issues?.map((i) => i.message).join(', ') || 'สร้างลิงก์ไม่สำเร็จ';
        error.classList.remove('hidden');
      }
    });
    return form;
  }

  await reload();
  return holder;
}

export async function linksView() {
  const branches = await api('/admin/branches');
  return h('div', {}, h('div', { class: 'page-head' }, h('h1', {}, 'ลิงก์และ QR code')), h('p', { class: 'muted' }, 'ลิงก์ลูกค้าใช้ได้ไม่จำกัดจำนวนครั้ง ใครสแกนก็ตอบได้ · ลิงก์ผู้บริหารเป็นความลับ ส่งให้เฉพาะผู้ที่ต้องดู Dashboard'), await linksPanel({ branches }));
}
