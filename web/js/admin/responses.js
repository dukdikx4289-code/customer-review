import { api } from '../api.js';
import { h, clear, formatDateTime, formatNumber } from '../util.js';

function cell(value) {
  if (value === undefined || value === null) return '–';
  if (Array.isArray(value)) return value.join(', ');
  return typeof value === 'number' ? formatNumber(value) : String(value);
}

/** ตารางคำตอบดิบ แบ่งหน้า — ใช้ทั้งหน้า "คำตอบ" และหน้ารายสาขา */
export async function responsesTable({ branchId = null } = {}) {
  const survey = await api('/admin/survey');
  const holder = h('div', {});
  let page = 1;

  async function load() {
    const q = new URLSearchParams({ page });
    if (branchId) q.set('branch_id', branchId);
    const data = await api(`/admin/responses?${q}`);
    const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
    const questions = survey.questions;

    const table = h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        {},
        h('thead', {}, h('tr', {}, h('th', {}, 'เวลา'), branchId ? null : h('th', {}, 'สาขา'), h('th', {}, 'ลิงก์'), questions.map((q) => h('th', { class: q.type === 'rating' ? 'num' : '' }, q.label)))),
        h('tbody', {}, data.items.length ? data.items.map((r) => h('tr', {}, h('td', {}, formatDateTime(r.submittedAt)), branchId ? null : h('td', {}, r.branch ?? '–'), h('td', {}, r.link ?? '–'), questions.map((q) => h('td', { class: q.type === 'rating' ? 'num' : '' }, cell(r.answers[q.key]))))) : h('tr', {}, h('td', { colspan: 3 + questions.length }, 'ยังไม่มีคำตอบ'))),
      ),
    );

    const pager = h(
      'div',
      { class: 'pager' },
      h('button', { class: 'btn small', type: 'button', disabled: page <= 1, onclick: () => { page -= 1; load(); } }, '‹ ก่อนหน้า'),
      h('span', { class: 'muted small' }, `หน้า ${page} / ${pages} · ทั้งหมด ${formatNumber(data.total, 0)} รายการ`),
      h('button', { class: 'btn small', type: 'button', disabled: page >= pages, onclick: () => { page += 1; load(); } }, 'ถัดไป ›'),
    );
    clear(holder).append(table, pager);
  }

  await load();
  return holder;
}

export async function responsesView() {
  return h('div', {}, h('div', { class: 'page-head' }, h('h1', {}, 'คำตอบทั้งหมด')), await responsesTable());
}
