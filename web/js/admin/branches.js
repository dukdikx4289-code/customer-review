import { api, ApiError } from '../api.js';
import { h, clear, toast } from '../util.js';
import { statsPanel } from './overview.js';
import { linksPanel } from './links.js';
import { responsesTable } from './responses.js';

const errorText = (err) => (err instanceof ApiError && err.status === 409 ? 'รหัสสาขานี้ถูกใช้แล้ว' : err.body?.issues?.map((i) => i.message).join(', ') || 'บันทึกไม่สำเร็จ');

export async function branchesView() {
  const holder = h('div', {});

  async function reload() {
    const branches = await api('/admin/branches');
    clear(holder).append(
      addForm(reload),
      h('div', { class: 'list' }, branches.length ? branches.map((b) => branchRow(b, reload)) : h('p', { class: 'muted' }, 'ยังไม่มีสาขา')),
    );
  }

  await reload();
  return h('div', {}, h('div', { class: 'page-head' }, h('h1', {}, 'จัดการสาขา')), h('p', { class: 'muted' }, 'แต่ละสาขามีลิงก์/QR ของตัวเอง คำตอบจึงรู้ว่ามาจากสาขาไหนโดยลูกค้าไม่ต้องเลือก'), holder);
}

function addForm(reload) {
  const code = h('input', { type: 'text', name: 'code', placeholder: 'เช่น BKK03', maxlength: 32, required: true, 'aria-label': 'รหัสสาขา' });
  const name = h('input', { type: 'text', name: 'name', placeholder: 'เช่น สาขาอารีย์', maxlength: 120, required: true, 'aria-label': 'ชื่อสาขา' });
  const error = h('p', { class: 'alert error hidden', role: 'alert' });
  const form = h('form', { class: 'card stack', novalidate: true }, h('h2', {}, 'เพิ่มสาขา'), h('div', { class: 'grid-cards' }, h('label', { class: 'field' }, h('span', {}, 'รหัสสาขา'), code), h('label', { class: 'field' }, h('span', {}, 'ชื่อสาขา'), name)), error, h('button', { class: 'btn primary', type: 'submit' }, 'เพิ่มสาขา'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.classList.add('hidden');
    try {
      await api('/admin/branches', { method: 'POST', body: { code: code.value, name: name.value } });
      toast('เพิ่มสาขาแล้ว');
      await reload();
    } catch (err) {
      error.textContent = errorText(err);
      error.classList.remove('hidden');
    }
  });
  return form;
}

function branchRow(b, reload) {
  const rename = async () => {
    const next = prompt('ชื่อสาขาใหม่', b.name);
    if (!next || next.trim() === b.name) return;
    try {
      await api(`/admin/branches/${b.id}`, { method: 'PATCH', body: { name: next.trim() } });
      await reload();
    } catch (err) {
      toast(errorText(err));
    }
  };
  const toggle = async () => {
    if (b.isActive && !confirm(`ปิดสาขา "${b.name}"?\nลิงก์/QR ของสาขานี้จะใช้ส่งรีวิวไม่ได้ (ข้อมูลเดิมยังอยู่)`)) return;
    await api(`/admin/branches/${b.id}`, { method: 'PATCH', body: { isActive: !b.isActive } });
    await reload();
  };
  return h(
    'article',
    { class: 'card row between' },
    h('div', {}, h('h3', {}, b.name), h('span', { class: 'key' }, b.code), ' ', h('span', { class: `badge ${b.isActive ? 'good' : 'off'}` }, b.isActive ? 'เปิดอยู่' : 'ปิดอยู่')),
    h('div', { class: 'row' }, h('a', { class: 'btn small primary', href: `#/branch/${b.id}` }, 'ดูผลและลิงก์'), h('a', { class: 'btn small', href: `#/survey/${b.id}` }, 'แก้ฟอร์ม'), h('button', { class: 'btn small', type: 'button', onclick: rename }, 'แก้ชื่อ'), h('button', { class: 'btn small', type: 'button', onclick: toggle }, b.isActive ? 'ปิดสาขา' : 'เปิดสาขา')),
  );
}

export async function branchDetailView({ param }) {
  const id = Number(param);
  const branches = await api('/admin/branches');
  const branch = branches.find((b) => b.id === id);
  if (!branch) return h('div', { class: 'alert error' }, 'ไม่พบสาขานี้');

  const tabs = {
    stats: ['ผลฟีดแบ็ค', () => statsPanel({ branchId: id })],
    links: ['ลิงก์และ QR', () => linksPanel({ branchId: id, branches })],
    responses: ['คำตอบทั้งหมด', () => responsesTable({ branchId: id })],
  };
  const body = h('div', {});
  const bar = h('div', { class: 'seg', role: 'tablist' });
  let current = 'stats';

  async function show(key) {
    current = key;
    for (const btn of bar.children) btn.setAttribute('aria-pressed', String(btn.dataset.key === key));
    clear(body).append(h('p', { class: 'muted' }, 'กำลังโหลด…'));
    const node = await tabs[key][1]();
    if (current === key) clear(body).append(node);
  }

  for (const [key, [label]] of Object.entries(tabs)) {
    bar.append(h('button', { type: 'button', role: 'tab', dataset: { key }, 'aria-pressed': String(key === current), onclick: () => show(key) }, label));
  }
  await show('stats');

  return h('div', {}, h('p', { class: 'small' }, h('a', { href: '#/branches' }, '‹ สาขาทั้งหมด')), h('div', { class: 'page-head' }, h('h1', {}, branch.name), bar), body);
}
